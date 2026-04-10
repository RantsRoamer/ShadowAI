'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const archiver = require('archiver');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DOWNLOADS = new Map();

function safeUser(username) {
  return String(username || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'default';
}

function userRoot(username) {
  return path.join(DATA_DIR, 'users', safeUser(username), 'my-data');
}

function ensureUserRoot(username) {
  const root = userRoot(username);
  if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
  return root;
}

function normalizeRel(p) {
  const s = String(p || '.').replace(/\\/g, '/').trim();
  if (!s || s === '.' || s === '/') return '.';
  const clean = s.replace(/^\/+/, '');
  if (clean.split('/').some(seg => seg === '..')) throw new Error('Path traversal denied');
  return clean;
}

function absFor(username, rel) {
  const root = ensureUserRoot(username);
  const r = normalizeRel(rel);
  const abs = path.resolve(root, r === '.' ? '' : r);
  if (abs !== root && !abs.startsWith(root + path.sep)) throw new Error('Path traversal denied');
  return { root, abs, rel: r };
}

function listUserFiles(username, relPath = '.') {
  const { abs } = absFor(username, relPath);
  if (!fs.existsSync(abs)) return [];
  const st = fs.statSync(abs);
  if (!st.isDirectory()) throw new Error('Not a directory');
  const names = fs.readdirSync(abs);
  return names.map((name) => {
    const child = path.join(abs, name);
    const cst = fs.statSync(child);
    return { name, isDir: cst.isDirectory(), size: cst.size };
  });
}

function readUserFile(username, relPath) {
  const { abs } = absFor(username, relPath);
  if (!fs.existsSync(abs)) throw new Error('File not found');
  if (fs.statSync(abs).isDirectory()) throw new Error('Path is a directory');
  return fs.readFileSync(abs, 'utf8');
}

function writeUserFile(username, relPath, content) {
  const { abs } = absFor(username, relPath);
  const dir = path.dirname(abs);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(abs, String(content ?? ''), 'utf8');
}

function queueZipDownload(username, relPaths) {
  const root = ensureUserRoot(username);
  const list = Array.isArray(relPaths) ? relPaths : [];
  const cleaned = list.map(normalizeRel).filter((v, i, a) => v && a.indexOf(v) === i);
  if (cleaned.length === 0) throw new Error('No paths selected');

  const id = crypto.randomBytes(12).toString('hex');
  const fileName = `my-data-${Date.now()}.zip`;
  const tempDir = path.join(root, '.downloads');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
  const zipPath = path.join(tempDir, `${id}.zip`);

  DOWNLOADS.set(id, { username: safeUser(username), zipPath, fileName, createdAt: Date.now() });

  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', () => resolve({ id, fileName, bytes: archive.pointer() }));
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);

    cleaned.forEach((rel) => {
      const abs = absFor(username, rel).abs;
      if (!fs.existsSync(abs)) return;
      const st = fs.statSync(abs);
      if (st.isDirectory()) archive.directory(abs, rel === '.' ? 'my-data' : rel);
      else archive.file(abs, { name: rel });
    });

    archive.finalize();
  });
}

function getDownloadMeta(id, username) {
  const row = DOWNLOADS.get(String(id || ''));
  if (!row) return null;
  if (row.username !== safeUser(username)) return null;
  return row;
}

function deleteDownload(id) {
  const key = String(id || '');
  const row = DOWNLOADS.get(key);
  if (!row) return;
  DOWNLOADS.delete(key);
  try { if (fs.existsSync(row.zipPath)) fs.unlinkSync(row.zipPath); } catch (_) {}
}

module.exports = {
  userRoot,
  listUserFiles,
  readUserFile,
  writeUserFile,
  queueZipDownload,
  getDownloadMeta,
  deleteDownload
};

