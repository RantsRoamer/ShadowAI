'use strict';

const crypto = require('crypto');
const { getConfig, updateConfig } = require('./config.js');
const projectStore = require('./projectStore.js');
const emailLib = require('./email.js');
const { ollamaChatJson } = require('./ollama.js');
const personalityLib = require('./personality.js');
const logger = require('./logger.js');
const { marked } = require('marked');

// Tracks reports currently running so we don't start the same report twice
// while a previous run is still generating content.
const runningReports = new Set(); // reportId -> true

/** Strip HTML tags for plain-text email fallback */
function stripHtmlTags(html) {
  if (!html || typeof html !== 'string') return '';
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Turn report body into HTML for the html part of the email, and plain text for the text part.
 * If content already looks like HTML, use as-is for html; otherwise treat as markdown and convert.
 */
async function toEmailBody(content) {
  if (!content || typeof content !== 'string') return { text: '', html: '' };
  const trimmed = content.trim();
  const looksLikeHtml = /<[a-z][a-z0-9]*[\s>]/i.test(trimmed) || /<\/[a-z]+>/i.test(trimmed);
  const htmlRaw = looksLikeHtml ? trimmed : await Promise.resolve(marked.parse(trimmed));
  const html = htmlRaw != null ? String(htmlRaw) : trimmed;
  const text = stripHtmlTags(html) || trimmed;
  return { text, html };
}

function newReportId() {
  return 'report_' + crypto.randomBytes(8).toString('hex');
}

/** Normalize report: ensure id, name, enabled, schedule, toEmail, projectIds, reportPrompt, lastRunAt, createdBy */
function normalizeReport(r) {
  return {
    id: r.id || newReportId(),
    name: (r.name != null && String(r.name).trim()) ? String(r.name).trim() : 'Report',
    enabled: r.enabled !== false,
    schedule: (r.schedule != null && String(r.schedule).trim()) ? String(r.schedule).trim() : '0 8 * * *',
    toEmail: (r.toEmail != null && String(r.toEmail).trim()) ? String(r.toEmail).trim() : '',
    projectIds: Array.isArray(r.projectIds) ? r.projectIds : [],
    reportPrompt: (r.reportPrompt != null && String(r.reportPrompt)) ? String(r.reportPrompt) : '',
    lastRunAt: r.lastRunAt || null,
    createdBy: (r.createdBy != null && String(r.createdBy).trim()) ? String(r.createdBy).trim() : ''
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

function getTimezone() {
  try {
    const config = getConfig();
    const tz = typeof config.timezone === 'string' ? config.timezone.trim() : '';
    return tz || '';
  } catch {
    return '';
  }
}

/**
 * Get raw project data for the given IDs (for AI formatting).
 * @param {string[]} projectIds
 * @returns {{ name: string, updatedAt: string, memoryExcerpt: string }[]}
 */
function getRawProjectData(projectIds) {
  if (!Array.isArray(projectIds)) return [];
  const out = [];
  const tz = getTimezone();
  for (const id of projectIds) {
    const project = projectStore.getProject(id);
    if (!project) continue;
    const memory = projectStore.readProjectMemory(id).trim();
    const excerpt = memory
      ? (memory.length <= MEMORY_EXCERPT_LEN ? memory : memory.slice(0, MEMORY_EXCERPT_LEN) + '…')
      : '(No notes or imported content yet.)';
    let updatedAtStr = '—';
    if (project.updatedAt) {
      const d = new Date(project.updatedAt);
      try {
        const fmt = new Intl.DateTimeFormat(undefined, {
          dateStyle: 'short',
          timeStyle: 'short',
          ...(tz ? { timeZone: tz } : {})
        });
        updatedAtStr = fmt.format(d) + (tz ? ` (${tz})` : '');
      } catch {
        updatedAtStr = d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
      }
    }
    out.push({
      name: project.name || id,
      updatedAt: updatedAtStr,
      memoryExcerpt: excerpt
    });
  }
  return out;
}

/**
 * Format report body using the user's prompt and Ollama. Returns formatted text or null on failure.
 * @param {string[]} projectIds
 * @param {string} reportPrompt
 * @param {string} [userContext]
 * @returns {Promise<string|null>}
 */
async function formatReportWithPrompt(projectIds, reportPrompt, userContext = '') {
  const config = getConfig();
  const baseUrl = config.ollama?.mainUrl || 'http://localhost:11434';
  const model = config.ollama?.mainModel || 'llama3.2';
  const raw = getRawProjectData(projectIds);
  if (raw.length === 0) return null;

  // For a single project, give the model the full project memory (not just an excerpt)
  // so it can produce rich, detailed outputs (e.g. full budget overviews) similar to
  // what you see in project chat.
  let dataBlock;
  if (projectIds.length === 1 && raw[0]) {
    const info = raw[0];
    const fullMemory = projectStore.readProjectMemory(projectIds[0]).trim() || info.memoryExcerpt;
    dataBlock = `### Project: ${info.name}\nLast updated: ${info.updatedAt}\n\n${fullMemory}`;
  } else {
    dataBlock = raw.map((p) => {
      return `### Project: ${p.name}\nLast updated: ${p.updatedAt}\n\n${p.memoryExcerpt}`;
    }).join('\n\n---\n\n');
  }

  const userMessage = `${reportPrompt.trim()}\n\n--- Raw project data (format the above according to the user instructions) ---\n\n${dataBlock}`;
  let systemMessage = 'You format project report content for an email. The user provides instructions on what to include and how to format, then raw project data. Output only the formatted email body. No preamble, no "Here is the report", no explanation. You may use HTML (e.g. <p>, <ul>, <li>, <strong>, <h2>) or markdown; both will be rendered as HTML in the email. Be as detailed and structured as you would be in an interactive project chat: include full breakdowns, bullet lists, and tables (for example, detailed budget tables) rather than a short high-level summary.';
  try {
    const personality = personalityLib.readPersonality(userContext).trim();
    const behavior = personalityLib.readBehavior(userContext).trim();
    if (personality || behavior) {
      systemMessage += '\n\nAssistant personality and behavior (match this tone and style in the email content):\n';
      if (personality) systemMessage += '\n--- Personality ---\n' + personality + '\n--- End personality ---\n';
      if (behavior) systemMessage += '\n--- AI Behavior / who the user is ---\n' + behavior + '\n--- End AI behavior ---\n';
    }
  } catch (e) {
    logger.warn('[ProjectReport] personality load failed:', e.message);
  }
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
  const tz = getTimezone();
  const now = new Date();
  let dateStr;
  let timeStr;
  try {
    const dateFmt = new Intl.DateTimeFormat(undefined, {
      dateStyle: 'long',
      ...(tz ? { timeZone: tz } : {})
    });
    dateStr = dateFmt.format(now);
  } catch {
    dateStr = now.toLocaleDateString(undefined, { dateStyle: 'long' });
  }
  try {
    const timeFmt = new Intl.DateTimeFormat(undefined, {
      timeStyle: 'short',
      ...(tz ? { timeZone: tz } : {})
    });
    timeStr = timeFmt.format(now) + (tz ? ` (${tz})` : '');
  } catch {
    timeStr = now.toLocaleTimeString(undefined, { timeStyle: 'short' });
  }
  const parts = [REPORT_HEADER, `Generated: ${dateStr} at ${timeStr}\n`, '---\n'];
  for (const id of projectIds) {
    const project = projectStore.getProject(id);
    if (!project) continue;
    const name = project.name || id;
    let updatedAt = '—';
    if (project.updatedAt) {
      const d = new Date(project.updatedAt);
      try {
        const fmt = new Intl.DateTimeFormat(undefined, {
          dateStyle: 'short',
          timeStyle: 'short',
          ...(tz ? { timeZone: tz } : {})
        });
        updatedAt = fmt.format(d) + (tz ? ` (${tz})` : '');
      } catch {
        updatedAt = d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
      }
    }
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
function buildReportContent(projectIds, reportPrompt, userContext = '') {
  if (!Array.isArray(projectIds) || projectIds.length === 0) {
    return { subject: 'Project Report', text: 'No projects selected.' };
  }
  const tz = getTimezone();
  const now = new Date();
  let dateStr;
  try {
    const dateFmt = new Intl.DateTimeFormat(undefined, {
      dateStyle: 'long',
      ...(tz ? { timeZone: tz } : {})
    });
    dateStr = dateFmt.format(now);
  } catch {
    dateStr = now.toLocaleDateString(undefined, { dateStyle: 'long' });
  }
  const subject = `Project Report — ${dateStr}`;
  const promptTrimmed = reportPrompt && String(reportPrompt).trim();
  if (!promptTrimmed) {
    return buildReportContentSync(projectIds);
  }
  return formatReportWithPrompt(projectIds, promptTrimmed, userContext).then((formatted) => {
    return { subject, text: formatted || buildReportContentSync(projectIds).text };
  });
}

/**
 * Run a single report: build content and send one email. Updates that report's lastRunAt in config.
 * @param {{ id: string, name: string, toEmail: string, projectIds: string[], reportPrompt: string }} report
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
async function runReport(report) {
  const config = getConfig();
  const emailCfg = config.email || {};
  if (!emailCfg.host || !emailCfg.enabled || !emailCfg.from) {
    logger.warn('[ProjectReport] Email not configured or disabled; skipping.');
    return { ok: false, error: 'Email not configured or disabled. Set SMTP in Config → Notifications and enable email.' };
  }
  if (!report || !report.toEmail || !Array.isArray(report.projectIds) || report.projectIds.length === 0) {
    return { ok: false, error: 'Report has no recipient (toEmail) or no projects selected.' };
  }
  try {
    if (runningReports.has(report.id)) {
      logger.warn('[ProjectReport] Report already running, skipping concurrent run:', report.name || report.id);
      return { ok: false, error: 'This report is already running. Wait for it to finish before sending again.' };
    }
    runningReports.add(report.id);

    const nowMs = Date.now();
    if (report.lastRunAt) {
      const lastMs = Date.parse(report.lastRunAt);
      if (!Number.isNaN(lastMs) && nowMs - lastMs < 60_000) {
        logger.warn('[ProjectReport] Skipping duplicate send for report', report.name || report.id, '- lastRunAt is too recent.');
        return { ok: false, error: 'Skipped duplicate send (last sent less than 60 seconds ago).' };
      }
    }

    const content = await Promise.resolve(buildReportContent(report.projectIds, report.reportPrompt, report.createdBy || ''));
    const { subject, text } = content;
    const { text: plainText, html } = await toEmailBody(text);
    await emailLib.sendMail(emailCfg, {
      to: report.toEmail.trim(),
      subject,
      text: plainText || text,
      html: html || undefined
    });
    const now = new Date(nowMs).toISOString();
    const reports = getReports().map((r) => r.id === report.id ? { ...r, lastRunAt: now } : r);
    persistReports(reports);
    logger.info('[ProjectReport] Sent', report.name || report.id, 'to', report.toEmail);
    return { ok: true };
  } catch (e) {
    const msg = e && (e.message || String(e));
    logger.error('[ProjectReport] Send failed', report.name || report.id, ':', msg);
    return { ok: false, error: 'Email send failed: ' + (msg || 'Unknown error') };
  } finally {
    if (report && report.id) runningReports.delete(report.id);
  }
}

/**
 * Mark a report as having started a run (updates lastRunAt in config).
 * Called by the scheduler when a run starts so the next tick doesn't start it again.
 * @param {string} reportId
 */
function markReportRunStarted(reportId) {
  const reports = getReports().map((r) =>
    r.id === reportId ? { ...r, lastRunAt: new Date().toISOString() } : r
  );
  if (reports.some((r) => r.id === reportId)) persistReports(reports);
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
  const result = await runReport(report);
  return result.ok ? { ok: true } : { ok: false, error: result.error || 'Send failed.' };
}

module.exports = { buildReportContent, runReport, sendReportNow, markReportRunStarted, getReportJob: getReportJobs, getReportJobs, getReports, newReportId, normalizeReport, persistReports };
