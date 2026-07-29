# Review Package Task 2 (re-review 4)
BASE: 82aca35cf46db3e475eb7ca1cbd464d056adee6f
HEAD: 39853ff0c3fdbb76a7ad9878a06ef9d86aafe607

## Commits
39853ff Harden resolved browser request guards.
baa3559 Harden browser navigation network guards
76003fd Harden Playwright browser request blocking
366464c Implement Playwright browser sessions and tool actions.


## Stat
 .superpowers/sdd/task-2-report.md       |  92 ++++++++++++
 lib/browserTools.js                     | 247 +++++++++++++++++++++++++++++++-
 package-lock.json                       |  47 +++++-
 package.json                            |   6 +-
 tests/browser-tools-guards.test.js      | 102 ++++++++++++-
 tests/browser-tools-integration.test.js | 109 ++++++++++++++
 6 files changed, 593 insertions(+), 10 deletions(-)


## Diff
diff --git a/.superpowers/sdd/task-2-report.md b/.superpowers/sdd/task-2-report.md
new file mode 100644
index 0000000..3afe05c
--- /dev/null
+++ b/.superpowers/sdd/task-2-report.md
@@ -0,0 +1,92 @@
+# Task 2 Report: Playwright sessions and action implementations
+
+## Completed
+
+- Installed `playwright` and downloaded the Chromium runtime with `npx playwright install chromium`.
+- Added the `test` npm script: `node --test tests/`.
+- Added an integration test that runs against a local HTTP fixture and verifies navigation, snapshots, and clicks.
+- Implemented lazy Playwright Chromium sessions, per-session action limits, idle-session cleanup, explicit session cleanup, screenshot persistence, and pending base64 vision-image retrieval.
+- Implemented `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`, `browser_screenshot`, and `browser_close`.
+- Exported `executeBrowserTool`, `closeSession`, `closeAllSessions`, and `takePendingVisionImages`.
+
+## TDD evidence
+
+The integration test was created before implementation. Its first run failed as expected because `executeBrowserTool` was not defined. The fixture server remained open when its cleanup then reached the also-missing `closeSession`, so the failed test process was stopped after the failure was observed. After implementation, the complete browser test suite passed.
+
+## Verification
+
+Command:
+
+```powershell
+node --test tests/browser-tools-guards.test.js tests/browser-tools-integration.test.js
+```
+
+Result: 8 passed, 0 failed, 0 skipped.
+
+Full suite command:
+
+```powershell
+node --test tests/*.test.js
+```
+
+Result: 22 passed, 0 failed, 0 skipped.
+
+## Notes
+
+- Navigation uses `await new Promise((resolve) => setTimeout(resolve, 250))`, not deprecated `page.waitForTimeout`.
+- The requested `npm test` script (`node --test tests/`) fails under the installed Node.js 25.6.0 because that version treats the directory as a module path. Explicit test-file invocation succeeds; the script was retained verbatim per the task brief.
+- `npm install` reported 33 existing dependency-audit vulnerabilities (2 low, 16 moderate, 12 high, 3 critical); this task did not remediate unrelated dependency findings.
+
+## Review-follow-up fixes
+
+- Added a context-level Playwright request guard when private-network blocking is enabled. It rejects private/local destinations for navigations (including redirects) and subresource requests; service workers are blocked in this mode so their requests cannot bypass routing.
+- `browser_navigate` now returns a clear `Error: Navigation blocked: ΓÇª` result when a routed navigation is rejected instead of reporting a blank page as successful.
+- Extended integration coverage for typing, screenshots saved to disk, pending base64 vision image retrieval and clearing, action limits, close/no-session handling, and string-form tool errors.
+- Raised the package and lockfile Node engine requirement to `>=20`.
+
+## Review-follow-up test evidence
+
+Command:
+
+```powershell
+node --test tests/browser-tools-guards.test.js tests/browser-tools-integration.test.js
+```
+
+Result: 8 passed, 0 failed, 2 skipped. The two Playwright integration tests skipped because the Chromium runtime is not installed in this environment; the private-request guard unit test passed.
+
+## Private-network DNS and IPv6 follow-up
+
+- Classified IPv6 site-local `fec0::/10` (including `fec0::1`) and unspecified `::` as private/local destinations.
+- Added `assertAllowedUrlResolved`, which performs normal URL validation and resolves hostname navigations with `dns.promises.lookup(..., { all: true, verbatim: true })`; it rejects the navigation when any answer is private/local.
+- `browser_navigate` now performs this DNS check before opening a Playwright session or calling `goto`. DNS lookup failures return a clear `URL host lookup failed` error.
+- The Playwright route guard continues to block literal private IP URLs for navigations and subresources. It deliberately does not resolve every subresource because synchronous routing-time DNS checks would stall page loading.
+- Added guard tests for deprecated IPv6 site-local addresses and hostname resolution that includes a private answer.
+
+## Private-network DNS verification
+
+Command:
+
+```powershell
+node --test tests/browser-tools-guards.test.js tests/browser-tools-integration.test.js
+```
+
+Result: 10 passed, 0 failed, 2 skipped. The two Playwright integration tests were skipped because Chromium is not installed in this environment.
+
+## SSRF route resolution follow-up
+
+- Updated the Playwright context route handler to await `assertAllowedUrlResolved` for every routed navigation and subresource request while private-network blocking is enabled.
+- A hostname that passes the literal hostname check but resolves to a private or local address is now aborted with `blockedbyclient`, including redirect destinations.
+- No DNS-result cache was added: the route guard resolves each request immediately before it is continued, avoiding a cache window that could weaken DNS-rebinding protection.
+- Extended the route-guard unit test with a controlled resolver: `redirected-private.test` resolves to `127.0.0.1`, and the test verifies the route is aborted rather than continued.
+
+## SSRF route resolution verification
+
+The new regression test was run before the implementation and failed as intended: the route handler continued `https://redirected-private.test/landing` despite its private resolver answer.
+
+Command:
+
+```powershell
+node --test tests/browser-tools-guards.test.js tests/browser-tools-integration.test.js
+```
+
+Result after the fix: 12 passed, 0 failed, 0 skipped. Chromium was installed with `npx playwright install chromium`; the local loopback fixture continues to work with `blockPrivateNetworks: false`.
diff --git a/lib/browserTools.js b/lib/browserTools.js
index b6cc1a8..615ad1a 100644
--- a/lib/browserTools.js
+++ b/lib/browserTools.js
@@ -1,14 +1,16 @@
 'use strict';
 
 const path = require('path');
 const fs = require('fs');
+const dns = require('dns');
+const net = require('net');
 const { getConfig } = require('./config.js');
 const { DATA_DIR } = require('./personality.js');
 const logger = require('./logger.js');
 
 const BROWSER_TOOL_NAMES = [
   'browser_navigate',
   'browser_snapshot',
   'browser_click',
   'browser_type',
   'browser_screenshot',
@@ -69,26 +71,27 @@ function ipv4FromMappedIpv6(hostname) {
 }
 
 function isPrivateHostnameOrIp(hostname) {
   const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
   if (!h) return true;
   if (h === 'localhost' || h === '0.0.0.0' || h.endsWith('.localhost')) return true;
   // IPv4
   const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
   if (m) return isPrivateIpv4Octets(+m[1], +m[2]);
   if (h.includes(':')) {
-    if (h === '::1') return true;
+    if (h === '::' || h === '::1') return true;
     if (h.startsWith('fc') || h.startsWith('fd')) return true; // ULA fc00::/7
     const firstHextet = h.split(':')[0];
     if (firstHextet && /^[0-9a-f]{1,4}$/.test(firstHextet)) {
       const n = parseInt(firstHextet, 16);
       if (n >= 0xfe80 && n <= 0xfebf) return true; // fe80::/10 link-local
+      if (n >= 0xfec0 && n <= 0xfeff) return true; // fec0::/10 site-local (deprecated)
     }
     const mappedIpv4 = ipv4FromMappedIpv6(h);
     if (mappedIpv4) {
       const pm = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(mappedIpv4);
       if (pm) return isPrivateIpv4Octets(+pm[1], +pm[2]);
     }
   }
   return false;
 }
 
@@ -102,20 +105,42 @@ function assertAllowedUrl(urlString, opts = {}) {
   }
   const block = opts.blockPrivateNetworks !== undefined
     ? !!opts.blockPrivateNetworks
     : getBrowserConfig().blockPrivateNetworks !== false;
   if (block && isPrivateHostnameOrIp(u.hostname)) {
     throw new Error('URL blocked: private/local network addresses are not allowed');
   }
   return u;
 }
 
+async function assertAllowedUrlResolved(urlString, opts = {}) {
+  const u = assertAllowedUrl(urlString, opts);
+  const block = opts.blockPrivateNetworks !== undefined
+    ? !!opts.blockPrivateNetworks
+    : getBrowserConfig().blockPrivateNetworks !== false;
+  const hostname = u.hostname.replace(/^\[|\]$/g, '');
+  if (!block || net.isIP(hostname)) return u;
+
+  let addresses;
+  try {
+    const lookup = opts.lookup || dns.promises.lookup;
+    addresses = await lookup(hostname, { all: true, verbatim: true });
+  } catch (err) {
+    const reason = err && (err.code || err.message) ? (err.code || err.message) : 'unknown error';
+    throw new Error(`URL host lookup failed for ${hostname}: ${reason}`);
+  }
+  if (addresses.some((entry) => isPrivateHostnameOrIp(entry.address))) {
+    throw new Error('URL blocked: hostname resolves to a private/local network address');
+  }
+  return u;
+}
+
 function truncateText(text, maxChars) {
   const max = maxChars != null ? maxChars : getBrowserConfig().maxTextChars;
   const s = text == null ? '' : String(text);
   return s.length > max ? s.slice(0, max) : s;
 }
 
 function handles(name) {
   return TOOL_NAME_SET.has(name);
 }
 
@@ -191,26 +216,236 @@ function getBrowserToolDefinitions() {
       type: 'function',
       function: {
         name: 'browser_close',
         description: 'Close this chat\'s browser session and free resources.',
         parameters: { type: 'object', properties: {} }
       }
     }
   ];
 }
 
-// Placeholders filled in Task 2:
-// async function executeBrowserTool(name, args, ctx) { ... }
-// async function closeSession(sessionId) { ... }
-// function takePendingVisionImages(sessionId) { ... }
+const sessions = new Map(); // sessionId -> { browser, context, page, lastUsedAt, actionCount, pendingImages }
+let idleTimer = null;
+
+function safeId(id) {
+  return String(id || 'unknown').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
+}
+
+function screenshotsDir(sessionId) {
+  const dir = path.join(DATA_DIR, 'browser-screenshots', safeId(sessionId));
+  fs.mkdirSync(dir, { recursive: true });
+  return dir;
+}
+
+function takePendingVisionImages(sessionId) {
+  const s = sessions.get(String(sessionId || ''));
+  if (!s || !s.pendingImages || !s.pendingImages.length) return [];
+  const out = s.pendingImages.slice();
+  s.pendingImages = [];
+  return out;
+}
+
+async function installPrivateNetworkRequestGuard(context, blockedRequests, cfg) {
+  if (cfg.blockPrivateNetworks === false) return;
+  await context.route('**/*', async (route) => {
+    const request = route.request();
+    try {
+      await assertAllowedUrlResolved(request.url(), {
+        blockPrivateNetworks: true,
+        lookup: cfg.lookup
+      });
+      await route.continue();
+    } catch (_) {
+      blockedRequests.push({
+        url: request.url(),
+        isNavigation: request.isNavigationRequest()
+      });
+      await route.abort('blockedbyclient');
+    }
+  });
+}
+
+async function ensureSession(sessionId) {
+  const id = String(sessionId || '').trim();
+  if (!id) throw new Error('browser sessionId is required');
+  let s = sessions.get(id);
+  if (s && s.page) {
+    s.lastUsedAt = Date.now();
+    return s;
+  }
+  const cfg = getBrowserConfig();
+  let playwright;
+  try {
+    playwright = require('playwright');
+  } catch (_) {
+    throw new Error('Playwright is not installed. Run: npm install playwright && npx playwright install chromium');
+  }
+  const browser = await playwright.chromium.launch({ headless: cfg.headless !== false });
+  const context = await browser.newContext({
+    serviceWorkers: cfg.blockPrivateNetworks === false ? 'allow' : 'block'
+  });
+  const blockedRequests = [];
+  await installPrivateNetworkRequestGuard(context, blockedRequests, cfg);
+  const page = await context.newPage();
+  page.setDefaultTimeout(cfg.actionTimeoutMs || 30000);
+  s = {
+    browser,
+    context,
+    page,
+    lastUsedAt: Date.now(),
+    actionCount: 0,
+    pendingImages: [],
+    blockedRequests
+  };
+  sessions.set(id, s);
+  ensureIdleSweeper();
+  return s;
+}
+
+async function closeSession(sessionId) {
+  const id = String(sessionId || '');
+  const s = sessions.get(id);
+  if (!s) return;
+  sessions.delete(id);
+  try { await s.context.close(); } catch (_) {}
+  try { await s.browser.close(); } catch (_) {}
+}
+
+async function closeAllSessions() {
+  for (const id of [...sessions.keys()]) await closeSession(id);
+}
+
+function bumpAction(s) {
+  const cfg = getBrowserConfig();
+  s.actionCount = (s.actionCount || 0) + 1;
+  s.lastUsedAt = Date.now();
+  if (s.actionCount > (cfg.maxActionsPerSession || 40)) {
+    throw new Error('Browser action limit reached for this session. Call browser_close and start again.');
+  }
+}
+
+async function saveScreenshot(sessionId, page) {
+  const file = path.join(screenshotsDir(sessionId), `${Date.now()}.png`);
+  const buf = await page.screenshot({ type: 'png', fullPage: false });
+  fs.writeFileSync(file, buf);
+  const b64 = buf.toString('base64');
+  const s = sessions.get(String(sessionId));
+  if (s) {
+    s.pendingImages = s.pendingImages || [];
+    s.pendingImages.push(b64);
+  }
+  return { file, relative: path.relative(path.join(__dirname, '..'), file) };
+}
+
+async function executeBrowserTool(name, args, ctx) {
+  if (!isBrowserEnabled()) return 'Error: browser tools are disabled in config.';
+  const sessionId = ctx && ctx.sessionId != null ? String(ctx.sessionId).trim() : '';
+  if (!sessionId) return 'Error: browser sessionId is required.';
+  args = args && typeof args === 'object' ? args : {};
+  try {
+    if (name === 'browser_close') {
+      await closeSession(sessionId);
+      return 'Browser session closed.';
+    }
+    if (name === 'browser_navigate') {
+      const url = args.url != null ? String(args.url).trim() : '';
+      if (!url) return 'Error: url is required.';
+      await assertAllowedUrlResolved(url);
+      const s = await ensureSession(sessionId);
+      bumpAction(s);
+      s.blockedRequests.length = 0;
+      let resp;
+      try {
+        resp = await s.page.goto(url, { waitUntil: 'domcontentloaded', timeout: getBrowserConfig().actionTimeoutMs });
+      } catch (err) {
+        const blockedNavigation = s.blockedRequests.find((request) => request.isNavigation);
+        if (blockedNavigation) {
+          throw new Error(`Navigation blocked: ${blockedNavigation.url} is a private/local network address`);
+        }
+        throw err;
+      }
+      const blockedNavigation = s.blockedRequests.find((request) => request.isNavigation);
+      if (blockedNavigation) {
+        throw new Error(`Navigation blocked: ${blockedNavigation.url} is a private/local network address`);
+      }
+      await new Promise((resolve) => setTimeout(resolve, 250));
+      const title = await s.page.title();
+      return `Navigated to ${s.page.url()}\nTitle: ${title || '(none)'}\nHTTP: ${resp ? resp.status() : 'n/a'}`;
+    }
+    const s = sessions.get(sessionId);
+    if (!s || !s.page) return 'Error: no browser session. Call browser_navigate first.';
+    if (name === 'browser_snapshot') {
+      bumpAction(s);
+      const title = await s.page.title();
+      const text = truncateText(await s.page.innerText('body').catch(() => ''));
+      let extra = '';
+      if (args.screenshot === true) {
+        const shot = await saveScreenshot(sessionId, s.page);
+        extra = `\nScreenshot: ${shot.relative}`;
+      }
+      return `Title: ${title || '(none)'}\nURL: ${s.page.url()}\n\nContent:\n${text}${extra}`;
+    }
+    if (name === 'browser_click') {
+      bumpAction(s);
+      const selector = args.selector != null ? String(args.selector).trim() : '';
+      const role = args.role != null ? String(args.role).trim() : '';
+      const accessibleName = args.name != null ? String(args.name).trim() : '';
+      if (selector) await s.page.click(selector);
+      else if (role) await s.page.getByRole(role, accessibleName ? { name: accessibleName } : undefined).click();
+      else return 'Error: provide selector or role(+name).';
+      return 'Clicked successfully.';
+    }
+    if (name === 'browser_type') {
+      bumpAction(s);
+      const selector = args.selector != null ? String(args.selector).trim() : '';
+      const text = args.text != null ? String(args.text) : '';
+      if (!selector) return 'Error: selector is required.';
+      if (args.clear !== false) await s.page.fill(selector, text);
+      else await s.page.type(selector, text);
+      if (args.submit === true) await s.page.press(selector, 'Enter');
+      return 'Typed successfully.';
+    }
+    if (name === 'browser_screenshot') {
+      bumpAction(s);
+      const shot = await saveScreenshot(sessionId, s.page);
+      return `Screenshot saved: ${shot.relative}`;
+    }
+    return `Error: unknown browser tool ${name}`;
+  } catch (err) {
+    logger.warn('browser tool error:', name, err.message);
+    const msg = String(err && err.message ? err.message : err);
+    if (/Executable doesn't exist|browserType\.launch/i.test(msg)) {
+      return 'Error: Chromium not installed. Run: npx playwright install chromium';
+    }
+    return 'Error: ' + msg;
+  }
+}
+
+function ensureIdleSweeper() {
+  if (idleTimer) return;
+  idleTimer = setInterval(() => {
+    const idle = getBrowserConfig().idleTimeoutMs || 300000;
+    const now = Date.now();
+    for (const [id, s] of sessions.entries()) {
+      if (now - (s.lastUsedAt || 0) > idle) closeSession(id).catch(() => {});
+    }
+  }, 60000);
+  if (idleTimer.unref) idleTimer.unref();
+}
 
 module.exports = {
   BROWSER_TOOL_NAMES,
   getBrowserConfig,
   setBrowserConfigOverrideForTests,
   isBrowserEnabled,
   isPrivateHostnameOrIp,
   assertAllowedUrl,
+  assertAllowedUrlResolved,
+  installPrivateNetworkRequestGuard,
   truncateText,
   handles,
-  getBrowserToolDefinitions
+  getBrowserToolDefinitions,
+  executeBrowserTool,
+  closeSession,
+  closeAllSessions,
+  takePendingVisionImages
 };
diff --git a/package-lock.json b/package-lock.json
index a9c368d..1860098 100644
--- a/package-lock.json
+++ b/package-lock.json
@@ -13,24 +13,25 @@
         "body-parser": "^1.20.2",
         "cron-parser": "^4.9.0",
         "dotenv": "^16.4.5",
         "express": "^4.21.0",
         "express-rate-limit": "^7.4.1",
         "express-session": "^1.18.0",
         "helmet": "^8.0.0",
         "marked": "^15.0.12",
         "multer": "^1.4.5-lts.1",
         "nodemailer": "^8.0.1",
+        "playwright": "^1.62.0",
         "sqlite3": "^5.1.7"
       },
       "engines": {
-        "node": ">=18"
+        "node": ">=20"
       },
       "optionalDependencies": {
         "discord.js": "^14.14.0",
         "mammoth": "^1.8.0",
         "matrix-bot-sdk": "^0.8.0",
         "node-telegram-bot-api": "^0.66.0",
         "pdf-parse": "^1.1.1",
         "word-extractor": "^1.0.4"
       }
     },
@@ -2742,20 +2743,34 @@
         "node": ">= 8"
       }
     },
     "node_modules/fs.realpath": {
       "version": "1.0.0",
       "resolved": "https://registry.npmjs.org/fs.realpath/-/fs.realpath-1.0.0.tgz",
       "integrity": "sha512-OO0pH2lK6a0hZnAdau5ItzHPI6pUlvI7jMVnxUQRtw4owF2wk8lOSabtGDCTP4Ggrg2MbGnWO9X8K1t4+fGMDw==",
       "license": "ISC",
       "optional": true
     },
+    "node_modules/fsevents": {
+      "version": "2.3.2",
+      "resolved": "https://registry.npmjs.org/fsevents/-/fsevents-2.3.2.tgz",
+      "integrity": "sha512-xiqMQR4xAeHTuB9uWm+fFRcIOgKBMiOBP+eXiyT7jsgVCq1bkVygt00oASowB7EdtpOHaaPgKt812P9ab+DDKA==",
+      "hasInstallScript": true,
+      "license": "MIT",
+      "optional": true,
+      "os": [
+        "darwin"
+      ],
+      "engines": {
+        "node": "^8.16.0 || ^10.6.0 || >=11.0.0"
+      }
+    },
     "node_modules/function-bind": {
       "version": "1.1.2",
       "resolved": "https://registry.npmjs.org/function-bind/-/function-bind-1.1.2.tgz",
       "integrity": "sha512-7XHNxH7qX9xG5mIwxkhumTox/MIRNcOgDrxWsMt2pAr23WHp6MrRlN7FBSFpCpr+oVO0F744iUgR82nJMfG2SA==",
       "license": "MIT",
       "funding": {
         "url": "https://github.com/sponsors/ljharb"
       }
     },
     "node_modules/function.prototype.name": {
@@ -4917,20 +4932,50 @@
     "node_modules/pify": {
       "version": "3.0.0",
       "resolved": "https://registry.npmjs.org/pify/-/pify-3.0.0.tgz",
       "integrity": "sha512-C3FsVNH1udSEX48gGX1xfvwTWfsYWj5U+8/uK15BGzIGrKoUpghX8hWZwa/OFnakBiiVNmBvemTJR5mcy7iPcg==",
       "license": "MIT",
       "optional": true,
       "engines": {
         "node": ">=4"
       }
     },
+    "node_modules/playwright": {
+      "version": "1.62.0",
+      "resolved": "https://registry.npmjs.org/playwright/-/playwright-1.62.0.tgz",
+      "integrity": "sha512-Z14dG305dgaLu6foB1TXQagFiW8JfSUIUaUuPaKQ6NtBPKF1P/qXcqfh6c6K/icPqdy37JmjbiBXf6JNg6Sylw==",
+      "license": "Apache-2.0",
+      "dependencies": {
+        "playwright-core": "1.62.0"
+      },
+      "bin": {
+        "playwright": "cli.js"
+      },
+      "engines": {
+        "node": ">=20"
+      },
+      "optionalDependencies": {
+        "fsevents": "2.3.2"
+      }
+    },
+    "node_modules/playwright-core": {
+      "version": "1.62.0",
+      "resolved": "https://registry.npmjs.org/playwright-core/-/playwright-core-1.62.0.tgz",
+      "integrity": "sha512-nsNRyq0r2zsG8AcRHWknc9QRA5XCueC7gWMrs+Gx2tlZn9hcl8zudfh00lhJPY1DE7NmZ6bDsT9g2yey8mXljA==",
+      "license": "Apache-2.0",
+      "bin": {
+        "playwright-core": "cli.js"
+      },
+      "engines": {
+        "node": ">=20"
+      }
+    },
     "node_modules/possible-typed-array-names": {
       "version": "1.1.0",
       "resolved": "https://registry.npmjs.org/possible-typed-array-names/-/possible-typed-array-names-1.1.0.tgz",
       "integrity": "sha512-/+5VFTchJDoVj3bhoqi6UeymcD00DAwb1nJwamzPvHEszJ4FpF6SNNbUbOS8yI56qHzdV8eK0qEfOSiodkTdxg==",
       "license": "MIT",
       "optional": true,
       "engines": {
         "node": ">= 0.4"
       }
     },
diff --git a/package.json b/package.json
index dd0e4a3..27af395 100644
--- a/package.json
+++ b/package.json
@@ -1,37 +1,39 @@
 {
   "name": "shadow-ai",
   "version": "1.0.0",
   "description": "Web-based AI assistant with Ollama, Matrix-style UI, code execution and self-update",
   "main": "server.js",
   "scripts": {
     "start": "node server.js",
     "dev": "node server.js",
     "cli": "node scripts/cli.js",
-    "repair:project-memory": "node scripts/repair-project-memories.js"
+    "repair:project-memory": "node scripts/repair-project-memories.js",
+    "test": "node --test tests/"
   },
   "engines": {
-    "node": ">=18"
+    "node": ">=20"
   },
   "dependencies": {
     "archiver": "^7.0.1",
     "bcryptjs": "^2.4.3",
     "body-parser": "^1.20.2",
     "cron-parser": "^4.9.0",
     "dotenv": "^16.4.5",
     "express": "^4.21.0",
     "express-rate-limit": "^7.4.1",
     "express-session": "^1.18.0",
     "helmet": "^8.0.0",
     "marked": "^15.0.12",
     "multer": "^1.4.5-lts.1",
     "nodemailer": "^8.0.1",
+    "playwright": "^1.62.0",
     "sqlite3": "^5.1.7"
   },
   "optionalDependencies": {
     "discord.js": "^14.14.0",
     "mammoth": "^1.8.0",
     "matrix-bot-sdk": "^0.8.0",
     "node-telegram-bot-api": "^0.66.0",
     "pdf-parse": "^1.1.1",
     "word-extractor": "^1.0.4"
   }
diff --git a/tests/browser-tools-guards.test.js b/tests/browser-tools-guards.test.js
index 7715084..d6b10db 100644
--- a/tests/browser-tools-guards.test.js
+++ b/tests/browser-tools-guards.test.js
@@ -1,70 +1,170 @@
 'use strict';
 
 const test = require('node:test');
 const assert = require('node:assert/strict');
 
 const {
   getBrowserConfig,
   setBrowserConfigOverrideForTests,
   isPrivateHostnameOrIp,
   assertAllowedUrl,
+  assertAllowedUrlResolved,
+  installPrivateNetworkRequestGuard,
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
 
-test('isPrivateHostnameOrIp blocks fe80::/10 link-local and IPv4-mapped private', () => {
+test('isPrivateHostnameOrIp blocks local IPv6 ranges and IPv4-mapped private', () => {
   assert.equal(isPrivateHostnameOrIp('fe80::1'), true);
   assert.equal(isPrivateHostnameOrIp('fe90::1'), true);
+  assert.equal(isPrivateHostnameOrIp('fec0::1'), true);
   assert.equal(isPrivateHostnameOrIp('::ffff:127.0.0.1'), true);
   assert.equal(isPrivateHostnameOrIp('::ffff:10.1.2.3'), true);
   assert.equal(isPrivateHostnameOrIp('::ffff:7f00:1'), true);
   assert.equal(isPrivateHostnameOrIp('::ffff:a01:203'), true);
   assert.equal(isPrivateHostnameOrIp('[::ffff:7f00:1]'), true);
   assert.equal(isPrivateHostnameOrIp('2001:db8::1'), false);
   assert.equal(isPrivateHostnameOrIp('example.com'), false);
 });
 
 test('assertAllowedUrl blocks IPv4-mapped IPv6 private addresses', () => {
   assert.throws(
     () => assertAllowedUrl('http://[::ffff:127.0.0.1]/', { blockPrivateNetworks: true }),
     /private|blocked|local/i
   );
   assert.throws(
     () => assertAllowedUrl('http://[::ffff:10.1.2.3]/', { blockPrivateNetworks: true }),
     /private|blocked|local/i
   );
 });
 
+test('assertAllowedUrlResolved rejects hostnames resolving to private addresses', async () => {
+  await assert.rejects(
+    () => assertAllowedUrlResolved('https://example.com/', {
+      blockPrivateNetworks: true,
+      lookup: async (hostname, options) => {
+        assert.equal(hostname, 'example.com');
+        assert.deepEqual(options, { all: true, verbatim: true });
+        return [{ address: '203.0.113.10', family: 4 }, { address: 'fec0::1', family: 6 }];
+      }
+    }),
+    /private|blocked|local/i
+  );
+});
+
+test('assertAllowedUrlResolved permits hostnames resolving to public addresses', async () => {
+  const u = await assertAllowedUrlResolved('https://example.com/', {
+    blockPrivateNetworks: true,
+    lookup: async () => [{ address: '203.0.113.10', family: 4 }]
+  });
+  assert.equal(u.hostname, 'example.com');
+});
+
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
 
+test('request guard resolves hostnames and aborts private navigation and subresources', async () => {
+  let routeHandler;
+  const context = {
+    route: async (pattern, handler) => {
+      assert.equal(pattern, '**/*');
+      routeHandler = handler;
+    }
+  };
+  const blockedRequests = [];
+  await installPrivateNetworkRequestGuard(context, blockedRequests, {
+    blockPrivateNetworks: true,
+    lookup: async (hostname) => {
+      if (hostname === 'redirected-private.test') {
+        return [{ address: '127.0.0.1', family: 4 }];
+      }
+      return [{ address: '203.0.113.10', family: 4 }];
+    }
+  });
+
+  const navigationRoute = {
+    request: () => ({
+      url: () => 'http://127.0.0.1/private',
+      isNavigationRequest: () => true
+    }),
+    abort: async (reason) => assert.equal(reason, 'blockedbyclient')
+  };
+  await routeHandler(navigationRoute);
+  assert.deepEqual(blockedRequests, [{
+    url: 'http://127.0.0.1/private',
+    isNavigation: true
+  }]);
+
+  await routeHandler({
+    request: () => ({
+      url: () => 'http://192.168.1.10/script.js',
+      isNavigationRequest: () => false
+    }),
+    abort: async (reason) => assert.equal(reason, 'blockedbyclient')
+  });
+  assert.deepEqual(blockedRequests[1], {
+    url: 'http://192.168.1.10/script.js',
+    isNavigation: false
+  });
+
+  let redirectedPrivateContinued = false;
+  let redirectedPrivateAborted = false;
+  await routeHandler({
+    request: () => ({
+      url: () => 'https://redirected-private.test/landing',
+      isNavigationRequest: () => true
+    }),
+    continue: async () => { redirectedPrivateContinued = true; },
+    abort: async (reason) => {
+      redirectedPrivateAborted = true;
+      assert.equal(reason, 'blockedbyclient');
+    }
+  });
+  assert.equal(redirectedPrivateContinued, false);
+  assert.equal(redirectedPrivateAborted, true);
+  assert.deepEqual(blockedRequests[2], {
+    url: 'https://redirected-private.test/landing',
+    isNavigation: true
+  });
+
+  let continued = false;
+  await routeHandler({
+    request: () => ({
+      url: () => 'https://example.com/script.js',
+      isNavigationRequest: () => false
+    }),
+    continue: async () => { continued = true; }
+  });
+  assert.equal(continued, true);
+});
+
 test('truncateText respects max', () => {
   assert.equal(truncateText('abcdef', 3), 'abc');
 });
 
 test('getBrowserToolDefinitions respects enabled flag via setBrowserConfigOverrideForTests', () => {
   assert.ok(Array.isArray(BROWSER_TOOL_NAMES));
   assert.equal(BROWSER_TOOL_NAMES.length, 6);
   for (const n of BROWSER_TOOL_NAMES) assert.equal(handles(n), true);
   assert.equal(handles('fetch_url'), false);
 
diff --git a/tests/browser-tools-integration.test.js b/tests/browser-tools-integration.test.js
new file mode 100644
index 0000000..16212f6
--- /dev/null
+++ b/tests/browser-tools-integration.test.js
@@ -0,0 +1,109 @@
+'use strict';
+
+const test = require('node:test');
+const assert = require('node:assert/strict');
+const http = require('http');
+const fs = require('fs');
+const path = require('path');
+const browserTools = require('../lib/browserTools.js');
+
+async function chromiumAvailable() {
+  try {
+    const { chromium } = require('playwright');
+    const b = await chromium.launch({ headless: true });
+    await b.close();
+    return true;
+  } catch (_) {
+    return false;
+  }
+}
+
+test('navigate + snapshot against local fixture', async (t) => {
+  if (!(await chromiumAvailable())) {
+    t.skip('Chromium not installed');
+    return;
+  }
+  browserTools.setBrowserConfigOverrideForTests({
+    enabled: true,
+    headless: true,
+    blockPrivateNetworks: false,
+    actionTimeoutMs: 15000,
+    maxActionsPerSession: 20
+  });
+  const html = '<!doctype html><html><head><title>ShadowAI Fixture</title></head><body><h1 id="hi">Hello Browser</h1><input id="field" value="" oninput="document.querySelector(\'#value\').textContent = this.value"><p id="value"></p><button id="btn">Go</button></body></html>';
+  const server = http.createServer((req, res) => {
+    res.writeHead(200, { 'Content-Type': 'text/html' });
+    res.end(html);
+  });
+  await new Promise((r) => server.listen(0, '127.0.0.1', r));
+  const { port } = server.address();
+  const sessionId = 'test-session-1';
+  try {
+    const nav = await browserTools.executeBrowserTool('browser_navigate', {
+      url: `http://127.0.0.1:${port}/`
+    }, { sessionId });
+    assert.match(nav, /ShadowAI Fixture|127\.0\.0\.1/i);
+    const snap = await browserTools.executeBrowserTool('browser_snapshot', {}, { sessionId });
+    assert.match(snap, /Hello Browser/);
+    const click = await browserTools.executeBrowserTool('browser_click', { selector: '#btn' }, { sessionId });
+    assert.match(click, /click/i);
+    const typed = await browserTools.executeBrowserTool('browser_type', {
+      selector: '#field',
+      text: 'ShadowAI'
+    }, { sessionId });
+    assert.match(typed, /typed/i);
+    const fieldValue = await browserTools.executeBrowserTool('browser_snapshot', {}, { sessionId });
+    assert.match(fieldValue, /ShadowAI/);
+    const screenshot = await browserTools.executeBrowserTool('browser_screenshot', {}, { sessionId });
+    assert.match(screenshot, /Screenshot saved: data[\\/]browser-screenshots/i);
+    const screenshotPath = screenshot.replace(/^Screenshot saved: /, '');
+    assert.equal(fs.existsSync(path.resolve(__dirname, '..', screenshotPath)), true);
+    const images = browserTools.takePendingVisionImages(sessionId);
+    assert.equal(images.length, 1);
+    assert.match(images[0], /^[A-Za-z0-9+/]+={0,2}$/);
+    assert.deepEqual(browserTools.takePendingVisionImages(sessionId), []);
+    const badClick = await browserTools.executeBrowserTool('browser_click', { selector: '#missing' }, { sessionId });
+    assert.match(badClick, /^Error:/);
+  } finally {
+    await browserTools.closeSession(sessionId);
+    browserTools.setBrowserConfigOverrideForTests(null);
+    await new Promise((r) => server.close(r));
+  }
+});
+
+test('close removes session and action limit returns an error', async (t) => {
+  if (!(await chromiumAvailable())) {
+    t.skip('Chromium not installed');
+    return;
+  }
+  browserTools.setBrowserConfigOverrideForTests({
+    enabled: true,
+    headless: true,
+    blockPrivateNetworks: false,
+    actionTimeoutMs: 15000,
+    maxActionsPerSession: 1
+  });
+  const server = http.createServer((req, res) => {
+    res.writeHead(200, { 'Content-Type': 'text/html' });
+    res.end('<!doctype html><title>Fixture</title><p>Fixture</p>');
+  });
+  await new Promise((r) => server.listen(0, '127.0.0.1', r));
+  const { port } = server.address();
+  const sessionId = 'test-session-limit';
+  try {
+    const nav = await browserTools.executeBrowserTool('browser_navigate', {
+      url: `http://127.0.0.1:${port}/`
+    }, { sessionId });
+    assert.doesNotMatch(nav, /^Error:/);
+    const limit = await browserTools.executeBrowserTool('browser_snapshot', {}, { sessionId });
+    assert.match(limit, /^Error:.*action limit/i);
+    const closed = await browserTools.executeBrowserTool('browser_close', {}, { sessionId });
+    assert.match(closed, /closed/i);
+    const noSession = await browserTools.executeBrowserTool('browser_snapshot', {}, { sessionId });
+    assert.match(noSession, /^Error: no browser session/i);
+  } finally {
+    await browserTools.closeSession(sessionId);
+    browserTools.setBrowserConfigOverrideForTests(null);
+    await new Promise((r) => server.close(r));
+  }
+});

