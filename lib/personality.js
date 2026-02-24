const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const PERSONALITY_PATH = path.join(DATA_DIR, 'personality.md');
const MEMORY_PATH = path.join(DATA_DIR, 'memory.md');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readPersonality() {
  ensureDataDir();
  if (!fs.existsSync(PERSONALITY_PATH)) return '';
  return fs.readFileSync(PERSONALITY_PATH, 'utf8');
}

function writePersonality(content) {
  ensureDataDir();
  fs.writeFileSync(PERSONALITY_PATH, String(content ?? ''), 'utf8');
}

function readMemory() {
  ensureDataDir();
  if (!fs.existsSync(MEMORY_PATH)) return '';
  return fs.readFileSync(MEMORY_PATH, 'utf8');
}

function writeMemory(content) {
  ensureDataDir();
  fs.writeFileSync(MEMORY_PATH, String(content ?? ''), 'utf8');
}

function appendMemory(text) {
  const normalized = String(text).trim();
  if (!normalized) return;
  ensureDataDir();
  const existing = fs.existsSync(MEMORY_PATH) ? fs.readFileSync(MEMORY_PATH, 'utf8') : '';
  // De-duplicate: strip the `- [timestamp] ` prefix and compare content
  const lines = existing.split('\n');
  const alreadyExists = lines.some(l => l.replace(/^- \[.*?\] /, '').trim() === normalized);
  if (alreadyExists) return;
  const line = `- [${new Date().toISOString()}] ${normalized}`;
  const newContent = existing ? existing.trimEnd() + '\n' + line : line;
  fs.writeFileSync(MEMORY_PATH, newContent + '\n', 'utf8');
}

module.exports = {
  readPersonality,
  writePersonality,
  readMemory,
  writeMemory,
  appendMemory,
  PERSONALITY_PATH,
  MEMORY_PATH,
  DATA_DIR
};
