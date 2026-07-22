'use strict';

const { getConfig } = require('../config.js');
const { chatJson, resolveLlm } = require('../llm.js');
const agentStore = require('../agentStore.js');
const hiveStore = require('../hiveMind/store.js');

/** Statuses that mean a mission child will not advance further without human action. */
const TERMINAL_STATUSES = new Set(['complete', 'failed', 'blocked']);
const ACTIVE_STATUSES = new Set(['queued', 'planning', 'executing', 'learning', 'awaiting_approval']);

function safeText(s, max = 4000) {
  return String(s || '').trim().slice(0, max);
}

function isBoilerplateNote(text) {
  const t = safeText(text, 300).toLowerCase();
  if (!t) return true;
  return (
    t.includes('learning phase complete') ||
    (t.includes('step ') && t.includes(' complete')) ||
    t.startsWith('all steps complete') ||
    t.startsWith('plan created')
  );
}

function getLastTaskNote(task) {
  const log = Array.isArray(task && task.log) ? task.log : [];
  for (let i = log.length - 1; i >= 0; i--) {
    const entry = log[i];
    const content = safeText(entry && entry.content ? entry.content : '', 500);
    if (content && !isBoilerplateNote(content)) return content;
  }
  for (let i = log.length - 1; i >= 0; i--) {
    const entry = log[i];
    const content = safeText(entry && entry.content ? entry.content : '', 500);
    if (content) return content;
  }
  return '';
}

function getTaskEvidence(task) {
  const log = Array.isArray(task && task.log) ? task.log : [];
  const evidence = [];
  for (let i = log.length - 1; i >= 0; i--) {
    const entry = log[i];
    const type = String(entry && entry.type ? entry.type : '');
    const content = safeText(entry && entry.content ? entry.content : '', 800);
    if (!content) continue;
    if (type === 'result' || (type === 'thought' && !isBoilerplateNote(content))) {
      evidence.push(content);
    }
    if (evidence.length >= 4) break;
  }
  return evidence.reverse();
}

function buildMissionCompletionPayload(mission, tasks) {
  const statusCounts = {};
  let hasConcreteData = false;
  const taskIds = Array.isArray(mission && mission.taskIds) ? mission.taskIds.filter(Boolean) : [];
  const byId = new Map((tasks || []).map((t) => [t.id, t]));

  const normalizedTasks = taskIds.map((id) => {
    const task = byId.get(id);
    if (!task) {
      statusCounts.missing = (statusCounts.missing || 0) + 1;
      return {
        id,
        title: id,
        status: 'missing',
        role: null,
        lastNote: 'Task record was deleted or unavailable.',
        evidence: []
      };
    }
    const status = String(task.status || 'unknown');
    statusCounts[status] = (statusCounts[status] || 0) + 1;
    const evidence = getTaskEvidence(task);
    if (evidence.length > 0) hasConcreteData = true;
    return {
      id: task.id,
      title: task.title || task.goal || task.id,
      status,
      role: task.role || null,
      lastNote: getLastTaskNote(task),
      evidence
    };
  });

  return {
    missionId: mission.id,
    title: mission.title || 'Mission',
    summary: mission.summary || '',
    statusCounts,
    tasks: normalizedTasks,
    hasConcreteData
  };
}

/**
 * Finalize when every child is done advancing:
 * - complete / failed / blocked count as terminal
 * - missing (deleted) tasks count as terminal failures
 * - still-active statuses keep the mission open
 */
function shouldFinalizeMission(mission, tasks) {
  if (!mission || !mission.id || mission.finalReport) return false;
  const taskIds = Array.isArray(mission.taskIds) ? mission.taskIds.filter(Boolean) : [];
  if (taskIds.length === 0) return false;

  const byId = new Map((tasks || []).filter(Boolean).map((t) => [t.id, t]));
  for (const id of taskIds) {
    const task = byId.get(id);
    if (!task) continue; // missing => treat as terminal
    const status = String(task.status || '');
    if (ACTIVE_STATUSES.has(status)) return false;
    if (!TERMINAL_STATUSES.has(status)) return false;
  }
  return true;
}

function inferOutcomeFromPayload(payload) {
  const counts = (payload && payload.statusCounts) || {};
  const complete = counts.complete || 0;
  const failed = (counts.failed || 0) + (counts.missing || 0);
  const blocked = counts.blocked || 0;
  const total = Object.values(counts).reduce((a, b) => a + Number(b || 0), 0);
  if (total > 0 && complete === total) return 'complete';
  if (total > 0 && failed === total) return 'failed';
  if (blocked > 0 || failed > 0 || !payload.hasConcreteData) return 'partial';
  return 'partial';
}

async function summarizeMissionCompletion(payload) {
  const cfg = getConfig();
  const llm = resolveLlm(cfg);
  const system = [
    'You are the Shadow Command Center mission reporter.',
    'Summarize a finished multi-agent mission into a clear, human-readable report grounded in task evidence.',
    'Return ONLY strict JSON with keys (no extra keys):',
    '{ "headline": string, "summary": string, "outcome": "complete"|"partial"|"failed", "finalReport": string }',
    '"summary" must be a 3-6 sentence high-level overview.',
    '"finalReport" must be a merged, well-structured narrative (2-8 short paragraphs) suitable for the user to read as-is.',
    'Base the outcome on task statuses and evidence quality.',
    'If any tasks are blocked, missing, or failed, set outcome to "partial" or "failed" as appropriate and say so explicitly.',
    'If statuses are complete but concrete outputs are missing/empty, set outcome to "partial" and say that explicitly.',
    'Never claim data was retrieved unless evidence contains that data.',
    'In "finalReport", do NOT mention internal agent steps or tool names; focus only on user-facing facts and conclusions.'
  ].join('\n');
  const data = await chatJson(llm, [
    { role: 'system', content: system },
    { role: 'user', content: JSON.stringify(payload, null, 2) }
  ]);
  const raw = safeText(data?.message?.content || '', 4000);
  const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  const parsed = JSON.parse(cleaned);
  return {
    headline: safeText(parsed && parsed.headline ? parsed.headline : payload.title, 200),
    summary: safeText(parsed && parsed.summary ? parsed.summary : '', 2000),
    outcome: ['complete', 'partial', 'failed'].includes(parsed && parsed.outcome) ? parsed.outcome : inferOutcomeFromPayload(payload),
    finalReport: safeText(parsed && parsed.finalReport ? parsed.finalReport : (parsed && parsed.summary ? parsed.summary : ''), 16000)
  };
}

async function finalizeCompletedMissions({ scopeUser = '' } = {}) {
  const snap = hiveStore.getSnapshot({ scopeUser });
  const missions = Array.isArray(snap.missions) ? [...snap.missions] : [];
  let changed = false;

  for (let i = 0; i < missions.length; i++) {
    const mission = missions[i];
    const taskIds = Array.isArray(mission && mission.taskIds) ? mission.taskIds.filter(Boolean) : [];
    if (!taskIds.length || mission.finalReport) continue;
    const tasks = taskIds.map((id) => agentStore.getTask(id)).filter(Boolean);
    if (!shouldFinalizeMission(mission, tasks)) continue;

    const payload = buildMissionCompletionPayload(mission, tasks);
    let report;
    try {
      report = await summarizeMissionCompletion(payload);
    } catch (e) {
      const outcome = inferOutcomeFromPayload(payload);
      report = {
        headline: mission.title || 'Mission complete',
        summary: outcome === 'complete'
          ? 'All child agent tasks completed successfully.'
          : 'Mission reached a terminal state, but some child tasks did not complete successfully (failed, blocked, or missing).',
        outcome,
        finalReport: ''
      };
    }

    missions[i] = {
      ...mission,
      completedAt: new Date().toISOString(),
      finalReport: {
        ...report,
        payload
      }
    };
    hiveStore.appendEvent(
      {
        type: 'mission_completed',
        source: 'command_center',
        missionId: mission.id,
        user: scopeUser || (mission.user || null),
        message: report.headline,
        payload: { outcome: report.outcome }
      },
      { scopeUser }
    );
    changed = true;
  }

  if (changed) {
    hiveStore.updateSnapshot({ missions }, { scopeUser });
  }

  return missions;
}

module.exports = {
  TERMINAL_STATUSES,
  ACTIVE_STATUSES,
  shouldFinalizeMission,
  buildMissionCompletionPayload,
  summarizeMissionCompletion,
  finalizeCompletedMissions,
  inferOutcomeFromPayload
};
