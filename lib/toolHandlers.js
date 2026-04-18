'use strict';

const crypto = require('crypto');
const { getConfig, updateConfig } = require('./config.js');
const skillsLib = require('./skills.js');

function newJobId() {
  return 'job_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');
}

/**
 * Execute a scheduler/skill/heartbeat tool. Returns a string result for the model.
 * Used by server.js and chatRunner.js for create_skill, add_heartbeat_job, update_skill, update_heartbeat_job, delete_heartbeat_job.
 */
async function executeSchedulerTool(name, args) {
  if (name === 'create_skill') {
    const id = (args.id || args.skillId || '').trim().replace(/[^a-zA-Z0-9_-]/g, '_');
    if (!id) return 'Error: skill id is required (letters, numbers, hyphen, underscore only).';
    const skillName = (args.name || id).trim() || id;
    const description = (args.description || '').trim();
    const code = args.code != null ? String(args.code) : '';
    try {
      skillsLib.createSkill(id, skillName, description, code);
      skillsLib.setSkillEnabled(id, true);
      return `Created skill "${id}" (${skillName}) and enabled it. The user can run it via /skill ${id} or schedule it in Heartbeat.`;
    } catch (e) {
      return 'Error: ' + e.message;
    }
  }

  if (name === 'add_heartbeat_job') {
    const nameStr = (args.name || 'Scheduled job').trim();
    const schedule = (args.schedule || '0 7 * * *').trim();
    const type = (args.type || 'skill').toLowerCase();
    if (type !== 'skill' && type !== 'prompt') return 'Error: type must be "skill" or "prompt".';
    const skillId = type === 'skill' ? (args.skillId || '').trim() : undefined;
    const prompt = type === 'prompt' ? (args.prompt || '').trim() : undefined;
    if (type === 'skill' && !skillId) return 'Error: skillId is required when type is "skill".';
    if (type === 'prompt' && !prompt) return 'Error: prompt is required when type is "prompt".';
    let jobArgs = args.args;
    if (jobArgs !== undefined && typeof jobArgs !== 'object') jobArgs = {};
    const emailResult = !!args.emailResult;
    const emailSubject = (args.emailSubject || '').trim() || nameStr;
    const config = getConfig();
    const jobs = Array.isArray(config.heartbeat) ? [...config.heartbeat] : [];
    const job = {
      id: newJobId(),
      name: nameStr,
      schedule,
      type,
      enabled: true,
      skillId: type === 'skill' ? skillId : undefined,
      prompt: type === 'prompt' ? prompt : undefined,
      args: type === 'skill' ? (jobArgs || {}) : undefined,
      emailResult: emailResult || undefined,
      emailSubject: emailResult ? emailSubject : undefined
    };
    jobs.push(job);
    updateConfig({ heartbeat: jobs });
    return `Added heartbeat job "${nameStr}" (${schedule}). The scheduler runs every 30 seconds and will run this job when the cron schedule matches.${emailResult ? ' The result will be emailed to the configured default address.' : ''}`;
  }

  if (name === 'list_heartbeat_jobs') {
    const config = getConfig();
    const jobs = Array.isArray(config.heartbeat) ? config.heartbeat : [];
    if (jobs.length === 0) return 'No heartbeat jobs. Use add_heartbeat_job to add one.';
    return jobs.map(j => `- ${j.name} (id: ${j.id}, schedule: ${j.schedule}, type: ${j.type}${j.skillId ? ', skillId: ' + j.skillId : ''})`).join('\n');
  }

  if (name === 'update_skill') {
    const skillId = (args.skillId || args.id || '').trim();
    if (!skillId) return 'Error: skillId is required.';
    const updates = {};
    if (args.name !== undefined) updates.name = String(args.name).trim();
    if (args.description !== undefined) updates.description = String(args.description).trim();
    if (args.code !== undefined) updates.code = String(args.code);
    if (Object.keys(updates).length === 0) return 'Error: provide at least one of name, description, or code to update.';
    try {
      skillsLib.updateSkill(skillId, updates);
      return `Updated skill "${skillId}".`;
    } catch (e) {
      return 'Error: ' + e.message;
    }
  }

  if (name === 'delete_heartbeat_job') {
    const jobId = (args.jobId || args.id || '').trim();
    if (!jobId) return 'Error: jobId is required.';
    const config = getConfig();
    const jobs = Array.isArray(config.heartbeat) ? config.heartbeat : [];
    const next = jobs.filter(j => j.id !== jobId);
    if (next.length === jobs.length) return 'Error: heartbeat job not found with id "' + jobId + '".';
    updateConfig({ heartbeat: next });
    return `Deleted heartbeat job "${jobId}".`;
  }

  if (name === 'update_heartbeat_job') {
    const jobId = (args.jobId || args.id || '').trim();
    if (!jobId) return 'Error: jobId is required.';
    const config = getConfig();
    const jobs = Array.isArray(config.heartbeat) ? [...config.heartbeat] : [];
    const idx = jobs.findIndex(j => j.id === jobId);
    if (idx === -1) return 'Error: heartbeat job not found with id "' + jobId + '".';
    const job = { ...jobs[idx] };
    if (args.name !== undefined) job.name = String(args.name).trim();
    if (args.schedule !== undefined) job.schedule = String(args.schedule).trim();
    if (args.type !== undefined) job.type = String(args.type).toLowerCase();
    if (args.skillId !== undefined) job.skillId = String(args.skillId).trim();
    if (args.prompt !== undefined) job.prompt = String(args.prompt).trim();
    if (args.args !== undefined) job.args = typeof args.args === 'object' ? args.args : {};
    if (args.enabled !== undefined) job.enabled = !!args.enabled;
    if (args.emailResult !== undefined) job.emailResult = !!args.emailResult;
    if (args.emailSubject !== undefined) job.emailSubject = String(args.emailSubject).trim();
    jobs[idx] = job;
    updateConfig({ heartbeat: jobs });
    return `Updated heartbeat job "${job.name}" (${jobId}).`;
  }

  return 'Unknown scheduler tool: ' + name;
}

function getSchedulerToolDefinitions() {
  return [
    {
      type: 'function',
      function: {
        name: 'create_skill',
        description: 'Create a new skill (plugin) and enable it. Use when the user asks for a scheduled task or an automated action—create the skill that does the work, then use add_heartbeat_job to schedule it. Args: id (skill id, required), name (display name), description, code (full run.js content; must export run(args) or module.exports = { run }).',
        parameters: {
          type: 'object',
          required: ['id', 'code'],
          properties: {
            id: { type: 'string', description: 'Skill id (letters, numbers, hyphen, underscore only)' },
            name: { type: 'string', description: 'Display name' },
            description: { type: 'string', description: 'Short description' },
            code: { type: 'string', description: 'Full run.js code; must export async function run(args) or module.exports = { run }' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'add_heartbeat_job',
        description: 'Add a scheduled job to the Heartbeat system. The scheduler runs every 30 seconds and runs jobs when their cron schedule is due. Use after create_skill when the user wants something run on a schedule (e.g. daily at 7am). Cron format: minute hour day month weekday (e.g. 0 7 * * * = daily at 07:00 server time).',
        parameters: {
          type: 'object',
          required: ['name', 'schedule'],
          properties: {
            name: { type: 'string', description: 'Job name' },
            schedule: { type: 'string', description: 'Cron expression, e.g. 0 7 * * * for daily at 7am' },
            type: { type: 'string', enum: ['skill', 'prompt'], description: 'skill or prompt (default skill)' },
            skillId: { type: 'string', description: 'Skill id when type is skill (required for skill)' },
            prompt: { type: 'string', description: 'Prompt when type is prompt' },
            args: { type: 'object', description: 'Arguments passed to the skill (optional)' },
            emailResult: { type: 'boolean', description: 'If true, email the skill result to the configured default address' },
            emailSubject: { type: 'string', description: 'Subject when emailResult is true' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'list_heartbeat_jobs',
        description: 'List all Heartbeat jobs (id, name, schedule, type). Use to find jobId when the user asks to change a scheduled task.',
        parameters: { type: 'object', properties: {} }
      }
    },
    {
      type: 'function',
      function: {
        name: 'delete_heartbeat_job',
        description: 'Remove a scheduled Heartbeat job by id. Use when the user asks to cancel or delete a scheduled task (get jobId from list_heartbeat_jobs first).',
        parameters: {
          type: 'object',
          required: ['jobId'],
          properties: {
            jobId: { type: 'string', description: 'Job id from list_heartbeat_jobs' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'update_skill',
        description: 'Update an existing skill. Use when the user asks to change what a skill does or its name/description.',
        parameters: {
          type: 'object',
          required: ['skillId'],
          properties: {
            skillId: { type: 'string', description: 'Skill id to update' },
            name: { type: 'string', description: 'New display name' },
            description: { type: 'string', description: 'New description' },
            code: { type: 'string', description: 'New full run.js code' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'update_heartbeat_job',
        description: 'Update an existing Heartbeat job (schedule, name, type, skillId, prompt, args, enabled, emailResult, emailSubject). Use when the user asks to change a scheduled task.',
        parameters: {
          type: 'object',
          required: ['jobId'],
          properties: {
            jobId: { type: 'string', description: 'Job id (from the Heartbeat list)' },
            name: { type: 'string' },
            schedule: { type: 'string' },
            type: { type: 'string', enum: ['skill', 'prompt'] },
            skillId: { type: 'string' },
            prompt: { type: 'string' },
            args: { type: 'object' },
            enabled: { type: 'boolean' },
            emailResult: { type: 'boolean' },
            emailSubject: { type: 'string' }
          }
        }
      }
    }
  ];
}

module.exports = { executeSchedulerTool, getSchedulerToolDefinitions };
