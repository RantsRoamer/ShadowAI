#!/usr/bin/env node
/**
 * fix-memory.js — CLI wrapper around lib/memoryCheck.js
 *
 * Usage:
 *   node fix-memory.js          # check only (dry run)
 *   node fix-memory.js --fix    # auto-fix issues found
 */

const { runCheck } = require('./lib/memoryCheck.js');

const FIX_MODE = process.argv.includes('--fix');

console.log(`Memory directory: see lib/memoryCheck.js`);
console.log(`Mode: ${FIX_MODE ? 'FIX' : 'CHECK (dry run — use --fix to apply repairs)'}\n`);

const result = runCheck(FIX_MODE);

console.log(`Memory directory: ${result.memoryDir}`);

for (const f of result.files) {
  console.log(`\nChecking ${f.name}`);
  if (f.issues.length === 0) {
    console.log('  ✓  OK');
  } else {
    for (const issue of f.issues) console.warn('  ⚠  ' + issue);
  }
}

console.log('\nChecking MEMORY.md index');
if (result.index.issues.length === 0) {
  console.log(`  ✓  OK (${result.index.lineCount} lines)`);
} else {
  for (const issue of result.index.issues) console.warn('  ⚠  ' + issue);
}

console.log('\n' + '─'.repeat(50));
if (result.totalIssues === 0) {
  console.log('All memory files look good.');
} else {
  console.log(`Found ${result.totalIssues} issue(s).`);
  if (FIX_MODE) {
    console.log(`Applied ${result.fixed} fix(es).`);
  } else {
    console.log('Run with --fix to auto-repair.');
  }
}
