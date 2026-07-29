'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const browserTools = require('../lib/browserTools.js');

async function chromiumAvailable() {
  try {
    const { chromium } = require('playwright');
    const b = await chromium.launch({ headless: true });
    await b.close();
    return true;
  } catch (_) {
    return false;
  }
}

test('navigate + snapshot against local fixture', async (t) => {
  if (!(await chromiumAvailable())) {
    t.skip('Chromium not installed');
    return;
  }
  browserTools.setBrowserConfigOverrideForTests({
    enabled: true,
    headless: true,
    blockPrivateNetworks: false,
    actionTimeoutMs: 15000,
    maxActionsPerSession: 20
  });
  const html = '<!doctype html><html><head><title>ShadowAI Fixture</title></head><body><h1 id="hi">Hello Browser</h1><button id="btn">Go</button></body></html>';
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  const sessionId = 'test-session-1';
  try {
    const nav = await browserTools.executeBrowserTool('browser_navigate', {
      url: `http://127.0.0.1:${port}/`
    }, { sessionId });
    assert.match(nav, /ShadowAI Fixture|127\.0\.0\.1/i);
    const snap = await browserTools.executeBrowserTool('browser_snapshot', {}, { sessionId });
    assert.match(snap, /Hello Browser/);
    const click = await browserTools.executeBrowserTool('browser_click', { selector: '#btn' }, { sessionId });
    assert.match(click, /click/i);
  } finally {
    await browserTools.closeSession(sessionId);
    browserTools.setBrowserConfigOverrideForTests(null);
    await new Promise((r) => server.close(r));
  }
});
