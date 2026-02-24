'use strict';

const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./personality.js');

const STRUCTURED_PATH = path.join(DATA_DIR, 'memory.json');

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readAll() {
  ensureDir();
  if (!fs.existsSync(STRUCTURED_PATH)) {
    return { facts: {}, lastUpdated: null };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(STRUCTURED_PATH, 'utf8'));
    const facts = raw && typeof raw.facts === 'object' && raw.facts !== null ? raw.facts : {};
    const lastUpdated = raw && typeof raw.lastUpdated === 'string' ? raw.lastUpdated : null;
    return { facts, lastUpdated };
  } catch (_) {
    return { facts: {}, lastUpdated: null };
  }
}

function writeAll(data) {
  ensureDir();
  const payload = {
    facts: data && typeof data.facts === 'object' && data.facts !== null ? data.facts : {},
    lastUpdated: new Date().toISOString()
  };
  fs.writeFileSync(STRUCTURED_PATH, JSON.stringify(payload, null, 2), 'utf8');
}

function getMemory(key) {
  const k = String(key || '').trim();
  if (!k) return '';
  const { facts } = readAll();
  return Object.prototype.hasOwnProperty.call(facts, k) ? String(facts[k]) : '';
}

function setMemory(key, value) {
  const k = String(key || '').trim();
  if (!k) return;
  const v = String(value ?? '').trim();
  const data = readAll();
  const facts = { ...data.facts, [k]: v };
  writeAll({ facts });
}

module.exports = {
  readAll,
  writeAll,
  getMemory,
  setMemory,
  STRUCTURED_PATH
};

