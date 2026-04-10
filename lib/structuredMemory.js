'use strict';

const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./personality.js');

const STRUCTURED_PATH = path.join(DATA_DIR, 'memory.json');

function safeUserScope(user) {
  if (!user) return '';
  if (typeof user === 'object') user = user.username || '';
  return String(user || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

function structuredPathForUser(user = '') {
  const scope = safeUserScope(user);
  if (!scope) return STRUCTURED_PATH;
  return path.join(DATA_DIR, 'users', scope, 'memory.json');
}

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readAll(user = '') {
  const target = structuredPathForUser(user);
  ensureDir(target);
  if (!fs.existsSync(target)) {
    return { facts: {}, lastUpdated: null };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(target, 'utf8'));
    const facts = raw && typeof raw.facts === 'object' && raw.facts !== null ? raw.facts : {};
    const lastUpdated = raw && typeof raw.lastUpdated === 'string' ? raw.lastUpdated : null;
    return { facts, lastUpdated };
  } catch (_) {
    return { facts: {}, lastUpdated: null };
  }
}

function writeAll(data, user = '') {
  const target = structuredPathForUser(user);
  ensureDir(target);
  const payload = {
    facts: data && typeof data.facts === 'object' && data.facts !== null ? data.facts : {},
    lastUpdated: new Date().toISOString()
  };
  fs.writeFileSync(target, JSON.stringify(payload, null, 2), 'utf8');
}

function getMemory(key, user = '') {
  const k = String(key || '').trim();
  if (!k) return '';
  const { facts } = readAll(user);
  return Object.prototype.hasOwnProperty.call(facts, k) ? String(facts[k]) : '';
}

function setMemory(key, value, user = '') {
  const k = String(key || '').trim();
  if (!k) return;
  const v = String(value ?? '').trim();
  const data = readAll(user);
  const facts = { ...data.facts, [k]: v };
  writeAll({ facts }, user);
}

module.exports = {
  readAll,
  writeAll,
  getMemory,
  setMemory,
  STRUCTURED_PATH
};

