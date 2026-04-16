'use strict';

const fs = require('fs');
const path = require('path');

const { updateConfig } = require('../config.js');
const agentStore = require('../agentStore.js');
const agentRunner = require('../agentRunner.js');
const heartbeat = require('../heartbeat.js');
const pipelineRunner = require('../pipelineRunner.js');
const personality = require('../personality.js');
const structuredMemory = require('../structuredMemory.js');
const projectStore = require('../projectStore.js');
const hiveStore = require('../hiveMind/store.js');

function safeRm(targetPath) {
  try {
    if (!targetPath) return;
    if (fs.existsSync(targetPath)) {
      fs.rmSync(targetPath, { recursive: true, force: true });
    }
  } catch (_) {}
}

function safeWriteFile(p, content) {
  try {
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(p, content, 'utf8');
  } catch (_) {}
}

function stopAllAgents({ markTasksBlocked = true } = {}) {
  agentRunner.stopAgentRunner();

  const updated = [];
  if (markTasksBlocked) {
    const index = agentStore.listTasks();
    for (const entry of index) {
      if (!entry || !entry.id) continue;
      const task = agentStore.getTask(entry.id);
      if (!task) continue;
      if (['queued', 'planning', 'executing', 'learning'].includes(task.status)) {
        task.log = Array.isArray(task.log) ? task.log : [];
        task.log.push({
          ts: new Date().toISOString(),
          type: 'thought',
          content: 'Task execution paused: stopped by admin (Command Center).'
        });
        agentStore.updateTask(task.id, { status: 'blocked', log: task.log });
        updated.push(task.id);
      }
    }
  }

  return { ok: true, stoppedRunner: true, tasksPaused: updated.length };
}

function clearAllMemory() {
  // Stop agents first to avoid writing while deleting.
  stopAllAgents({ markTasksBlocked: false });

  const dataDir = personality.DATA_DIR;
  const usersDir = path.join(dataDir, 'users');
  const agentsDir = path.join(dataDir, 'agents');
  const vectorsDir = path.join(dataDir, 'vectors');
  const hivemindDir = hiveStore.HIVEMIND_DIR;
  const projectsDir = projectStore.PROJECTS_DIR;

  // 1) User/global freeform memory + behavior + personality
  safeWriteFile(personality.MEMORY_PATH, '');
  safeWriteFile(personality.PERSONALITY_PATH, '');
  safeWriteFile(personality.BEHAVIOR_PATH, '');

  // 2) Structured memory (global) + per-user (wipe entire users dir; then restore empty per-user stores lazily)
  safeRm(structuredMemory.STRUCTURED_PATH);
  safeRm(usersDir);

  // 3) Hive mind state + events
  safeRm(hivemindDir);

  // 4) RAG vectors
  safeRm(vectorsDir);

  // 5) Agent “strategy memory” + tasks/logs
  safeRm(agentsDir);

  // 6) Project memory files (keep project meta, only wipe memory.md)
  try {
    if (fs.existsSync(projectsDir)) {
      const dirs = fs.readdirSync(projectsDir, { withFileTypes: true }).filter(d => d.isDirectory());
      for (const d of dirs) {
        const memPath = path.join(projectsDir, d.name, projectStore.MEMORY_FILENAME);
        safeWriteFile(memPath, '');
      }
    }
  } catch (_) {}

  return {
    ok: true,
    wiped: {
      freeform: true,
      structured: true,
      users: true,
      hivemind: true,
      ragVectors: true,
      agents: true,
      projectMemory: true
    }
  };
}

function disableAllPipelines() {
  let changed = 0;
  try {
    const pipelines = pipelineRunner.readPipelines();
    const next = pipelines.map((p) => {
      if (p && p.enabled !== false) {
        changed += 1;
        return { ...p, enabled: false };
      }
      return p;
    });
    pipelineRunner.writePipelines(next);
  } catch (_) {}
  return changed;
}

function masterKill() {
  // Stop all loops immediately.
  try { agentRunner.stopAgentRunner(); } catch (_) {}
  try { heartbeat.stopHeartbeat(); } catch (_) {}
  try { pipelineRunner.stopScheduler(); } catch (_) {}

  // Persist safety switches so loops stay off after restart.
  updateConfig({ agent: { paused: true }, heartbeat: [] });
  const pipelinesDisabled = disableAllPipelines();

  // Pause any runnable tasks and wipe all memory/task stores.
  const stopped = stopAllAgents({ markTasksBlocked: true });
  const wiped = clearAllMemory();

  return {
    ok: true,
    stopped,
    wiped,
    persisted: { agentPaused: true, heartbeatJobsCleared: true, pipelinesDisabled }
  };
}

module.exports = { stopAllAgents, clearAllMemory, masterKill };

