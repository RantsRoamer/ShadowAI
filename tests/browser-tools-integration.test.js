'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
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
  const html = '<!doctype html><html><head><title>ShadowAI Fixture</title></head><body><h1 id="hi">Hello Browser</h1><input id="field" value="" oninput="document.querySelector(\'#value\').textContent = this.value"><p id="value"></p><button id="btn">Go</button></body></html>';
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
    const typed = await browserTools.executeBrowserTool('browser_type', {
      selector: '#field',
      text: 'ShadowAI'
    }, { sessionId });
    assert.match(typed, /typed/i);
    const fieldValue = await browserTools.executeBrowserTool('browser_snapshot', {}, { sessionId });
    assert.match(fieldValue, /ShadowAI/);
    const screenshot = await browserTools.executeBrowserTool('browser_screenshot', {}, { sessionId });
    assert.match(screenshot, /Screenshot saved: data[\\/]browser-screenshots/i);
    const screenshotPath = screenshot.replace(/^Screenshot saved: /, '');
    assert.equal(fs.existsSync(path.resolve(__dirname, '..', screenshotPath)), true);
    const images = browserTools.takePendingVisionImages(sessionId);
    assert.equal(images.length, 1);
    assert.match(images[0], /^[A-Za-z0-9+/]+={0,2}$/);
    assert.deepEqual(browserTools.takePendingVisionImages(sessionId), []);
    const badClick = await browserTools.executeBrowserTool('browser_click', { selector: '#missing' }, { sessionId });
    assert.match(badClick, /^Error:/);
  } finally {
    await browserTools.closeSession(sessionId);
    browserTools.setBrowserConfigOverrideForTests(null);
    await new Promise((r) => server.close(r));
  }
});

test('close removes session and action limit returns an error', async (t) => {
  if (!(await chromiumAvailable())) {
    t.skip('Chromium not installed');
    return;
  }
  browserTools.setBrowserConfigOverrideForTests({
    enabled: true,
    headless: true,
    blockPrivateNetworks: false,
    actionTimeoutMs: 15000,
    maxActionsPerSession: 1
  });
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<!doctype html><title>Fixture</title><p>Fixture</p>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  const sessionId = 'test-session-limit';
  try {
    const nav = await browserTools.executeBrowserTool('browser_navigate', {
      url: `http://127.0.0.1:${port}/`
    }, { sessionId });
    assert.doesNotMatch(nav, /^Error:/);
    const limit = await browserTools.executeBrowserTool('browser_snapshot', {}, { sessionId });
    assert.match(limit, /^Error:.*action limit/i);
    const closed = await browserTools.executeBrowserTool('browser_close', {}, { sessionId });
    assert.match(closed, /closed/i);
    const noSession = await browserTools.executeBrowserTool('browser_snapshot', {}, { sessionId });
    assert.match(noSession, /^Error: no browser session/i);
  } finally {
    await browserTools.closeSession(sessionId);
    browserTools.setBrowserConfigOverrideForTests(null);
    await new Promise((r) => server.close(r));
  }
});
