const test = require('node:test');
const assert = require('node:assert/strict');

const { parseStepSignal } = require('../lib/agentRunner.js');

test('parseStepSignal detects STEP_DONE after explanatory text', () => {
  const parsed = parseStepSignal("I verified the location is present.\n\nSTEP_DONE");
  assert.equal(parsed.done, true);
  assert.equal(parsed.blocked, false);
  assert.equal(parsed.logText, 'I verified the location is present.');
});

test('parseStepSignal detects STEP_BLOCKED anywhere in content', () => {
  const parsed = parseStepSignal("Need a missing API key.\nSTEP_BLOCKED: API key is required");
  assert.equal(parsed.done, false);
  assert.equal(parsed.blocked, true);
  assert.equal(parsed.blockedReason, 'API key is required');
  assert.equal(parsed.logText, 'Need a missing API key.');
});

test('parseStepSignal returns plain text when no control signal exists', () => {
  const parsed = parseStepSignal('Still searching for data.');
  assert.equal(parsed.done, false);
  assert.equal(parsed.blocked, false);
  assert.equal(parsed.logText, 'Still searching for data.');
});

