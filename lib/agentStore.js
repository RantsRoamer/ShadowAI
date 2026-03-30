'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR } = require('./personality.js');

const AGENTS_DIR = path.join(DATA_DIR, 'agents');
const INDEX_PATH = path.join(AGENTS_DIR, 'index.json');
const STRATEGY_PATH = path.join(AGENTS_DIR, 'strategy.md');

function ensureDir() {
  if (!fs.existsSync(AGENTS_DIR)) fs.mkdirSync(AGENTS_DIR, { recursive: true });
}

function readIndex() {
  ensureDir();
  if (!fs.existsSync(INDEX_PATH)) return [];
  try { return JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8')); } catch (_) { return []; }
}

function writeIndex(index) {
  ensureDir();
  fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2), 'utf8');
}

function readTask(id) {
  ensureDir();
  const p = path.join(AGENTS_DIR, `${id}.json`);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return null; }
}

function writeTask(task) {
  ensureDir();
  task.updatedAt = new Date().toISOString();
  fs.writeFileSync(
    path.join(AGENTS_DIR, `${task.id}.json`),
    JSON.stringify(task, null, 2),
    'utf8'
  );
  const index = readIndex();
  const i = index.findIndex(e => e.id === task.id);
  const entry = { id: task.id, title: task.title, status: task.status, updatedAt: task.updatedAt };
  if (i === -1) index.push(entry); else index[i] = entry;
  writeIndex(index);
}

function createTask({ goal, title, blockedBehavior = 'pause' }) {
  ensureDir();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const task = {
    id,
    title: title || goal.slice(0, 60),
    goal,
    status: 'queued',
    blockedBehavior,
    createdAt: now,
    updatedAt: now,
    plan: [],
    currentStep: 0,
    log: [],
    pendingApproval: null,
    learnings: { strategyNotes: '', skillsCreated: [], factsAdded: [] }
  };
  writeTask(task);
  return task;
}

function listTasks() {
  return readIndex();
}

function getTask(id) {
  return readTask(id);
}

function updateTask(id, updates) {
  const task = readTask(id);
  if (!task) return null;
  Object.assign(task, updates);
  writeTask(task);
  return task;
}

function deleteTask(id) {
  ensureDir();
  const p = path.join(AGENTS_DIR, `${id}.json`);
  if (fs.existsSync(p)) fs.unlinkSync(p);
  writeIndex(readIndex().filter(e => e.id !== id));
}

function readStrategy() {
  ensureDir();
  if (!fs.existsSync(STRATEGY_PATH)) return '';
  return fs.readFileSync(STRATEGY_PATH, 'utf8');
}

function appendStrategy(note) {
  ensureDir();
  const trimmed = String(note).trim();
  if (!trimmed) return;
  const line = `- [${new Date().toISOString()}] ${trimmed}`;
  const existing = fs.existsSync(STRATEGY_PATH) ? fs.readFileSync(STRATEGY_PATH, 'utf8') : '';
  fs.writeFileSync(STRATEGY_PATH, (existing ? existing.trimEnd() + '\n' + line : line) + '\n', 'utf8');
}

module.exports = {
  createTask, listTasks, getTask, updateTask, deleteTask,
  readStrategy, appendStrategy,
  AGENTS_DIR, STRATEGY_PATH
};
