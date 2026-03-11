'use strict';

const fs = require('fs');
const path = require('path');
const { getConfig } = require('./config.js');
const { ollamaChatJson } = require('./ollama.js');
const projectStore = require('./projectStore.js');
const projectImport = require('./projectImport.js');
const logger = require('./logger.js');

const DATA_DIR = path.join(__dirname, '..', 'data');
const VECTORS_DIR = path.join(DATA_DIR, 'vectors');

function ensureVectorsDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(VECTORS_DIR)) fs.mkdirSync(VECTORS_DIR, { recursive: true });
}

function getRagConfig() {
  const cfg = getConfig();
  const rag = cfg.rag || {};
  return {
    embeddingModel: (rag.embeddingModel && String(rag.embeddingModel).trim()) || 'nomic-embed-text',
    chunkSize: Number.isFinite(rag.chunkSize) && rag.chunkSize > 0 ? Math.floor(rag.chunkSize) : 800,
    chunkOverlap: Number.isFinite(rag.chunkOverlap) && rag.chunkOverlap >= 0 ? Math.floor(rag.chunkOverlap) : 200,
    collectionName: (rag.collectionName && String(rag.collectionName).trim()) || 'shadowai',
    topK: Number.isFinite(rag.topK) && rag.topK > 0 ? Math.floor(rag.topK) : 8
  };
}

function getCollectionFileName(scope, projectId) {
  const { collectionName } = getRagConfig();
  if (scope === 'project' && projectId) {
    return path.join(VECTORS_DIR, `${collectionName}_project_${projectId}.json`);
  }
  return path.join(VECTORS_DIR, `${collectionName}_global.json`);
}

function loadCollection(scope, projectId) {
  ensureVectorsDir();
  const file = getCollectionFileName(scope, projectId);
  if (!fs.existsSync(file)) return { chunks: [] };
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!data || typeof data !== 'object') return { chunks: [] };
    if (!Array.isArray(data.chunks)) data.chunks = [];
    return data;
  } catch (e) {
    logger.warn('[RAG] Failed to load collection:', e.message);
    return { chunks: [] };
  }
}

function saveCollection(scope, projectId, data) {
  ensureVectorsDir();
  const file = getCollectionFileName(scope, projectId);
  const out = { chunks: Array.isArray(data.chunks) ? data.chunks : [] };
  fs.writeFileSync(file, JSON.stringify(out, null, 2), 'utf8');
}

function clearCollection(scope, projectId) {
  ensureVectorsDir();
  const file = getCollectionFileName(scope, projectId);
  if (fs.existsSync(file)) {
    try { fs.unlinkSync(file); } catch (e) { logger.warn('[RAG] Failed to delete collection file:', e.message); }
  }
}

function chunkText(text, size, overlap) {
  const clean = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!clean) return [];
  const chunks = [];
  let start = 0;
  const len = clean.length;
  if (size <= 0) return [clean];
  const step = Math.max(1, size - Math.max(0, overlap));
  while (start < len) {
    const end = Math.min(len, start + size);
    const chunk = clean.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= len) break;
    start += step;
  }
  return chunks;
}

async function embedTexts(texts) {
  const cfg = getConfig();
  const { embeddingModel } = getRagConfig();
  const baseUrl = cfg.ollama?.mainUrl || 'http://localhost:11434';
  const url = `${baseUrl.replace(/\/$/, '')}/api/embeddings`;
  const input = texts.map(t => String(t || '').slice(0, 4000));
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: embeddingModel, input })
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Ollama embeddings error ${res.status}: ${err}`);
  }
  const data = await res.json();
  const embeddings = data.embeddings || data.vectors || [];
  if (!Array.isArray(embeddings) || embeddings.length !== input.length) {
    throw new Error('Unexpected embeddings response format.');
  }
  return embeddings;
}

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const va = Number(a[i]) || 0;
    const vb = Number(b[i]) || 0;
    dot += va * vb;
    na += va * va;
    nb += vb * vb;
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function indexText({ scope = 'global', projectId = null, docId, text, source }) {
  const { chunkSize, chunkOverlap } = getRagConfig();
  const chunks = chunkText(text, chunkSize, chunkOverlap);
  if (chunks.length === 0) return { ok: false, error: 'No text to index.' };
  const embeddings = await embedTexts(chunks);
  const coll = loadCollection(scope, projectId);
  const baseId = String(docId || `doc_${Date.now()}`);
  const nowIso = new Date().toISOString();
  for (let i = 0; i < chunks.length; i++) {
    coll.chunks.push({
      id: `${baseId}::${i}`,
      text: chunks[i],
      embedding: embeddings[i],
      source: source || baseId,
      scope,
      projectId: projectId || null,
      createdAt: nowIso
    });
  }
  saveCollection(scope, projectId, coll);
  return { ok: true, chunks: chunks.length };
}

async function queryRag({ scope = 'global', projectId = null, query, topK }) {
  const { topK: defaultK } = getRagConfig();
  const k = Number.isFinite(topK) && topK > 0 ? Math.floor(topK) : defaultK;
  const coll = loadCollection(scope, projectId);
  if (!Array.isArray(coll.chunks) || coll.chunks.length === 0) return [];
  const [queryEmbedding] = await embedTexts([query]);
  const scored = coll.chunks.map((c) => ({
    chunk: c,
    score: cosineSimilarity(queryEmbedding, c.embedding)
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k).map(({ chunk, score }) => ({
    text: chunk.text,
    source: chunk.source,
    score,
    projectId: chunk.projectId || null
  }));
}

async function indexProjectMemory(projectId) {
  if (!projectId) return { ok: false, error: 'projectId is required' };
  const project = projectStore.getProject(projectId);
  if (!project) return { ok: false, error: 'Project not found' };
  const mem = projectStore.readProjectMemory(projectId).trim();
  if (!mem) return { ok: false, error: 'Project has no memory.' };
  const docId = `memory_${projectId}`;
  return indexText({ scope: 'project', projectId, docId, text: mem, source: `memory:${projectId}` });
}

async function extractFileText(buffer, filename, mimetype) {
  const name = String(filename || '').toLowerCase();
  const type = String(mimetype || '').toLowerCase();
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (name.endsWith('.pdf') || type === 'application/pdf') {
    return projectImport.extractPdfText(buf);
  }
  if (name.endsWith('.docx')) {
    return projectImport.extractDocxText(buf);
  }
  if (name.endsWith('.doc')) {
    return projectImport.extractDocText(buf);
  }
  if (name.endsWith('.md') || name.endsWith('.markdown') || name.endsWith('.txt') || type.startsWith('text/')) {
    return buf.toString('utf8');
  }
  throw new Error('Unsupported file type for RAG. Use PDF, TXT, MD, DOCX, or DOC.');
}

module.exports = {
  getRagConfig,
  indexText,
  queryRag,
  clearCollection,
  indexProjectMemory,
  extractFileText
};

