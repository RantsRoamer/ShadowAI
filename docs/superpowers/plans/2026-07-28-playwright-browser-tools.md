# Playwright Browser Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Playwright browser tools (`browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`, `browser_screenshot`, `browser_close`) with per-chat sessions, available in web chat, channels, and the autonomous agent.

**Architecture:** New `lib/browserTools.js` owns session store, URL/security guards, tool definitions, and execution. Wire into `server.js`, `lib/chatRunner.js`, and `lib/agentRunner.js` like other built-ins. Screenshots save under `data/browser-screenshots/` and optionally attach as Ollama `images` on the next LLM round when vision is configured.

**Tech Stack:** Node.js 18+, Playwright (Chromium), existing Express tool loops, `node:test`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-28-playwright-browser-tools-design.md`
- `browser.enabled` defaults to **true**
- Only **http/https**; **block private networks** by default
- One headless Chromium page per session (chat id / channel session id / agent task id)
- Agent: low-risk = navigate/snapshot/screenshot; high-risk = click/type/close
- Tool failures return strings; never crash the tool loop
- v1: no multi-tab, downloads, MCP, or non-Chromium browsers

## File Map

| Path | Action | Responsibility |
|------|--------|----------------|
| `lib/browserTools.js` | Create | Config helpers, URL guards, sessions, tools, screenshots, vision queue |
| `tests/browser-tools-guards.test.js` | Create | Unit tests for URL guards, defs gate, truncation (no browser) |
| `tests/browser-tools-integration.test.js` | Create | Optional Chromium navigate+snapshot via local fixture |
| `config.default.json` | Modify | Add `browser` section |
| `lib/config.js` | Modify | `updateConfig` merge for `browser` |
| `package.json` | Modify | Add `playwright` dependency; optional `test` script |
| `.gitignore` | Modify | Ignore `data/browser-screenshots/` |
| `server.js` | Modify | Tool defs + dispatch + vision inject; session id from `bodyChatId` |
| `lib/chatRunner.js` | Modify | Tool defs + dispatch + vision inject; `sessionId` option |
| `lib/agentRunner.js` | Modify | Tool defs, risk sets, execute, session cleanup on terminal |
| `public/config.html` | Modify | Browser settings panel |
| `public/config.js` | Modify | Load/save browser settings |
| `README.md` | Modify | Browser tools + `npx playwright install chromium` |
| `ROADMAP.md` | Modify | Mark §6 progress |

---

### Task 1: Config defaults + URL guards + tool definitions (no Playwright launch)

**Files:**
- Create: `lib/browserTools.js` (guards + defs + stubs for execute later)
- Create: `tests/browser-tools-guards.test.js`
- Modify: `config.default.json`
- Modify: `lib/config.js`
- Modify: `.gitignore`

**Interfaces:**
- Produces:
  - `getBrowserConfig(): { enabled, headless, idleTimeoutMs, actionTimeoutMs, maxActionsPerSession, maxTextChars, blockPrivateNetworks }`
  - `isBrowserEnabled(): boolean`
  - `assertAllowedUrl(urlString, { blockPrivateNetworks?: boolean }): URL` (throws Error with clear message)
  - `isPrivateHostnameOrIp(hostname: string): boolean`
  - `truncateText(text: string, maxChars?: number): string`
  - `getBrowserToolDefinitions(): Array` (empty when disabled)
  - `handles(name: string): boolean`
  - `BROWSER_TOOL_NAMES: string[]`

- [ ] **Step 1.1: Write failing unit tests**

Create `tests/browser-tools-guards.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isPrivateHostnameOrIp,
  assertAllowedUrl,
  truncateText,
  getBrowserToolDefinitions,
  handles,
  BROWSER_TOOL_NAMES
} = require('../lib/browserTools.js');

test('isPrivateHostnameOrIp blocks localhost and RFC1918', () => {
  assert.equal(isPrivateHostnameOrIp('localhost'), true);
  assert.equal(isPrivateHostnameOrIp('127.0.0.1'), true);
  assert.equal(isPrivateHostnameOrIp('10.0.0.1'), true);
  assert.equal(isPrivateHostnameOrIp('192.168.1.1'), true);
  assert.equal(isPrivateHostnameOrIp('172.16.5.1'), true);
  assert.equal(isPrivateHostnameOrIp('example.com'), false);
});

test('assertAllowedUrl rejects non-http and private hosts when blocking', () => {
  assert.throws(() => assertAllowedUrl('file:///tmp/x'), /http/i);
  assert.throws(() => assertAllowedUrl('http://127.0.0.1/', { blockPrivateNetworks: true }), /private|blocked|local/i);
  const u = assertAllowedUrl('https://example.com/path', { blockPrivateNetworks: true });
  assert.equal(u.hostname, 'example.com');
});

test('assertAllowedUrl allows loopback when blockPrivateNetworks false', () => {
  const u = assertAllowedUrl('http://127.0.0.1:8765/', { blockPrivateNetworks: false });
  assert.equal(u.hostname, '127.0.0.1');
});

test('truncateText respects max', () => {
  assert.equal(truncateText('abcdef', 3), 'abc');
});

test('getBrowserToolDefinitions respects enabled flag via setBrowserConfigOverrideForTests', () => {
  assert.ok(Array.isArray(BROWSER_TOOL_NAMES));
  assert.equal(BROWSER_TOOL_NAMES.length, 6);
  for (const n of BROWSER_TOOL_NAMES) assert.equal(handles(n), true);
  assert.equal(handles('fetch_url'), false);

  setBrowserConfigOverrideForTests({ enabled: false });
  assert.deepEqual(getBrowserToolDefinitions(), []);
  setBrowserConfigOverrideForTests({ enabled: true });
  assert.equal(getBrowserToolDefinitions().length, 6);
  assert.deepEqual(
    getBrowserToolDefinitions().map((t) => t.function.name),
    BROWSER_TOOL_NAMES
  );
  setBrowserConfigOverrideForTests(null);
});
```

Import `getBrowserConfig`, `setBrowserConfigOverrideForTests`, and `getBrowserToolDefinitions` in the require list at the top of the test file.

- [ ] **Step 1.2: Run tests — expect FAIL (module missing)**

Run: `node --test tests/browser-tools-guards.test.js`  
Expected: FAIL cannot find module `../lib/browserTools.js`

- [ ] **Step 1.3: Add config defaults + gitignore + updateConfig**

In `config.default.json` add sibling to `searxng`:

```json
"browser": {
  "enabled": true,
  "headless": true,
  "idleTimeoutMs": 300000,
  "actionTimeoutMs": 30000,
  "maxActionsPerSession": 40,
  "maxTextChars": 80000,
  "blockPrivateNetworks": true
}
```

In `.gitignore` add:

```
data/browser-screenshots/
```

In `lib/config.js` `updateConfig`, after `agentLoop` branch:

```js
if (updates.browser !== undefined && typeof updates.browser === 'object') {
  config.browser = { ...(config.browser || {}), ...updates.browser };
}
```

- [ ] **Step 1.4: Implement `lib/browserTools.js` (guards + defs only)**

```js
'use strict';

const path = require('path');
const fs = require('fs');
const { getConfig } = require('./config.js');
const { DATA_DIR } = require('./personality.js');
const logger = require('./logger.js');

const BROWSER_TOOL_NAMES = [
  'browser_navigate',
  'browser_snapshot',
  'browser_click',
  'browser_type',
  'browser_screenshot',
  'browser_close'
];

const TOOL_NAME_SET = new Set(BROWSER_TOOL_NAMES);

let configOverride = null; // tests only

function setBrowserConfigOverrideForTests(obj) {
  configOverride = obj;
}

function getBrowserConfig() {
  if (configOverride) return { ...defaultBrowserConfig(), ...configOverride };
  const b = getConfig().browser || {};
  return { ...defaultBrowserConfig(), ...b };
}

function defaultBrowserConfig() {
  return {
    enabled: true,
    headless: true,
    idleTimeoutMs: 300000,
    actionTimeoutMs: 30000,
    maxActionsPerSession: 40,
    maxTextChars: 80000,
    blockPrivateNetworks: true
  };
}

function isBrowserEnabled() {
  return getBrowserConfig().enabled !== false;
}

function isPrivateHostnameOrIp(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (h === 'localhost' || h === '0.0.0.0' || h.endsWith('.localhost')) return true;
  // IPv4
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
  if (m) {
    const a = +m[1], b = +m[2];
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  }
  // IPv6 loopback / ULA / link-local
  if (h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80:')) return true;
  return false;
}

function assertAllowedUrl(urlString, opts = {}) {
  let u;
  try { u = new URL(String(urlString || '').trim()); } catch (_) {
    throw new Error('Invalid URL');
  }
  if (!['http:', 'https:'].includes(u.protocol)) {
    throw new Error('Only http and https URLs are allowed');
  }
  const block = opts.blockPrivateNetworks !== undefined
    ? !!opts.blockPrivateNetworks
    : getBrowserConfig().blockPrivateNetworks !== false;
  if (block && isPrivateHostnameOrIp(u.hostname)) {
    throw new Error('URL blocked: private/local network addresses are not allowed');
  }
  return u;
}

function truncateText(text, maxChars) {
  const max = maxChars != null ? maxChars : getBrowserConfig().maxTextChars;
  const s = text == null ? '' : String(text);
  return s.length > max ? s.slice(0, max) : s;
}

function handles(name) {
  return TOOL_NAME_SET.has(name);
}

function getBrowserToolDefinitions() {
  if (!isBrowserEnabled()) return [];
  return [
    {
      type: 'function',
      function: {
        name: 'browser_navigate',
        description: 'Open a URL in this chat\'s browser session (creates session if needed). Prefer this over fetch_url for JS-heavy pages. Then use browser_snapshot.',
        parameters: {
          type: 'object',
          required: ['url'],
          properties: { url: { type: 'string', description: 'Full http(s) URL' } }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'browser_snapshot',
        description: 'Get the current page title and visible text from the browser session. Optionally include a screenshot.',
        parameters: {
          type: 'object',
          properties: {
            screenshot: { type: 'boolean', description: 'If true, also capture a screenshot' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'browser_click',
        description: 'Click an element in the browser session by CSS selector, or by role+name.',
        parameters: {
          type: 'object',
          properties: {
            selector: { type: 'string', description: 'CSS selector' },
            role: { type: 'string', description: 'ARIA role (e.g. button, link)' },
            name: { type: 'string', description: 'Accessible name when using role' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'browser_type',
        description: 'Type text into an input in the browser session.',
        parameters: {
          type: 'object',
          required: ['selector', 'text'],
          properties: {
            selector: { type: 'string' },
            text: { type: 'string' },
            clear: { type: 'boolean', description: 'Clear field before typing (default true)' },
            submit: { type: 'boolean', description: 'Press Enter after typing' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'browser_screenshot',
        description: 'Capture a PNG screenshot of the current page. Saved under data/browser-screenshots/.',
        parameters: { type: 'object', properties: {} }
      }
    },
    {
      type: 'function',
      function: {
        name: 'browser_close',
        description: 'Close this chat\'s browser session and free resources.',
        parameters: { type: 'object', properties: {} }
      }
    }
  ];
}

// Placeholders filled in Task 2:
// async function executeBrowserTool(name, args, ctx) { ... }
// async function closeSession(sessionId) { ... }
// function takePendingVisionImages(sessionId) { ... }

module.exports = {
  BROWSER_TOOL_NAMES,
  getBrowserConfig,
  setBrowserConfigOverrideForTests,
  isBrowserEnabled,
  isPrivateHostnameOrIp,
  assertAllowedUrl,
  truncateText,
  handles,
  getBrowserToolDefinitions
};
```

Expand the defs-gate test using `setBrowserConfigOverrideForTests({ enabled: false })` → `[]`, then `{ enabled: true }` → length 6.

- [ ] **Step 1.5: Run tests — expect PASS**

Run: `node --test tests/browser-tools-guards.test.js`  
Expected: PASS

- [ ] **Step 1.6: Commit**

```bash
git add lib/browserTools.js tests/browser-tools-guards.test.js config.default.json lib/config.js .gitignore
git commit -m "Add browser tool config, URL guards, and tool definitions."
```

---

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

- [ ] **Step 2.3: Run integration test — expect FAIL (executeBrowserTool missing)**

Run: `node --test tests/browser-tools-integration.test.js`  
Expected: FAIL executeBrowserTool is not a function (or skip if no Chromium — then temporarily assert export exists in guards test)

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
Expected: PASS (integration may skip only if Chromium missing — after `npx playwright install chromium` it should run)

- [ ] **Step 2.6: Commit**

```bash
git add lib/browserTools.js package.json package-lock.json tests/browser-tools-integration.test.js
git commit -m "Implement Playwright browser sessions and tool actions."
```

---

### Task 3: Wire web chat + channel chatRunner

**Files:**
- Modify: `server.js` (require + tool list + dispatch + vision inject)
- Modify: `lib/chatRunner.js` (same)

**Interfaces:**
- Consumes: `getBrowserToolDefinitions`, `handles`, `executeBrowserTool`, `takePendingVisionImages`
- Session ids:
  - Web: `String(bodyChatId || '').trim() || ('web:' + (effectiveUser || user || 'anon'))`
  - Channels: add `options.sessionId`; default `options.user`

- [ ] **Step 3.1: Wire `server.js`**

Near other requires:

```js
const browserTools = require('./lib/browserTools.js');
```

In `commonTools` array (after `fetchUrlTool` / with other spreads):

```js
...browserTools.getBrowserToolDefinitions(),
```

In the tool dispatch `try` block, before skills fallback (alongside `agentLoopTools.handles`):

```js
} else if (browserTools.handles(name)) {
  const sessionId = String(bodyChatId || '').trim() || ('web:' + (effectiveUser || user || 'anon'));
  content = await browserTools.executeBrowserTool(name, args, { sessionId });
```

After processing all tool calls in a round (still inside the `while` loop, before next `chatWithTools`), inject vision images if any:

```js
const sessionId = String(bodyChatId || '').trim() || ('web:' + (effectiveUser || user || 'anon'));
const visionImages = browserTools.takePendingVisionImages(sessionId);
const visionModel = (getConfig().ollama || {}).visionModel;
if (visionImages.length && visionModel) {
  messagesForOllama.push({
    role: 'user',
    content: 'Screenshot(s) from the browser tool follow for visual context.',
    images: visionImages
  });
}
```

(If `visionModel` unset but main model already accepts images in this deployment, still attach when `visionImages.length` — prefer: attach whenever `visionImages.length`, matching chat attachment behavior.)

Use this simpler rule from the spec:

```js
if (visionImages.length) {
  messagesForOllama.push({
    role: 'user',
    content: 'Screenshot(s) from the browser tool follow for visual context.',
    images: visionImages
  });
}
```

- [ ] **Step 3.2: Wire `lib/chatRunner.js`**

Require `browserTools`. Extend `runChatTurn` options with `sessionId`.

```js
const { user, userContext, messages, customInstructions = '', agentId, sessionId: optSessionId } = options;
const browserSessionId = (typeof optSessionId === 'string' && optSessionId.trim())
  ? optSessionId.trim()
  : String(user || 'channel');
```

Add `...browserTools.getBrowserToolDefinitions()` to `tools` array.

Dispatch:

```js
} else if (browserTools.handles(name)) {
  toolContent = await browserTools.executeBrowserTool(name, args, { sessionId: browserSessionId });
```

After each tool-call batch (same as server), inject pending images onto `messagesForLlm`.

- [ ] **Step 3.3: Smoke check (manual or quick node require)**

Run: `node -e "const b=require('./lib/browserTools'); console.log(b.getBrowserToolDefinitions().map(t=>t.function.name).join(','))"`  
Expected: prints the six tool names (if config enabled).

- [ ] **Step 3.4: Commit**

```bash
git add server.js lib/chatRunner.js
git commit -m "Wire browser tools into web chat and channel runner."
```

---

### Task 4: Wire autonomous agent + session cleanup

**Files:**
- Modify: `lib/agentRunner.js`

**Interfaces:**
- Consumes: browserTools APIs
- Session id: `task.id`
- Risk: add navigate/snapshot/screenshot to `LOW_RISK`; click/type/close to `BASE_HIGH_RISK`

- [ ] **Step 4.1: Update risk sets and tool definitions**

At top:

```js
const browserTools = require('./browserTools.js');

const BASE_HIGH_RISK = new Set([
  'send_email', 'create_skill', 'set_memory', 'append_memory',
  'browser_click', 'browser_type', 'browser_close'
]);
const LOW_RISK = new Set([
  'web_search', 'fetch_url', 'get_memory',
  'browser_navigate', 'browser_snapshot', 'browser_screenshot'
]);
```

In `buildToolDefinitions()`, after `fetch_url` tool push:

```js
for (const t of browserTools.getBrowserToolDefinitions()) tools.push(t);
```

- [ ] **Step 4.2: Dispatch in `executeTool`**

```js
if (browserTools.handles(name)) {
  // Caller must pass session via closure — change signature to executeTool(name, args, taskId)
  return browserTools.executeBrowserTool(name, args, { sessionId: String(taskId || 'agent') });
}
```

Update all `executeTool(name, args)` call sites in this file to `executeTool(name, args, task.id)` (and approval resume path likewise).

After each tool round in the agent step loop, if screenshots pending:

```js
const imgs = browserTools.takePendingVisionImages(task.id);
if (imgs.length) {
  messages.push({
    role: 'user',
    content: 'Screenshot(s) from the browser tool follow for visual context.',
    images: imgs
  });
}
```

- [ ] **Step 4.3: Close browser session on terminal task status**

Wherever tasks are set to `complete`, `failed`, or cleaned up as terminal, call:

```js
browserTools.closeSession(task.id).catch(() => {});
```

At minimum: after successful completion learning path and on failure/blocked terminal writes. Search `status: 'complete'` / `'failed'` update sites in `agentRunner.js` and add cleanup.

- [ ] **Step 4.4: Run existing agent signal tests**

Run: `node --test tests/agent-runner-signals.test.js tests/browser-tools-guards.test.js`  
Expected: PASS

- [ ] **Step 4.5: Commit**

```bash
git add lib/agentRunner.js
git commit -m "Wire browser tools into autonomous agent with approval tiers."
```

---

### Task 5: Config UI + docs

**Files:**
- Modify: `public/config.html`
- Modify: `public/config.js`
- Modify: `README.md`
- Modify: `ROADMAP.md`

- [ ] **Step 5.1: Add Browser tab to config UI**

In `public/config.html`, add a tab button next to SearXNG:

```html
<button type="button" class="config-tab" data-tab="browser" role="tab" aria-selected="false">Browser</button>
```

Add panel:

```html
<div id="panel-browser" class="config-panel" role="tabpanel" hidden>
  <section class="section">
    <h2>Browser (Playwright)</h2>
    <p class="section-desc">Let the AI control a headless Chromium browser for JS-heavy pages and multi-step web flows. Requires <code>npx playwright install chromium</code> on the server.</p>
    <div class="form-group">
      <label><input type="checkbox" id="browserEnabled" /> Enable browser tools</label>
    </div>
    <div class="form-group">
      <label><input type="checkbox" id="browserHeadless" /> Headless mode</label>
    </div>
    <div class="form-group">
      <label><input type="checkbox" id="browserBlockPrivate" /> Block private/local network URLs</label>
    </div>
    <div class="form-group">
      <label>Action timeout (ms)</label>
      <input type="number" id="browserActionTimeoutMs" min="1000" step="1000" />
    </div>
    <div class="form-group">
      <label>Idle session timeout (ms)</label>
      <input type="number" id="browserIdleTimeoutMs" min="60000" step="1000" />
    </div>
  </section>
</div>
```

- [ ] **Step 5.2: Load/save in `public/config.js`**

On load (near searxng fields):

```js
document.getElementById('browserEnabled').checked = c.browser?.enabled !== false;
document.getElementById('browserHeadless').checked = c.browser?.headless !== false;
document.getElementById('browserBlockPrivate').checked = c.browser?.blockPrivateNetworks !== false;
document.getElementById('browserActionTimeoutMs').value = c.browser?.actionTimeoutMs ?? 30000;
document.getElementById('browserIdleTimeoutMs').value = c.browser?.idleTimeoutMs ?? 300000;
```

On save payload:

```js
browser: {
  enabled: document.getElementById('browserEnabled').checked,
  headless: document.getElementById('browserHeadless').checked,
  blockPrivateNetworks: document.getElementById('browserBlockPrivate').checked,
  actionTimeoutMs: Number(document.getElementById('browserActionTimeoutMs').value) || 30000,
  idleTimeoutMs: Number(document.getElementById('browserIdleTimeoutMs').value) || 300000
}
```

Ensure the config POST endpoint merges `browser` (already handled if `updateConfig` / replaceConfig receives full object — if save sends full config via replace, include `browser` in the assembled object like searxng).

- [ ] **Step 5.3: Update README.md**

Add a short **Browser tools** bullet under features and an install note:

```markdown
- **Browser tools** — Playwright Chromium tools (`browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`, `browser_screenshot`, `browser_close`) for JS-rendered pages and interactive flows. Enabled by default; configure under Config → Browser.

After `npm install`, install Chromium once:

```bash
npx playwright install chromium
```
```

- [ ] **Step 5.4: Update ROADMAP.md §6**

Note that built-in Playwright tools (v1: navigate/snapshot/click/type/screenshot/close, per-chat sessions) are implemented; MCP wrapper remains future work.

- [ ] **Step 5.5: Final test run**

Run: `node --test tests/`  
Expected: all PASS (integration skip only if Chromium absent)

- [ ] **Step 5.6: Commit**

```bash
git add public/config.html public/config.js README.md ROADMAP.md
git commit -m "Add browser config UI and documentation."
```

---

## Self-review (plan vs spec)

| Spec requirement | Task |
|------------------|------|
| `lib/browserTools.js` module | 1–2 |
| Six tools | 1–2 |
| Per-chat / channel / agent sessions | 3–4 |
| Config enabled default true + guards | 1 |
| Private network block | 1–2 |
| Screenshots to disk + vision attach | 2–3–4 |
| Agent risk tiers | 4 |
| Wire server + chatRunner + agentRunner | 3–4 |
| Tests + gitignore | 1–2 |
| Config UI + README + ROADMAP | 5 |
| No MCP / multi-tab in v1 | honored (non-goals) |

Type consistency: `executeBrowserTool(name, args, { sessionId })`, `takePendingVisionImages(sessionId)`, `setBrowserConfigOverrideForTests` used across tasks.
