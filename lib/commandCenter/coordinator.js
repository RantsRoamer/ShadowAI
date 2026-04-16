'use strict';

const crypto = require('crypto');
const { getConfig } = require('../config.js');
const { ollamaChatJson } = require('../ollama.js');
const agentStore = require('../agentStore.js');
const hiveStore = require('../hiveMind/store.js');
const { getRole } = require('./roles.js');

function safeText(s, max = 6000) {
  return String(s || '').trim().slice(0, max);
}

function pickEnabledAgentId(preferredAgentId) {
  const cfg = getConfig();
  const pref = String(preferredAgentId || '').trim();
  if (!pref) return null;
  const agents = Array.isArray(cfg.ollama && cfg.ollama.agents) ? cfg.ollama.agents : [];
  const match = agents.find(a => a && a.enabled && String(a.id || '') === pref);
  return match ? pref : null;
}

async function triageMission(text, { user = '' } = {}) {
  const cfg = getConfig();
  const baseUrl = (cfg.ollama && cfg.ollama.mainUrl) || 'http://localhost:11434';
  const model = (cfg.ollama && cfg.ollama.mainModel) || 'llama3.2';

  const system = [
    'You are the Shadow Command Center coordinator.',
    'Break the mission into 1-6 subtasks and assign a role for each.',
    '',
    'Return ONLY strict JSON matching this schema:',
    '{',
    '  "title": string,',
    '  "summary": string,',
    '  "subtasks": [',
    '    { "title": string, "goal": string, "role": "coder"|"research"|"planner"|"ops"|"memory_curator", "priority": 1|2|3|4|5 }',
    '  ]',
    '}',
    '',
    'Rules:',
    '- Keep it lightweight and layered on top of the existing Shadow system.',
    '- Avoid major refactors. Prefer additive modules and small hooks.',
    '- No voice features.',
    '- Everything must run via Shadow’s existing Ollama integration (no external LLM providers).',
    '- Goals should be concrete and executable as background agent tasks.',
    '- NEVER invent vague internal references (e.g., "Shadow operational tools") unless explicitly present in the user text.',
    '- For simple factual requests (weather, price, quick lookup), create exactly ONE concrete subtask with explicit query language.'
  ].join('\n');

  const userMsg = [
    `User: ${user || '(unknown)'}`,
    'Mission:',
    safeText(text, 8000)
  ].join('\n\n');

  const data = await ollamaChatJson(baseUrl, model, [
    { role: 'system', content: system },
    { role: 'user', content: userMsg }
  ]);

  const raw = String((data && data.message && data.message.content) || '').trim();
  const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  const parsed = JSON.parse(cleaned);
  if (!parsed || typeof parsed !== 'object') throw new Error('Coordinator returned invalid JSON.');
  if (!Array.isArray(parsed.subtasks) || parsed.subtasks.length === 0) {
    parsed.subtasks = [{
      title: parsed.title || 'Mission task',
      goal: safeText(text, 4000),
      role: 'coder',
      priority: 3
    }];
  }
  return {
    title: safeText(parsed.title || 'Mission', 120),
    summary: safeText(parsed.summary || '', 500),
    subtasks: parsed.subtasks.slice(0, 8).map((s, i) => ({
      title: safeText(s && s.title ? s.title : `Subtask ${i + 1}`, 120),
      goal: safeText(s && s.goal ? s.goal : '', 6000),
      role: safeText(s && s.role ? s.role : 'coder', 40),
      priority: Math.max(1, Math.min(5, Number(s && s.priority) || 3))
    }))
  };
}

function createMissionId() {
  return 'mission_' + crypto.randomBytes(8).toString('hex');
}

async function dispatchMission(text, { user = '' } = {}) {
  const missionId = createMissionId();
  hiveStore.appendEvent(
    { type: 'mission_received', source: 'command_center', missionId, user: user || null, message: safeText(text, 2000), payload: { user } },
    { scopeUser: user || '' }
  );

  let triage;
  const textLower = String(text || '').toLowerCase();
  if (/\bweather\b/.test(textLower)) {
    triage = {
      title: 'Weather Lookup',
      summary: 'Retrieve weather details from web sources and report concise results.',
      subtasks: [{
        title: 'Fetch weather data',
        goal: `Use web_search to answer this exact user request with current temperature, humidity, and conditions. If location is missing, respond with STEP_BLOCKED asking for location. User request: ${safeText(text, 1200)}`,
        role: 'research',
        priority: 1
      }]
    };
  }
  try {
    if (!triage) triage = await triageMission(text, { user });
  } catch (e) {
    hiveStore.appendEvent(
      { type: 'mission_triage_failed', source: 'command_center', missionId, user: user || null, message: e.message },
      { scopeUser: user || '' }
    );
    // Fallback: single coding task
    triage = {
      title: 'Mission',
      summary: 'Fallback triage (JSON parse failed).',
      subtasks: [{ title: 'Mission', goal: safeText(text, 6000), role: 'coder', priority: 3 }]
    };
  }

  const createdTasks = [];
  for (const st of triage.subtasks) {
    const role = getRole(st.role);
    const agentId = pickEnabledAgentId(role.preferredAgentId);
    const task = agentStore.createTask({
      goal: st.goal,
      title: st.title,
      blockedBehavior: 'pause',
      role: role.id,
      agentId,
      priority: st.priority,
      parentMissionId: missionId,
      ownerUser: user || null,
      tags: ['command_center']
    });
    createdTasks.push(task);
    hiveStore.appendEvent(
      {
        type: 'task_created',
        source: 'command_center',
        missionId,
        taskId: task.id,
        agent: role.id,
        user: user || null,
        message: `${task.title} (${role.id})`,
        payload: { agentId: agentId || null, priority: st.priority }
      },
      { scopeUser: user || '' }
    );
  }

  const snap = hiveStore.getSnapshot({ scopeUser: user || '' });
  const missions = Array.isArray(snap.missions) ? [...snap.missions] : [];
  missions.unshift({
    id: missionId,
    title: triage.title,
    summary: triage.summary,
    createdAt: new Date().toISOString(),
    user: user || null,
    taskIds: createdTasks.map(t => t.id)
  });
  hiveStore.updateSnapshot({ missions: missions.slice(0, 50) }, { scopeUser: user || '' });

  return {
    missionId,
    title: triage.title,
    summary: triage.summary,
    tasks: createdTasks.map(t => ({
      id: t.id,
      title: t.title,
      status: t.status,
      role: t.role || null,
      agentId: t.agentId || null,
      priority: t.priority || null
    }))
  };
}

module.exports = { dispatchMission };

