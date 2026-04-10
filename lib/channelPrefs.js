'use strict';

const fs = require('fs');
const path = require('path');
const chatStore = require('./chatStore.js');

const DATA_DIR = path.join(__dirname, '..', 'data');
const PREFS_PATH = path.join(DATA_DIR, 'channel-prefs.json');

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readRaw() {
  ensureDir();
  if (!fs.existsSync(PREFS_PATH)) return { statsEnabled: {} };
  try {
    const raw = JSON.parse(fs.readFileSync(PREFS_PATH, 'utf8'));
    return {
      statsEnabled: raw && typeof raw.statsEnabled === 'object' && raw.statsEnabled ? raw.statsEnabled : {}
    };
  } catch (_) {
    return { statsEnabled: {} };
  }
}

function writeRaw(data) {
  ensureDir();
  fs.writeFileSync(PREFS_PATH, JSON.stringify(data, null, 2), 'utf8');
}

function isStatsEnabled(channelUsername) {
  const cu = chatStore.safeUsername(channelUsername || '');
  if (!cu) return false;
  const state = readRaw();
  return state.statsEnabled[cu] === true;
}

function toggleStats(channelUsername) {
  const cu = chatStore.safeUsername(channelUsername || '');
  if (!cu) return false;
  const state = readRaw();
  const next = !(state.statsEnabled[cu] === true);
  state.statsEnabled[cu] = next;
  writeRaw(state);
  return next;
}

module.exports = {
  isStatsEnabled,
  toggleStats
};
