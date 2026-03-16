#!/usr/bin/env node
/**
 * fix-memory.js — validates and repairs Claude memory files
 *
 * Usage:
 *   node fix-memory.js          # check only (dry run)
 *   node fix-memory.js --fix    # auto-fix issues found
 */

const fs = require('fs');
const path = require('path');

const MEMORY_DIR = path.join(
  process.env.USERPROFILE || process.env.HOME,
  '.claude', 'projects', 'N--AI-Projects-ShadowAI', 'memory'
);
const MEMORY_INDEX = path.join(MEMORY_DIR, 'MEMORY.md');

const VALID_TYPES = ['user', 'feedback', 'project', 'reference'];
const FIX_MODE = process.argv.includes('--fix');

let issues = 0;
let fixed = 0;

function log(msg)   { console.log(msg); }
function warn(msg)  { console.warn('  ⚠  ' + msg); issues++; }
function ok(msg)    { console.log('  ✓  ' + msg); }
function fixLog(msg){ console.log('  ✎  ' + msg); fixed++; }

// ── Parse frontmatter ─────────────────────────────────────────────────────────
function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const fm = {};
  for (const line of match[1].split('\n')) {
    const [key, ...rest] = line.split(':');
    if (key && rest.length) fm[key.trim()] = rest.join(':').trim();
  }
  return fm;
}

function hasFrontmatter(content) {
  return /^---\n[\s\S]*?\n---/.test(content);
}

// ── Check individual memory file ──────────────────────────────────────────────
function checkMemoryFile(filePath) {
  const name = path.basename(filePath);
  log(`\nChecking ${name}`);

  let content = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
  let dirty = false;

  if (!hasFrontmatter(content)) {
    warn(`Missing frontmatter block`);
    if (FIX_MODE) {
      // Infer type from filename prefix
      let type = 'project';
      if (name.startsWith('user_'))     type = 'user';
      if (name.startsWith('feedback_')) type = 'feedback';
      if (name.startsWith('reference_'))type = 'reference';

      const inferredName = name.replace(/\.md$/, '').replace(/_/g, ' ');
      const fm = `---\nname: ${inferredName}\ndescription: (auto-generated — please update)\ntype: ${type}\n---\n\n`;
      content = fm + content;
      dirty = true;
      fixLog(`Added default frontmatter (type: ${type})`);
    }
    return dirty ? content : null;
  }

  const fm = parseFrontmatter(content);
  if (!fm) {
    warn('Could not parse frontmatter');
    return null;
  }

  // Check required fields
  for (const field of ['name', 'description', 'type']) {
    if (!fm[field] || !fm[field].trim()) {
      warn(`Missing required frontmatter field: ${field}`);
      if (FIX_MODE && field !== 'type') {
        const placeholder = field === 'name'
          ? path.basename(filePath, '.md').replace(/_/g, ' ')
          : '(please fill in)';
        content = content.replace(
          /^(---\n[\s\S]*?)\n---/,
          (m, body) => `${body}\n${field}: ${placeholder}\n---`
        );
        dirty = true;
        fixLog(`Added missing field: ${field}: ${placeholder}`);
      }
    }
  }

  // Check type is valid
  if (fm.type && !VALID_TYPES.includes(fm.type)) {
    warn(`Invalid type "${fm.type}" — must be one of: ${VALID_TYPES.join(', ')}`);
  } else if (fm.type) {
    ok(`type: ${fm.type}`);
  }

  // Check there's actual body content after frontmatter
  const bodyMatch = content.match(/^---\n[\s\S]*?\n---\n+([\s\S]*)$/);
  if (!bodyMatch || !bodyMatch[1].trim()) {
    warn('File has frontmatter but no body content');
  } else {
    ok('Has body content');
  }

  return dirty ? content : null;
}

// ── Check MEMORY.md index ─────────────────────────────────────────────────────
function checkIndex(files) {
  log('\nChecking MEMORY.md index');

  if (!fs.existsSync(MEMORY_INDEX)) {
    warn('MEMORY.md does not exist');
    if (FIX_MODE) {
      buildIndex(files);
      fixLog('Created MEMORY.md index');
    }
    return;
  }

  const indexContent = fs.readFileSync(MEMORY_INDEX, 'utf8').replace(/\r\n/g, '\n');

  // MEMORY.md should not contain memory content directly (no frontmatter of its own is fine,
  // but it should not have large inline sections pretending to be a memory file)
  if (hasFrontmatter(indexContent)) {
    warn('MEMORY.md has frontmatter — it should be an index only, not a memory file');
  }

  // Every memory file should be referenced
  const missingFromIndex = [];
  for (const f of files) {
    if (!indexContent.includes(path.basename(f))) {
      missingFromIndex.push(path.basename(f));
      warn(`${path.basename(f)} is not referenced in MEMORY.md`);
    } else {
      ok(`${path.basename(f)} is indexed`);
    }
  }

  // Index lines over 200 warning
  const lineCount = indexContent.split('\n').length;
  if (lineCount > 180) {
    warn(`MEMORY.md is ${lineCount} lines — content after line 200 is truncated in context. Consider thinning the index.`);
  } else {
    ok(`Index is ${lineCount} lines (within limit)`);
  }

  if (FIX_MODE && missingFromIndex.length > 0) {
    buildIndex(files);
    fixLog('Rebuilt MEMORY.md index to include all memory files');
  }
}

function buildIndex(files) {
  const rows = files.map(f => {
    const content = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
    const fm = parseFrontmatter(content) || {};
    const name = path.basename(f);
    const type = fm.type || '?';
    const desc = fm.description || '(no description)';
    return `| [${name}](${name}) | ${type} | ${desc} |`;
  });

  const header = `# ShadowAI Memory Index\n\n| File | Type | Description |\n|------|------|-------------|`;
  const newIndex = header + '\n' + rows.join('\n') + '\n';
  fs.writeFileSync(MEMORY_INDEX, newIndex, 'utf8');
}

// ── Main ──────────────────────────────────────────────────────────────────────
function main() {
  log(`Memory directory: ${MEMORY_DIR}`);
  log(`Mode: ${FIX_MODE ? 'FIX' : 'CHECK (dry run — use --fix to apply repairs)'}\n`);

  if (!fs.existsSync(MEMORY_DIR)) {
    console.error('Memory directory does not exist:', MEMORY_DIR);
    process.exit(1);
  }

  const allFiles = fs.readdirSync(MEMORY_DIR)
    .filter(f => f.endsWith('.md') && f !== 'MEMORY.md')
    .map(f => path.join(MEMORY_DIR, f));

  if (allFiles.length === 0) {
    warn('No memory files found (only MEMORY.md exists)');
  }

  for (const f of allFiles) {
    const updated = checkMemoryFile(f);
    if (updated !== null && FIX_MODE) {
      fs.writeFileSync(f, updated, 'utf8');
      fixLog(`Saved: ${path.basename(f)}`);
    }
  }

  checkIndex(allFiles);

  log('\n' + '─'.repeat(50));
  if (issues === 0) {
    log('All memory files look good.');
  } else {
    log(`Found ${issues} issue(s).`);
    if (FIX_MODE) {
      log(`Applied ${fixed} fix(es).`);
    } else {
      log('Run with --fix to auto-repair.');
    }
  }
}

main();
