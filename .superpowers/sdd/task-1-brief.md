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

- [ ] **Step 1.2: Run tests â€” expect FAIL (module missing)**

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

Expand the defs-gate test using `setBrowserConfigOverrideForTests({ enabled: false })` â†’ `[]`, then `{ enabled: true }` â†’ length 6.

- [ ] **Step 1.5: Run tests â€” expect PASS**

Run: `node --test tests/browser-tools-guards.test.js`  
Expected: PASS

- [ ] **Step 1.6: Commit**

```bash
git add lib/browserTools.js tests/browser-tools-guards.test.js config.default.json lib/config.js .gitignore
git commit -m "Add browser tool config, URL guards, and tool definitions."
```

---
