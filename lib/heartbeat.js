const cronParser = require('cron-parser');
const { getConfig, updateConfig } = require('./config.js');
const skillsLib = require('./skills.js');
const emailLib = require('./email.js');
const { ollamaChatJson } = require('./ollama.js');
const logger = require('./logger.js');

const INTERVAL_MS = 30 * 1000; // 30 seconds
let intervalId = null;
const lastRunAt = new Map(); // job.id -> timestamp (ms, in-memory cache)

async function postWebhook(url, payload) {
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    logger.warn('Webhook POST failed:', e.message);
  }
}

async function runJob(job) {
  const config = getConfig();
  if (job.type === 'skill' && job.skillId) {
    try {
      const result = await skillsLib.runSkill(job.skillId, job.args || {});
      if (job.emailResult && config.email && config.email.host && config.email.defaultTo && config.email.enabled) {
        const subjectFallback = job.emailSubject || (job.name || 'Scheduled result');
        const hasSubjectField = typeof result === 'object' && result !== null && result.subject != null;
        const hasTextField = typeof result === 'object' && result !== null && result.text != null;
        const subj = hasSubjectField ? String(result.subject) : subjectFallback;
        const text = hasTextField ? String(result.text) : String(result ?? '');
        await emailLib.sendMail(config.email, { subject: subj || subjectFallback, text: text || '(No content)' });
      }
      await postWebhook(job.webhookUrl, { jobId: job.id, jobName: job.name, result, timestamp: new Date().toISOString() });
      return result;
    } catch (e) {
      logger.error('[Heartbeat] skill', job.skillId, e.message);
      return null;
    }
  }
  if (job.type === 'prompt' && job.prompt) {
    const baseUrl = config.ollama?.mainUrl || 'http://localhost:11434';
    const model = config.ollama?.mainModel || 'llama3.2';
    const messages = [{ role: 'user', content: job.prompt }];
    const result = await ollamaChatJson(baseUrl, model, messages).then(() => null).catch(e => {
      logger.error('[Heartbeat] prompt', e.message);
      return null;
    });
    await postWebhook(job.webhookUrl, { jobId: job.id, jobName: job.name, result, timestamp: new Date().toISOString() });
    return result;
  }
  return null;
}

function getLastRunDate(job) {
  if (job.lastRunAt) {
    const t = Date.parse(job.lastRunAt);
    if (!Number.isNaN(t)) return new Date(t);
  }
  const cached = lastRunAt.get(job.id);
  if (cached) return new Date(cached);
  return new Date(0);
}

function isJobDue(job) {
  if (job.enabled === false || !job.schedule || !job.id) return false;
  try {
    const last = getLastRunDate(job);
    const interval = cronParser.parseExpression(job.schedule, { currentDate: last });
    const next = interval.next().toDate();
    return Date.now() >= next.getTime();
  } catch (_) {
    return false;
  }
}

function persistLastRun(jobId, timestampMs) {
  const config = getConfig();
  const jobs = Array.isArray(config.heartbeat) ? [...config.heartbeat] : [];
  const idx = jobs.findIndex(j => j.id === jobId);
  if (idx === -1) return;
  const job = { ...jobs[idx], lastRunAt: new Date(timestampMs).toISOString() };
  jobs[idx] = job;
  updateConfig({ heartbeat: jobs });
}

function tick() {
  const config = getConfig();
  const jobs = config.heartbeat || [];
  const now = Date.now();
  for (const job of jobs) {
    if (!isJobDue(job)) continue;
    lastRunAt.set(job.id, now);
    runJob(job).then(() => {
      persistLastRun(job.id, now);
    }).catch(() => {});
  }
}

function startHeartbeat() {
  stopHeartbeat();
  tick(); // run once immediately to catch any due jobs (including after downtime)
  intervalId = setInterval(tick, INTERVAL_MS);
}

function stopHeartbeat() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

module.exports = { startHeartbeat, stopHeartbeat, runJob };
