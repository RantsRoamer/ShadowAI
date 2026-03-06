'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const PROJECTS_DIR = path.join(DATA_DIR, 'projects');

const MEMORY_FILENAME = 'memory.md';
const PROJECT_META_FILENAME = 'project.json';

function ensureProjectsDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(PROJECTS_DIR)) fs.mkdirSync(PROJECTS_DIR, { recursive: true });
}

function safeId(id) {
  if (!id || typeof id !== 'string') return '';
  return id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

function getProjectDir(projectId) {
  const safe = safeId(projectId);
  if (!safe) return null;
  const dir = path.join(PROJECTS_DIR, safe);
  if (!dir.startsWith(PROJECTS_DIR)) return null;
  return dir;
}

function newId() {
  return 'proj_' + crypto.randomBytes(8).toString('hex');
}

function listProjects() {
  ensureProjectsDir();
  const out = [];
  const dirs = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true }).filter(d => d.isDirectory());
  for (const d of dirs) {
    const metaPath = path.join(PROJECTS_DIR, d.name, PROJECT_META_FILENAME);
    if (!fs.existsSync(metaPath)) continue;
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      out.push({
        id: meta.id || d.name,
        name: meta.name || d.name,
        createdAt: meta.createdAt || null,
        updatedAt: meta.updatedAt || null
      });
    } catch (_) {}
  }
  out.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  return out;
}

function getProject(projectId) {
  const dir = getProjectDir(projectId);
  if (!dir || !fs.existsSync(dir)) return null;
  const metaPath = path.join(dir, PROJECT_META_FILENAME);
  if (!fs.existsSync(metaPath)) return null;
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    return {
      id: meta.id || projectId,
      name: meta.name || projectId,
      createdAt: meta.createdAt || null,
      updatedAt: meta.updatedAt || null
    };
  } catch (_) {
    return null;
  }
}

function createProject(name) {
  ensureProjectsDir();
  const id = newId();
  const dir = path.join(PROJECTS_DIR, safeId(id));
  if (fs.existsSync(dir)) return null;
  fs.mkdirSync(dir, { recursive: true });
  const now = new Date().toISOString();
  const meta = { id, name: (name || 'Untitled project').trim().slice(0, 120), createdAt: now, updatedAt: now };
  fs.writeFileSync(path.join(dir, PROJECT_META_FILENAME), JSON.stringify(meta, null, 2), 'utf8');
  fs.writeFileSync(path.join(dir, MEMORY_FILENAME), '', 'utf8');
  return meta;
}

function updateProject(projectId, updates) {
  const dir = getProjectDir(projectId);
  if (!dir || !fs.existsSync(dir)) return null;
  const metaPath = path.join(dir, PROJECT_META_FILENAME);
  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  } catch (_) {
    return null;
  }
  if (updates.name !== undefined) meta.name = String(updates.name).trim().slice(0, 120) || meta.name;
  meta.updatedAt = new Date().toISOString();
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');
  return meta;
}

/** Read project memory from disk. No caching—called per request so new content is immediately visible to the AI. */
function readProjectMemory(projectId) {
  const dir = getProjectDir(projectId);
  if (!dir) return '';
  const memoryPath = path.join(dir, MEMORY_FILENAME);
  if (!fs.existsSync(memoryPath)) return '';
  try {
    return fs.readFileSync(memoryPath, 'utf8');
  } catch (_) {
    return '';
  }
}

function appendProjectMemory(projectId, text, sectionTitle) {
  const dir = getProjectDir(projectId);
  if (!dir) return false;
  const memoryPath = path.join(dir, MEMORY_FILENAME);
  const existing = fs.existsSync(memoryPath) ? fs.readFileSync(memoryPath, 'utf8') : '';
  const now = new Date().toISOString();
  const block = sectionTitle
    ? `\n\n## ${sectionTitle}\n\n${text.trim()}\n`
    : `\n\n${text.trim()}\n`;
  fs.writeFileSync(memoryPath, (existing + block).trimStart(), 'utf8');
  updateProject(projectId, {}); // bump updatedAt
  return true;
}

function writeProjectMemory(projectId, content) {
  const dir = getProjectDir(projectId);
  if (!dir) return false;
  fs.writeFileSync(path.join(dir, MEMORY_FILENAME), String(content ?? ''), 'utf8');
  updateProject(projectId, {});
  return true;
}

function deleteProject(projectId) {
  const dir = getProjectDir(projectId);
  if (!dir || !fs.existsSync(dir)) return false;
  try {
    fs.rmSync(dir, { recursive: true });
    return true;
  } catch (_) {
    return false;
  }
}

/** Username used in chatStore for this project's conversation (isolated per project). */
function projectChatUsername(projectId) {
  const safe = safeId(projectId);
  return safe ? 'project_' + safe : null;
}

module.exports = {
  listProjects,
  getProject,
  createProject,
  updateProject,
  readProjectMemory,
  appendProjectMemory,
  writeProjectMemory,
  deleteProject,
  projectChatUsername,
  getProjectDir,
  PROJECTS_DIR,
  MEMORY_FILENAME
};
