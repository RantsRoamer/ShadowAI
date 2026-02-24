const cronParser = require('cron-parser');
const { getConfig, updateConfig } = require('./config.js');
const skillsLib = require('./skills.js');
const emailLib = require('./email.js');
const { ollamaChatJson } = require('./ollama.js');

const INTERVAL_MS = 30 * 1000; // 30 seconds
let intervalId = null;
const lastRunAt = new Map(); // job.id -> timestamp (ms)

function runJob(job) {
  const config = getConfig();
  if (job.type === 'skill' && job.skillId) {
    return skillsLib.runSkill(job.skillId, job.args || {}).then(async (result) => {
      if (job.emailResult && config.email && config.email.host && config.email.defaultTo && config.email.enabled) {
        const subject = job.emailSubject || (job.name || 'Scheduled result');
        const text = typeof result === 'object' && result !== null && result.subject != null
          ? (result.text != null ? String(result.text) : JSON.stringify(result))
          : String(result ?? '');
        const subj = typeof result === 'object' && result !== null && result.subject != null
          ? String(result.subject) : subject;
        await emailLib.sendMail(config.email, { subject: subj, text });
      }
      return result;
    }).catch(e => {
      console.error('[Heartbeat] skill', job.skillId, e.message);
    });
  }
  if (job.type === 'prompt' && job.prompt) {
    const baseUrl = config.ollama?.mainUrl || 'http://localhost:11434';
    const model = config.ollama?.mainModel || 'llama3.2';
    const messages = [{ role: 'user', content: job.prompt }];
    return ollamaChatJson(baseUrl, model, messages).then(() => {}).catch(e => {
      console.error('[Heartbeat] prompt', e.message);
    });
  }
}

function isJobDue(job) {
  if (job.enabled === false || !job.schedule || !job.id) return false;
  try {
    const last = lastRunAt.get(job.id) ? new Date(lastRunAt.get(job.id)) : new Date(0);
    const interval = cronParser.parseExpression(job.schedule, { currentDate: last });
    const next = interval.next().toDate();
    return Date.now() >= next.getTime();
  } catch (_) {
    return false;
  }
}

function tick() {
  const config = getConfig();
  const jobs = config.heartbeat || [];
  const now = Date.now();
  for (const job of jobs) {
    if (!isJobDue(job)) continue;
    lastRunAt.set(job.id, now);
    runJob(job).catch(() => {});
  }
}

function startHeartbeat() {
  stopHeartbeat();
  tick(); // run once immediately to catch any due jobs
  intervalId = setInterval(tick, INTERVAL_MS);
}

function stopHeartbeat() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

module.exports = { startHeartbeat, stopHeartbeat, runJob };
