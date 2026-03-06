'use strict';

const { getConfig, updateConfig } = require('./config.js');
const projectStore = require('./projectStore.js');
const emailLib = require('./email.js');
const logger = require('./logger.js');

const MEMORY_EXCERPT_LEN = 2500;
const REPORT_HEADER = 'Project Report — summary, status and notes from your selected projects.\n\n';

/**
 * Build a single email body from selected projects: name, last updated, and memory excerpt.
 * @param {string[]} projectIds
 * @returns {{ subject: string, text: string }}
 */
function buildReportContent(projectIds) {
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
    const { subject, text } = buildReportContent(report.projectIds);
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

module.exports = { buildReportContent, runReport, getReportJob };
