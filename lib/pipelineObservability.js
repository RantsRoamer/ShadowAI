'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getConfig } = require('./config.js');

const DATA_DIR = path.join(__dirname, '..', 'data');
const RUNS_PATH = path.join(DATA_DIR, 'pipeline-runs.json');
const EVENTS_PATH = path.join(DATA_DIR, 'pipeline-events.json');
const DELIVERIES_PATH = path.join(DATA_DIR, 'webhook-deliveries.json');
const ALERTS_PATH = path.join(DATA_DIR, 'alerts.json');

const DEFAULT_RETENTION = {
  runs: 500,
  events: 5000,
  deliveries: 2000,
  alerts: 1000
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readArray(filePath) {
  try {
    if (!fs.existsSync(filePath)) return [];
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function writeArray(filePath, records) {
  ensureDataDir();
  fs.writeFileSync(filePath, JSON.stringify(records, null, 2), 'utf8');
}

function getRetention() {
  const cfg = getConfig();
  const raw = (cfg.observability && cfg.observability.retention) || {};
  return {
    runs: Number(raw.runs) > 0 ? Number(raw.runs) : DEFAULT_RETENTION.runs,
    events: Number(raw.events) > 0 ? Number(raw.events) : DEFAULT_RETENTION.events,
    deliveries: Number(raw.deliveries) > 0 ? Number(raw.deliveries) : DEFAULT_RETENTION.deliveries,
    alerts: Number(raw.alerts) > 0 ? Number(raw.alerts) : DEFAULT_RETENTION.alerts
  };
}

function trimToLimit(rows, limit) {
  if (!Array.isArray(rows)) return [];
  if (!Number.isFinite(limit) || limit <= 0) return rows;
  if (rows.length <= limit) return rows;
  return rows.slice(rows.length - limit);
}

function appendRecord(filePath, record, limit) {
  const rows = readArray(filePath);
  rows.push(record);
  writeArray(filePath, trimToLimit(rows, limit));
}

function newId(prefix) {
  return prefix + '_' + crypto.randomBytes(8).toString('hex');
}

function nowIso() {
  return new Date().toISOString();
}

function createRun({ pipelineId, pipelineName, triggerType, source, triggerId, contextPreview }) {
  const run = {
    id: newId('run'),
    pipelineId: pipelineId || '',
    pipelineName: pipelineName || '',
    triggerType: triggerType || 'manual',
    triggerId: triggerId || null,
    source: source || 'api',
    startedAt: nowIso(),
    finishedAt: null,
    status: 'running',
    nodeCount: 0,
    error: null,
    contextPreview: contextPreview || {}
  };
  appendRecord(RUNS_PATH, run, getRetention().runs);
  return run;
}

function completeRun(runId, updates) {
  const rows = readArray(RUNS_PATH);
  const idx = rows.findIndex((r) => r.id === runId);
  if (idx === -1) return null;
  const next = {
    ...rows[idx],
    finishedAt: nowIso(),
    ...updates
  };
  rows[idx] = next;
  writeArray(RUNS_PATH, trimToLimit(rows, getRetention().runs));
  return next;
}

function appendEvent({ runId, pipelineId, nodeId, nodeType, stage, status, message, payload }) {
  const evt = {
    id: newId('evt'),
    ts: nowIso(),
    runId: runId || null,
    pipelineId: pipelineId || '',
    nodeId: nodeId || null,
    nodeType: nodeType || null,
    stage: stage || 'run',
    status: status || 'info',
    message: message || '',
    payload: payload || null
  };
  appendRecord(EVENTS_PATH, evt, getRetention().events);
  return evt;
}

function appendDelivery({ runId, pipelineId, nodeId, url, statusCode, ok, error, responseText }) {
  const rec = {
    id: newId('delivery'),
    ts: nowIso(),
    runId: runId || null,
    pipelineId: pipelineId || '',
    nodeId: nodeId || null,
    url: url || '',
    ok: !!ok,
    statusCode: statusCode != null ? Number(statusCode) : null,
    error: error || null,
    responseText: responseText || ''
  };
  appendRecord(DELIVERIES_PATH, rec, getRetention().deliveries);
  return rec;
}

function appendAlert({ runId, pipelineId, severity, type, message, target }) {
  const alert = {
    id: newId('alert'),
    ts: nowIso(),
    runId: runId || null,
    pipelineId: pipelineId || '',
    severity: severity || 'error',
    type: type || 'pipeline_failure',
    message: message || '',
    target: target || null
  };
  appendRecord(ALERTS_PATH, alert, getRetention().alerts);
  return alert;
}

function parseTimeRange(query) {
  const sinceMs = query && query.since ? Date.parse(query.since) : null;
  const untilMs = query && query.until ? Date.parse(query.until) : null;
  return {
    sinceMs: Number.isFinite(sinceMs) ? sinceMs : null,
    untilMs: Number.isFinite(untilMs) ? untilMs : null
  };
}

function filterByTime(rows, key, query) {
  const { sinceMs, untilMs } = parseTimeRange(query);
  return rows.filter((row) => {
    const t = Date.parse(row[key] || row.ts || '');
    if (!Number.isFinite(t)) return true;
    if (sinceMs != null && t < sinceMs) return false;
    if (untilMs != null && t > untilMs) return false;
    return true;
  });
}

function paginate(rows, query) {
  const limit = Math.min(Math.max(Number(query && query.limit) || 100, 1), 1000);
  const offset = Math.max(Number(query && query.offset) || 0, 0);
  return {
    total: rows.length,
    limit,
    offset,
    items: rows.slice(offset, offset + limit)
  };
}

function listRuns(query) {
  let rows = readArray(RUNS_PATH).slice().reverse();
  rows = filterByTime(rows, 'startedAt', query || {});
  if (query && query.pipelineId) rows = rows.filter((r) => r.pipelineId === query.pipelineId);
  if (query && query.status) rows = rows.filter((r) => r.status === query.status);
  if (query && query.triggerType) rows = rows.filter((r) => r.triggerType === query.triggerType);
  return paginate(rows, query || {});
}

function getRun(runId) {
  return readArray(RUNS_PATH).find((r) => r.id === runId) || null;
}

function listEvents(query) {
  let rows = readArray(EVENTS_PATH).slice().reverse();
  rows = filterByTime(rows, 'ts', query || {});
  if (query && query.pipelineId) rows = rows.filter((r) => r.pipelineId === query.pipelineId);
  if (query && query.runId) rows = rows.filter((r) => r.runId === query.runId);
  if (query && query.status) rows = rows.filter((r) => r.status === query.status);
  return paginate(rows, query || {});
}

function listDeliveries(query) {
  let rows = readArray(DELIVERIES_PATH).slice().reverse();
  rows = filterByTime(rows, 'ts', query || {});
  if (query && query.pipelineId) rows = rows.filter((r) => r.pipelineId === query.pipelineId);
  if (query && query.runId) rows = rows.filter((r) => r.runId === query.runId);
  if (query && query.ok != null && query.ok !== '') rows = rows.filter((r) => String(r.ok) === String(query.ok));
  return paginate(rows, query || {});
}

function listAlerts(query) {
  let rows = readArray(ALERTS_PATH).slice().reverse();
  rows = filterByTime(rows, 'ts', query || {});
  if (query && query.pipelineId) rows = rows.filter((r) => r.pipelineId === query.pipelineId);
  if (query && query.runId) rows = rows.filter((r) => r.runId === query.runId);
  if (query && query.severity) rows = rows.filter((r) => r.severity === query.severity);
  return paginate(rows, query || {});
}

function getSummary() {
  const runs = readArray(RUNS_PATH);
  const events = readArray(EVENTS_PATH);
  const deliveries = readArray(DELIVERIES_PATH);
  const alerts = readArray(ALERTS_PATH);
  const last24h = Date.now() - (24 * 60 * 60 * 1000);
  const last24Runs = runs.filter((r) => Date.parse(r.startedAt || '') >= last24h);
  return {
    retention: getRetention(),
    counts: {
      runs: runs.length,
      events: events.length,
      deliveries: deliveries.length,
      alerts: alerts.length
    },
    health: {
      last24Runs: last24Runs.length,
      last24FailedRuns: last24Runs.filter((r) => r.status === 'failed').length,
      last24SuccessRuns: last24Runs.filter((r) => r.status === 'success').length,
      deliveryFailures: deliveries.filter((d) => !d.ok).length
    }
  };
}

module.exports = {
  createRun,
  completeRun,
  appendEvent,
  appendDelivery,
  appendAlert,
  listRuns,
  getRun,
  listEvents,
  listDeliveries,
  listAlerts,
  getSummary
};
