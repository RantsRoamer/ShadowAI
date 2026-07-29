# Review Package Task 1 (re-review 2)
BASE: f9378a5898a560a7aefb1e3d057aedf4f60cb8da
HEAD: 82aca35cf46db3e475eb7ca1cbd464d056adee6f

## Commits
82aca35 Harden IPv4-mapped IPv6 private URL blocking.
e908740 Fix IPv6 and IPv4-mapped private URL blocking.
0f3b7d1 Add browser tool config, URL guards, and tool definitions.


## Stat
 .gitignore                         |   1 +
 config.default.json                |   9 ++
 lib/browserTools.js                | 216 +++++++++++++++++++++++++++++++++++++
 lib/config.js                      |   3 +
 tests/browser-tools-guards.test.js |  80 ++++++++++++++
 5 files changed, 309 insertions(+)


## Diff
diff --git a/.gitignore b/.gitignore
index 0bfa3de..154c082 100644
--- a/.gitignore
+++ b/.gitignore
@@ -1,14 +1,15 @@
 node_modules/
 config.json
 run/
 data/chats/
 data/projects/
 data/personality.md
 data/memory.md
 data/memory.json
 data/AIBEHAVIOR.md
+data/browser-screenshots/
 .env
 *.log
 .DS_Store
 .claude/
 .worktrees/
diff --git a/config.default.json b/config.default.json
index c39fee8..af9e12e 100644
--- a/config.default.json
+++ b/config.default.json
@@ -34,20 +34,29 @@
     "alerts": {
       "enabled": false,
       "minSeverity": "error",
       "email": { "enabled": false },
       "webhook": { "enabled": false, "url": "", "secret": "" }
     }
   },
   "heartbeat": [],
   "skills": { "enabledIds": [] },
   "searxng": { "url": "", "enabled": false },
+  "browser": {
+    "enabled": true,
+    "headless": true,
+    "idleTimeoutMs": 300000,
+    "actionTimeoutMs": 30000,
+    "maxActionsPerSession": 40,
+    "maxTextChars": 80000,
+    "blockPrivateNetworks": true
+  },
   "email": {
     "host": "",
     "port": 25,
     "secure": false,
     "auth": { "user": "", "pass": "" },
     "from": "",
     "defaultTo": "",
     "enabled": false
   },
   "channels": {
diff --git a/lib/browserTools.js b/lib/browserTools.js
new file mode 100644
index 0000000..b6cc1a8
--- /dev/null
+++ b/lib/browserTools.js
@@ -0,0 +1,216 @@
+'use strict';
+
+const path = require('path');
+const fs = require('fs');
+const { getConfig } = require('./config.js');
+const { DATA_DIR } = require('./personality.js');
+const logger = require('./logger.js');
+
+const BROWSER_TOOL_NAMES = [
+  'browser_navigate',
+  'browser_snapshot',
+  'browser_click',
+  'browser_type',
+  'browser_screenshot',
+  'browser_close'
+];
+
+const TOOL_NAME_SET = new Set(BROWSER_TOOL_NAMES);
+
+let configOverride = null; // tests only
+
+function setBrowserConfigOverrideForTests(obj) {
+  configOverride = obj;
+}
+
+function getBrowserConfig() {
+  if (configOverride) return { ...defaultBrowserConfig(), ...configOverride };
+  const b = getConfig().browser || {};
+  return { ...defaultBrowserConfig(), ...b };
+}
+
+function defaultBrowserConfig() {
+  return {
+    enabled: true,
+    headless: true,
+    idleTimeoutMs: 300000,
+    actionTimeoutMs: 30000,
+    maxActionsPerSession: 40,
+    maxTextChars: 80000,
+    blockPrivateNetworks: true
+  };
+}
+
+function isBrowserEnabled() {
+  return getBrowserConfig().enabled !== false;
+}
+
+function isPrivateIpv4Octets(a, b) {
+  if (a === 10) return true;
+  if (a === 127) return true;
+  if (a === 0) return true;
+  if (a === 169 && b === 254) return true;
+  if (a === 192 && b === 168) return true;
+  if (a === 172 && b >= 16 && b <= 31) return true;
+  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
+  return false;
+}
+
+function ipv4FromMappedIpv6(hostname) {
+  const dotted = /ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(hostname);
+  if (dotted) return dotted[1];
+  const hex = /ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(hostname);
+  if (hex) {
+    const hi = parseInt(hex[1], 16);
+    const lo = parseInt(hex[2], 16);
+    return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
+  }
+  return null;
+}
+
+function isPrivateHostnameOrIp(hostname) {
+  const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
+  if (!h) return true;
+  if (h === 'localhost' || h === '0.0.0.0' || h.endsWith('.localhost')) return true;
+  // IPv4
+  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
+  if (m) return isPrivateIpv4Octets(+m[1], +m[2]);
+  if (h.includes(':')) {
+    if (h === '::1') return true;
+    if (h.startsWith('fc') || h.startsWith('fd')) return true; // ULA fc00::/7
+    const firstHextet = h.split(':')[0];
+    if (firstHextet && /^[0-9a-f]{1,4}$/.test(firstHextet)) {
+      const n = parseInt(firstHextet, 16);
+      if (n >= 0xfe80 && n <= 0xfebf) return true; // fe80::/10 link-local
+    }
+    const mappedIpv4 = ipv4FromMappedIpv6(h);
+    if (mappedIpv4) {
+      const pm = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(mappedIpv4);
+      if (pm) return isPrivateIpv4Octets(+pm[1], +pm[2]);
+    }
+  }
+  return false;
+}
+
+function assertAllowedUrl(urlString, opts = {}) {
+  let u;
+  try { u = new URL(String(urlString || '').trim()); } catch (_) {
+    throw new Error('Invalid URL');
+  }
+  if (!['http:', 'https:'].includes(u.protocol)) {
+    throw new Error('Only http and https URLs are allowed');
+  }
+  const block = opts.blockPrivateNetworks !== undefined
+    ? !!opts.blockPrivateNetworks
+    : getBrowserConfig().blockPrivateNetworks !== false;
+  if (block && isPrivateHostnameOrIp(u.hostname)) {
+    throw new Error('URL blocked: private/local network addresses are not allowed');
+  }
+  return u;
+}
+
+function truncateText(text, maxChars) {
+  const max = maxChars != null ? maxChars : getBrowserConfig().maxTextChars;
+  const s = text == null ? '' : String(text);
+  return s.length > max ? s.slice(0, max) : s;
+}
+
+function handles(name) {
+  return TOOL_NAME_SET.has(name);
+}
+
+function getBrowserToolDefinitions() {
+  if (!isBrowserEnabled()) return [];
+  return [
+    {
+      type: 'function',
+      function: {
+        name: 'browser_navigate',
+        description: 'Open a URL in this chat\'s browser session (creates session if needed). Prefer this over fetch_url for JS-heavy pages. Then use browser_snapshot.',
+        parameters: {
+          type: 'object',
+          required: ['url'],
+          properties: { url: { type: 'string', description: 'Full http(s) URL' } }
+        }
+      }
+    },
+    {
+      type: 'function',
+      function: {
+        name: 'browser_snapshot',
+        description: 'Get the current page title and visible text from the browser session. Optionally include a screenshot.',
+        parameters: {
+          type: 'object',
+          properties: {
+            screenshot: { type: 'boolean', description: 'If true, also capture a screenshot' }
+          }
+        }
+      }
+    },
+    {
+      type: 'function',
+      function: {
+        name: 'browser_click',
+        description: 'Click an element in the browser session by CSS selector, or by role+name.',
+        parameters: {
+          type: 'object',
+          properties: {
+            selector: { type: 'string', description: 'CSS selector' },
+            role: { type: 'string', description: 'ARIA role (e.g. button, link)' },
+            name: { type: 'string', description: 'Accessible name when using role' }
+          }
+        }
+      }
+    },
+    {
+      type: 'function',
+      function: {
+        name: 'browser_type',
+        description: 'Type text into an input in the browser session.',
+        parameters: {
+          type: 'object',
+          required: ['selector', 'text'],
+          properties: {
+            selector: { type: 'string' },
+            text: { type: 'string' },
+            clear: { type: 'boolean', description: 'Clear field before typing (default true)' },
+            submit: { type: 'boolean', description: 'Press Enter after typing' }
+          }
+        }
+      }
+    },
+    {
+      type: 'function',
+      function: {
+        name: 'browser_screenshot',
+        description: 'Capture a PNG screenshot of the current page. Saved under data/browser-screenshots/.',
+        parameters: { type: 'object', properties: {} }
+      }
+    },
+    {
+      type: 'function',
+      function: {
+        name: 'browser_close',
+        description: 'Close this chat\'s browser session and free resources.',
+        parameters: { type: 'object', properties: {} }
+      }
+    }
+  ];
+}
+
+// Placeholders filled in Task 2:
+// async function executeBrowserTool(name, args, ctx) { ... }
+// async function closeSession(sessionId) { ... }
+// function takePendingVisionImages(sessionId) { ... }
+
+module.exports = {
+  BROWSER_TOOL_NAMES,
+  getBrowserConfig,
+  setBrowserConfigOverrideForTests,
+  isBrowserEnabled,
+  isPrivateHostnameOrIp,
+  assertAllowedUrl,
+  truncateText,
+  handles,
+  getBrowserToolDefinitions
+};
diff --git a/lib/config.js b/lib/config.js
index 196d0fc..00173f3 100644
--- a/lib/config.js
+++ b/lib/config.js
@@ -122,20 +122,23 @@ function updateConfig(updates) {
   }
   if (updates.rag !== undefined) {
     config.rag = { ...(config.rag || {}), ...updates.rag };
   }
   if (updates.agent !== undefined) {
     config.agent = { ...(config.agent || {}), ...updates.agent };
   }
   if (updates.agentLoop !== undefined && typeof updates.agentLoop === 'object') {
     config.agentLoop = { ...(config.agentLoop || {}), ...updates.agentLoop };
   }
+  if (updates.browser !== undefined && typeof updates.browser === 'object') {
+    config.browser = { ...(config.browser || {}), ...updates.browser };
+  }
   if (updates.timezone !== undefined) {
     config.timezone = typeof updates.timezone === 'string' ? updates.timezone.trim() : '';
   }
   saveConfig(config);
   global.__shadowConfig = config;
   return config;
 }
 
 /** Replace entire config and persist. Use when you have built the full merged config. */
 function replaceConfig(fullConfig) {
diff --git a/tests/browser-tools-guards.test.js b/tests/browser-tools-guards.test.js
new file mode 100644
index 0000000..7715084
--- /dev/null
+++ b/tests/browser-tools-guards.test.js
@@ -0,0 +1,80 @@
+'use strict';
+
+const test = require('node:test');
+const assert = require('node:assert/strict');
+
+const {
+  getBrowserConfig,
+  setBrowserConfigOverrideForTests,
+  isPrivateHostnameOrIp,
+  assertAllowedUrl,
+  truncateText,
+  getBrowserToolDefinitions,
+  handles,
+  BROWSER_TOOL_NAMES
+} = require('../lib/browserTools.js');
+
+test('isPrivateHostnameOrIp blocks localhost and RFC1918', () => {
+  assert.equal(isPrivateHostnameOrIp('localhost'), true);
+  assert.equal(isPrivateHostnameOrIp('127.0.0.1'), true);
+  assert.equal(isPrivateHostnameOrIp('10.0.0.1'), true);
+  assert.equal(isPrivateHostnameOrIp('192.168.1.1'), true);
+  assert.equal(isPrivateHostnameOrIp('172.16.5.1'), true);
+  assert.equal(isPrivateHostnameOrIp('example.com'), false);
+});
+
+test('isPrivateHostnameOrIp blocks fe80::/10 link-local and IPv4-mapped private', () => {
+  assert.equal(isPrivateHostnameOrIp('fe80::1'), true);
+  assert.equal(isPrivateHostnameOrIp('fe90::1'), true);
+  assert.equal(isPrivateHostnameOrIp('::ffff:127.0.0.1'), true);
+  assert.equal(isPrivateHostnameOrIp('::ffff:10.1.2.3'), true);
+  assert.equal(isPrivateHostnameOrIp('::ffff:7f00:1'), true);
+  assert.equal(isPrivateHostnameOrIp('::ffff:a01:203'), true);
+  assert.equal(isPrivateHostnameOrIp('[::ffff:7f00:1]'), true);
+  assert.equal(isPrivateHostnameOrIp('2001:db8::1'), false);
+  assert.equal(isPrivateHostnameOrIp('example.com'), false);
+});
+
+test('assertAllowedUrl blocks IPv4-mapped IPv6 private addresses', () => {
+  assert.throws(
+    () => assertAllowedUrl('http://[::ffff:127.0.0.1]/', { blockPrivateNetworks: true }),
+    /private|blocked|local/i
+  );
+  assert.throws(
+    () => assertAllowedUrl('http://[::ffff:10.1.2.3]/', { blockPrivateNetworks: true }),
+    /private|blocked|local/i
+  );
+});
+
+test('assertAllowedUrl rejects non-http and private hosts when blocking', () => {
+  assert.throws(() => assertAllowedUrl('file:///tmp/x'), /http/i);
+  assert.throws(() => assertAllowedUrl('http://127.0.0.1/', { blockPrivateNetworks: true }), /private|blocked|local/i);
+  const u = assertAllowedUrl('https://example.com/path', { blockPrivateNetworks: true });
+  assert.equal(u.hostname, 'example.com');
+});
+
+test('assertAllowedUrl allows loopback when blockPrivateNetworks false', () => {
+  const u = assertAllowedUrl('http://127.0.0.1:8765/', { blockPrivateNetworks: false });
+  assert.equal(u.hostname, '127.0.0.1');
+});
+
+test('truncateText respects max', () => {
+  assert.equal(truncateText('abcdef', 3), 'abc');
+});
+
+test('getBrowserToolDefinitions respects enabled flag via setBrowserConfigOverrideForTests', () => {
+  assert.ok(Array.isArray(BROWSER_TOOL_NAMES));
+  assert.equal(BROWSER_TOOL_NAMES.length, 6);
+  for (const n of BROWSER_TOOL_NAMES) assert.equal(handles(n), true);
+  assert.equal(handles('fetch_url'), false);
+
+  setBrowserConfigOverrideForTests({ enabled: false });
+  assert.deepEqual(getBrowserToolDefinitions(), []);
+  setBrowserConfigOverrideForTests({ enabled: true });
+  assert.equal(getBrowserToolDefinitions().length, 6);
+  assert.deepEqual(
+    getBrowserToolDefinitions().map((t) => t.function.name),
+    BROWSER_TOOL_NAMES
+  );
+  setBrowserConfigOverrideForTests(null);
+});

