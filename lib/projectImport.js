'use strict';

const { getConfig } = require('./config.js');
const { ollamaDescribeImage, ollamaChatJson } = require('./ollama.js');
const projectStore = require('./projectStore.js');
const logger = require('./logger.js');

/**
 * Extract text from a PDF buffer. Requires optional dependency pdf-parse.
 * Supports pdf-parse v1 (default export function) or v2+ (PDFParse class).
 * @param {Buffer} buffer
 * @returns {Promise<string>}
 */
async function extractPdfText(buffer) {
  try {
    const pdfParse = require('pdf-parse');
    if (typeof pdfParse === 'function') {
      const data = await pdfParse(buffer);
      return (data && data.text) ? String(data.text).trim() : '';
    }
    if (pdfParse.PDFParse) {
      const parser = new pdfParse.PDFParse({ data: buffer });
      const result = await parser.getText();
      await parser.destroy && parser.destroy();
      return (result && result.text) ? String(result.text).trim() : '';
    }
    throw new Error('Unsupported pdf-parse API');
  } catch (e) {
    if (e.code === 'MODULE_NOT_FOUND') throw new Error('PDF extraction requires: npm install pdf-parse');
    throw e;
  }
}

/**
 * Normalize base64 image: strip data URL prefix if present, return raw base64.
 */
function normalizeImageBase64(input) {
  if (!input || typeof input !== 'string') return '';
  const s = input.trim();
  const match = /^data:image\/[a-z]+;base64,(.+)$/i.exec(s);
  return match ? match[1] : s;
}

/**
 * Describe an image using Ollama vision and return the description text.
 */
async function describeImage(imageBase64) {
  const raw = normalizeImageBase64(imageBase64);
  if (!raw) throw new Error('No image data');
  const config = getConfig();
  const baseUrl = config.ollama?.mainUrl || 'http://localhost:11434';
  const model = config.ollama?.visionModel || config.ollama?.mainModel || 'llava';
  return ollamaDescribeImage(baseUrl, model, raw, 'Describe this image in detail so the description can be used as context for questions later. Include any text, data, or meaning visible.');
}

/**
 * Import text into project memory. Appends with optional section title.
 * Returns { ok, content } so caller can summarize.
 */
function importText(projectId, text, sectionTitle) {
  if (!projectId || !text || typeof text !== 'string') return { ok: false, error: 'projectId and text required' };
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: 'Text is empty' };
  const ok = projectStore.appendProjectMemory(projectId, trimmed, sectionTitle || 'Imported text');
  return ok ? { ok: true, content: trimmed } : { ok: false, error: 'Project not found' };
}

/**
 * Import PDF into project memory. buffer is the raw PDF file buffer.
 */
async function importPdf(projectId, buffer, filename) {
  if (!projectId || !buffer) return { ok: false, error: 'projectId and PDF data required' };
  const project = projectStore.getProject(projectId);
  if (!project) return { ok: false, error: 'Project not found' };
  let text;
  try {
    text = await extractPdfText(Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer));
  } catch (e) {
    logger.warn('Project import PDF error:', e.message);
    return { ok: false, error: e.message };
  }
  if (!text) return { ok: false, error: 'No text could be extracted from the PDF' };
  const sectionTitle = filename ? `Document: ${filename}` : 'Document: PDF';
  projectStore.appendProjectMemory(projectId, text, sectionTitle);
  return { ok: true, chars: text.length, content: text };
}

/**
 * Extract text from a Word .docx buffer. Requires optional dependency mammoth.
 * @param {Buffer} buffer
 * @returns {Promise<string>}
 */
async function extractDocxText(buffer) {
  try {
    const mammoth = require('mammoth');
    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    const result = await mammoth.extractRawText({ buffer: buf });
    return (result && result.value) ? String(result.value).trim() : '';
  } catch (e) {
    if (e.code === 'MODULE_NOT_FOUND') throw new Error('Word document extraction requires: npm install mammoth');
    throw e;
  }
}

/**
 * Import Word (.docx) into project memory.
 */
async function importDocx(projectId, buffer, filename) {
  if (!projectId || !buffer) return { ok: false, error: 'projectId and document data required' };
  const project = projectStore.getProject(projectId);
  if (!project) return { ok: false, error: 'Project not found' };
  let text;
  try {
    text = await extractDocxText(Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer));
  } catch (e) {
    logger.warn('Project import DOCX error:', e.message);
    return { ok: false, error: e.message };
  }
  if (!text) return { ok: false, error: 'No text could be extracted from the Word document' };
  const sectionTitle = filename ? `Document: ${filename}` : 'Document: Word';
  projectStore.appendProjectMemory(projectId, text, sectionTitle);
  return { ok: true, chars: text.length, content: text };
}

/**
 * Import image into project memory by describing it with Ollama vision and appending the description.
 */
async function importImage(projectId, imageBase64, filename) {
  if (!projectId || !imageBase64) return { ok: false, error: 'projectId and image data required' };
  const project = projectStore.getProject(projectId);
  if (!project) return { ok: false, error: 'Project not found' };
  let description;
  try {
    description = await describeImage(imageBase64);
  } catch (e) {
    logger.warn('Project import image (vision) error:', e.message);
    return { ok: false, error: e.message };
  }
  if (!description) return { ok: false, error: 'Could not get image description from vision model' };
  const sectionTitle = filename ? `Image: ${filename}` : 'Image';
  projectStore.appendProjectMemory(projectId, description, sectionTitle);
  return { ok: true, content: description };
}

/**
 * Summarize content using Ollama. Returns 2-4 sentence summary for project memory.
 */
async function summarizeContent(content) {
  if (!content || typeof content !== 'string') return '';
  const text = content.trim().slice(0, 30000);
  if (!text) return '';
  const config = getConfig();
  const baseUrl = config.ollama?.mainUrl || 'http://localhost:11434';
  const model = config.ollama?.mainModel || 'llama3.2';
  const prompt = `Summarize the following in 2-4 clear sentences. Output only the summary, no preamble or labels.\n\n---\n${text}`;
  try {
    const data = await ollamaChatJson(baseUrl, model, [{ role: 'user', content: prompt }]);
    const summary = (data.message && data.message.content) ? String(data.message.content).trim() : '';
    return summary;
  } catch (e) {
    logger.warn('Summarize content error:', e.message);
    return '';
  }
}

module.exports = { extractPdfText, extractDocxText, describeImage, importText, importPdf, importDocx, importImage, summarizeContent, normalizeImageBase64 };
