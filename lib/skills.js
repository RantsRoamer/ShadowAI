const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SKILLS_DIR = path.join(ROOT, 'skills');
const SKILL_WORKER = path.join(__dirname, 'skillWorker.js');

// Registry tracks which skills are enabled and ready (no in-process require)
const REGISTRY = new Map(); // id -> { runPath }

function ensureSkillsDir() {
  if (!fs.existsSync(SKILLS_DIR)) {
    fs.mkdirSync(SKILLS_DIR, { recursive: true });
  }
}

function getSkillDir(id) {
  if (!id || /[^a-zA-Z0-9_-]/.test(id)) return null;
  const resolved = path.join(SKILLS_DIR, id);
  if (!resolved.startsWith(SKILLS_DIR) || resolved === SKILLS_DIR) return null;
  return resolved;
}

function validateManifest(meta, id) {
  if (!meta || typeof meta !== 'object') throw new Error('skill.json is missing or not valid JSON');
  if (!meta.name || typeof meta.name !== 'string' || !meta.name.trim()) {
    throw new Error('skill.json: "name" field is required and must be a non-empty string');
  }
}

function listSkills() {
  ensureSkillsDir();
  const list = [];
  const dirs = fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('.'));
  for (const d of dirs) {
    const id = d.name;
    const skillPath = path.join(SKILLS_DIR, id, 'skill.json');
    const runPath = path.join(SKILLS_DIR, id, 'run.js');
    if (!fs.existsSync(skillPath) || !fs.existsSync(runPath)) continue;
    try {
      const meta = JSON.parse(fs.readFileSync(skillPath, 'utf8'));
      validateManifest(meta, id);
      list.push({
        id,
        name: meta.name || id,
        description: meta.description || '',
        enabled: meta.enabled === true,
        loaded: REGISTRY.has(id)
      });
    } catch (e) {
      list.push({ id, name: id, description: `(invalid skill: ${e.message})`, enabled: false, loaded: false });
    }
  }
  return list;
}

function getSkillMeta(id) {
  const dir = getSkillDir(id);
  if (!dir) return null;
  const skillPath = path.join(dir, 'skill.json');
  if (!fs.existsSync(skillPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(skillPath, 'utf8'));
  } catch (e) {
    return null;
  }
}

function getSkillCode(id) {
  const dir = getSkillDir(id);
  if (!dir) return null;
  const runPath = path.join(dir, 'run.js');
  if (!fs.existsSync(runPath)) return null;
  try {
    return fs.readFileSync(runPath, 'utf8');
  } catch (e) {
    return null;
  }
}

function updateSkill(id, updates) {
  const dir = getSkillDir(id);
  if (!dir) throw new Error('Skill not found');
  const meta = getSkillMeta(id) || { name: id, description: '', enabled: false };
  if (updates.name !== undefined) meta.name = String(updates.name).trim() || id;
  if (updates.description !== undefined) meta.description = String(updates.description).trim() || '';
  const skillPath = path.join(dir, 'skill.json');
  fs.writeFileSync(skillPath, JSON.stringify(meta, null, 2), 'utf8');
  if (updates.code !== undefined) {
    const runPath = path.join(dir, 'run.js');
    fs.writeFileSync(runPath, String(updates.code), 'utf8');
    if (REGISTRY.has(id)) {
      unloadSkill(id);
      if (meta.enabled) loadSkill(id);
    }
  }
  return { id, name: meta.name, description: meta.description };
}

function setSkillEnabled(id, enabled) {
  const dir = getSkillDir(id);
  if (!dir) throw new Error('Skill not found');
  const skillPath = path.join(dir, 'skill.json');
  const meta = getSkillMeta(id) || { name: id, description: '' };
  meta.enabled = !!enabled;
  fs.writeFileSync(skillPath, JSON.stringify(meta, null, 2), 'utf8');
  if (enabled) loadSkill(id);
  else unloadSkill(id);
}

function loadSkill(id) {
  const dir = getSkillDir(id);
  if (!dir) throw new Error('Skill not found');
  const runPath = path.join(dir, 'run.js');
  if (!fs.existsSync(runPath)) throw new Error('run.js not found');
  // Validate manifest before marking as loaded
  const meta = getSkillMeta(id);
  validateManifest(meta, id);
  // Store only the path — skill runs in a forked worker, not in this process
  REGISTRY.set(id, { runPath });
}

function unloadSkill(id) {
  REGISTRY.delete(id);
}

function runSkillForked(runPath, args, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (fn, val) => { if (!settled) { settled = true; fn(val); } };

    const child = fork(SKILL_WORKER, [], { silent: true });

    const timer = setTimeout(() => {
      child.kill();
      settle(reject, new Error('Skill timed out after 30 seconds'));
    }, timeoutMs);

    child.on('message', (msg) => {
      clearTimeout(timer);
      if (msg.ok) settle(resolve, msg.result);
      else settle(reject, new Error(msg.error || 'Skill execution failed'));
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      settle(reject, err);
    });

    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code !== 0) settle(reject, new Error(`Skill process exited with code ${code}`));
    });

    child.send({ skillPath: runPath, args });
  });
}

function runSkill(id, args = {}) {
  const dir = getSkillDir(id);
  if (!dir) throw new Error('Skill not found or invalid id');

  // Auto-load if enabled but not yet in registry
  if (!REGISTRY.has(id)) {
    const meta = getSkillMeta(id);
    if (meta && meta.enabled) loadSkill(id);
  }

  const entry = REGISTRY.get(id);
  if (!entry) throw new Error('Skill not loaded (enable it first)');

  return runSkillForked(entry.runPath, args);
}

function ensureEnabledSkillsLoaded() {
  const list = listSkills();
  for (const s of list) {
    if (s.enabled && !s.loaded) {
      try { loadSkill(s.id); } catch (e) {
        console.warn(`[skills] Failed to load skill "${s.id}":`, e.message);
      }
    }
  }
}

function createSkill(id, name, description, code) {
  if (!id || /[^a-zA-Z0-9_-]/.test(id)) throw new Error('Invalid skill id (use only letters, numbers, hyphen, underscore)');
  const dir = getSkillDir(id);
  if (!dir) throw new Error('Invalid skill id');
  ensureSkillsDir();
  const dirPath = path.join(SKILLS_DIR, id);
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
  const skillPath = path.join(dirPath, 'skill.json');
  const runPath = path.join(dirPath, 'run.js');
  const meta = { name: name || id, description: description || '', enabled: false };
  // Validate the manifest we're about to write
  validateManifest(meta, id);
  fs.writeFileSync(skillPath, JSON.stringify(meta, null, 2), 'utf8');
  fs.writeFileSync(runPath, String(code || ''), 'utf8');
  return { id, name: meta.name, description: meta.description };
}

module.exports = {
  SKILLS_DIR,
  listSkills,
  getSkillMeta,
  getSkillCode,
  setSkillEnabled,
  loadSkill,
  unloadSkill,
  runSkill,
  createSkill,
  updateSkill,
  ensureSkillsDir,
  ensureEnabledSkillsLoaded,
  getSkillDir
};
