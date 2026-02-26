'use strict';

const fs = require('fs');
const path = require('path');
const cronParser = require('cron-parser');
const { getConfig } = require('./config.js');
const skillsLib = require('./skills.js');
const emailLib = require('./email.js');
const { ollamaChatJson } = require('./ollama.js');
const logger = require('./logger.js');

const PIPELINES_PATH = path.join(__dirname, '..', 'data', 'pipelines.json');
const INTERVAL_MS = 30 * 1000;
let intervalId = null;
const lastRunAt = new Map(); // pipeline.id -> timestamp ms

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------
function readPipelines() {
  try {
    if (fs.existsSync(PIPELINES_PATH)) return JSON.parse(fs.readFileSync(PIPELINES_PATH, 'utf8'));
  } catch (_) {}
  return [];
}

function writePipelines(pipelines) {
  const dir = path.dirname(PIPELINES_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(PIPELINES_PATH, JSON.stringify(pipelines, null, 2), 'utf8');
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------
function substituteVars(str, ctx) {
  return String(str || '').replace(/\{\{(\w+)\}\}/g, (_, k) => ctx[k] != null ? String(ctx[k]) : '');
}

/** Topological sort — returns nodes in execution order (trigger first) */
function buildExecutionOrder(pipeline) {
  const nodes = pipeline.nodes || [];
  const connections = pipeline.connections || [];
  // Build adjacency
  const deps = new Map(); // nodeId -> set of prerequisite nodeIds
  for (const n of nodes) deps.set(n.id, new Set());
  for (const c of connections) {
    if (deps.has(c.to)) deps.get(c.to).add(c.from);
  }
  const order = [];
  const visited = new Set();
  function visit(id) {
    if (visited.has(id)) return;
    visited.add(id);
    for (const dep of (deps.get(id) || [])) visit(dep);
    order.push(id);
  }
  for (const n of nodes) visit(n.id);
  return order.map(id => nodes.find(n => n.id === id)).filter(Boolean);
}

async function executeNode(node, context, config) {
  switch (node.type) {
    case 'trigger':
      return null;

    case 'skill': {
      if (!node.skillId) return null;
      // Substitute vars in args values
      const args = {};
      for (const [k, v] of Object.entries(node.args || {})) {
        args[k] = typeof v === 'string' ? substituteVars(v, context) : v;
      }
      const result = await skillsLib.runSkill(node.skillId, args);
      return typeof result === 'object' ? JSON.stringify(result) : String(result ?? '');
    }

    case 'prompt': {
      const prompt = substituteVars(node.prompt || '', context);
      if (!prompt) return '';
      const data = await ollamaChatJson(
        config.ollama.mainUrl, config.ollama.mainModel,
        [{ role: 'user', content: prompt }]
      );
      return data?.message?.content || '';
    }

    case 'email': {
      const emailCfg = config.email || {};
      if (!emailCfg.host || !emailCfg.defaultTo || !emailCfg.enabled) return 'Email not configured';
      const subject = substituteVars(node.subject || 'Pipeline result', context);
      const body = substituteVars(node.body || '', context);
      try {
        await emailLib.sendMail(emailCfg, { subject, text: body });
        return 'Email sent';
      } catch (e) {
        logger.error('[Pipeline] email node error:', e.message);
        return 'Email error: ' + e.message;
      }
    }

    case 'webhook_out': {
      const url = substituteVars(node.url || '', context);
      if (!url) return 'No URL';
      const bodyStr = substituteVars(node.bodyTemplate || '{{body}}', context);
      let bodyObj;
      try { bodyObj = JSON.parse(bodyStr); } catch (_) { bodyObj = { body: bodyStr }; }
      try {
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(bodyObj)
        });
        return 'HTTP ' + resp.status;
      } catch (e) {
        logger.error('[Pipeline] webhook_out node error:', e.message);
        return 'Error: ' + e.message;
      }
    }

    default:
      return null;
  }
}

async function runPipeline(pipeline) {
  const config = getConfig();
  const context = {
    date: new Date().toLocaleDateString(),
    time: new Date().toLocaleTimeString()
  };
  const order = buildExecutionOrder(pipeline);
  for (const node of order) {
    if (node.type === 'trigger') continue;
    try {
      const result = await executeNode(node, context, config);
      if (node.outputVar && result != null) context[node.outputVar] = String(result);
    } catch (e) {
      logger.error('[Pipeline] node', node.id, 'type', node.type, 'error:', e.message);
      if (node.outputVar) context[node.outputVar] = 'Error: ' + e.message;
    }
  }
  return context;
}

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------
function getTriggerNode(pipeline) {
  return (pipeline.nodes || []).find(n => n.type === 'trigger' && n.triggerType === 'schedule');
}

function getLastRunDate(pipeline) {
  if (pipeline.lastRunAt) {
    const t = Date.parse(pipeline.lastRunAt);
    if (!Number.isNaN(t)) return new Date(t);
  }
  const cached = lastRunAt.get(pipeline.id);
  if (cached) return new Date(cached);
  return new Date(0);
}

function isScheduleDue(pipeline) {
  if (pipeline.enabled === false || !pipeline.id) return false;
  const trigger = getTriggerNode(pipeline);
  if (!trigger || !trigger.schedule) return false;
  try {
    const last = getLastRunDate(pipeline);
    const interval = cronParser.parseExpression(trigger.schedule, { currentDate: last, utc: false });
    const next = interval.next().toDate();
    return Date.now() >= next.getTime();
  } catch (e) {
    logger.warn('[Pipeline] bad cron in pipeline "' + pipeline.name + '":', e.message);
    return false;
  }
}

function persistLastRun(pipelineId, timestampMs) {
  try {
    const pipelines = readPipelines();
    const idx = pipelines.findIndex(p => p.id === pipelineId);
    if (idx === -1) return;
    pipelines[idx] = { ...pipelines[idx], lastRunAt: new Date(timestampMs).toISOString() };
    writePipelines(pipelines);
  } catch (e) {
    logger.error('[Pipeline] persistLastRun error:', e.message);
  }
}

function tick() {
  const pipelines = readPipelines();
  const now = Date.now();
  for (const pipeline of pipelines) {
    if (!isScheduleDue(pipeline)) continue;
    logger.info('[Pipeline] running scheduled pipeline:', pipeline.name);
    lastRunAt.set(pipeline.id, now);
    runPipeline(pipeline).then(() => {
      persistLastRun(pipeline.id, now);
    }).catch(e => {
      logger.error('[Pipeline] tick error for pipeline', pipeline.name, ':', e.message);
    });
  }
}

function startScheduler() {
  if (intervalId) clearInterval(intervalId);
  tick();
  intervalId = setInterval(tick, INTERVAL_MS);
  logger.info('[Pipeline] scheduler started');
}

function stopScheduler() {
  if (intervalId) { clearInterval(intervalId); intervalId = null; }
}

module.exports = { readPipelines, writePipelines, runPipeline, startScheduler, stopScheduler };
