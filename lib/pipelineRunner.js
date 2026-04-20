'use strict';

const fs = require('fs');
const path = require('path');
const cronParser = require('cron-parser');
const { getConfig } = require('./config.js');
const skillsLib = require('./skills.js');
const emailLib = require('./email.js');
const { ollamaChatJson } = require('./ollama.js');
const logger = require('./logger.js');
const observability = require('./pipelineObservability.js');

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

function getPipelineById(pipelineId) {
  return readPipelines().find((p) => p.id === pipelineId) || null;
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------
function substituteVars(str, ctx) {
  return String(str || '').replace(/\{\{([\w.]+)\}\}/g, (_, keyPath) => {
    const parts = String(keyPath).split('.');
    let cur = ctx;
    for (const part of parts) {
      if (cur == null || typeof cur !== 'object') return '';
      cur = cur[part];
    }
    return cur != null ? String(cur) : '';
  });
}

function evaluateConditionExpression(expression, context) {
  const expr = String(expression || '').trim();
  if (!expr) return false;
  try {
    const fn = new Function('context', 'return !!(' + expr + ');');
    return !!fn(context);
  } catch (_) {
    return false;
  }
}

async function executeNode(node, context, config, runMeta) {
  observability.appendEvent({
    runId: runMeta.id,
    pipelineId: runMeta.pipelineId,
    nodeId: node.id,
    nodeType: node.type,
    stage: 'node_start',
    status: 'running',
    message: 'Node started'
  });
  switch (node.type) {
    case 'trigger':
      observability.appendEvent({
        runId: runMeta.id,
        pipelineId: runMeta.pipelineId,
        nodeId: node.id,
        nodeType: node.type,
        stage: 'node_end',
        status: 'success',
        message: 'Trigger skipped at runtime'
      });
      return null;

    case 'skill': {
      if (!node.skillId) return null;
      // Substitute vars in args values
      const args = {};
      for (const [k, v] of Object.entries(node.args || {})) {
        args[k] = typeof v === 'string' ? substituteVars(v, context) : v;
      }
      const result = await skillsLib.runSkill(node.skillId, args);
      observability.appendEvent({
        runId: runMeta.id,
        pipelineId: runMeta.pipelineId,
        nodeId: node.id,
        nodeType: node.type,
        stage: 'node_end',
        status: 'success',
        message: 'Skill completed',
        payload: { skillId: node.skillId }
      });
      return typeof result === 'object' ? JSON.stringify(result) : String(result ?? '');
    }

    case 'prompt': {
      const prompt = substituteVars(node.prompt || '', context);
      if (!prompt) return '';
      const data = await ollamaChatJson(
        config.ollama.mainUrl, config.ollama.mainModel,
        [{ role: 'user', content: prompt }]
      );
      observability.appendEvent({
        runId: runMeta.id,
        pipelineId: runMeta.pipelineId,
        nodeId: node.id,
        nodeType: node.type,
        stage: 'node_end',
        status: 'success',
        message: 'Prompt completed'
      });
      return data?.message?.content || '';
    }

    case 'email': {
      const emailCfg = config.email || {};
      if (!emailCfg.host || !emailCfg.defaultTo || !emailCfg.enabled) return 'Email not configured';
      const subject = substituteVars(node.subject || 'Pipeline result', context);
      const body = substituteVars(node.body || '', context);
      try {
        await emailLib.sendMail(emailCfg, { subject, text: body });
        observability.appendEvent({
          runId: runMeta.id,
          pipelineId: runMeta.pipelineId,
          nodeId: node.id,
          nodeType: node.type,
          stage: 'node_end',
          status: 'success',
          message: 'Email sent'
        });
        return 'Email sent';
      } catch (e) {
        logger.error('[Pipeline] email node error:', e.message);
        observability.appendEvent({
          runId: runMeta.id,
          pipelineId: runMeta.pipelineId,
          nodeId: node.id,
          nodeType: node.type,
          stage: 'node_end',
          status: 'failed',
          message: 'Email failed',
          payload: { error: e.message }
        });
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
        const respText = await resp.text();
        observability.appendDelivery({
          runId: runMeta.id,
          pipelineId: runMeta.pipelineId,
          nodeId: node.id,
          url,
          statusCode: resp.status,
          ok: resp.ok,
          responseText: String(respText || '').slice(0, 2000)
        });
        observability.appendEvent({
          runId: runMeta.id,
          pipelineId: runMeta.pipelineId,
          nodeId: node.id,
          nodeType: node.type,
          stage: 'node_end',
          status: resp.ok ? 'success' : 'failed',
          message: 'Webhook delivered',
          payload: { statusCode: resp.status }
        });
        return 'HTTP ' + resp.status;
      } catch (e) {
        logger.error('[Pipeline] webhook_out node error:', e.message);
        observability.appendDelivery({
          runId: runMeta.id,
          pipelineId: runMeta.pipelineId,
          nodeId: node.id,
          url,
          ok: false,
          error: e.message
        });
        observability.appendEvent({
          runId: runMeta.id,
          pipelineId: runMeta.pipelineId,
          nodeId: node.id,
          nodeType: node.type,
          stage: 'node_end',
          status: 'failed',
          message: 'Webhook delivery failed',
          payload: { error: e.message }
        });
        return 'Error: ' + e.message;
      }
    }

    case 'if': {
      const result = evaluateConditionExpression(node.expression, context);
      observability.appendEvent({
        runId: runMeta.id,
        pipelineId: runMeta.pipelineId,
        nodeId: node.id,
        nodeType: node.type,
        stage: 'node_end',
        status: 'success',
        message: 'Condition evaluated',
        payload: { result }
      });
      return result ? 'true' : 'false';
    }

    default:
      observability.appendEvent({
        runId: runMeta.id,
        pipelineId: runMeta.pipelineId,
        nodeId: node.id,
        nodeType: node.type,
        stage: 'node_end',
        status: 'warning',
        message: 'Unknown node type'
      });
      return null;
  }
}

function normalizeConnections(pipeline) {
  return (pipeline.connections || []).map((c) => {
    if (typeof c === 'string') return null;
    return {
      from: c.from,
      to: c.to,
      condition: c.condition === 'true' || c.condition === 'false' ? c.condition : null
    };
  }).filter((c) => c && c.from && c.to);
}

function severityAllowed(severity, minSeverity) {
  const order = { info: 0, warning: 1, error: 2, critical: 3 };
  return (order[severity] ?? 0) >= (order[minSeverity] ?? 2);
}

async function emitRunAlertIfNeeded(pipeline, runMeta, severity, message) {
  const cfg = getConfig();
  const alertCfg = (cfg.observability && cfg.observability.alerts) || {};
  if (!alertCfg.enabled) return;
  if (!severityAllowed(severity, alertCfg.minSeverity || 'error')) return;
  observability.appendAlert({
    runId: runMeta.id,
    pipelineId: pipeline.id,
    severity,
    type: 'pipeline_run',
    message
  });
  if (alertCfg.email && alertCfg.email.enabled && cfg.email && cfg.email.enabled && cfg.email.host && cfg.email.defaultTo) {
    try {
      await emailLib.sendMail(cfg.email, {
        subject: '[ShadowAI] Pipeline alert: ' + (pipeline.name || pipeline.id),
        text: message
      });
    } catch (e) {
      logger.warn('[Pipeline] alert email failed:', e.message);
    }
  }
  if (alertCfg.webhook && alertCfg.webhook.enabled && alertCfg.webhook.url) {
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (alertCfg.webhook.secret) headers['x-webhook-secret'] = alertCfg.webhook.secret;
      await fetch(alertCfg.webhook.url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          pipelineId: pipeline.id,
          pipelineName: pipeline.name || pipeline.id,
          runId: runMeta.id,
          severity,
          message,
          ts: new Date().toISOString()
        })
      });
    } catch (e) {
      logger.warn('[Pipeline] alert webhook failed:', e.message);
    }
  }
}

function findStartNodes(pipeline) {
  const nodes = Array.isArray(pipeline.nodes) ? pipeline.nodes : [];
  const triggers = nodes.filter((n) => n.type === 'trigger');
  if (triggers.length > 0) return triggers;
  return nodes.filter((n) => n.type !== 'trigger');
}

async function runPipeline(pipeline, opts) {
  const options = opts || {};
  const config = getConfig();
  const context = {
    date: new Date().toLocaleDateString(),
    time: new Date().toLocaleTimeString(),
    triggerType: options.triggerType || 'manual',
    triggerSource: options.source || 'api',
    payload: options.payload || {}
  };
  const runMeta = observability.createRun({
    pipelineId: pipeline.id,
    pipelineName: pipeline.name,
    triggerType: options.triggerType || 'manual',
    source: options.source || 'api',
    triggerId: options.triggerId || null,
    contextPreview: {
      payloadKeys: Object.keys(options.payload || {}),
      triggerType: options.triggerType || 'manual'
    }
  });

  observability.appendEvent({
    runId: runMeta.id,
    pipelineId: pipeline.id,
    stage: 'run_start',
    status: 'running',
    message: 'Pipeline run started',
    payload: { pipelineName: pipeline.name }
  });

  const nodeById = new Map((pipeline.nodes || []).map((n) => [n.id, n]));
  const outgoing = new Map();
  for (const c of normalizeConnections(pipeline)) {
    if (!outgoing.has(c.from)) outgoing.set(c.from, []);
    outgoing.get(c.from).push(c);
  }
  const startNodes = findStartNodes(pipeline);
  const visited = new Set();
  let nodeCount = 0;

  async function execFrom(nodeId, inheritedBranch) {
    const node = nodeById.get(nodeId);
    if (!node || visited.has(nodeId)) return;
    visited.add(nodeId);
    let result = null;
    if (node.type !== 'trigger') {
      nodeCount += 1;
      try {
        result = await executeNode(node, context, config, { id: runMeta.id, pipelineId: pipeline.id });
      } catch (e) {
        logger.error('[Pipeline] node', node.id, 'type', node.type, 'error:', e.message);
        observability.appendEvent({
          runId: runMeta.id,
          pipelineId: pipeline.id,
          nodeId: node.id,
          nodeType: node.type,
          stage: 'node_end',
          status: 'failed',
          message: 'Node execution failed',
          payload: { error: e.message }
        });
        if (node.outputVar) context[node.outputVar] = 'Error: ' + e.message;
      }
      if (node.outputVar && result != null) context[node.outputVar] = String(result);
    }

    const nextEdges = outgoing.get(nodeId) || [];
    for (const edge of nextEdges) {
      if (edge.condition && inheritedBranch && edge.condition !== inheritedBranch) continue;
      if (node.type === 'if') {
        const branch = String(result) === 'true' ? 'true' : 'false';
        if (edge.condition && edge.condition !== branch) continue;
        if (!edge.condition && branch !== 'true') continue;
      }
      await execFrom(edge.to, null);
    }
  }

  try {
    for (const startNode of startNodes) {
      await execFrom(startNode.id, null);
    }
    observability.completeRun(runMeta.id, { status: 'success', nodeCount });
    await emitRunAlertIfNeeded(pipeline, runMeta, 'info', 'Pipeline run succeeded: ' + (pipeline.name || pipeline.id));
    observability.appendEvent({
      runId: runMeta.id,
      pipelineId: pipeline.id,
      stage: 'run_end',
      status: 'success',
      message: 'Pipeline run completed',
      payload: { nodeCount }
    });
  } catch (e) {
    observability.completeRun(runMeta.id, { status: 'failed', nodeCount, error: e.message });
    await emitRunAlertIfNeeded(pipeline, runMeta, 'error', 'Pipeline run failed: ' + (pipeline.name || pipeline.id) + ' (' + e.message + ')');
    observability.appendEvent({
      runId: runMeta.id,
      pipelineId: pipeline.id,
      stage: 'run_end',
      status: 'failed',
      message: 'Pipeline run failed',
      payload: { error: e.message }
    });
    throw e;
  }

  context._runId = runMeta.id;
  return context;
}

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------
function getTriggerNodesByType(pipeline, triggerType) {
  return (pipeline.nodes || []).filter((n) => n.type === 'trigger' && n.triggerType === triggerType);
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
  const trigger = getTriggerNodesByType(pipeline, 'schedule')[0];
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
    runPipeline(pipeline, { triggerType: 'schedule', source: 'scheduler' }).then(() => {
      persistLastRun(pipeline.id, now);
    }).catch(e => {
      logger.error('[Pipeline] tick error for pipeline', pipeline.name, ':', e.message);
    });
  }
}

function findWebhookPipeline(triggerId) {
  const pipelines = readPipelines();
  for (const pipeline of pipelines) {
    const webhookTrigger = getTriggerNodesByType(pipeline, 'webhook').find((node) => node.webhookId === triggerId);
    if (webhookTrigger) {
      return { pipeline, trigger: webhookTrigger };
    }
  }
  return null;
}

async function runWebhookPipeline(triggerId, payload, providedSecret) {
  const found = findWebhookPipeline(triggerId);
  if (!found) {
    return { ok: false, status: 404, error: 'Webhook trigger not found' };
  }
  const expectedSecret = String(found.trigger.webhookSecret || '');
  if (expectedSecret) {
    const provided = String(providedSecret || '').trim();
    if (!provided || provided !== expectedSecret) {
      return { ok: false, status: 401, error: 'Invalid webhook secret' };
    }
  }
  const context = await runPipeline(found.pipeline, {
    triggerType: 'webhook',
    source: 'webhook',
    triggerId,
    payload: payload || {}
  });
  return { ok: true, status: 200, pipelineId: found.pipeline.id, runId: context._runId, context };
}

function getWebhookTriggers() {
  const out = [];
  for (const pipeline of readPipelines()) {
    for (const trigger of getTriggerNodesByType(pipeline, 'webhook')) {
      out.push({
        pipelineId: pipeline.id,
        pipelineName: pipeline.name || pipeline.id,
        triggerId: trigger.webhookId || '',
        enabled: pipeline.enabled !== false && trigger.enabled !== false,
        hasSecret: !!trigger.webhookSecret
      });
    }
  }
  return out.filter((t) => t.triggerId);
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

module.exports = {
  readPipelines,
  writePipelines,
  getPipelineById,
  runPipeline,
  runWebhookPipeline,
  getWebhookTriggers,
  startScheduler,
  stopScheduler
};
