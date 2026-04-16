'use strict';

const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../personality.js');

const HIVEMIND_DIR = path.join(DATA_DIR, 'hivemind');
const STATE_PATH = path.join(HIVEMIND_DIR, 'state.json');
const EVENTS_PATH = path.join(HIVEMIND_DIR, 'events.jsonl');

function normalizeScopeUser(scopeUser) {
  const raw = String(scopeUser || '').trim();
  if (!raw) return '';
  // filesystem-safe, stable user key
  return raw.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
}

function resolvePaths(scopeUser) {
  const key = normalizeScopeUser(scopeUser);
  if (!key) {
    return {
      dir: HIVEMIND_DIR,
      statePath: STATE_PATH,
      eventsPath: EVENTS_PATH,
      scopeKey: ''
    };
  }
  const dir = path.join(HIVEMIND_DIR, 'users', key);
  return {
    dir,
    statePath: path.join(dir, 'state.json'),
    eventsPath: path.join(dir, 'events.jsonl'),
    scopeKey: key
  };
}

function ensureDir(dirPath = HIVEMIND_DIR) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function nowIso() {
  return new Date().toISOString();
}

function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) return fallback;
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object') ? parsed : fallback;
  } catch (_) {
    return fallback;
  }
}

function writeJson(filePath, obj) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), 'utf8');
}

function getSnapshot({ scopeUser = '' } = {}) {
  const { dir, statePath } = resolvePaths(scopeUser);
  ensureDir(dir);
  const snap = readJsonSafe(statePath, null);
  if (snap) return snap;
  const initial = {
    updatedAt: nowIso(),
    pinned: {
      facts: [],
      notes: ''
    },
    workingSummary: '',
    missions: [],
    agents: {}
  };
  writeJson(statePath, initial);
  return initial;
}

function updateSnapshot(patch, { scopeUser = '' } = {}) {
  const { statePath } = resolvePaths(scopeUser);
  const snap = getSnapshot({ scopeUser });
  const next = {
    ...snap,
    ...(patch && typeof patch === 'object' ? patch : {}),
    updatedAt: nowIso()
  };
  writeJson(statePath, next);
  return next;
}

function appendEvent(evt, { scopeUser = '' } = {}) {
  const { dir, eventsPath } = resolvePaths(scopeUser);
  ensureDir(dir);
  const e = {
    ts: nowIso(),
    type: String(evt && evt.type ? evt.type : 'event'),
    source: String(evt && evt.source ? evt.source : 'unknown'),
    taskId: evt && evt.taskId ? String(evt.taskId) : null,
    missionId: evt && evt.missionId ? String(evt.missionId) : null,
    agent: evt && evt.agent ? String(evt.agent) : null,
    user: evt && evt.user ? String(evt.user) : (scopeUser ? String(scopeUser) : null),
    message: evt && evt.message != null ? String(evt.message) : null,
    payload: evt && evt.payload != null ? evt.payload : null
  };
  fs.appendFileSync(eventsPath, JSON.stringify(e) + '\n', 'utf8');
  return e;
}

function listRecentEvents({ since = null, limit = 100, scopeUser = '' } = {}) {
  const { dir, eventsPath } = resolvePaths(scopeUser);
  ensureDir(dir);
  if (!fs.existsSync(eventsPath)) return { events: [], cursor: null };
  let raw = '';
  try {
    raw = fs.readFileSync(eventsPath, 'utf8');
  } catch (_) {
    return { events: [], cursor: null };
  }
  const lines = raw.split('\n').filter(Boolean);
  const parsed = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const e = JSON.parse(lines[i]);
      if (!e || typeof e !== 'object') continue;
      if (since && e.ts && String(e.ts) <= String(since)) continue;
      parsed.push(e);
      if (parsed.length >= Math.max(1, Math.min(500, Number(limit) || 100))) break;
    } catch (_) {}
  }
  const events = parsed; // newest-first
  const cursor = events.length > 0 ? events[0].ts : since;
  return { events, cursor: cursor || null };
}

module.exports = {
  HIVEMIND_DIR,
  STATE_PATH,
  EVENTS_PATH,
  normalizeScopeUser,
  getSnapshot,
  updateSnapshot,
  appendEvent,
  listRecentEvents
};

