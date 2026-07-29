'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');

function source(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

test('web chat wires browser tools with a stable web session and vision messages', () => {
  const server = source('server.js');

  assert.match(server, /const browserTools = require\('\.\/lib\/browserTools\.js'\);/);
  assert.match(server, /\.\.\.browserTools\.getBrowserToolDefinitions\(\)/);
  assert.match(server, /browserTools\.handles\(name\)/);
  assert.match(server, /String\(bodyChatId \|\| ''\)\.trim\(\) \|\| \('web:' \+ \(effectiveUser \|\| user \|\| 'anon'\)\)/);
  assert.match(server, /browserTools\.executeBrowserTool\(name, args, \{ sessionId \}\)/);
  assert.match(server, /browserTools\.takePendingVisionImages\(sessionId\)/);
  assert.match(server, /images: visionImages/);
});

test('channel runner accepts an explicit browser session and injects vision messages', () => {
  const chatRunner = source('lib/chatRunner.js');

  assert.match(chatRunner, /const browserTools = require\('\.\/browserTools\.js'\);/);
  assert.match(chatRunner, /sessionId: optSessionId/);
  assert.match(chatRunner, /const browserSessionId = \(typeof optSessionId === 'string' && optSessionId\.trim\(\)\)/);
  assert.match(chatRunner, /: String\(user \|\| 'channel'\);/);
  assert.match(chatRunner, /\.\.\.browserTools\.getBrowserToolDefinitions\(\)/);
  assert.match(chatRunner, /browserTools\.handles\(name\)/);
  assert.match(chatRunner, /browserTools\.executeBrowserTool\(name, args, \{ sessionId: browserSessionId \}\)/);
  assert.match(chatRunner, /browserTools\.takePendingVisionImages\(browserSessionId\)/);
  assert.match(chatRunner, /images: visionImages/);
});
