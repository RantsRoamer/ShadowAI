const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const PERSONALITY_PATH = path.join(DATA_DIR, 'personality.md');
const MEMORY_PATH = path.join(DATA_DIR, 'memory.md');
const BEHAVIOR_PATH = path.join(DATA_DIR, 'AIBEHAVIOR.md');

function safeUserScope(user) {
  if (!user) return '';
  if (typeof user === 'object') user = user.username || '';
  return String(user || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

function pathForUser(user, fileName) {
  const scope = safeUserScope(user);
  if (!scope) return path.join(DATA_DIR, fileName);
  return path.join(DATA_DIR, 'users', scope, fileName);
}

function ensureParentDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readPersonality(user = '') {
  ensureDataDir();
  const p = pathForUser(user, 'personality.md');
  if (!fs.existsSync(p)) return '';
  return fs.readFileSync(p, 'utf8');
}

function writePersonality(content, user = '') {
  ensureDataDir();
  const p = pathForUser(user, 'personality.md');
  ensureParentDir(p);
  fs.writeFileSync(p, String(content ?? ''), 'utf8');
}

function readMemory(user = '') {
  ensureDataDir();
  const p = pathForUser(user, 'memory.md');
  if (!fs.existsSync(p)) return '';
  return fs.readFileSync(p, 'utf8');
}

function writeMemory(content, user = '') {
  ensureDataDir();
  const p = pathForUser(user, 'memory.md');
  ensureParentDir(p);
  fs.writeFileSync(p, String(content ?? ''), 'utf8');
}

function appendMemory(text, user = '') {
  const normalized = String(text).trim();
  if (!normalized) return;
  ensureDataDir();
  const p = pathForUser(user, 'memory.md');
  ensureParentDir(p);
  const existing = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
  // De-duplicate: strip the `- [timestamp] ` prefix and compare content
  const lines = existing.split('\n');
  const alreadyExists = lines.some(l => l.replace(/^- \[.*?\] /, '').trim() === normalized);
  if (alreadyExists) return;
  const line = `- [${new Date().toISOString()}] ${normalized}`;
  const newContent = existing ? existing.trimEnd() + '\n' + line : line;
  fs.writeFileSync(p, newContent + '\n', 'utf8');
}

function readBehavior(user = '') {
  ensureDataDir();
  const p = pathForUser(user, 'AIBEHAVIOR.md');
  if (!fs.existsSync(p)) return '';
  return fs.readFileSync(p, 'utf8');
}

function writeBehavior(content, user = '') {
  ensureDataDir();
  const p = pathForUser(user, 'AIBEHAVIOR.md');
  ensureParentDir(p);
  fs.writeFileSync(p, String(content ?? ''), 'utf8');
}

module.exports = {
  readPersonality,
  writePersonality,
  readMemory,
  writeMemory,
  appendMemory,
  readBehavior,
  writeBehavior,
  PERSONALITY_PATH,
  MEMORY_PATH,
  BEHAVIOR_PATH,
  DATA_DIR
};
