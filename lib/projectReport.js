'use strict';

const { getConfig, updateConfig } = require('./config.js');
const projectStore = require('./projectStore.js');
const emailLib = require('./email.js');
const { ollamaChatJson } = require('./ollama.js');
const logger = require('./logger.js');

const MEMORY_EXCERPT_LEN = 2500;
const REPORT_HEADER = 'Project Report — summary, status and notes from your selected projects.\n\n';

/**
 * Get raw project data for the given IDs (for AI formatting).
 * @param {string[]} projectIds
 * @returns {{ name: string, updatedAt: string, memoryExcerpt: string }[]}
 */
function getRawProjectData(projectIds) {
  if (!Array.isArray(projectIds)) return [];
  const out = [];
  for (const id of projectIds) {
    const project = projectStore.getProject(id);
    if (!project) continue;
    const memory = projectStore.readProjectMemory(id).trim();
    const excerpt = memory
      ? (memory.length <= MEMORY_EXCERPT_LEN ? memory : memory.slice(0, MEMORY_EXCERPT_LEN) + '…')
      : '(No notes or imported content yet.)';
    out.push({
      name: project.name || id,
      updatedAt: project.updatedAt
        ? new Date(project.updatedAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
        : '—',
      memoryExcerpt: excerpt
    });
  }
  return out;
}

/**
 * Format report body using the user's prompt and Ollama. Returns formatted text or null on failure.
 * @param {string[]} projectIds
 * @param {string} reportPrompt
 * @returns {Promise<string|null>}
 */
async function formatReportWithPrompt(projectIds, reportPrompt) {
  const config = getConfig();
  const baseUrl = config.ollama?.mainUrl || 'http://localhost:11434';
  const model = config.ollama?.mainModel || 'llama3.2';
  const raw = getRawProjectData(projectIds);
  if (raw.length === 0) return null;
  const dataBlock = raw.map((p, i) => {
    return `### Project: ${p.name}\nLast updated: ${p.updatedAt}\n\n${p.memoryExcerpt}`;
  }).join('\n\n---\n\n');
  const userMessage = `${reportPrompt.trim()}\n\n--- Raw project data (format the above according to the user instructions) ---\n\n${dataBlock}`;
  const systemMessage = 'You format project report content for an email. The user provides instructions on what to include and how to format, then raw project data. Output only the formatted email body text. No preamble, no "Here is the report", no explanation. Plain text or markdown as appropriate.';
  try {
    const res = await ollamaChatJson(baseUrl, model, [
      { role: 'system', content: systemMessage },
      { role: 'user', content: userMessage }
    ]);
    const text = (res?.message?.content && String(res.message.content).trim()) || null;
    return text;
  } catch (e) {
    logger.warn('[ProjectReport] Format with prompt failed:', e.message);
    return null;
  }
}

/**
 * Build a single email body from selected projects: name, last updated, and memory excerpt.
 * If reportPrompt is provided and non-empty, uses Ollama to format; otherwise uses default format.
 * @param {string[]} projectIds
 * @param {string} [reportPrompt]
 * @returns {{ subject: string, text: string } | Promise<{ subject: string, text: string }>}
 */
function buildReportContentSync(projectIds) {
  if (!Array.isArray(projectIds) || projectIds.length === 0) {
    return { subject: 'Project Report', text: 'No projects selected.' };
  }
  const dateStr = new Date().toLocaleDateString(undefined, { dateStyle: 'long' });
  const timeStr = new Date().toLocaleTimeString(undefined, { timeStyle: 'short' });
  const parts = [REPORT_HEADER, `Generated: ${dateStr} at ${timeStr}\n`, '---\n'];
  for (const id of projectIds) {
    const project = projectStore.getProject(id);
    if (!project) continue;
    const name = project.name || id;
    const updatedAt = project.updatedAt
      ? new Date(project.updatedAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
      : '—';
    const memory = projectStore.readProjectMemory(id).trim();
    const excerpt = memory
      ? (memory.length <= MEMORY_EXCERPT_LEN ? memory : memory.slice(0, MEMORY_EXCERPT_LEN) + '…')
      : '(No notes or imported content yet.)';
    parts.push(`## ${name}\n`);
    parts.push(`Last updated: ${updatedAt}\n\n`);
    parts.push(excerpt.replace(/\n/g, '\n') + '\n\n---\n');
  }
  const text = parts.join('');
  const subject = `Project Report — ${dateStr}`;
  return { subject, text };
}

/**
 * Build report content. If reportPrompt is set, returns a Promise that resolves to { subject, text } using AI formatting.
 */
function buildReportContent(projectIds, reportPrompt) {
  if (!Array.isArray(projectIds) || projectIds.length === 0) {
    return { subject: 'Project Report', text: 'No projects selected.' };
  }
  const dateStr = new Date().toLocaleDateString(undefined, { dateStyle: 'long' });
  const subject = `Project Report — ${dateStr}`;
  const promptTrimmed = reportPrompt && String(reportPrompt).trim();
  if (!promptTrimmed) {
    return buildReportContentSync(projectIds);
  }
  return formatReportWithPrompt(projectIds, promptTrimmed).then((formatted) => {
    return { subject, text: formatted || buildReportContentSync(projectIds).text };
  });
}

/**
 * Run the project report: build content from config.projectReport.projectIds and send one email to config.projectReport.toEmail.
 * Updates config.projectReport.lastRunAt on success.
 * @returns {Promise<boolean>} true if sent, false if skipped or failed
 */
async function runReport() {
  const config = getConfig();
  const report = config.projectReport || {};
  if (!report.enabled || !report.toEmail || !Array.isArray(report.projectIds) || report.projectIds.length === 0) {
    return false;
  }
  const emailCfg = config.email || {};
  if (!emailCfg.host || !emailCfg.enabled || !emailCfg.from) {
    logger.warn('[ProjectReport] Email not configured or disabled; skipping report.');
    return false;
  }
  try {
    const content = await Promise.resolve(buildReportContent(report.projectIds, report.reportPrompt));
    const { subject, text } = content;
    await emailLib.sendMail(emailCfg, {
      to: report.toEmail.trim(),
      subject,
      text
    });
    const now = new Date().toISOString();
    updateConfig({
      projectReport: {
        ...report,
        lastRunAt: now
      }
    });
    logger.info('[ProjectReport] Sent report to', report.toEmail, 'with', report.projectIds.length, 'project(s).');
    return true;
  } catch (e) {
    logger.error('[ProjectReport] Send failed:', e.message);
    return false;
  }
}

/**
 * Send the report immediately to the given address with the given project IDs (e.g. from "Send now").
 * Updates config.projectReport.lastRunAt on success.
 * @param {{ toEmail: string, projectIds: string[] }} opts
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
async function sendReportNow(opts) {
  const config = getConfig();
  const emailCfg = config.email || {};
  if (!emailCfg.host || !emailCfg.enabled || !emailCfg.from) {
    return { ok: false, error: 'Email not configured or disabled in Config.' };
  }
  const toEmail = (opts && opts.toEmail && String(opts.toEmail).trim()) || '';
  const projectIds = Array.isArray(opts && opts.projectIds) ? opts.projectIds : [];
  if (!toEmail) return { ok: false, error: 'Recipient email is required.' };
  if (projectIds.length === 0) return { ok: false, error: 'Select at least one project to include.' };
  const configReport = config.projectReport || {};
  try {
    const content = await Promise.resolve(buildReportContent(projectIds, configReport.reportPrompt));
    const { subject, text } = content;
    await emailLib.sendMail(emailCfg, { to: toEmail, subject, text });
    const now = new Date().toISOString();
    const report = configReport;
    updateConfig({
      projectReport: {
        ...report,
        lastRunAt: now
      }
    });
    logger.info('[ProjectReport] Send now to', toEmail, 'with', projectIds.length, 'project(s).');
    return { ok: true };
  } catch (e) {
    logger.error('[ProjectReport] Send now failed:', e.message);
    return { ok: false, error: e.message };
  }
}

/**
 * Return a synthetic job object for the project report so heartbeat can use isJobDue/persistLastRun.
 */
function getReportJob() {
  const config = getConfig();
  const report = config.projectReport || {};
  if (!report.enabled || !report.schedule || !report.toEmail || !Array.isArray(report.projectIds) || report.projectIds.length === 0) {
    return null;
  }
  return {
    id: 'project_report',
    name: 'Project Report',
    schedule: report.schedule,
    lastRunAt: report.lastRunAt || null,
    enabled: true
  };
}

module.exports = { buildReportContent, runReport, sendReportNow, getReportJob };
