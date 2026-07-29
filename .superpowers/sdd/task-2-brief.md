### Task 2: Playwright sessions + action implementations

**Files:**
- Modify: `lib/browserTools.js`
- Modify: `package.json` (add `playwright`)
- Create: `tests/browser-tools-integration.test.js`

**Interfaces:**
- Consumes: Task 1 exports
- Produces:
  - `async executeBrowserTool(name, args, ctx: { sessionId: string }): Promise<string>`
  - `async closeSession(sessionId: string): Promise<void>`
  - `async closeAllSessions(): Promise<void>`
  - `takePendingVisionImages(sessionId: string): string[]` (base64, clears queue)
  - Internal: lazy `chromium.launch`, idle sweeper

- [ ] **Step 2.1: Install Playwright**

```bash
npm install playwright
npx playwright install chromium
```

Add to `package.json` scripts if missing:

```json
"test": "node --test tests/"
```

- [ ] **Step 2.2: Write integration test (skips without Chromium)**

Create `tests/browser-tools-integration.test.js`:

```js
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
```

- [ ] **Step 2.3: Run integration test â€” expect FAIL (executeBrowserTool missing)**

Run: `node --test tests/browser-tools-integration.test.js`  
Expected: FAIL executeBrowserTool is not a function (or skip if no Chromium â€” then temporarily assert export exists in guards test)

- [ ] **Step 2.4: Implement sessions + executeBrowserTool in `lib/browserTools.js`**

Key implementation notes (implement fully in the file):

```js
const sessions = new Map(); // sessionId -> { browser, context, page, lastUsedAt, actionCount, pendingImages: [] }
let idleTimer = null;

function screenshotsDir(sessionId) {
  const dir = path.join(DATA_DIR, 'browser-screenshots', safeId(sessionId));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function safeId(id) {
  return String(id || 'unknown').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
}

function takePendingVisionImages(sessionId) {
  const s = sessions.get(String(sessionId || ''));
  if (!s || !s.pendingImages || !s.pendingImages.length) return [];
  const out = s.pendingImages.slice();
  s.pendingImages = [];
  return out;
}

async function ensureSession(sessionId) {
  const id = String(sessionId || '').trim();
  if (!id) throw new Error('browser sessionId is required');
  let s = sessions.get(id);
  if (s && s.page) {
    s.lastUsedAt = Date.now();
    return s;
  }
  const cfg = getBrowserConfig();
  let playwright;
  try {
    playwright = require('playwright');
  } catch (e) {
    throw new Error('Playwright is not installed. Run: npm install playwright && npx playwright install chromium');
  }
  const browser = await playwright.chromium.launch({ headless: cfg.headless !== false });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(cfg.actionTimeoutMs || 30000);
  s = { browser, context, page, lastUsedAt: Date.now(), actionCount: 0, pendingImages: [] };
  sessions.set(id, s);
  ensureIdleSweeper();
  return s;
}

async function closeSession(sessionId) {
  const id = String(sessionId || '');
  const s = sessions.get(id);
  if (!s) return;
  sessions.delete(id);
  try { await s.context.close(); } catch (_) {}
  try { await s.browser.close(); } catch (_) {}
}

async function closeAllSessions() {
  for (const id of [...sessions.keys()]) await closeSession(id);
}

function bumpAction(s) {
  const cfg = getBrowserConfig();
  s.actionCount = (s.actionCount || 0) + 1;
  s.lastUsedAt = Date.now();
  if (s.actionCount > (cfg.maxActionsPerSession || 40)) {
    throw new Error('Browser action limit reached for this session. Call browser_close and start again.');
  }
}

async function saveScreenshot(sessionId, page) {
  const file = path.join(screenshotsDir(sessionId), `${Date.now()}.png`);
  const buf = await page.screenshot({ type: 'png', fullPage: false });
  fs.writeFileSync(file, buf);
  const b64 = buf.toString('base64');
  const s = sessions.get(String(sessionId));
  if (s) {
    s.pendingImages = s.pendingImages || [];
    s.pendingImages.push(b64);
  }
  return { file, relative: path.relative(path.join(__dirname, '..'), file) };
}

async function executeBrowserTool(name, args, ctx) {
  if (!isBrowserEnabled()) return 'Error: browser tools are disabled in config.';
  const sessionId = ctx && ctx.sessionId != null ? String(ctx.sessionId).trim() : '';
  if (!sessionId) return 'Error: browser sessionId is required.';
  args = args && typeof args === 'object' ? args : {};
  try {
    if (name === 'browser_close') {
      await closeSession(sessionId);
      return 'Browser session closed.';
    }
    if (name === 'browser_navigate') {
      const url = args.url != null ? String(args.url).trim() : '';
      if (!url) return 'Error: url is required.';
      assertAllowedUrl(url);
      const s = await ensureSession(sessionId);
      bumpAction(s);
      const resp = await s.page.goto(url, { waitUntil: 'domcontentloaded', timeout: getBrowserConfig().actionTimeoutMs });
      await s.page.waitForTimeout(250);
      const title = await s.page.title();
      return `Navigated to ${s.page.url()}\nTitle: ${title || '(none)'}\nHTTP: ${resp ? resp.status() : 'n/a'}`;
    }
    const s = sessions.get(sessionId);
    if (!s || !s.page) return 'Error: no browser session. Call browser_navigate first.';
    if (name === 'browser_snapshot') {
      bumpAction(s);
      const title = await s.page.title();
      const text = truncateText(await s.page.innerText('body').catch(() => ''));
      let extra = '';
      if (args.screenshot === true) {
        const shot = await saveScreenshot(sessionId, s.page);
        extra = `\nScreenshot: ${shot.relative}`;
      }
      return `Title: ${title || '(none)'}\nURL: ${s.page.url()}\n\nContent:\n${text}${extra}`;
    }
    if (name === 'browser_click') {
      bumpAction(s);
      const selector = args.selector != null ? String(args.selector).trim() : '';
      const role = args.role != null ? String(args.role).trim() : '';
      const accessibleName = args.name != null ? String(args.name).trim() : '';
      if (selector) await s.page.click(selector);
      else if (role) await s.page.getByRole(role, accessibleName ? { name: accessibleName } : undefined).click();
      else return 'Error: provide selector or role(+name).';
      return 'Clicked successfully.';
    }
    if (name === 'browser_type') {
      bumpAction(s);
      const selector = args.selector != null ? String(args.selector).trim() : '';
      const text = args.text != null ? String(args.text) : '';
      if (!selector) return 'Error: selector is required.';
      const clear = args.clear !== false;
      if (clear) await s.page.fill(selector, text);
      else await s.page.type(selector, text);
      if (args.submit === true) await s.page.press(selector, 'Enter');
      return 'Typed successfully.';
    }
    if (name === 'browser_screenshot') {
      bumpAction(s);
      const shot = await saveScreenshot(sessionId, s.page);
      return `Screenshot saved: ${shot.relative}`;
    }
    return `Error: unknown browser tool ${name}`;
  } catch (err) {
    logger.warn('browser tool error:', name, err.message);
    const msg = String(err && err.message ? err.message : err);
    if (/Executable doesn't exist|browserType\.launch/i.test(msg)) {
      return 'Error: Chromium not installed. Run: npx playwright install chromium';
    }
    return 'Error: ' + msg;
  }
}

function ensureIdleSweeper() {
  if (idleTimer) return;
  idleTimer = setInterval(() => {
    const idle = getBrowserConfig().idleTimeoutMs || 300000;
    const now = Date.now();
    for (const [id, s] of sessions.entries()) {
      if (now - (s.lastUsedAt || 0) > idle) {
        closeSession(id).catch(() => {});
      }
    }
  }, 60000);
  if (idleTimer.unref) idleTimer.unref();
}
```

Export the new functions from `module.exports`.

Note: Prefer `page.waitForTimeout` only if available; on newer Playwright use `await new Promise(r => setTimeout(r, 250))` instead.

- [ ] **Step 2.5: Run unit + integration tests**

Run: `node --test tests/browser-tools-guards.test.js tests/browser-tools-integration.test.js`  
Expected: PASS (integration may skip only if Chromium missing â€” after `npx playwright install chromium` it should run)

- [ ] **Step 2.6: Commit**

```bash
git add lib/browserTools.js package.json package-lock.json tests/browser-tools-integration.test.js
git commit -m "Implement Playwright browser sessions and tool actions."
```

---
