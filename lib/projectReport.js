'use strict';

const crypto = require('crypto');
const { getConfig, updateConfig } = require('./config.js');
const projectStore = require('./projectStore.js');
const emailLib = require('./email.js');
const { ollamaChatJson } = require('./ollama.js');
const logger = require('./logger.js');

function newReportId() {
  return 'report_' + crypto.randomBytes(8).toString('hex');
}

/** Normalize report: ensure id, name, enabled, schedule, toEmail, projectIds, reportPrompt, lastRunAt */
function normalizeReport(r) {
  return {
    id: r.id || newReportId(),
    name: (r.name != null && String(r.name).trim()) ? String(r.name).trim() : 'Report',
    enabled: r.enabled !== false,
    schedule: (r.schedule != null && String(r.schedule).trim()) ? String(r.schedule).trim() : '0 8 * * *',
    toEmail: (r.toEmail != null && String(r.toEmail).trim()) ? String(r.toEmail).trim() : '',
    projectIds: Array.isArray(r.projectIds) ? r.projectIds : [],
    reportPrompt: (r.reportPrompt != null && String(r.reportPrompt)) ? String(r.reportPrompt) : '',
    lastRunAt: r.lastRunAt || null
  };
}

/**
 * Get all report configs. Migrates legacy config.projectReport to projectReports[0] once.
 * @returns {{ id: string, name: string, enabled: boolean, schedule: string, toEmail: string, projectIds: string[], reportPrompt: string, lastRunAt: string|null }[]}
 */
function getReports() {
  const config = getConfig();
  let list = config.projectReports;
  if (Array.isArray(list)) {
    return list.map(normalizeReport);
  }
  const legacy = config.projectReport;
  if (legacy && (legacy.toEmail || legacy.schedule || Array.isArray(legacy.projectIds))) {
    const migrated = [normalizeReport({ ...legacy, id: legacy.id || 'project_report', name: legacy.name || 'Project Report' })];
    updateConfig({ projectReports: migrated });
    return migrated;
  }
  return [];
}

function persistReports(reports) {
  updateConfig({ projectReports: reports });
}

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
 * Run a single report: build content and send one email. Updates that report's lastRunAt in config.
 * @param {{ id: string, name: string, toEmail: string, projectIds: string[], reportPrompt: string }} report
 * @returns {Promise<boolean>} true if sent, false if skipped or failed
 */
async function runReport(report) {
  const config = getConfig();
  const emailCfg = config.email || {};
  if (!emailCfg.host || !emailCfg.enabled || !emailCfg.from) {
    logger.warn('[ProjectReport] Email not configured or disabled; skipping.');
    return false;
  }
  if (!report || !report.toEmail || !Array.isArray(report.projectIds) || report.projectIds.length === 0) {
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
    const reports = getReports().map((r) => r.id === report.id ? { ...r, lastRunAt: now } : r);
    persistReports(reports);
    logger.info('[ProjectReport] Sent', report.name || report.id, 'to', report.toEmail);
    return true;
  } catch (e) {
    logger.error('[ProjectReport] Send failed', report.name || report.id, ':', e.message);
    return false;
  }
}

/**
 * Return synthetic job objects for each enabled report (for heartbeat).
 * @returns {{ id: string, name: string, schedule: string, lastRunAt: string|null, enabled: boolean }[]}
 */
function getReportJobs() {
  return getReports()
    .filter((r) => r.enabled !== false && r.schedule && r.toEmail && Array.isArray(r.projectIds) && r.projectIds.length > 0)
    .map((r) => ({
      id: r.id,
      name: r.name || r.id,
      schedule: r.schedule,
      lastRunAt: r.lastRunAt || null,
      enabled: true
    }));
}

/**
 * Send a specific report by id immediately.
 * @param {string} reportId
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
async function sendReportNow(reportId) {
  const config = getConfig();
  const emailCfg = config.email || {};
  if (!emailCfg.host || !emailCfg.enabled || !emailCfg.from) {
    return { ok: false, error: 'Email not configured or disabled in Config.' };
  }
  const reports = getReports();
  const report = reports.find((r) => r.id === reportId);
  if (!report) return { ok: false, error: 'Report not found.' };
  if (!report.toEmail) return { ok: false, error: 'Report has no email address.' };
  if (!Array.isArray(report.projectIds) || report.projectIds.length === 0) {
    return { ok: false, error: 'Report has no projects selected.' };
  }
  const sent = await runReport(report);
  return sent ? { ok: true } : { ok: false, error: 'Send failed.' };
}

module.exports = { buildReportContent, runReport, sendReportNow, getReportJob: getReportJobs, getReportJobs, getReports, newReportId, normalizeReport, persistReports };
