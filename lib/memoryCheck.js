/**
 * lib/memoryCheck.js — memory file validation and repair logic
 * Used by both fix-memory.js (CLI) and the /api/debug/memory endpoints.
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const MEMORY_DIR = path.join(
  os.homedir(),
  '.claude', 'projects', 'N--AI-Projects-ShadowAI', 'memory'
);
const MEMORY_INDEX = path.join(MEMORY_DIR, 'MEMORY.md');
const VALID_TYPES  = ['user', 'feedback', 'project', 'reference'];

// ── Helpers ───────────────────────────────────────────────────────────────────

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const fm = {};
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    fm[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return fm;
}

function hasFrontmatter(content) {
  return /^---\n[\s\S]*?\n---/.test(content);
}

function addDefaultFrontmatter(content, filePath) {
  const name  = path.basename(filePath, '.md');
  let type = 'project';
  if (name.startsWith('user_'))      type = 'user';
  if (name.startsWith('feedback_'))  type = 'feedback';
  if (name.startsWith('reference_')) type = 'reference';
  const inferredName = name.replace(/_/g, ' ');
  return `---\nname: ${inferredName}\ndescription: (auto-generated — please update)\ntype: ${type}\n---\n\n` + content;
}

function buildIndexContent(files) {
  const rows = files.map(f => {
    const content = fs.existsSync(f) ? read(f) : '';
    const fm   = parseFrontmatter(content) || {};
    const name = path.basename(f);
    return `| [${name}](${name}) | ${fm.type || '?'} | ${fm.description || '(no description)'} |`;
  });
  return `# ShadowAI Memory Index\n\n| File | Type | Description |\n|------|------|-------------|\n` + rows.join('\n') + '\n';
}

// ── Core check/fix ────────────────────────────────────────────────────────────

/**
 * Run a check (and optionally fix) of the memory directory.
 * @param {boolean} fix  - apply repairs if true
 * @returns {{ memoryDir, files, index, totalIssues, fixed }}
 */
function runCheck(fix = false) {
  const result = {
    memoryDir: MEMORY_DIR,
    files: [],
    index: { issues: [], lineCount: 0, ok: true },
    totalIssues: 0,
    fixed: 0,
  };

  if (!fs.existsSync(MEMORY_DIR)) {
    result.index.issues.push('Memory directory does not exist: ' + MEMORY_DIR);
    result.totalIssues++;
    return result;
  }

  const memFiles = fs.readdirSync(MEMORY_DIR)
    .filter(f => f.endsWith('.md') && f !== 'MEMORY.md')
    .map(f => path.join(MEMORY_DIR, f));

  if (memFiles.length === 0) {
    result.index.issues.push('No memory files found (only MEMORY.md exists or directory is empty)');
    result.totalIssues++;
  }

  // Check each memory file
  for (const filePath of memFiles) {
    const name = path.basename(filePath);
    const fileResult = { name, issues: [], ok: true };
    let content = read(filePath);
    let dirty = false;

    if (!hasFrontmatter(content)) {
      fileResult.issues.push('Missing frontmatter block');
      if (fix) {
        content = addDefaultFrontmatter(content, filePath);
        dirty = true;
        fileResult.issues[fileResult.issues.length - 1] += ' (fixed: added default frontmatter)';
        result.fixed++;
      }
    } else {
      const fm = parseFrontmatter(content);
      if (!fm) {
        fileResult.issues.push('Could not parse frontmatter');
      } else {
        for (const field of ['name', 'description', 'type']) {
          if (!fm[field] || !fm[field].trim()) {
            fileResult.issues.push(`Missing required frontmatter field: ${field}`);
            if (fix && field !== 'type') {
              const placeholder = field === 'name'
                ? path.basename(filePath, '.md').replace(/_/g, ' ')
                : '(please fill in)';
              content = content.replace(
                /^(---\n[\s\S]*?)\n---/,
                (m, body) => `${body}\n${field}: ${placeholder}\n---`
              );
              dirty = true;
              fileResult.issues[fileResult.issues.length - 1] += ` (fixed: added ${field})`;
              result.fixed++;
            }
          }
        }
        if (fm.type && !VALID_TYPES.includes(fm.type)) {
          fileResult.issues.push(`Invalid type "${fm.type}" — must be one of: ${VALID_TYPES.join(', ')}`);
        }
      }

      const bodyMatch = content.match(/^---\n[\s\S]*?\n---\n+([\s\S]*)$/);
      if (!bodyMatch || !bodyMatch[1].trim()) {
        fileResult.issues.push('File has frontmatter but no body content');
      }
    }

    if (dirty && fix) {
      fs.writeFileSync(filePath, content, 'utf8');
    }

    fileResult.ok = fileResult.issues.length === 0;
    result.totalIssues += fileResult.issues.length;
    result.files.push(fileResult);
  }

  // Check MEMORY.md index
  if (!fs.existsSync(MEMORY_INDEX)) {
    result.index.issues.push('MEMORY.md does not exist');
    if (fix) {
      fs.writeFileSync(MEMORY_INDEX, buildIndexContent(memFiles), 'utf8');
      result.index.issues[result.index.issues.length - 1] += ' (fixed: created index)';
      result.fixed++;
    }
  } else {
    const indexContent = read(MEMORY_INDEX);
    result.index.lineCount = indexContent.split('\n').length;

    if (hasFrontmatter(indexContent)) {
      result.index.issues.push('MEMORY.md has frontmatter — it should be an index only');
    }

    const missingFromIndex = memFiles.filter(f => !indexContent.includes(path.basename(f)));
    for (const f of missingFromIndex) {
      result.index.issues.push(`${path.basename(f)} is not referenced in MEMORY.md`);
    }
    if (missingFromIndex.length > 0 && fix) {
      fs.writeFileSync(MEMORY_INDEX, buildIndexContent(memFiles), 'utf8');
      result.index.issues = result.index.issues.map(i =>
        i.includes('not referenced') ? i + ' (fixed: rebuilt index)' : i
      );
      result.fixed += missingFromIndex.length;
    }

    if (result.index.lineCount > 180) {
      result.index.issues.push(
        `MEMORY.md is ${result.index.lineCount} lines — content after line 200 is truncated in context`
      );
    }
  }

  result.index.ok = result.index.issues.length === 0;
  result.totalIssues += result.index.issues.length;
  return result;
}

module.exports = { runCheck, MEMORY_DIR };
