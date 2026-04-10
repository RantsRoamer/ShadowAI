'use strict';

const fs = require('fs');
const path = require('path');
const chatStore = require('./chatStore.js');

const DATA_DIR = path.join(__dirname, '..', 'data');
const LINKS_PATH = path.join(DATA_DIR, 'channel-links.json');
const CODE_TTL_MS = 10 * 60 * 1000;

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readRaw() {
  ensureDir();
  if (!fs.existsSync(LINKS_PATH)) return { links: {}, pendingCodes: {} };
  try {
    const raw = JSON.parse(fs.readFileSync(LINKS_PATH, 'utf8'));
    return {
      links: raw && typeof raw.links === 'object' && raw.links ? raw.links : {},
      pendingCodes: raw && typeof raw.pendingCodes === 'object' && raw.pendingCodes ? raw.pendingCodes : {}
    };
  } catch (_) {
    return { links: {}, pendingCodes: {} };
  }
}

function writeRaw(data) {
  ensureDir();
  fs.writeFileSync(LINKS_PATH, JSON.stringify(data, null, 2), 'utf8');
}

function cleanExpiredCodes(state) {
  const now = Date.now();
  for (const code of Object.keys(state.pendingCodes)) {
    const row = state.pendingCodes[code];
    if (!row || !row.expiresAt || Number(row.expiresAt) < now) delete state.pendingCodes[code];
  }
}

function createVerificationCode(appUsername) {
  const username = chatStore.safeUsername(appUsername || '');
  if (!username) return null;
  const state = readRaw();
  cleanExpiredCodes(state);
  const code = Math.random().toString(36).slice(2, 8).toUpperCase();
  state.pendingCodes[code] = { username, createdAt: Date.now(), expiresAt: Date.now() + CODE_TTL_MS };
  writeRaw(state);
  return { code, expiresInMs: CODE_TTL_MS };
}

function verifyAndLink(channelUsername, code) {
  const cu = chatStore.safeUsername(channelUsername || '');
  const c = String(code || '').trim().toUpperCase();
  if (!cu || !c) return { ok: false, error: 'Invalid channel or code.' };
  if (!chatStore.isChannelUsername(cu) || cu.startsWith('project_')) return { ok: false, error: 'Unsupported channel type.' };
  const state = readRaw();
  cleanExpiredCodes(state);
  const row = state.pendingCodes[c];
  if (!row || !row.username) return { ok: false, error: 'Invalid or expired verification code.' };
  state.links[cu] = row.username;
  delete state.pendingCodes[c];
  writeRaw(state);
  return { ok: true, username: row.username };
}

function unlinkChannel(channelUsername) {
  const cu = chatStore.safeUsername(channelUsername || '');
  const state = readRaw();
  if (state.links[cu]) {
    delete state.links[cu];
    writeRaw(state);
    return true;
  }
  return false;
}

function getLinkedAppUser(channelUsername) {
  const cu = chatStore.safeUsername(channelUsername || '');
  const state = readRaw();
  return state.links[cu] || null;
}

function getLinkedChannelsForUser(appUsername) {
  const user = chatStore.safeUsername(appUsername || '');
  if (!user) return [];
  const state = readRaw();
  return Object.keys(state.links).filter((k) => state.links[k] === user);
}

module.exports = {
  createVerificationCode,
  verifyAndLink,
  unlinkChannel,
  getLinkedAppUser,
  getLinkedChannelsForUser
};

