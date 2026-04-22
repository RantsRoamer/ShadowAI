const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ALLOWED_EXT = ['.js', '.json', '.html', '.css', '.md', '.txt', '.mjs', '.cjs', '.ts', '.py'];

// Files that must never be readable or writable via the self-update API
const DENIED_FILES = [
  'config.json',        // contains credentials and secrets
  'config.default.json' // template with default credentials
];

// Directories whose contents must never be accessible via this API
const DENIED_DIR_PREFIXES = [
  'data' + path.sep,
  'data/'
];

function isAllowedPath(filePath) {
  const resolved = path.resolve(ROOT, filePath);
  if (!resolved.startsWith(ROOT)) return false;
  const relPath = path.relative(ROOT, resolved);
  // Deny sensitive files regardless of extension
  if (DENIED_FILES.some(f => relPath === f || relPath.endsWith(path.sep + f))) return false;
  // Deny entire data/ directory — contains chat logs, pipelines, memory, etc.
  if (relPath === 'data' || DENIED_DIR_PREFIXES.some(p => relPath.startsWith(p))) return false;
  const ext = path.extname(resolved);
  return ALLOWED_EXT.includes(ext.toLowerCase());
}

function readFile(relativePath) {
  if (!isAllowedPath(relativePath)) {
    throw new Error('Path not allowed');
  }
  const full = path.resolve(ROOT, relativePath);
  return fs.readFileSync(full, 'utf8');
}

function writeFile(relativePath, content) {
  if (!isAllowedPath(relativePath)) {
    throw new Error('Path not allowed');
  }
  const full = path.resolve(ROOT, relativePath);
  const dir = path.dirname(full);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}

function listFiles(dirRelative = '.') {
  const full = path.resolve(ROOT, dirRelative);
  if (!full.startsWith(ROOT)) throw new Error('Path not allowed');
  if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) return [];
  return fs.readdirSync(full, { withFileTypes: true })
    .filter(d => d.name !== 'node_modules' && !d.name.startsWith('.'))
    .map(d => ({ name: d.name, isDir: d.isDirectory() }));
}

module.exports = { readFile, writeFile, listFiles, isAllowedPath, ROOT };
