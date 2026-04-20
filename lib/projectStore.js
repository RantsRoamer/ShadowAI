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
        updatedAt: meta.updatedAt || null,
        owner: meta.owner || null,
        shares: Array.isArray(meta.shares) ? meta.shares : []
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
      updatedAt: meta.updatedAt || null,
      owner: meta.owner || null,
      shares: Array.isArray(meta.shares) ? meta.shares : []
    };
  } catch (_) {
    return null;
  }
}

function createProject(name, owner) {
  ensureProjectsDir();
  const id = newId();
  const dir = path.join(PROJECTS_DIR, safeId(id));
  if (fs.existsSync(dir)) return null;
  fs.mkdirSync(dir, { recursive: true });
  const now = new Date().toISOString();
  const meta = {
    id,
    name: (name || 'Untitled project').trim().slice(0, 120),
    createdAt: now,
    updatedAt: now,
    owner: owner || null,
    shares: []
  };
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
   if (updates.owner !== undefined) meta.owner = updates.owner ? String(updates.owner).trim() : meta.owner;
   if (Array.isArray(updates.shares)) meta.shares = updates.shares.map(s => ({
     username: String(s.username || '').trim(),
     access: ['admin', 'user', 'view'].includes(s.access) ? s.access : 'view'
   })).filter(s => s.username);
  meta.updatedAt = new Date().toISOString();
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');
  return meta;
}

/** Return the absolute path to the project memory file (for debugging). */
function getProjectMemoryPath(projectId) {
  const dir = getProjectDir(projectId);
  if (!dir) return null;
  return path.join(dir, MEMORY_FILENAME);
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

/**
 * Upsert a single ## section in a memory document.
 * If a section with the same title (case-insensitive) already exists, its
 * content is replaced. Otherwise the section is appended.
 * Returns the updated document string.
 */
function upsertSection(content, title, body) {
  const titleTrimmed = String(title).trim();
  const bodyTrimmed  = String(body).trim();
  const newBlock     = `## ${titleTrimmed}\n\n${bodyTrimmed}`;
  const titleLower   = titleTrimmed.toLowerCase();

  // Split on lines that start a new ## section, keeping the delimiter
  const parts = content.split(/(?=^## )/m);
  let found = false;

  const updated = parts.map(part => {
    const m = part.match(/^## (.+?)(?:\r?\n|$)/);
    if (m && m[1].trim().toLowerCase() === titleLower) {
      found = true;
      return newBlock + '\n';
    }
    return part;
  });

  if (!found) updated.push(newBlock + '\n');

  return updated.join('').replace(/\n{3,}/g, '\n\n').trim();
}

function normalizeMarkdownHeadings(content) {
  if (!content) return '';
  let out = String(content).replace(/\r\n/g, '\n');
  // Ensure headings are on their own line (fixes "...text## Heading").
  out = out.replace(/([^\n])([ \t]*#{1,6}[ \t]+)/g, '$1\n$2');
  const lines = out.split('\n');
  const normalized = [];
  let firstH1Seen = false;
  for (const line of lines) {
    // Legacy memories sometimes have a standalone "#" line before headings.
    if (/^#\s*$/.test(line)) continue;
    const h1 = line.match(/^#\s+(.+)$/);
    if (h1) {
      if (!firstH1Seen) {
        firstH1Seen = true;
        normalized.push(line);
      } else {
        // Canonicalize section headings to ## so upsert/dedupe logic matches.
        normalized.push(`## ${h1[1].trim()}`);
      }
      continue;
    }
    normalized.push(line);
  }
  out = normalized.join('\n');
  return out;
}

function splitByHeadingLevel(content, level) {
  const heading = '#'.repeat(level);
  const escapedHeading = heading.replace(/#/g, '\\#');
  const startRegex = new RegExp(`(?=^${escapedHeading} )`, 'm');
  const boundaryRegex = new RegExp(`^${escapedHeading} `);

  const parts = String(content).split(startRegex);
  const preamble = [];
  const sections = [];
  for (const part of parts) {
    const trimmed = part.trimEnd();
    if (!trimmed) continue;
    if (boundaryRegex.test(trimmed)) sections.push(trimmed);
    else preamble.push(trimmed);
  }
  return { preamble, sections };
}

function dedupeSectionsByTitle(content, level) {
  const { preamble, sections } = splitByHeadingLevel(content, level);
  const order = [];
  const latest = new Map();
  const titleRegex = new RegExp(`^${'#'.repeat(level)} (.+?)(?:\\n|$)`);

  for (const section of sections) {
    const m = section.match(titleRegex);
    if (!m) continue;
    const key = m[1].trim().toLowerCase();
    if (!latest.has(key)) order.push(key);
    latest.set(key, section); // last occurrence wins
  }

  const rebuilt = [];
  if (preamble.length) rebuilt.push(preamble.join('\n\n'));
  for (const key of order) rebuilt.push(latest.get(key));
  return rebuilt.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Consolidate a memory document: merge duplicate ## sections (last one wins),
 * preserve insertion order of first occurrence, and normalise whitespace.
 */
function consolidateMemory(content) {
  if (!content || !content.trim()) return '';
  let normalized = normalizeMarkdownHeadings(content);
  // First consolidate top-level memory topics, then common nested subsections.
  normalized = dedupeSectionsByTitle(normalized, 2);
  normalized = dedupeSectionsByTitle(normalized, 3);
  return normalized.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Append or update a section in the project memory file.
 * sectionTitle is required — free-form unsectioned appends are not supported
 * to prevent duplicate headings and orphaned content.
 * "Last Updated" is always auto-managed.
 */
function appendProjectMemory(projectId, text, sectionTitle) {
  const dir = getProjectDir(projectId);
  if (!dir) return false;
  const memoryPath = path.join(dir, MEMORY_FILENAME);
  const existingRaw = fs.existsSync(memoryPath) ? fs.readFileSync(memoryPath, 'utf8') : '';
  const existing = normalizeMarkdownHeadings(existingRaw);
  const trimmedText = String(text || '').trim();
  if (!trimmedText) return false;

  let inferredTitle = sectionTitle ? String(sectionTitle).trim() : '';
  let bodyText = trimmedText;
  if (!inferredTitle) {
    const headingMatch = bodyText.match(/^#{1,6}\s+(.+?)(?:\n|$)/);
    if (headingMatch && headingMatch[1].trim()) {
      inferredTitle = headingMatch[1].trim();
      bodyText = bodyText.replace(/^#{1,6}\s+.+?(?:\n|$)/, '').trim();
    } else {
      inferredTitle = 'Notes';
    }
  }

  let content = upsertSection(existing, inferredTitle, bodyText || trimmedText);

  // Auto-manage Last Updated — always reflects the most recent write
  const today = new Date().toISOString().slice(0, 10);
  content = upsertSection(content, 'Last Updated', today);

  // Clean up any pre-existing duplicate sections
  content = consolidateMemory(content);

  fs.writeFileSync(memoryPath, content + '\n', 'utf8');
  updateProject(projectId, {}); // bump updatedAt
  return true;
}

function writeProjectMemory(projectId, content) {
  const dir = getProjectDir(projectId);
  if (!dir) return false;
  // Consolidate on manual save too, so UI edits stay clean
  const clean = consolidateMemory(String(content ?? ''));
  fs.writeFileSync(path.join(dir, MEMORY_FILENAME), clean ? clean + '\n' : '', 'utf8');
  updateProject(projectId, {});
  return true;
}

function repairAllProjectMemories() {
  const projects = listProjects();
  let scanned = 0;
  let changed = 0;
  let skipped = 0;
  const updated = [];

  for (const project of projects) {
    scanned++;
    const memoryPath = getProjectMemoryPath(project.id);
    if (!memoryPath || !fs.existsSync(memoryPath)) {
      skipped++;
      continue;
    }

    const before = fs.readFileSync(memoryPath, 'utf8');
    const consolidated = consolidateMemory(before);
    const after = consolidated ? consolidated.replace(/\r\n/g, '\n').replace(/\s*$/, '\n') : '';
    const beforeNormalized = before.replace(/\r\n/g, '\n');

    if (beforeNormalized === after) continue;

    fs.writeFileSync(memoryPath, after, 'utf8');
    changed++;
    updated.push({
      id: project.id,
      name: project.name || project.id,
      path: memoryPath,
      beforeBytes: Buffer.byteLength(before, 'utf8'),
      afterBytes: Buffer.byteLength(after, 'utf8')
    });
  }

  return { scanned, changed, skipped, updated };
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
  getProjectMemoryPath,
  appendProjectMemory,
  writeProjectMemory,
  deleteProject,
  projectChatUsername,
  getProjectDir,
  PROJECTS_DIR,
  MEMORY_FILENAME,
  consolidateMemory,
  repairAllProjectMemories
};
