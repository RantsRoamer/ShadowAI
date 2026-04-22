const test = require('node:test');
const assert = require('node:assert/strict');

const { prepareMemoryForReport } = require('../lib/projectReport.js');

test('prepareMemoryForReport keeps latest financial summary variant', () => {
  const memory = [
    '# Home Improvement Projects Tracker',
    '',
    '## Financial Summary',
    '',
    '| Project | Total | Paid | Remaining |',
    '|---------|-------|------|-----------|',
    '| Oil to Gas | $17,750 | $1,500 | $16,250 |',
    '',
    '## Financial Summary - Payment Update',
    '',
    'Tuesday 3/10: Basement sheetrock payment of $10,000 paid.',
    '',
    '## Financial Summary Update',
    '',
    'March 19, 2026: $15,000 payment recorded for basement.',
    '',
    '## Financial Summary',
    '',
    '| Project | Total | Paid | Remaining |',
    '|---------|-------|------|-----------|',
    '| Oil to Gas | $17,750 | $7,500 | $10,250 |',
    '| Basement | $64,531 | $65,000 | -$469 |'
  ].join('\n');

  const out = prepareMemoryForReport(memory);
  const financialSummaryCount = (out.match(/^## Financial Summary/gm) || []).length;

  assert.equal(financialSummaryCount, 1);
  assert.match(out, /\$7,500/);
  assert.doesNotMatch(out, /\$1,500 \| \$16,250/);
});
