const cronParser = require('cron-parser');
const { getConfig, updateConfig } = require('./config.js');
const skillsLib = require('./skills.js');
const emailLib = require('./email.js');
const { ollamaChatJson } = require('./ollama.js');
const projectReport = require('./projectReport.js');
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

async function sendResultEmail(config, job, result) {
  if (!job.emailResult) return;
  if (!config.email || !config.email.host || !config.email.defaultTo || !config.email.enabled) return;
  const subjectFallback = job.emailSubject || job.name || 'Scheduled result';
  const hasSubjectField = typeof result === 'object' && result !== null && result.subject != null;
  const hasTextField    = typeof result === 'object' && result !== null && result.text != null;
  const subj = hasSubjectField ? String(result.subject) : subjectFallback;
  const text = hasTextField    ? String(result.text)    : (result != null ? String(result) : '(No content)');
  try {
    await emailLib.sendMail(config.email, { subject: subj || subjectFallback, text: text || '(No content)' });
  } catch (e) {
    logger.error('[Heartbeat] email send failed for job', job.name, ':', e.message);
  }
}

async function runJob(job) {
  const config = getConfig();

  if (job.type === 'skill' && job.skillId) {
    try {
      const result = await skillsLib.runSkill(job.skillId, job.args || {});
      await sendResultEmail(config, job, result);
      await postWebhook(job.webhookUrl, { jobId: job.id, jobName: job.name, result, timestamp: new Date().toISOString() });
      return result;
    } catch (e) {
      logger.error('[Heartbeat] skill job', job.name, '(', job.skillId, '):', e.message);
      return null;
    }
  }

  if (job.type === 'prompt' && job.prompt) {
    const baseUrl = config.ollama?.mainUrl || 'http://localhost:11434';
    const model   = config.ollama?.mainModel || 'llama3.2';
    try {
      const data   = await ollamaChatJson(baseUrl, model, [{ role: 'user', content: job.prompt }]);
      const result = data?.message?.content || '';
      await sendResultEmail(config, job, result);
      await postWebhook(job.webhookUrl, { jobId: job.id, jobName: job.name, result, timestamp: new Date().toISOString() });
      return result;
    } catch (e) {
      logger.error('[Heartbeat] prompt job', job.name, ':', e.message);
      return null;
    }
  }

  logger.warn('[Heartbeat] job', job.name, 'has unrecognised type:', job.type);
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

function getNextRun(schedule, after) {
  // utc: false forces cron-parser to use the server's local timezone,
  // not UTC — so "0 9 * * *" means 09:00 local time.
  const interval = cronParser.parseExpression(schedule, {
    currentDate: after || new Date(),
    utc: false
  });
  return interval.next().toDate();
}

function isJobDue(job) {
  if (job.enabled === false || !job.schedule || !job.id) return false;
  try {
    const last = getLastRunDate(job);
    const next = getNextRun(job.schedule, last);
    return Date.now() >= next.getTime();
  } catch (e) {
    logger.warn('[Heartbeat] cron parse error for job "' + job.name + '" schedule "' + job.schedule + '":', e.message);
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
    logger.info('[Heartbeat] running job:', job.name, '(', job.schedule, ')');
    lastRunAt.set(job.id, now);
    runJob(job).then(() => {
      persistLastRun(job.id, now);
    }).catch(e => {
      logger.error('[Heartbeat] tick error for job', job.name, ':', e.message);
    });
  }
  // Project reports (each has its own schedule, projects, prompt)
  const reportJobs = projectReport.getReportJobs();
  const reports = projectReport.getReports();
  for (const job of reportJobs) {
    if (!isJobDue(job)) continue;
    const report = reports.find((r) => r.id === job.id);
    if (report) {
      logger.info('[Heartbeat] running project report:', job.name);
      projectReport.runReport(report).catch((e) => {
        logger.error('[Heartbeat] project report error:', e.message);
      });
    }
  }
}

function startHeartbeat() {
  stopHeartbeat();

  // Log next fire time for each enabled job so the user can verify local time is correct
  const jobs = getConfig().heartbeat || [];
  const enabled = jobs.filter(j => j.enabled !== false && j.schedule && j.id);
  if (enabled.length > 0) {
    logger.info('[Heartbeat] scheduler starting —', enabled.length, 'job(s) configured');
    for (const job of enabled) {
      try {
        const last = getLastRunDate(job);
        const next = getNextRun(job.schedule, last);
        logger.info('[Heartbeat]  •', job.name, '| schedule:', job.schedule, '| next run (local):', next.toLocaleString());
      } catch (e) {
        logger.warn('[Heartbeat]  •', job.name, '| bad cron:', e.message);
      }
    }
  } else {
    logger.info('[Heartbeat] scheduler starting — no enabled jobs');
  }

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
