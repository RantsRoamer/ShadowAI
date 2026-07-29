'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');

function source(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

test('web chat namespaces browser sessions and skips unsafe vision attachment', () => {
  const server = source('server.js');

  assert.match(server, /const browserTools = require\('\.\/lib\/browserTools\.js'\);/);
  assert.match(server, /\.\.\.browserTools\.getBrowserToolDefinitions\(\)/);
  assert.match(server, /browserTools\.handles\(name\)/);
  assert.match(server, /'web:' \+ \(effectiveUser \|\| user \|\| 'anon'\) \+ ':' \+ \(String\(bodyChatId \|\| ''\)\.trim\(\) \|\| 'default'\)/);
  assert.match(server, /browserTools\.executeBrowserTool\(name, args, \{ sessionId \}\)/);
  assert.match(server, /browserTools\.takePendingVisionImages\(sessionId\)/);
  assert.match(server, /browserTools\.shouldAttachVisionImages\(llm, config\)/);
});

test('channel runner namespaces browser sessions and skips unsafe vision attachment', () => {
  const chatRunner = source('lib/chatRunner.js');

  assert.match(chatRunner, /const browserTools = require\('\.\/browserTools\.js'\);/);
  assert.match(chatRunner, /sessionId: optSessionId/);
  assert.match(chatRunner, /const browserSessionId = 'channel:'/);
  assert.match(chatRunner, /: String\(user \|\| 'channel'\)\);/);
  assert.match(chatRunner, /\.\.\.browserTools\.getBrowserToolDefinitions\(\)/);
  assert.match(chatRunner, /browserTools\.handles\(name\)/);
  assert.match(chatRunner, /browserTools\.executeBrowserTool\(name, args, \{ sessionId: browserSessionId \}\)/);
  assert.match(chatRunner, /browserTools\.takePendingVisionImages\(browserSessionId\)/);
  assert.match(chatRunner, /browserTools\.shouldAttachVisionImages\(llm, config\)/);
});

test('agent runner namespaces browser sessions and skips unsafe vision attachment', () => {
  const agentRunner = source('lib/agentRunner.js');

  assert.match(agentRunner, /'agent:' \+ String\(taskId \|\| 'unknown'\)/);
  assert.match(agentRunner, /browserTools\.shouldAttachVisionImages\(llm, getConfig\(\)\)/);
});
