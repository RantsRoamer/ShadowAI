const test = require('node:test');
const assert = require('node:assert/strict');

const { consolidateMemory } = require('../lib/projectStore.js');

test('consolidateMemory normalizes legacy single-hash sections and deduplicates latest section', () => {
  const before = [
    '# IVF Project Tracker',
    '',
    '#',
    '# Upcoming Task',
    '- [ ] Call office',
    '',
    '#',
    '# Upcoming Task',
    '- [x] Call office',
    '',
    '#',
    '# Last Updated',
    '2026-04-20',
    ''
  ].join('\n');

  const out = consolidateMemory(before);

  assert.match(out, /^# IVF Project Tracker/m);
  assert.equal((out.match(/^## Upcoming Task$/gm) || []).length, 1);
  assert.match(out, /- \[x\] Call office/);
  assert.doesNotMatch(out, /^#\s*$/m);
});
