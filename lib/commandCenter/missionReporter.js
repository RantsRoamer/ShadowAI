'use strict';

const { getConfig } = require('../config.js');
const { ollamaChatJson } = require('../ollama.js');
const agentStore = require('../agentStore.js');
const hiveStore = require('../hiveMind/store.js');

const TERMINAL_STATUSES = new Set(['complete', 'failed']);

function safeText(s, max = 4000) {
  return String(s || '').trim().slice(0, max);
}

function getLastTaskNote(task) {
  const log = Array.isArray(task && task.log) ? task.log : [];
  for (let i = log.length - 1; i >= 0; i--) {
    const entry = log[i];
    const content = safeText(entry && entry.content ? entry.content : '', 500);
    if (content) return content;
  }
  return '';
}

function buildMissionCompletionPayload(mission, tasks) {
  const statusCounts = {};
  const normalizedTasks = tasks.map((task) => {
    const status = String(task && task.status ? task.status : 'unknown');
    statusCounts[status] = (statusCounts[status] || 0) + 1;
    return {
      id: task.id,
      title: task.title || task.goal || task.id,
      status,
      role: task.role || null,
      lastNote: getLastTaskNote(task)
    };
  });

  return {
    missionId: mission.id,
    title: mission.title || 'Mission',
    summary: mission.summary || '',
    statusCounts,
    tasks: normalizedTasks
  };
}

function shouldFinalizeMission(mission, tasks) {
  if (!mission || !mission.id || mission.finalReport) return false;
  const taskIds = Array.isArray(mission.taskIds) ? mission.taskIds.filter(Boolean) : [];
  if (taskIds.length === 0 || tasks.length !== taskIds.length) return false;
  return tasks.every((task) => TERMINAL_STATUSES.has(String(task && task.status ? task.status : '')));
}

async function summarizeMissionCompletion(payload) {
  const cfg = getConfig();
  const baseUrl = cfg.ollama?.mainUrl || 'http://localhost:11434';
  const model = cfg.ollama?.mainModel || 'llama3.2';
  const system = [
    'You are the Shadow Command Center mission reporter.',
    'Summarize a finished multi-agent mission into a concise final report.',
    'Return ONLY strict JSON with keys:',
    '{ "headline": string, "summary": string, "outcome": "complete"|"partial"|"failed" }',
    'Keep the summary to 3-6 short sentences.',
    'Base the outcome on the task statuses: all complete => complete; mix of complete/failed => partial; all failed => failed.'
  ].join('\n');
  const data = await ollamaChatJson(baseUrl, model, [
    { role: 'system', content: system },
    { role: 'user', content: JSON.stringify(payload, null, 2) }
  ]);
  const raw = safeText(data?.message?.content || '', 4000);
  const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  const parsed = JSON.parse(cleaned);
  return {
    headline: safeText(parsed && parsed.headline ? parsed.headline : payload.title, 200),
    summary: safeText(parsed && parsed.summary ? parsed.summary : '', 2000),
    outcome: ['complete', 'partial', 'failed'].includes(parsed && parsed.outcome) ? parsed.outcome : 'partial'
  };
}

async function finalizeCompletedMissions() {
  const snap = hiveStore.getSnapshot();
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
      const allComplete = tasks.every((task) => task.status === 'complete');
      const allFailed = tasks.every((task) => task.status === 'failed');
      report = {
        headline: mission.title || 'Mission complete',
        summary: allComplete
          ? 'All child agent tasks completed successfully.'
          : 'Mission reached a terminal state, but some child tasks did not complete successfully.',
        outcome: allComplete ? 'complete' : (allFailed ? 'failed' : 'partial')
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
    hiveStore.appendEvent({
      type: 'mission_completed',
      source: 'command_center',
      missionId: mission.id,
      message: report.headline,
      payload: { outcome: report.outcome }
    });
    changed = true;
  }

  if (changed) {
    hiveStore.updateSnapshot({ missions });
  }

  return missions;
}

module.exports = {
  TERMINAL_STATUSES,
  shouldFinalizeMission,
  buildMissionCompletionPayload,
  summarizeMissionCompletion,
  finalizeCompletedMissions
};

