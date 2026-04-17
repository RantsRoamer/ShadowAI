'use strict';

const fs = require('fs');
const path = require('path');

const { updateConfig } = require('../config.js');
const agentStore = require('../agentStore.js');
const agentRunner = require('../agentRunner.js');
const heartbeat = require('../heartbeat.js');
const pipelineRunner = require('../pipelineRunner.js');
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

function clearAllMemory({ scopeUser = '' } = {}) {
  // Clear only Command Center scoped data (do NOT touch user/project/global memory stores).
  const userKey = hiveStore.normalizeScopeUser(scopeUser);
  const scopedHiveDir = userKey
    ? path.join(hiveStore.HIVEMIND_DIR, 'users', userKey)
    : hiveStore.HIVEMIND_DIR;

  // 1) Remove scoped Command Center snapshot/events.
  safeRm(scopedHiveDir);

  // 2) Remove scoped Command Center tasks (keep non-command-center tasks).
  let deletedTasks = 0;
  try {
    const index = agentStore.listTasks();
    for (const entry of index) {
      if (!entry || !entry.id) continue;
      const task = agentStore.getTask(entry.id);
      if (!task) continue;
      const owner = String(task.ownerUser || '');
      const tags = Array.isArray(task.tags) ? task.tags : [];
      const isCommandCenterTask = !!task.parentMissionId || tags.includes('command_center');
      if (owner === String(scopeUser || '') && isCommandCenterTask) {
        agentStore.deleteTask(task.id);
        deletedTasks += 1;
      }
    }
  } catch (_) {}

  return {
    ok: true,
    scopeUser: scopeUser || null,
    deletedTasks,
    wiped: {
      commandCenterScopedHive: true,
      commandCenterScopedTasks: true,
      userMemory: false,
      projectMemory: false,
      ragVectors: false,
      globalStructuredMemory: false
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

