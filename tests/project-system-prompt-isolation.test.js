const test = require('node:test');
const assert = require('node:assert/strict');

const systemPrompt = require('../lib/systemPrompt.js');

test('project system prompt does not inject global memory/profile blocks', () => {
  const text = systemPrompt.buildProjectSystemPrompt('proj_missing', '', false, '');
  assert.equal(text.includes('--- User memory profile (informational context about the user) ---'), false);
  assert.equal(text.includes('--- User structured profile (key → value; informational) ---'), false);
  assert.equal(text.includes('--- Who the user is / how to help (follow this) ---'), false);
});
