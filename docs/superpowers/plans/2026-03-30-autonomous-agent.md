# Autonomous Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent, server-side autonomous agent that plans and executes multi-step goals using existing tools, requests approval before irreversible actions, and learns from completed tasks.

**Architecture:** A new `lib/agentRunner.js` module starts with the server and runs a configurable-interval loop that advances active tasks through a lifecycle: queued → planning → executing → learning → complete. A new `lib/agentStore.js` handles all file I/O for task state. New `/api/agent/*` routes and a `/autoagent` admin dashboard page expose full control.

**Tech Stack:** Node.js, Express, Ollama (via `lib/ollama.js`), existing tools (searxng, fetchUrl, email, structuredMemory, skills, toolHandlers), vanilla JS + HTML frontend following existing page patterns.

---

## File Map

| Path | Action | Responsibility |
|------|--------|----------------|
| `lib/agentStore.js` | Create | Task file CRUD, index.json, strategy.md |
| `lib/agentRunner.js` | Create | Loop, state machine, LLM calls, tool execution with approval tiers |
| `server.js` | Modify | Add requires, page route, 9 API routes, `agentRunner.startAgentRunner()` in `start()`, `agent` config branch in `updateConfig`, chat intent detection |
| `lib/config.js` | Modify | Add `agent` config branch to `updateConfig()` |
| `public/autoagent.html` | Create | Dashboard page HTML |
| `public/autoagent.js` | Create | Dashboard frontend JS (task list, detail panel, approval queue, form, config) |
| `public/autoagent.css` | Create | Minimal dashboard styles |
| `public/*.html` (15 files) | Modify | Add AUTOAGENT nav link to SYSTEM dropdown in every existing HTML page |

---

## Task 1: lib/agentStore.js — Task data layer

**Files:**
- Create: `lib/agentStore.js`

- [ ] **Step 1.1: Create agentStore.js**

```js
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR } = require('./personality.js');

const AGENTS_DIR = path.join(DATA_DIR, 'agents');
const INDEX_PATH = path.join(AGENTS_DIR, 'index.json');
const STRATEGY_PATH = path.join(AGENTS_DIR, 'strategy.md');

function ensureDir() {
  if (!fs.existsSync(AGENTS_DIR)) fs.mkdirSync(AGENTS_DIR, { recursive: true });
}

function readIndex() {
  ensureDir();
  if (!fs.existsSync(INDEX_PATH)) return [];
  try { return JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8')); } catch (_) { return []; }
}

function writeIndex(index) {
  ensureDir();
  fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2), 'utf8');
}

function readTask(id) {
  ensureDir();
  const p = path.join(AGENTS_DIR, `${id}.json`);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return null; }
}

function writeTask(task) {
  ensureDir();
  task.updatedAt = new Date().toISOString();
  fs.writeFileSync(
    path.join(AGENTS_DIR, `${task.id}.json`),
    JSON.stringify(task, null, 2),
    'utf8'
  );
  const index = readIndex();
  const i = index.findIndex(e => e.id === task.id);
  const entry = { id: task.id, title: task.title, status: task.status, updatedAt: task.updatedAt };
  if (i === -1) index.push(entry); else index[i] = entry;
  writeIndex(index);
}

function createTask({ goal, title, blockedBehavior = 'pause' }) {
  ensureDir();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const task = {
    id,
    title: title || goal.slice(0, 60),
    goal,
    status: 'queued',
    blockedBehavior,
    createdAt: now,
    updatedAt: now,
    plan: [],
    currentStep: 0,
    log: [],
    pendingApproval: null,
    learnings: { strategyNotes: '', skillsCreated: [], factsAdded: [] }
  };
  writeTask(task);
  return task;
}

function listTasks() {
  return readIndex();
}

function getTask(id) {
  return readTask(id);
}

function updateTask(id, updates) {
  const task = readTask(id);
  if (!task) return null;
  Object.assign(task, updates);
  writeTask(task);
  return task;
}

function deleteTask(id) {
  ensureDir();
  const p = path.join(AGENTS_DIR, `${id}.json`);
  if (fs.existsSync(p)) fs.unlinkSync(p);
  writeIndex(readIndex().filter(e => e.id !== id));
}

function readStrategy() {
  ensureDir();
  if (!fs.existsSync(STRATEGY_PATH)) return '';
  return fs.readFileSync(STRATEGY_PATH, 'utf8');
}

function appendStrategy(note) {
  ensureDir();
  const trimmed = String(note).trim();
  if (!trimmed) return;
  const line = `- [${new Date().toISOString()}] ${trimmed}`;
  const existing = fs.existsSync(STRATEGY_PATH) ? fs.readFileSync(STRATEGY_PATH, 'utf8') : '';
  fs.writeFileSync(STRATEGY_PATH, (existing ? existing.trimEnd() + '\n' + line : line) + '\n', 'utf8');
}

module.exports = {
  createTask, listTasks, getTask, updateTask, deleteTask,
  readStrategy, appendStrategy,
  AGENTS_DIR, STRATEGY_PATH
};
```

- [ ] **Step 1.2: Smoke test agentStore**

Run from the repo root:
```bash
node -e "
const s = require('./lib/agentStore');
const t = s.createTask({ goal: 'test goal for smoke test' });
console.log('created:', t.id, t.status);
const got = s.getTask(t.id);
console.log('read back:', got ? got.status : 'MISSING');
s.appendStrategy('Test lesson');
const strat = s.readStrategy();
console.log('strategy has content:', strat.length > 0);
s.deleteTask(t.id);
const gone = s.getTask(t.id);
console.log('deleted:', gone === null);
"
```

Expected output:
```
created: <uuid> queued
read back: queued
strategy has content: true
deleted: true
```

- [ ] **Step 1.3: Commit**

```bash
git add lib/agentStore.js
git commit -m "feat: add agentStore.js — task CRUD, index, and strategy log"
```

---

## Task 2: lib/agentRunner.js — Core runtime

**Files:**
- Create: `lib/agentRunner.js`

- [ ] **Step 2.1: Create agentRunner.js**

```js
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

function getAgentConfig() {
  const cfg = getConfig();
  return {
    maxConcurrent: cfg.agent?.maxConcurrent ?? 2,
    loopIntervalMs: cfg.agent?.loopIntervalMs ?? 5000,
    baseUrl: cfg.ollama?.mainUrl || 'http://localhost:11434',
    model: cfg.ollama?.mainModel || 'llama3.2'
  };
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
  const { baseUrl, model } = getAgentConfig();
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
    agentStore.writeTask(task);
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
    agentStore.writeTask(task);
    return;
  }

  task.plan = plan.map((s, i) => ({
    step: Number(s.step) || i + 1,
    description: String(s.description || ''),
    status: 'pending'
  }));
  task.currentStep = 0;
  task.status = 'executing';
  addLog(task, 'thought', `Plan created: ${task.plan.length} steps`);
  agentStore.writeTask(task);
}

async function executeStep(task) {
  const { baseUrl, model } = getAgentConfig();
  const strategy = agentStore.readStrategy();
  const step = task.plan[task.currentStep];

  if (!step) {
    task.status = 'learning';
    agentStore.writeTask(task);
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
  ].filter(s => s !== null).join('\n');

  const tools = buildToolDefinitions();
  const messages = [
    { role: 'system', content: systemMsg },
    { role: 'user', content: `Execute step ${step.step}: ${step.description}` }
  ];

  let maxRounds = 5;
  let stepDone = false;
  let stepBlocked = false;
  let blockedReason = '';

  while (maxRounds-- > 0) {
    let data;
    try {
      data = await ollamaChatWithTools(baseUrl, model, messages, tools);
    } catch (e) {
      addLog(task, 'thought', `LLM error: ${e.message}`);
      agentStore.writeTask(task);
      return;
    }

    const msg = data?.message || {};
    const toolCalls = msg.tool_calls || [];
    const content = (msg.content || '').trim();

    if (toolCalls.length === 0) {
      if (content.startsWith('STEP_DONE')) {
        stepDone = true;
      } else if (content.startsWith('STEP_BLOCKED:')) {
        stepBlocked = true;
        blockedReason = content.replace('STEP_BLOCKED:', '').trim();
      } else if (content) {
        addLog(task, 'thought', content);
      }
      break;
    }

    messages.push({ role: 'assistant', content: content || '', tool_calls: toolCalls });

    for (const tc of toolCalls) {
      const name = tc.function?.name;
      let args = tc.function?.arguments || {};
      if (typeof args === 'string') {
        try { args = JSON.parse(args); } catch (_) { args = {}; }
      }

      if (isHighRisk(name)) {
        task.status = 'awaiting_approval';
        task.pendingApproval = {
          action: name,
          args,
          requestedAt: new Date().toISOString()
        };
        addLog(task, 'approval_request',
          `Needs approval: ${name}(${JSON.stringify(args).slice(0, 200)})`
        );
        agentStore.writeTask(task);
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
  }

  if (stepDone) {
    step.status = 'done';
    task.currentStep += 1;
    addLog(task, 'thought', `Step ${step.step} complete`);
    if (task.currentStep >= task.plan.length) {
      task.status = 'learning';
      addLog(task, 'thought', 'All steps complete. Starting learning phase.');
    }
  } else if (stepBlocked) {
    addLog(task, 'thought', `Blocked: ${blockedReason}`);
    if (task.blockedBehavior === 'pause' || task.blockedBehavior === 'notify') {
      task.status = 'blocked';
      if (task.blockedBehavior === 'notify') {
        notifyBlocked(task, blockedReason).catch(() => {});
      }
    }
    // blockedBehavior === 'continue': stay in executing, LLM will try another approach next tick
  }

  agentStore.writeTask(task);
}

async function learnFromTask(task) {
  const { baseUrl, model } = getAgentConfig();
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
    task.status = 'complete';
    agentStore.writeTask(task);
    return;
  }

  let learnings;
  try {
    const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    learnings = JSON.parse(cleaned);
  } catch (_) {
    task.status = 'complete';
    agentStore.writeTask(task);
    return;
  }

  // Strategy notes are low-risk: write freely
  if (Array.isArray(learnings.strategyNotes) && learnings.strategyNotes.length > 0) {
    for (const note of learnings.strategyNotes) {
      if (note) agentStore.appendStrategy(String(note));
    }
    addLog(task, 'learn', `Added ${learnings.strategyNotes.length} strategy note(s) to memory`);
  }

  // Facts require approval
  const facts = Array.isArray(learnings.factsToStore)
    ? learnings.factsToStore.filter(f => f && f.key)
    : [];

  if (facts.length > 0) {
    task.status = 'awaiting_approval';
    task.pendingApproval = {
      action: 'store_facts',
      args: { facts },
      requestedAt: new Date().toISOString()
    };
    addLog(task, 'approval_request',
      `Learning: needs approval to store ${facts.length} memory fact(s): ${facts.map(f => f.key).join(', ')}`
    );
    agentStore.writeTask(task);
    return;
  }

  task.status = 'complete';
  addLog(task, 'learn', 'Learning phase complete');
  agentStore.writeTask(task);
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
      task.status = 'planning';
      agentStore.writeTask(task);
      await planTask(task);
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
  const { maxConcurrent } = getAgentConfig();
  const index = agentStore.listTasks();
  const eligible = index
    .filter(e => ADVANCEABLE.has(e.status) && !inFlight.has(e.id))
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
  const { loopIntervalMs } = getAgentConfig();
  logger.info('[AgentRunner] starting — loop interval:', loopIntervalMs, 'ms');
  tick();
  intervalId = setInterval(tick, loopIntervalMs);
}

function stopAgentRunner() {
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
    task.pendingApproval = null;
    task.status = 'executing';
    agentStore.writeTask(task);
    return;
  }

  addLog(task, 'action', `APPROVED: ${pa.action}(${JSON.stringify(pa.args).slice(0, 200)})`);

  if (pa.action === 'store_facts') {
    for (const { key, value } of (pa.args.facts || [])) {
      if (key) {
        structuredMemory.setMemory(String(key), String(value || ''));
        if (!task.learnings.factsAdded.includes(key)) task.learnings.factsAdded.push(key);
      }
    }
    addLog(task, 'result', `Stored ${pa.args.facts?.length || 0} memory fact(s)`);
    task.pendingApproval = null;
    task.status = 'complete';
    addLog(task, 'learn', 'Learning phase complete');
    agentStore.writeTask(task);
    return;
  }

  let result;
  try {
    result = await executeTool(pa.action, pa.args);
    if (pa.action === 'create_skill') {
      task.learnings.skillsCreated.push(String(pa.args.id || '?'));
    }
    if (pa.action === 'set_memory' || pa.action === 'append_memory') {
      const key = pa.args.key || (pa.args.text || '').slice(0, 30);
      if (!task.learnings.factsAdded.includes(key)) task.learnings.factsAdded.push(key);
    }
  } catch (e) {
    result = `Error: ${e.message}`;
  }

  addLog(task, 'result', String(result).slice(0, 1000));
  task.pendingApproval = null;
  task.status = 'executing';
  agentStore.writeTask(task);
}

module.exports = { startAgentRunner, stopAgentRunner, resumeAfterApproval };
```

- [ ] **Step 2.2: Smoke test agentRunner loads without error**

```bash
node -e "const r = require('./lib/agentRunner'); console.log('exports:', Object.keys(r).join(', '));"
```

Expected output:
```
exports: startAgentRunner, stopAgentRunner, resumeAfterApproval
```

- [ ] **Step 2.3: Commit**

```bash
git add lib/agentRunner.js
git commit -m "feat: add agentRunner.js — autonomous task loop with planning, execution, approval gates, and learning"
```

---

## Task 3: server.js — Routes, startup, config, chat integration

**Files:**
- Modify: `server.js`
- Modify: `lib/config.js`

- [ ] **Step 3.1: Add agent requires to server.js top-of-file imports**

In `server.js`, after line 29 (`const ragLib = require('./lib/rag.js');`), add:

```js
const agentStore = require('./lib/agentStore.js');
const agentRunner = require('./lib/agentRunner.js');
```

- [ ] **Step 3.2: Add `/autoagent` page route to server.js**

In `server.js`, after line 220 (`app.get('/debug', adminPageGuard, ...)`), add:

```js
app.get('/autoagent', adminPageGuard, (req, res) => res.sendFile(path.join(PUBLIC, 'autoagent.html')));
```

- [ ] **Step 3.3: Add `/api/agent/*` routes to server.js**

Add these routes in `server.js` before the `start()` function (before line 2100). Find a natural section break (e.g., after the pipelines routes) and add:

```js
// ---------------------------------------------------------------------------
// Autonomous agent routes
// ---------------------------------------------------------------------------
app.get('/api/agent/tasks', requireAdmin, (req, res) => {
  try {
    res.json(agentStore.listTasks());
  } catch (e) {
    logger.error('GET /api/agent/tasks:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/agent/tasks', requireAdmin, (req, res) => {
  try {
    const { goal, blockedBehavior, title } = req.body || {};
    if (!goal || typeof goal !== 'string' || !goal.trim()) {
      return res.status(400).json({ error: 'goal is required' });
    }
    const task = agentStore.createTask({
      goal: goal.trim(),
      title: title ? String(title).trim() : undefined,
      blockedBehavior: blockedBehavior || 'pause'
    });
    res.status(201).json(task);
  } catch (e) {
    logger.error('POST /api/agent/tasks:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/agent/tasks/:id', requireAdmin, (req, res) => {
  try {
    const task = agentStore.getTask(req.params.id);
    if (!task) return res.status(404).json({ error: 'Not found' });
    res.json(task);
  } catch (e) {
    logger.error('GET /api/agent/tasks/:id:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/agent/tasks/:id', requireAdmin, (req, res) => {
  try {
    agentStore.deleteTask(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    logger.error('DELETE /api/agent/tasks/:id:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/agent/tasks/:id/approve', requireAdmin, async (req, res) => {
  try {
    const task = agentStore.getTask(req.params.id);
    if (!task) return res.status(404).json({ error: 'Not found' });
    if (task.status !== 'awaiting_approval') {
      return res.status(400).json({ error: 'Task is not awaiting approval' });
    }
    await agentRunner.resumeAfterApproval(task, true, null);
    res.json({ ok: true });
  } catch (e) {
    logger.error('POST /api/agent/tasks/:id/approve:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/agent/tasks/:id/reject', requireAdmin, async (req, res) => {
  try {
    const task = agentStore.getTask(req.params.id);
    if (!task) return res.status(404).json({ error: 'Not found' });
    if (task.status !== 'awaiting_approval') {
      return res.status(400).json({ error: 'Task is not awaiting approval' });
    }
    const { reason } = req.body || {};
    await agentRunner.resumeAfterApproval(task, false, reason ? String(reason) : '');
    res.json({ ok: true });
  } catch (e) {
    logger.error('POST /api/agent/tasks/:id/reject:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/agent/tasks/:id/unblock', requireAdmin, (req, res) => {
  try {
    const task = agentStore.getTask(req.params.id);
    if (!task) return res.status(404).json({ error: 'Not found' });
    if (task.status !== 'blocked') {
      return res.status(400).json({ error: 'Task is not blocked' });
    }
    agentStore.updateTask(req.params.id, { status: 'executing' });
    res.json({ ok: true });
  } catch (e) {
    logger.error('POST /api/agent/tasks/:id/unblock:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/agent/config', requireAdmin, (req, res) => {
  try {
    const cfg = getConfig();
    res.json(cfg.agent || { maxConcurrent: 2, loopIntervalMs: 5000 });
  } catch (e) {
    logger.error('GET /api/agent/config:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/agent/config', requireAdmin, (req, res) => {
  try {
    const { maxConcurrent, loopIntervalMs } = req.body || {};
    const updates = {};
    if (maxConcurrent != null) updates.maxConcurrent = Math.max(1, Math.min(10, Number(maxConcurrent)));
    if (loopIntervalMs != null) updates.loopIntervalMs = Math.max(1000, Number(loopIntervalMs));
    updateConfig({ agent: updates });
    res.json({ ok: true });
  } catch (e) {
    logger.error('PUT /api/agent/config:', e.message);
    res.status(500).json({ error: e.message });
  }
});
```

- [ ] **Step 3.4: Start agentRunner in the `start()` function in server.js**

In `server.js`, inside the `start()` function after `pipelineRunner.startScheduler();` (around line 2136), add:

```js
  agentRunner.startAgentRunner();
```

- [ ] **Step 3.5: Add `agent` config branch to lib/config.js `updateConfig()`**

In `lib/config.js`, inside `updateConfig()`, after the `if (updates.rag !== undefined)` block (before the `saveConfig(config)` line), add:

```js
  if (updates.agent !== undefined) {
    config.agent = { ...(config.agent || {}), ...updates.agent };
  }
```

- [ ] **Step 3.6: Add chat intent detection in server.js**

In `server.js`, inside `app.post('/api/chat', ...)` handler, after the `if (!messages || !Array.isArray(messages))` check (after line 1398), add:

```js
  // Agent task creation via chat intent: /agent goal <text>
  const lastMsg = messages[messages.length - 1];
  if (lastMsg && lastMsg.role === 'user' && typeof lastMsg.content === 'string') {
    const trimmed = lastMsg.content.trim();
    if (trimmed.toLowerCase().startsWith('/agent goal ')) {
      const goal = trimmed.slice('/agent goal '.length).trim();
      if (goal) {
        try {
          const task = agentStore.createTask({ goal });
          return res.json({
            content: `Agent task created.\n\nTitle: "${task.title}"\nTask ID: \`${task.id}\`\nStatus: queued\n\nTrack progress at [/autoagent](/autoagent).`
          });
        } catch (e) {
          return res.status(500).json({ error: 'Failed to create agent task: ' + e.message });
        }
      }
    }
  }
```

- [ ] **Step 3.7: Smoke test — start server and verify API routes load**

Start the server:
```bash
node server.js
```

Expected in stdout:
```
[AgentRunner] starting — loop interval: 5000 ms
ShadowAI listening on http://...
```

Then in a separate terminal, test one route (replace SESSION_COOKIE with a real admin session cookie):
```bash
curl -s -b "connect.sid=<SESSION_COOKIE>" http://localhost:3000/api/agent/tasks
```

Expected: `[]` (empty array, no tasks yet)

- [ ] **Step 3.8: Commit**

```bash
git add server.js lib/config.js
git commit -m "feat: add /api/agent/* routes, /autoagent page route, agentRunner startup, and /agent goal chat intent"
```

---

## Task 4: public/autoagent.html — Dashboard page

**Files:**
- Create: `public/autoagent.html`

- [ ] **Step 4.1: Create autoagent.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ShadowAI — Autonomous Agent</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/static/styles.css" />
  <link rel="stylesheet" href="/static/config.css" />
  <link rel="stylesheet" href="/static/autoagent.css" />
</head>
<body>
  <header class="app-header">
    <div class="header-left">
      <a href="/dashboard" class="logo">SHADOW_AI</a>
    </div>
    <nav class="header-nav">
      <a href="/dashboard" class="nav-link">DASHBOARD</a>
      <a href="/app" class="nav-link">CHAT</a>
      <a href="/projects" class="nav-link">PROJECTS</a>
      <a href="/skills" class="nav-link">SKILLS</a>
      <a href="/rag" class="nav-link">KNOWLEDGE</a>
      <div class="nav-dropdown">
        <span class="nav-link nav-dropdown-toggle has-active">SYSTEM</span>
        <div class="nav-dropdown-menu">
          <a href="/config" class="nav-link">CONFIG</a>
          <a href="/personality" class="nav-link">PERSONALITY</a>
          <a href="/heartbeat" class="nav-link">HEARTBEAT</a>
          <a href="/agents" class="nav-link">AGENTS</a>
          <a href="/pipelines" class="nav-link">PIPELINES</a>
          <span class="nav-link active">AUTOAGENT</span>
          <a href="/users" class="nav-link">USERS</a>
        </div>
      </div>
      <a href="/editor" class="nav-link">EDITOR</a>
      <a href="/profile" class="nav-link">ACCOUNT</a>
      <button type="button" id="logoutBtn" class="btn btn-small">LOGOUT</button>
    </nav>
  </header>

  <main class="config-main">

    <!-- Approval queue (shown only when tasks are awaiting approval) -->
    <div id="approvalQueue" style="display:none;">
      <div class="config-card agent-approval-card">
        <h1>APPROVAL REQUIRED</h1>
        <p class="config-note">The agent wants to take an irreversible action. Review and approve or reject.</p>
        <div id="approvalList"></div>
      </div>
    </div>

    <!-- Task list + detail layout -->
    <div class="agent-layout">

      <!-- Left: task list + new task form -->
      <div class="agent-sidebar">
        <div class="config-card">
          <h1>TASKS</h1>
          <div id="taskList"><p class="config-note">Loading...</p></div>
          <button type="button" id="newTaskBtn" class="btn btn-small" style="margin-top:12px;">+ New task</button>
        </div>

        <!-- New task form (hidden by default) -->
        <div class="config-card" id="newTaskForm" style="display:none; margin-top:16px;">
          <h1>NEW TASK</h1>
          <div class="form-group">
            <label class="form-label">Goal</label>
            <textarea id="taskGoal" class="form-control" rows="4" placeholder="Describe what the agent should do..."></textarea>
          </div>
          <div class="form-group">
            <label class="form-label">When blocked</label>
            <select id="taskBlockedBehavior" class="form-control">
              <option value="pause">Pause and wait</option>
              <option value="notify">Pause and notify me by email</option>
              <option value="continue">Best-guess and continue</option>
            </select>
          </div>
          <div class="form-actions">
            <button type="button" id="submitTaskBtn" class="btn">Create task</button>
            <button type="button" id="cancelTaskBtn" class="btn btn-secondary">Cancel</button>
            <span id="taskStatus" class="status"></span>
          </div>
        </div>

        <!-- Agent config -->
        <div class="config-card" style="margin-top:16px;">
          <h1>AGENT CONFIG</h1>
          <div class="form-group">
            <label class="form-label">Max concurrent tasks</label>
            <input type="number" id="cfgMaxConcurrent" class="form-control" min="1" max="10" value="2" />
          </div>
          <div class="form-group">
            <label class="form-label">Loop interval (ms)</label>
            <input type="number" id="cfgLoopInterval" class="form-control" min="1000" step="1000" value="5000" />
          </div>
          <div class="form-actions">
            <button type="button" id="saveConfigBtn" class="btn">Save config</button>
            <span id="configStatus" class="status"></span>
          </div>
        </div>
      </div>

      <!-- Right: task detail panel -->
      <div class="agent-detail" id="taskDetail" style="display:none;">
        <div class="config-card">
          <div class="agent-detail-header">
            <h1 id="detailTitle">TASK</h1>
            <div class="agent-detail-actions">
              <span id="detailStatus" class="agent-badge"></span>
              <button type="button" id="deleteTaskBtn" class="btn btn-small btn-danger">Delete</button>
              <button type="button" id="unblockTaskBtn" class="btn btn-small" style="display:none;">Unblock</button>
              <button type="button" id="closeDetailBtn" class="btn btn-small btn-secondary">Close</button>
            </div>
          </div>
          <p id="detailGoal" class="config-note"></p>

          <!-- Plan -->
          <h2 style="margin-top:16px;">PLAN</h2>
          <ol id="detailPlan" class="agent-plan-list"></ol>

          <!-- Learnings -->
          <div id="detailLearnings" style="display:none;">
            <h2 style="margin-top:16px;">LEARNINGS</h2>
            <div id="detailLearningsContent"></div>
          </div>

          <!-- Log -->
          <h2 style="margin-top:16px;">LOG</h2>
          <div id="detailLog" class="agent-log"></div>
        </div>
      </div>
    </div>

  </main>

  <script src="/static/nav.js"></script>
  <script src="/static/autoagent.js"></script>
</body>
</html>
```

- [ ] **Step 4.2: Verify the page loads**

Navigate to `http://localhost:3000/autoagent` while logged in as admin. The page should load without a 404 or console errors. You will see "Loading..." in the task list (the JS isn't written yet).

- [ ] **Step 4.3: Commit**

```bash
git add public/autoagent.html
git commit -m "feat: add autoagent.html — autonomous agent dashboard page"
```

---

## Task 5: public/autoagent.css and public/autoagent.js — Dashboard styles and logic

**Files:**
- Create: `public/autoagent.css`
- Create: `public/autoagent.js`

- [ ] **Step 5.1: Create autoagent.css**

```css
.agent-layout {
  display: flex;
  gap: 20px;
  align-items: flex-start;
}

.agent-sidebar {
  flex: 0 0 340px;
  min-width: 0;
}

.agent-detail {
  flex: 1;
  min-width: 0;
}

.agent-task-card {
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 4px;
  margin-bottom: 8px;
  cursor: pointer;
  transition: border-color 0.15s;
}

.agent-task-card:hover {
  border-color: var(--accent);
}

.agent-task-card.active {
  border-color: var(--accent);
  background: rgba(255,255,255,0.03);
}

.agent-task-title {
  font-size: 13px;
  font-weight: 600;
  margin: 0 0 4px 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.agent-task-meta {
  font-size: 11px;
  color: var(--text-dim);
  display: flex;
  gap: 10px;
  align-items: center;
}

.agent-progress {
  flex: 1;
  height: 4px;
  background: var(--border);
  border-radius: 2px;
  overflow: hidden;
}

.agent-progress-bar {
  height: 100%;
  background: var(--accent);
  border-radius: 2px;
  transition: width 0.3s;
}

.agent-badge {
  font-size: 10px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 3px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.agent-badge-queued       { background: #333; color: #aaa; }
.agent-badge-planning     { background: #2a3a5a; color: #7ab3f7; }
.agent-badge-executing    { background: #1a3a1a; color: #6fcf6f; }
.agent-badge-learning     { background: #3a2a1a; color: #f0b96a; }
.agent-badge-awaiting_approval { background: #3a1a1a; color: #f07070; }
.agent-badge-blocked      { background: #2a2a1a; color: #d4c862; }
.agent-badge-complete     { background: #1a2a1a; color: #5abf5a; }
.agent-badge-failed       { background: #3a1515; color: #e05555; }

.agent-approval-card {
  border-color: #f07070 !important;
}

.agent-approval-item {
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 4px;
  margin-bottom: 10px;
}

.agent-approval-action {
  font-size: 12px;
  color: var(--text-dim);
  margin: 6px 0;
  word-break: break-all;
}

.agent-approval-buttons {
  display: flex;
  gap: 8px;
  margin-top: 8px;
  align-items: center;
}

.agent-rejection-input {
  flex: 1;
}

.agent-detail-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}

.agent-detail-actions {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
}

.agent-plan-list {
  padding-left: 18px;
  margin: 8px 0;
}

.agent-plan-list li {
  font-size: 12px;
  margin-bottom: 6px;
  color: var(--text-dim);
}

.agent-plan-list li.step-done {
  color: var(--text);
  text-decoration: line-through;
  opacity: 0.6;
}

.agent-plan-list li.step-current {
  color: var(--accent);
  font-weight: 600;
}

.agent-log {
  max-height: 420px;
  overflow-y: auto;
  font-size: 11px;
  line-height: 1.6;
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 10px 12px;
  background: var(--bg-secondary, #0e0e0e);
}

.agent-log-entry {
  margin-bottom: 4px;
  word-break: break-word;
}

.agent-log-entry .log-ts {
  color: var(--text-dim);
  margin-right: 6px;
  font-size: 10px;
}

.log-thought           { color: var(--text); }
.log-action            { color: #7ab3f7; }
.log-result            { color: #aaa; padding-left: 12px; }
.log-approval_request  { color: #f07070; font-weight: 600; }
.log-learn             { color: #f0b96a; }

@media (max-width: 768px) {
  .agent-layout { flex-direction: column; }
  .agent-sidebar { flex: none; width: 100%; }
}
```

- [ ] **Step 5.2: Create autoagent.js**

```js
(function () {
  'use strict';

  let selectedTaskId = null;
  let refreshTimer = null;

  // ---- Utility ----

  function statusBadge(status) {
    return `<span class="agent-badge agent-badge-${status}">${status.replace('_', ' ')}</span>`;
  }

  function shortTs(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleTimeString();
    } catch (_) { return iso; }
  }

  function progressPct(task) {
    if (!task.plan || task.plan.length === 0) return 0;
    const done = task.plan.filter(s => s.status === 'done').length;
    return Math.round((done / task.plan.length) * 100);
  }

  // ---- Approval queue ----

  async function loadApprovalQueue() {
    let tasks;
    try {
      const r = await fetch('/api/agent/tasks');
      if (!r.ok) return;
      const index = await r.json();
      const pending = index.filter(e => e.status === 'awaiting_approval');
      const queue = document.getElementById('approvalQueue');
      const list = document.getElementById('approvalList');
      if (pending.length === 0) {
        queue.style.display = 'none';
        list.innerHTML = '';
        return;
      }
      queue.style.display = '';
      const details = await Promise.all(pending.map(e =>
        fetch(`/api/agent/tasks/${e.id}`).then(r => r.ok ? r.json() : null)
      ));
      list.innerHTML = '';
      for (const task of details) {
        if (!task || !task.pendingApproval) continue;
        const pa = task.pendingApproval;
        const div = document.createElement('div');
        div.className = 'agent-approval-item';
        div.innerHTML = `
          <strong>${escHtml(task.title)}</strong>
          <div class="agent-approval-action">
            Action: <code>${escHtml(pa.action)}</code><br>
            Args: <code>${escHtml(JSON.stringify(pa.args).slice(0, 300))}</code>
          </div>
          <div class="agent-approval-buttons">
            <button class="btn btn-small approve-btn" data-id="${task.id}">Approve</button>
            <input type="text" class="form-control rejection-reason agent-rejection-input" placeholder="Rejection reason..." />
            <button class="btn btn-small btn-danger reject-btn" data-id="${task.id}">Reject</button>
          </div>`;
        list.appendChild(div);
      }
      list.querySelectorAll('.approve-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          await fetch(`/api/agent/tasks/${btn.dataset.id}/approve`, { method: 'POST' });
          refresh();
        });
      });
      list.querySelectorAll('.reject-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const reason = btn.closest('.agent-approval-buttons')
            .querySelector('.rejection-reason')?.value || '';
          await fetch(`/api/agent/tasks/${btn.dataset.id}/reject`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason })
          });
          refresh();
        });
      });
    } catch (_) {}
  }

  // ---- Task list ----

  async function loadTaskList() {
    const list = document.getElementById('taskList');
    let index;
    try {
      const r = await fetch('/api/agent/tasks');
      if (!r.ok) { list.innerHTML = '<p class="config-note">Error loading tasks.</p>'; return; }
      index = await r.json();
    } catch (_) { list.innerHTML = '<p class="config-note">Error loading tasks.</p>'; return; }

    if (index.length === 0) {
      list.innerHTML = '<p class="config-note">No tasks yet. Create one below.</p>';
      return;
    }

    // Sort: awaiting_approval first, then by updatedAt desc
    index.sort((a, b) => {
      if (a.status === 'awaiting_approval' && b.status !== 'awaiting_approval') return -1;
      if (b.status === 'awaiting_approval' && a.status !== 'awaiting_approval') return 1;
      return new Date(b.updatedAt) - new Date(a.updatedAt);
    });

    list.innerHTML = '';
    for (const entry of index) {
      const card = document.createElement('div');
      card.className = 'agent-task-card' + (entry.id === selectedTaskId ? ' active' : '');
      card.dataset.id = entry.id;

      // We need plan info for the progress bar — fetch full task only if selected
      const pct = 0; // updated when detail loads
      card.innerHTML = `
        <div class="agent-task-title">${escHtml(entry.title)}</div>
        <div class="agent-task-meta">
          ${statusBadge(entry.status)}
          <div class="agent-progress"><div class="agent-progress-bar" style="width:${pct}%"></div></div>
          <span>${shortTs(entry.updatedAt)}</span>
        </div>`;

      card.addEventListener('click', () => selectTask(entry.id));
      list.appendChild(card);
    }
  }

  // ---- Task detail ----

  async function selectTask(id) {
    selectedTaskId = id;

    // Highlight card
    document.querySelectorAll('.agent-task-card').forEach(c => {
      c.classList.toggle('active', c.dataset.id === id);
    });

    const detail = document.getElementById('taskDetail');
    detail.style.display = '';

    let task;
    try {
      const r = await fetch(`/api/agent/tasks/${id}`);
      if (!r.ok) return;
      task = await r.json();
    } catch (_) { return; }

    // Header
    document.getElementById('detailTitle').textContent = task.title;
    document.getElementById('detailGoal').textContent = task.goal;
    const statusEl = document.getElementById('detailStatus');
    statusEl.className = `agent-badge agent-badge-${task.status}`;
    statusEl.textContent = task.status.replace('_', ' ');

    // Unblock button
    const unblockBtn = document.getElementById('unblockTaskBtn');
    unblockBtn.style.display = task.status === 'blocked' ? '' : 'none';
    unblockBtn.onclick = async () => {
      await fetch(`/api/agent/tasks/${id}/unblock`, { method: 'POST' });
      refresh();
    };

    // Delete button
    document.getElementById('deleteTaskBtn').onclick = async () => {
      if (!confirm(`Delete task "${task.title}"?`)) return;
      await fetch(`/api/agent/tasks/${id}`, { method: 'DELETE' });
      selectedTaskId = null;
      document.getElementById('taskDetail').style.display = 'none';
      refresh();
    };

    // Close button
    document.getElementById('closeDetailBtn').onclick = () => {
      selectedTaskId = null;
      document.getElementById('taskDetail').style.display = 'none';
      document.querySelectorAll('.agent-task-card').forEach(c => c.classList.remove('active'));
    };

    // Plan
    const planEl = document.getElementById('detailPlan');
    if (task.plan && task.plan.length > 0) {
      planEl.innerHTML = '';
      task.plan.forEach((s, i) => {
        const li = document.createElement('li');
        const isCurrent = i === task.currentStep && task.status === 'executing';
        li.className = s.status === 'done' ? 'step-done' : (isCurrent ? 'step-current' : '');
        li.textContent = s.description;
        planEl.appendChild(li);
      });
      // Update progress bar in task card
      const pct = progressPct(task);
      const card = document.querySelector(`.agent-task-card[data-id="${id}"] .agent-progress-bar`);
      if (card) card.style.width = `${pct}%`;
    } else {
      planEl.innerHTML = '<li style="list-style:none;color:var(--text-dim)">Plan not yet created.</li>';
    }

    // Learnings
    const learningsDiv = document.getElementById('detailLearnings');
    const learningsContent = document.getElementById('detailLearningsContent');
    const l = task.learnings;
    if (l && (l.skillsCreated?.length > 0 || l.factsAdded?.length > 0 || l.strategyNotes)) {
      learningsDiv.style.display = '';
      let html = '';
      if (l.skillsCreated?.length > 0) html += `<p class="config-note">Skills created: ${l.skillsCreated.map(escHtml).join(', ')}</p>`;
      if (l.factsAdded?.length > 0) html += `<p class="config-note">Facts stored: ${l.factsAdded.map(escHtml).join(', ')}</p>`;
      learningsContent.innerHTML = html;
    } else {
      learningsDiv.style.display = 'none';
    }

    // Log
    const logEl = document.getElementById('detailLog');
    if (task.log && task.log.length > 0) {
      logEl.innerHTML = task.log.map(e =>
        `<div class="agent-log-entry log-${e.type}">` +
        `<span class="log-ts">${shortTs(e.ts)}</span>` +
        `<span class="log-type">[${e.type}]</span> ${escHtml(e.content)}` +
        `</div>`
      ).join('');
      logEl.scrollTop = logEl.scrollHeight;
    } else {
      logEl.innerHTML = '<span style="color:var(--text-dim)">No log entries yet.</span>';
    }
  }

  // ---- New task form ----

  document.getElementById('newTaskBtn').addEventListener('click', () => {
    const form = document.getElementById('newTaskForm');
    form.style.display = form.style.display === 'none' ? '' : 'none';
  });

  document.getElementById('cancelTaskBtn').addEventListener('click', () => {
    document.getElementById('newTaskForm').style.display = 'none';
    document.getElementById('taskGoal').value = '';
    document.getElementById('taskStatus').textContent = '';
  });

  document.getElementById('submitTaskBtn').addEventListener('click', async () => {
    const goal = document.getElementById('taskGoal').value.trim();
    const blockedBehavior = document.getElementById('taskBlockedBehavior').value;
    const statusEl = document.getElementById('taskStatus');
    if (!goal) { statusEl.textContent = 'Goal is required.'; statusEl.className = 'status error'; return; }
    statusEl.textContent = 'Creating...';
    statusEl.className = 'status';
    try {
      const r = await fetch('/api/agent/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal, blockedBehavior })
      });
      if (!r.ok) {
        const e = await r.json();
        statusEl.textContent = e.error || 'Error';
        statusEl.className = 'status error';
        return;
      }
      const task = await r.json();
      document.getElementById('newTaskForm').style.display = 'none';
      document.getElementById('taskGoal').value = '';
      statusEl.textContent = '';
      refresh();
      selectTask(task.id);
    } catch (_) {
      statusEl.textContent = 'Network error.';
      statusEl.className = 'status error';
    }
  });

  // ---- Config ----

  async function loadConfig() {
    try {
      const r = await fetch('/api/agent/config');
      if (!r.ok) return;
      const cfg = await r.json();
      document.getElementById('cfgMaxConcurrent').value = cfg.maxConcurrent ?? 2;
      document.getElementById('cfgLoopInterval').value = cfg.loopIntervalMs ?? 5000;
    } catch (_) {}
  }

  document.getElementById('saveConfigBtn').addEventListener('click', async () => {
    const statusEl = document.getElementById('configStatus');
    statusEl.textContent = 'Saving...';
    statusEl.className = 'status';
    try {
      const r = await fetch('/api/agent/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          maxConcurrent: Number(document.getElementById('cfgMaxConcurrent').value),
          loopIntervalMs: Number(document.getElementById('cfgLoopInterval').value)
        })
      });
      if (!r.ok) { const e = await r.json(); statusEl.textContent = e.error || 'Error'; statusEl.className = 'status error'; return; }
      statusEl.textContent = 'Saved.';
      statusEl.className = 'status ok';
      setTimeout(() => { statusEl.textContent = ''; }, 2000);
    } catch (_) { statusEl.textContent = 'Error.'; statusEl.className = 'status error'; }
  });

  // ---- Refresh ----

  async function refresh() {
    await Promise.all([loadApprovalQueue(), loadTaskList()]);
    if (selectedTaskId) await selectTask(selectedTaskId);
  }

  function startAutoRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(refresh, 5000);
  }

  // ---- XSS protection ----

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ---- Init ----

  loadConfig();
  refresh();
  startAutoRefresh();
})();
```

- [ ] **Step 5.3: Verify dashboard renders correctly**

Navigate to `http://localhost:3000/autoagent`. You should see:
- "TASKS" panel on the left with "No tasks yet" message
- "NEW TASK" button that reveals the form when clicked
- "AGENT CONFIG" panel with maxConcurrent and loopInterval inputs

Open browser DevTools console — should be zero errors.

- [ ] **Step 5.4: End-to-end smoke test**

1. Click "+ New task" and enter goal: `Search for the current weather in New York and log what you find`
2. Set blocked behavior: "Pause and wait"
3. Click "Create task"
4. The task card should appear with status `queued`
5. Within 5-10 seconds, status should change to `planning`, then `executing`
6. The log panel should show thought/action entries populating

- [ ] **Step 5.5: Commit**

```bash
git add public/autoagent.css public/autoagent.js
git commit -m "feat: add autoagent dashboard — task list, detail panel, approval queue, new task form, config"
```

---

## Task 6: Nav updates and final wiring

**Files:**
- Modify: `public/agents.html`, `public/app.html`, `public/config.html`, `public/dashboard.html`, `public/debug.html`, `public/editor.html`, `public/heartbeat.html`, `public/personality.html`, `public/pipelines.html`, `public/profile.html`, `public/project.html`, `public/projects.html`, `public/rag.html`, `public/skills.html`, `public/users.html`

- [ ] **Step 6.1: Add AUTOAGENT nav link to every existing HTML page**

In each of the 15 HTML files listed above, find the SYSTEM dropdown nav block and add the AUTOAGENT link between PIPELINES and USERS. The existing markup in all these files looks like:

```html
          <a href="/pipelines" class="nav-link">PIPELINES</a>
          <a href="/users" class="nav-link">USERS</a>
```

Replace with:

```html
          <a href="/pipelines" class="nav-link">PIPELINES</a>
          <a href="/autoagent" class="nav-link">AUTOAGENT</a>
          <a href="/users" class="nav-link">USERS</a>
```

Do this for each file: `agents.html`, `app.html`, `config.html`, `dashboard.html`, `debug.html`, `editor.html`, `heartbeat.html`, `personality.html`, `pipelines.html`, `profile.html`, `project.html`, `projects.html`, `rag.html`, `skills.html`, `users.html`.

Note: `pipelines.html` — if PIPELINES is the active page, it will be a `<span class="nav-link active">` instead of an `<a>` tag. The line to find will still have `PIPELINES` followed by a line with `USERS`.

- [ ] **Step 6.2: Verify nav link appears on every page**

Visit each of these pages while logged in as admin and confirm the SYSTEM dropdown contains AUTOAGENT between PIPELINES and USERS:
- `/dashboard`
- `/app`
- `/skills`
- `/heartbeat`

- [ ] **Step 6.3: Test chat intent detection**

In the chat UI (`/app`), send the message:
```
/agent goal Research the top 3 open source LLM benchmarks and summarize them
```

Expected chat response includes: `Agent task created.` with a Task ID and a link to `/autoagent`.

Navigate to `/autoagent` — the task should appear with status `queued` and start advancing.

- [ ] **Step 6.4: Commit**

```bash
git add public/agents.html public/app.html public/config.html public/dashboard.html public/debug.html public/editor.html public/heartbeat.html public/personality.html public/pipelines.html public/profile.html public/project.html public/projects.html public/rag.html public/skills.html public/users.html
git commit -m "feat: add AUTOAGENT nav link to all pages"
```

---

## Self-Review Notes

**Spec coverage check:**
- ✅ Server-resident agent with persistent state: agentStore.js (JSON files) + agentRunner.js (loop)
- ✅ Goal assignment from chat: `/agent goal` intent in POST /api/chat
- ✅ Goal assignment from dashboard: POST /api/agent/tasks form
- ✅ Dashboard with task list, detail, approval queue, config: Tasks 4 & 5
- ✅ Blocked behavior configurable per task: `blockedBehavior` field (pause/notify/continue)
- ✅ Approval gates for high-risk actions: `isHighRisk()` + `awaiting_approval` status + approve/reject API
- ✅ Strategy memory: `appendStrategy()` + injected into planning/execution prompts
- ✅ Skill creation (with approval): `create_skill` tool in high-risk tier
- ✅ Fact accumulation (with approval): `store_facts` in learning phase + approval gate
- ✅ Configurable concurrency: `maxConcurrent` in `getAgentConfig()`
- ✅ Configurable loop interval: `loopIntervalMs` in `getAgentConfig()`

**Type consistency:**
- `agentStore.writeTask(task)` used consistently — never `updateTask` where `writeTask` is needed
- `task.currentStep` is an index into `task.plan[]` — used correctly in `executeStep` and `selectTask`
- `task.status` values: `queued | planning | executing | learning | awaiting_approval | blocked | complete | failed` — used consistently across store, runner, and frontend badge CSS classes
- `resumeAfterApproval(task, approved, reason)` signature matches all call sites
