'use strict';

const { getConfig } = require('./config.js');
const { ollamaChatWithTools, ollamaChatJson } = require('./ollama.js');
const agentStore = require('./agentStore.js');
const skillsLib = require('./skills.js');
const searxngLib = require('./searxng.js');
const fetchUrlLib = require('./fetchUrl.js');
const emailLib = require('./email.js');
const structuredMemory = require('./structuredMemory.js');
const personalityLib = require('./personality.js');
const { executeSchedulerTool } = require('./toolHandlers.js');
const logger = require('./logger.js');

// Tool names that require user approval before execution
const BASE_HIGH_RISK = new Set(['send_email', 'create_skill', 'set_memory', 'append_memory']);
// Low-risk tools run without approval
const LOW_RISK = new Set(['web_search', 'fetch_url', 'get_memory']);

let intervalId = null;
const inFlight = new Set(); // task IDs currently being processed
let runnerPaused = false;

function isRunnerPaused() {
  return runnerPaused;
}

function getRunnerState() {
  return {
    paused: runnerPaused,
    running: !!intervalId,
    inFlight: inFlight.size
  };
}

function getAgentConfig() {
  const cfg = getConfig();
  return {
    maxConcurrent: cfg.agent?.maxConcurrent ?? 2,
    loopIntervalMs: cfg.agent?.loopIntervalMs ?? 5000,
    maxStepAttempts: cfg.agent?.maxStepAttempts ?? 6,
    baseUrl: cfg.ollama?.mainUrl || 'http://localhost:11434',
    model: cfg.ollama?.mainModel || 'llama3.2'
  };
}

function resolveOllamaForTask(task) {
  const cfg = getConfig();
  let baseUrl = cfg.ollama?.mainUrl || 'http://localhost:11434';
  let model = cfg.ollama?.mainModel || 'llama3.2';
  const agentId = task && task.agentId ? String(task.agentId).trim() : '';
  if (agentId && Array.isArray(cfg.ollama?.agents)) {
    const agent = cfg.ollama.agents.find(a => a && a.enabled && String(a.id || '') === agentId);
    if (agent) {
      baseUrl = agent.url || baseUrl;
      model = agent.model || model;
    }
  }
  return { baseUrl, model };
}

function buildToolDefinitions() {
  const config = getConfig();
  const tools = [];

  // Low-risk tools
  const searxng = config.searxng || {};
  if (searxng.url && searxng.enabled) {
    tools.push({
      type: 'function',
      function: {
        name: 'web_search',
        description: 'Search the internet.',
        parameters: { type: 'object', required: ['query'], properties: { query: { type: 'string' } } }
      }
    });
  }
  tools.push({
    type: 'function',
    function: {
      name: 'fetch_url',
      description: 'Fetch the text content of a webpage.',
      parameters: { type: 'object', required: ['url'], properties: { url: { type: 'string' } } }
    }
  });
  tools.push({
    type: 'function',
    function: {
      name: 'get_memory',
      description: 'Retrieve a stored memory value by key.',
      parameters: { type: 'object', required: ['key'], properties: { key: { type: 'string' } } }
    }
  });

  // High-risk tools (require approval)
  tools.push({
    type: 'function',
    function: {
      name: 'set_memory',
      description: 'Store a key-value fact in memory. Requires user approval.',
      parameters: {
        type: 'object',
        required: ['key', 'value'],
        properties: { key: { type: 'string' }, value: { type: 'string' } }
      }
    }
  });
  tools.push({
    type: 'function',
    function: {
      name: 'append_memory',
      description: 'Append a fact to the memory log. Requires user approval.',
      parameters: { type: 'object', required: ['text'], properties: { text: { type: 'string' } } }
    }
  });

  const emailCfg = config.email || {};
  if (emailCfg.host && emailCfg.from && emailCfg.defaultTo && emailCfg.enabled) {
    tools.push({
      type: 'function',
      function: {
        name: 'send_email',
        description: 'Send an email. Requires user approval.',
        parameters: {
          type: 'object',
          required: ['subject', 'text'],
          properties: {
            to: { type: 'string' },
            subject: { type: 'string' },
            text: { type: 'string' }
          }
        }
      }
    });
  }
  tools.push({
    type: 'function',
    function: {
      name: 'create_skill',
      description: 'Create a reusable skill plugin from JS code. Requires user approval.',
      parameters: {
        type: 'object',
        required: ['id', 'description', 'code'],
        properties: {
          id: { type: 'string' },
          description: { type: 'string' },
          code: { type: 'string' }
        }
      }
    }
  });

  // Enabled skill plugins (high-risk: run arbitrary code)
  skillsLib.ensureEnabledSkillsLoaded();
  for (const s of skillsLib.listSkills().filter(sk => sk.enabled && sk.loaded)) {
    tools.push({
      type: 'function',
      function: {
        name: s.id,
        description: s.description || s.name || `Skill: ${s.id}`,
        parameters: { type: 'object' }
      }
    });
    BASE_HIGH_RISK.add(s.id);
  }

  return tools;
}

function isHighRisk(name) {
  return BASE_HIGH_RISK.has(name) || !LOW_RISK.has(name);
}

function addLog(task, type, content) {
  task.log.push({ ts: new Date().toISOString(), type, content: String(content) });
}

function parseStepSignal(content) {
  const text = String(content || '').trim();
  const blockedMatch = text.match(/(?:^|\n)\s*STEP_BLOCKED:\s*(.+?)\s*$/s);
  if (blockedMatch) {
    const logText = text.replace(/(?:^|\n)\s*STEP_BLOCKED:\s*.+?\s*$/s, '').trim();
    return {
      done: false,
      blocked: true,
      blockedReason: String(blockedMatch[1] || '').trim(),
      logText
    };
  }
  const doneMatch = /(?:^|\n)\s*STEP_DONE\s*$/.test(text);
  if (doneMatch) {
    const logText = text.replace(/(?:^|\n)\s*STEP_DONE\s*$/s, '').trim();
    return {
      done: true,
      blocked: false,
      blockedReason: '',
      logText
    };
  }
  return {
    done: false,
    blocked: false,
    blockedReason: '',
    logText: text
  };
}

function isTaskStatus(taskId, allowedStatuses) {
  const fresh = agentStore.getTask(taskId);
  if (!fresh) return { ok: false, task: null };
  const allowed = Array.isArray(allowedStatuses) ? allowedStatuses : [allowedStatuses];
  return { ok: allowed.includes(fresh.status), task: fresh };
}

function updateTaskIfStatus(taskId, allowedStatuses, updates) {
  const { ok } = isTaskStatus(taskId, allowedStatuses);
  if (!ok) return null;
  return agentStore.updateTask(taskId, updates);
}

function pauseTaskIfRunning(task, reason) {
  const msg = reason || 'Paused by admin.';
  try {
    task.log = Array.isArray(task.log) ? task.log : [];
    addLog(task, 'thought', `Task paused: ${msg}`);
    agentStore.updateTask(task.id, { status: 'blocked', log: task.log });
  } catch (_) {}
}

function shouldWaitForUpstreamData(task, blockedReason) {
  // Only auto-wait inside Command Center missions (parentMissionId set).
  if (!task || !task.parentMissionId) return false;
  const r = String(blockedReason || '').toLowerCase();
  if (!r) return false;
  return (
    r.includes('no raw data') ||
    r.includes('no data points') ||
    (r.includes('no data') && r.includes('provided')) ||
    (r.includes('please provide the data') && r.includes('proceed')) ||
    (r.includes('cannot proceed') && r.includes('data points')) ||
    r.includes('no such data') ||
    (r.includes('not found') && r.includes('memory')) ||
    (r.includes('no') && r.includes('found') && r.includes('memory')) ||
    (r.includes('cannot proceed') && (r.includes('no information') || r.includes('not been provided'))) ||
    r.includes('please provide the raw data')
  );
}

function scheduleWait(task, blockedReason) {
  const attempts = Number(task.waitAttempts || 0) + 1;
  const delayMs = Math.min(120000, 15000 * attempts); // 15s, 30s, 45s ... up to 2 minutes
  const until = Date.now() + delayMs;
  addLog(task, 'thought', `Waiting for upstream data (${attempts}/8). Will retry in ${Math.round(delayMs / 1000)}s.`);
  if (attempts >= 8) {
    addLog(task, 'thought', `Blocked: upstream data did not arrive after ${attempts} waits. Last reason: ${blockedReason}`);
    updateTaskIfStatus(task.id, ['executing'], { status: 'blocked', log: task.log, waitAttempts: attempts, notBefore: null });
    return true;
  }
  updateTaskIfStatus(task.id, ['executing'], {
    status: 'executing',
    log: task.log,
    waitAttempts: attempts,
    waitingFor: String(blockedReason || 'upstream data').slice(0, 400),
    notBefore: new Date(until).toISOString()
  });
  return true;
}

async function executeTool(name, args) {
  const config = getConfig();

  if (name === 'web_search') {
    const query = String(args.query || '').trim();
    if (!query) return 'No query provided.';
    const searxng = config.searxng || {};
    const results = await searxngLib.search(searxng.url, query, { limit: 8 });
    return results.length === 0
      ? 'No results.'
      : results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.content || ''}`).join('\n\n');
  }
  if (name === 'fetch_url') {
    const url = String(args.url || '').trim();
    if (!url) return 'No URL.';
    const page = await fetchUrlLib.fetchPage(url);
    return `Title: ${page.title || '(none)'}\nURL: ${page.url}\n\nContent:\n${(page.content || '').slice(0, 40000)}`;
  }
  if (name === 'get_memory') {
    return structuredMemory.getMemory(String(args.key || ''));
  }
  if (name === 'set_memory') {
    structuredMemory.setMemory(String(args.key || ''), String(args.value || ''));
    return `Stored memory for key "${args.key}".`;
  }
  if (name === 'append_memory') {
    personalityLib.appendMemory(String(args.text || ''));
    return 'Appended to memory.';
  }
  if (name === 'send_email') {
    const cfg = config.email || {};
    const to = String(args.to || cfg.defaultTo || '').trim();
    const subject = String(args.subject || '').trim();
    const text = String(args.text || '');
    await emailLib.sendMail(cfg, { to, subject: subject || '(No subject)', text: text || '(No content)' });
    return `Email sent to ${to}.`;
  }
  if (name === 'create_skill') {
    return await executeSchedulerTool('create_skill', args);
  }
  // Skill plugin
  const result = await skillsLib.runSkill(name, args);
  return typeof result === 'object' ? JSON.stringify(result) : String(result);
}

// ---- Phase handlers --------------------------------------------------------

async function planTask(task) {
  if (isRunnerPaused()) {
    pauseTaskIfRunning(task, 'Agent runner is paused.');
    return;
  }
  if (!isTaskStatus(task.id, ['planning']).ok) return;
  const { baseUrl, model } = resolveOllamaForTask(task);
  const strategy = agentStore.readStrategy();
  const systemMsg = [
    'You are a task planner. Break the goal into 3-8 concrete, actionable steps.',
    'Return ONLY a valid JSON array. Each element: {"step": <number>, "description": "<string>"}.',
    'No markdown, no explanation, no other text.',
    strategy ? `\nPast lessons to inform your plan:\n${strategy}` : ''
  ].filter(Boolean).join('\n');

  let raw = '';
  try {
    const data = await ollamaChatJson(baseUrl, model, [
      { role: 'system', content: systemMsg },
      { role: 'user', content: `Goal: ${task.goal}` }
    ]);
    raw = data?.message?.content || '';
  } catch (e) {
    addLog(task, 'thought', `Planning LLM error: ${e.message}`);
    task.status = 'failed';
    updateTaskIfStatus(task.id, ['planning'], { status: 'failed', log: task.log });
    return;
  }

  let plan;
  try {
    const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    plan = JSON.parse(cleaned);
    if (!Array.isArray(plan) || plan.length === 0) throw new Error('empty');
  } catch (_) {
    addLog(task, 'thought', `Could not parse plan from LLM response: ${raw.slice(0, 200)}`);
    task.status = 'failed';
    updateTaskIfStatus(task.id, ['planning'], { status: 'failed', log: task.log });
    return;
  }

  const newPlan = plan.map((s, i) => ({
    step: Number(s.step) || i + 1,
    description: String(s.description || ''),
    status: 'pending'
  }));
  addLog(task, 'thought', `Plan created: ${newPlan.length} steps`);
  updateTaskIfStatus(task.id, ['planning'], {
    plan: newPlan,
    currentStep: 0,
    status: 'executing',
    log: task.log
  });
}

async function executeStep(task) {
  if (isRunnerPaused()) {
    pauseTaskIfRunning(task, 'Agent runner is paused.');
    return;
  }
  if (!isTaskStatus(task.id, ['executing']).ok) return;

  // If this task is scheduled to wait, skip until notBefore.
  if (task && task.notBefore) {
    const nb = Date.parse(task.notBefore);
    if (!Number.isNaN(nb) && Date.now() < nb) return;
    // Clear notBefore once it is in the past.
    try { agentStore.updateTask(task.id, { notBefore: null, waitingFor: null }); } catch (_) {}
  }

  const { baseUrl, model } = resolveOllamaForTask(task);
  const { maxStepAttempts } = getAgentConfig();
  const strategy = agentStore.readStrategy();
  const step = task.plan[task.currentStep];

  if (!step) {
    updateTaskIfStatus(task.id, ['executing'], { status: 'learning' });
    return;
  }

  const stepKey = String(task.currentStep);
  const stepAttempts = { ...(task.stepAttempts || {}) };
  stepAttempts[stepKey] = Number(stepAttempts[stepKey] || 0) + 1;
  updateTaskIfStatus(task.id, ['executing'], { stepAttempts });
  if (stepAttempts[stepKey] > maxStepAttempts) {
    addLog(task, 'thought', `Blocked: step retry limit reached (${stepAttempts[stepKey]}/${maxStepAttempts}) for "${step.description}"`);
    updateTaskIfStatus(task.id, ['executing'], { status: 'blocked', log: task.log, stepAttempts });
    return;
  }

  const planSummary = task.plan
    .map(s => `Step ${s.step} [${s.status}]: ${s.description}`)
    .join('\n');
  const recentLog = task.log.slice(-20)
    .map(e => `[${e.type}] ${e.content}`)
    .join('\n');

  const systemMsg = [
    'You are an autonomous agent executing a goal step by step using tools.',
    '',
    `Goal: ${task.goal}`,
    '',
    'Plan:',
    planSummary,
    '',
    'Recent activity:',
    recentLog || '(none yet)',
    strategy ? `\nPast lessons:\n${strategy}` : '',
    '',
    `You are now executing Step ${step.step}/${task.plan.length}: ${step.description}`,
    '',
    'Use tools to accomplish this step. When the step is fully complete, respond with exactly: STEP_DONE',
    'If you are blocked and need human input, respond with exactly: STEP_BLOCKED: <brief reason>',
    'Otherwise, use tools and briefly describe what you are doing.'
  ].join('\n');

  const tools = buildToolDefinitions();
  const messages = [
    { role: 'system', content: systemMsg },
    { role: 'user', content: `Execute step ${step.step}: ${step.description}` }
  ];

  let maxRounds = 5;
  let stepDone = false;
  let stepBlocked = false;
  let blockedReason = '';
  let lastToolSig = '';
  let repeatedToolCalls = 0;

  while (maxRounds-- > 0) {
    if (isRunnerPaused()) {
      pauseTaskIfRunning(task, 'Agent runner is paused.');
      return;
    }
    if (!isTaskStatus(task.id, ['executing']).ok) return;
    let data;
    try {
      data = await ollamaChatWithTools(baseUrl, model, messages, tools);
    } catch (e) {
      addLog(task, 'thought', `LLM error: ${e.message}`);
      updateTaskIfStatus(task.id, ['executing'], { log: task.log });
      return;
    }

    const msg = data?.message || {};
    const toolCalls = msg.tool_calls || [];
    const content = (msg.content || '').trim();

    if (toolCalls.length === 0) {
      const parsed = parseStepSignal(content);
      if (parsed.done) {
        stepDone = true;
      } else if (parsed.blocked) {
        stepBlocked = true;
        blockedReason = parsed.blockedReason;
      }
      if (parsed.logText) addLog(task, 'thought', parsed.logText);
      break;
    }

    messages.push({ role: 'assistant', content: content || '', tool_calls: toolCalls });

    for (const tc of toolCalls) {
      if (isRunnerPaused()) {
        pauseTaskIfRunning(task, 'Agent runner is paused.');
        return;
      }
      if (!isTaskStatus(task.id, ['executing']).ok) return;
      const name = tc.function?.name;
      let args = tc.function?.arguments || {};
      if (typeof args === 'string') {
        try { args = JSON.parse(args); } catch (_) { args = {}; }
      }
      const sig = `${name}:${JSON.stringify(args || {})}`;
      if (sig === lastToolSig) {
        repeatedToolCalls += 1;
      } else {
        repeatedToolCalls = 1;
        lastToolSig = sig;
      }
      if (repeatedToolCalls >= 3) {
        stepBlocked = true;
        blockedReason = `repeated identical tool call loop detected (${name})`;
        addLog(task, 'thought', `Detected tool loop: ${sig.slice(0, 180)}`);
        break;
      }

      if (isHighRisk(name)) {
        addLog(task, 'approval_request',
          `Needs approval: ${name}(${JSON.stringify(args).slice(0, 200)})`
        );
        updateTaskIfStatus(task.id, ['executing'], {
          status: 'awaiting_approval',
          pendingApproval: { action: name, args, requestedAt: new Date().toISOString() },
          log: task.log
        });
        return;
      }

      addLog(task, 'action', `${name}(${JSON.stringify(args).slice(0, 200)})`);
      let toolResult;
      try {
        toolResult = await executeTool(name, args);
      } catch (e) {
        toolResult = `Error: ${e.message}`;
      }
      addLog(task, 'result', String(toolResult).slice(0, 1000));
      messages.push({ role: 'tool', tool_name: name, content: String(toolResult) });
    }
    if (stepBlocked) break;
  }

  const updatedPlan = task.plan.map((s, i) => {
    if (i === task.currentStep && stepDone) return { ...s, status: 'done' };
    return s;
  });

  if (stepDone) {
    const nextStep = task.currentStep + 1;
    addLog(task, 'thought', `Step ${step.step} complete`);
    const allDone = nextStep >= task.plan.length;
    if (allDone) addLog(task, 'thought', 'All steps complete. Starting learning phase.');
    const nextAttempts = { ...stepAttempts };
    delete nextAttempts[stepKey];
    updateTaskIfStatus(task.id, ['executing'], {
      plan: updatedPlan,
      currentStep: nextStep,
      status: allDone ? 'learning' : 'executing',
      log: task.log,
      stepAttempts: nextAttempts
    });
  } else if (stepBlocked) {
    if (shouldWaitForUpstreamData(task, blockedReason)) {
      const handled = scheduleWait(task, blockedReason);
      if (handled) return;
    }
    addLog(task, 'thought', `Blocked: ${blockedReason}`);
    const newStatus = (task.blockedBehavior === 'continue') ? 'executing' : 'blocked';
    if (task.blockedBehavior === 'notify') {
      notifyBlocked(task, blockedReason).catch(() => {});
    }
    updateTaskIfStatus(task.id, ['executing'], { status: newStatus, log: task.log, stepAttempts });
  } else {
    updateTaskIfStatus(task.id, ['executing'], { log: task.log, stepAttempts });
  }
}

async function learnFromTask(task) {
  if (isRunnerPaused()) {
    pauseTaskIfRunning(task, 'Agent runner is paused.');
    return;
  }
  if (!isTaskStatus(task.id, ['learning']).ok) return;
  const { baseUrl, model } = resolveOllamaForTask(task);
  const logText = task.log.map(e => `[${e.type}] ${e.content}`).join('\n');

  const systemMsg = [
    'You completed a task. Extract lessons from the execution log.',
    'Return ONLY valid JSON with these keys:',
    '- "strategyNotes": array of strings (non-obvious lessons for future tasks; what worked, what failed)',
    '- "factsToStore": array of {"key": string, "value": string} (facts discovered worth persisting in memory)',
    'No markdown, no other text. Both arrays may be empty.'
  ].join('\n');

  let raw = '{}';
  try {
    const data = await ollamaChatJson(baseUrl, model, [
      { role: 'system', content: systemMsg },
      { role: 'user', content: `Task: ${task.goal}\n\nLog:\n${logText.slice(0, 8000)}` }
    ]);
    raw = data?.message?.content || '{}';
  } catch (_) {
    agentStore.updateTask(task.id, { status: 'complete' });
    return;
  }

  let learnings;
  try {
    const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    learnings = JSON.parse(cleaned);
  } catch (_) {
    agentStore.updateTask(task.id, { status: 'complete' });
    return;
  }

  // Strategy notes are low-risk: write freely
  if (Array.isArray(learnings.strategyNotes) && learnings.strategyNotes.length > 0) {
    for (const note of learnings.strategyNotes) {
      if (note) agentStore.appendStrategy(String(note));
    }
    addLog(task, 'learn', `Added ${learnings.strategyNotes.length} strategy note(s) to memory`);
  }

  // Facts are relatively low-risk, but can be noisy. By default we require approval,
  // except for Command Center missions where we auto-store to avoid constant prompts.
  const facts = Array.isArray(learnings.factsToStore)
    ? learnings.factsToStore.filter(f => f && f.key)
    : [];

  if (facts.length > 0) {
    const cfg = getConfig();
    const isCommandCenterMission = !!(task && task.parentMissionId);
    const requireApprovalForFacts = cfg.agent?.requireApprovalForFacts;
    const mustApprove = (requireApprovalForFacts === true) || (!isCommandCenterMission && requireApprovalForFacts !== false);

    if (!mustApprove) {
      for (const { key, value } of facts) {
        if (key) structuredMemory.setMemory(String(key), String(value || ''));
      }
      addLog(task, 'result', `Stored ${facts.length} memory fact(s)`);
      addLog(task, 'learn', 'Learning phase complete');
      agentStore.updateTask(task.id, { status: 'complete', log: task.log });
      return;
    }

    addLog(task, 'approval_request',
      `Learning: needs approval to store ${facts.length} memory fact(s): ${facts.map(f => f.key).join(', ')}`
    );
    agentStore.updateTask(task.id, {
      status: 'awaiting_approval',
      pendingApproval: { action: 'store_facts', args: { facts }, requestedAt: new Date().toISOString() },
      log: task.log
    });
    return;
  }

  addLog(task, 'learn', 'Learning phase complete');
  agentStore.updateTask(task.id, { status: 'complete', log: task.log });
}

async function notifyBlocked(task, reason) {
  const config = getConfig();
  if (!config.email?.host || !config.email?.enabled || !config.email?.defaultTo) return;
  try {
    await emailLib.sendMail(config.email, {
      to: config.email.defaultTo,
      subject: `Agent task blocked: ${task.title}`,
      text: `Task "${task.title}" is blocked and needs your attention.\n\nReason: ${reason}\n\nTask ID: ${task.id}\n\nReview at /autoagent`
    });
  } catch (_) {}
}

// ---- State machine ---------------------------------------------------------

async function advanceTask(task) {
  try {
    if (task.status === 'queued') {
      agentStore.updateTask(task.id, { status: 'planning' });
      // Re-read to get the updated status reflected in the object
      const updated = agentStore.getTask(task.id);
      if (updated) await planTask(updated);
    } else if (task.status === 'executing') {
      await executeStep(task);
    } else if (task.status === 'learning') {
      await learnFromTask(task);
    }
  } catch (e) {
    logger.error('[AgentRunner] advanceTask error for task', task.id, ':', e.message);
  }
}

// ---- Loop ------------------------------------------------------------------

const ADVANCEABLE = new Set(['queued', 'planning', 'executing', 'learning']);

function tick() {
  if (isRunnerPaused()) return;
  const { maxConcurrent } = getAgentConfig();
  const index = agentStore.listTasks();
  const eligible = index
    .filter(e => {
      if (!e || !ADVANCEABLE.has(e.status) || inFlight.has(e.id)) return false;
      const t = agentStore.getTask(e.id);
      if (!t || !t.notBefore) return true;
      const nb = Date.parse(t.notBefore);
      if (Number.isNaN(nb)) return true;
      return Date.now() >= nb;
    })
    .slice(0, maxConcurrent - inFlight.size);

  for (const entry of eligible) {
    const task = agentStore.getTask(entry.id);
    if (!task) continue;
    inFlight.add(task.id);
    advanceTask(task).finally(() => inFlight.delete(task.id));
  }
}

function startAgentRunner() {
  stopAgentRunner();
  runnerPaused = false;
  const { loopIntervalMs } = getAgentConfig();
  logger.info('[AgentRunner] starting — loop interval:', loopIntervalMs, 'ms');
  tick();
  intervalId = setInterval(tick, loopIntervalMs);
}

function stopAgentRunner() {
  runnerPaused = true;
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

// ---- Approval/rejection handler -------------------------------------------

async function resumeAfterApproval(task, approved, rejectionReason) {
  const pa = task.pendingApproval;
  if (!pa) return;

  if (!approved) {
    addLog(task, 'action', `REJECTED: ${pa.action} — ${rejectionReason || 'no reason given'}`);
    agentStore.updateTask(task.id, {
      pendingApproval: null,
      status: 'executing',
      log: task.log
    });
    return;
  }

  addLog(task, 'action', `APPROVED: ${pa.action}(${JSON.stringify(pa.args).slice(0, 200)})`);

  if (pa.action === 'store_facts') {
    for (const { key, value } of (pa.args.facts || [])) {
      if (key) {
        structuredMemory.setMemory(String(key), String(value || ''));
        const factsAdded = [...(task.learnings?.factsAdded || [])];
        if (!factsAdded.includes(key)) factsAdded.push(key);
        task.learnings = { ...(task.learnings || {}), factsAdded };
      }
    }
    addLog(task, 'result', `Stored ${pa.args.facts?.length || 0} memory fact(s)`);
    addLog(task, 'learn', 'Learning phase complete');
    agentStore.updateTask(task.id, {
      pendingApproval: null,
      status: 'complete',
      log: task.log,
      learnings: task.learnings
    });
    return;
  }

  let result;
  try {
    result = await executeTool(pa.action, pa.args);
    const learnings = { ...(task.learnings || {}) };
    if (pa.action === 'create_skill') {
      learnings.skillsCreated = [...(learnings.skillsCreated || []), String(pa.args.id || '?')];
    }
    if (pa.action === 'set_memory' || pa.action === 'append_memory') {
      const key = pa.args.key || (pa.args.text || '').slice(0, 30);
      learnings.factsAdded = [...(learnings.factsAdded || [])];
      if (!learnings.factsAdded.includes(key)) learnings.factsAdded.push(key);
    }
    task.learnings = learnings;
  } catch (e) {
    result = `Error: ${e.message}`;
  }

  addLog(task, 'result', String(result).slice(0, 1000));
  agentStore.updateTask(task.id, {
    pendingApproval: null,
    status: 'executing',
    log: task.log,
    learnings: task.learnings
  });
}

module.exports = { startAgentRunner, stopAgentRunner, resumeAfterApproval, isRunnerPaused, getRunnerState, parseStepSignal };
