# Final Review Package — Playwright Browser Tools
BASE: f9378a5898a560a7aefb1e3d057aedf4f60cb8da
HEAD: f093162b826eb6ed82f857d22f26300289213a3d

## Progress ledger minors / residual risks
- Task 2 accepted residual: DNS rebinding TOCTOU needs proxy/pinning (beyond plan v1)
- Task 3 Minor: screenshot+close same batch may drop vision queue
- Task 4 note: images cleared before resumed LLM succeeds (transient LLM fail could lose them)

## Commits
f093162 Expose browser settings in config API.
ea29a17 Add browser config UI and documentation.
1caaa2e Fix approval-resume browser vision images
59f15f7 Fix vision handling in approval and vLLM
c1accd7 Wire browser tools into autonomous agent with approval tiers.
91390cc Wire browser tools into web chat and channel runner.
39853ff Harden resolved browser request guards.
baa3559 Harden browser navigation network guards
76003fd Harden Playwright browser request blocking
366464c Implement Playwright browser sessions and tool actions.
82aca35 Harden IPv4-mapped IPv6 private URL blocking.
e908740 Fix IPv6 and IPv4-mapped private URL blocking.
0f3b7d1 Add browser tool config, URL guards, and tool definitions.


## Stat
 .gitignore                              |   1 +
 .superpowers/sdd/task-2-report.md       |  92 +++++++
 .superpowers/sdd/task-4-report.md       |  58 ++++
 README.md                               |   7 +
 ROADMAP.md                              |   6 +-
 config.default.json                     |   9 +
 lib/agentRunner.js                      |  85 +++++-
 lib/browserTools.js                     | 451 ++++++++++++++++++++++++++++++++
 lib/chatRunner.js                       |  18 +-
 lib/config.js                           |   3 +
 lib/vllm.js                             |  16 +-
 package-lock.json                       |  47 +++-
 package.json                            |   6 +-
 public/config.html                      |  25 ++
 public/config.js                        |  17 ++
 server.js                               |  17 ++
 tests/browser-chat-wiring.test.js       |  38 +++
 tests/browser-tools-guards.test.js      | 180 +++++++++++++
 tests/browser-tools-integration.test.js | 109 ++++++++
 tests/task-4-vision.test.js             |  94 +++++++
 20 files changed, 1264 insertions(+), 15 deletions(-)


## Diff
diff --git a/.gitignore b/.gitignore
index 0bfa3de..154c082 100644
--- a/.gitignore
+++ b/.gitignore
@@ -5,10 +5,11 @@ data/chats/
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
diff --git a/.superpowers/sdd/task-4-report.md b/.superpowers/sdd/task-4-report.md
new file mode 100644
index 0000000..88b4cf1
--- /dev/null
+++ b/.superpowers/sdd/task-4-report.md
@@ -0,0 +1,58 @@
+# Task 4 Report: Autonomous browser tools and session cleanup
+
+## Completed
+
+- Added browser tool definitions to the autonomous agent tool set.
+- Classified navigation, snapshots, and screenshots as low risk; clicks, typing, and closing require approval.
+- Routed browser tool execution through `browserTools` with `task.id` as the session ID, including approval-resume execution.
+- Passed pending browser screenshots back to the agent after each tool round as vision images.
+- Closed task browser sessions when tasks reach complete, failed, or terminal blocked states.
+
+## Verification
+
+```powershell
+node --test tests/agent-runner-signals.test.js tests/browser-tools-guards.test.js
+```
+
+Result: 13 passed, 0 failed, 0 skipped.
+
+## Commit
+
+`c1accd7` ΓÇö Wire browser tools into autonomous agent with approval tiers.
+
+## Concerns
+
+- No agent-runner integration test exists for this new wiring; the requested existing signal and browser guard tests pass.
+
+## Review Follow-up
+
+- Drained pending browser vision images before the high-risk approval return, using the same user-message shape as completed tool rounds.
+- Kept terminal browser-session cleanup unchanged; approval flow still resumes through the existing task lifecycle.
+- Updated vLLM OpenAI-compatible message conversion to preserve image-bearing messages as multimodal text and `image_url` content parts. Messages without images retain string content.
+
+## Follow-up Verification
+
+```powershell
+node --test tests/task-4-vision.test.js
+node --test tests/agent-runner-signals.test.js tests/browser-tools-guards.test.js
+```
+
+Result: 3 new vision serialization tests passed; requested regression suite passed 13 tests with 0 failures.
+
+## Important finding fix: approval-safe vision images
+
+Screenshots captured by browser tools immediately before a high-risk tool request are now persisted in `task.pendingVisionImages` before the task transitions to `awaiting_approval`.
+
+The runner deliberately persists rather than retaining the images in the browser session: sessions can be closed by the idle sweeper while approval is pending. On the next `executeStep` after approval or rejection, the runner adds the persisted screenshots as a multimodal user message before the next LLM call, clears `pendingVisionImages`, and persists that clear operation.
+
+## Regression coverage
+
+`tests/task-4-vision.test.js` now proves that screenshots drained before approval are saved through `agentStore.updateTask`, then injected into the next LLM message and cleared through another persisted update.
+
+## Verification
+
+```powershell
+node --test tests/agent-runner-signals.test.js tests/browser-tools-guards.test.js tests/task-4-vision.test.js
+```
+
+Result: 17 passed, 0 failed, 0 skipped.
diff --git a/README.md b/README.md
index d27a0ae..3785fe5 100644
--- a/README.md
+++ b/README.md
@@ -18,10 +18,11 @@ For ideas on extending ShadowAI (multi-channel messaging, voice, calendar, smart
 - **Skills/plugins** ΓÇö Ask the AI to build a skill; it creates `skills/<id>/skill.json` + `run.js`. Enable/disable and run from **SKILLS** with no server reload. Run in chat: `/skill <id> [JSON args]`
 - **Heartbeat scheduler** ΓÇö Cron-style jobs that run skills or prompts every X minutes/hours/days; jobs remember `lastRunAt` so missed runs while offline are caught up once on restart, and skill results can optionally be emailed.
 - **Projects** ΓÇö Isolated project-specific chats. Each project has its own memory (markdown); you can add notes, paste text, or import PDFs and images (PDF text extraction and image description via Ollama vision). The AI answers only from that projectΓÇÖs context and is not aware of other projects.
 - **Project email reports** ΓÇö Configure multiple named reports under PROJECTS (Email reports): choose projects, schedule (cron), recipient email, and a custom formatting prompt. Reports are run by the heartbeat scheduler, respect your configured timezone, and send a single combined email per report.
 - **Knowledge index (RAG)** ΓÇö BuiltΓÇæin retrieval-augmented generation using Ollama embeddings and a local vector index in `data/vectors`. Upload PDFs/TXT/MD/DOC/DOCX or index project memory, then query via the KNOWLEDGE page, `/rag <query>`, or `#rag` in chat.
+- **Browser tools** ΓÇö Playwright Chromium tools (`browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`, `browser_screenshot`, `browser_close`) for JS-rendered pages and interactive flows. Enabled by default; configure under Config ΓåÆ Browser.
 - **UI customization** ΓÇö Change the application name, toggle toolΓÇæcall blocks and the prompt library button, and upload an AI avatar/profile picture used as the assistantΓÇÖs chat avatar.
 - **Mobile-friendly UI** ΓÇö Chat, Projects, and other main pages include responsive layouts so the interface remains usable on phones and tablets.
 - **Multi-user & roles** ΓÇö SQLite-backed users (`data/users.db`) with `admin`, `user`, and `guest` roles. Each user has isolated chats and projects. Admins manage all users and global config from **SYSTEM ΓåÆ USERS**.
 - **Project access control** ΓÇö Projects can be shared with other users at three levels: **Admin** (full control), **User** (chat + edit memory), or **Read-only** (chat only). Access is enforced server-side on every request. Non-admins see only their own projects and those explicitly shared with them.
 
@@ -35,10 +36,16 @@ For ideas on extending ShadowAI (multi-channel messaging, voice, calendar, smart
 ```bash
 npm install
 npm start
 ```
 
+After `npm install`, install Chromium once:
+
+```bash
+npx playwright install chromium
+```
+
 Open **http://localhost:9090** (or the host/port you set). Log in with `admin` / `admin`, then go to **CONFIG** to set your Ollama URL and models.
 
 ## Docker
 
 Requires [Docker](https://docs.docker.com/get-docker/) and an Ollama instance (on the host or elsewhere).
diff --git a/ROADMAP.md b/ROADMAP.md
index 6945ba1..2c41706 100644
--- a/ROADMAP.md
+++ b/ROADMAP.md
@@ -76,14 +76,12 @@ Check schedule, create events, reminders (Google/Apple Calendar).
 
 ### 6. **Browser control / web automation** (high impact, high effort)
 
 Control Chrome (or headless browser) for scraping and automation.
 
-- **Puppeteer/Playwright** ΓÇö Run headless browser in a container or on the host; tools: `navigate(url)`, `click(selector)`, `type(selector, text)`, `screenshot()`, `get_content()`. Needs careful sandboxing and timeouts.
-- **MCP (Model Context Protocol)** ΓÇö Add an MCP server that wraps Playwright (or other tools) so ShadowAI can expose ΓÇ£browserΓÇ¥ as an MCP tool and keep the rest of the stack unchanged.
-
-*Suggested order:* Start with a single ΓÇ£screenshot + contentΓÇ¥ tool (navigate, wait, return HTML + PNG) before full control.
+- **Built-in Playwright tools (implemented)** ΓÇö ShadowAI ships with Playwright Chromium tools: `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`, `browser_screenshot`, and `browser_close`. Per-chat sessions with idle cleanup, private-network blocking, and configurable timeouts. Enable/disable under Config ΓåÆ Browser.
+- **MCP (Model Context Protocol)** ΓÇö Add an MCP server that wraps Playwright (or other tools) so ShadowAI can expose ΓÇ£browserΓÇ¥ as an MCP tool and keep the rest of the stack unchanged. Future work.
 
 ---
 
 ### 7. **Document processing** (medium impact, medium effort)
 
diff --git a/config.default.json b/config.default.json
index c39fee8..af9e12e 100644
--- a/config.default.json
+++ b/config.default.json
@@ -39,10 +39,19 @@
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
diff --git a/lib/agentRunner.js b/lib/agentRunner.js
index 813776d..aacc9a3 100644
--- a/lib/agentRunner.js
+++ b/lib/agentRunner.js
@@ -10,15 +10,22 @@ const emailLib = require('./email.js');
 const structuredMemory = require('./structuredMemory.js');
 const personalityLib = require('./personality.js');
 const { executeSchedulerTool } = require('./toolHandlers.js');
 const logger = require('./logger.js');
 const { getRole } = require('./commandCenter/roles.js');
+const browserTools = require('./browserTools.js');
 
 // Tool names that require user approval before execution
-const BASE_HIGH_RISK = new Set(['send_email', 'create_skill', 'set_memory', 'append_memory']);
+const BASE_HIGH_RISK = new Set([
+  'send_email', 'create_skill', 'set_memory', 'append_memory',
+  'browser_click', 'browser_type', 'browser_close'
+]);
 // Low-risk tools run without approval
-const LOW_RISK = new Set(['web_search', 'fetch_url', 'get_memory']);
+const LOW_RISK = new Set([
+  'web_search', 'fetch_url', 'get_memory',
+  'browser_navigate', 'browser_snapshot', 'browser_screenshot'
+]);
 
 let intervalId = null;
 const inFlight = new Set(); // task IDs currently being processed
 let runnerPaused = false;
 
@@ -72,10 +79,11 @@ function buildToolDefinitions() {
       name: 'fetch_url',
       description: 'Fetch the text content of a webpage.',
       parameters: { type: 'object', required: ['url'], properties: { url: { type: 'string' } } }
     }
   });
+  for (const tool of browserTools.getBrowserToolDefinitions()) tools.push(tool);
   tools.push({
     type: 'function',
     function: {
       name: 'get_memory',
       description: 'Retrieve a stored memory value by key.',
@@ -207,16 +215,21 @@ function updateTaskIfStatus(taskId, allowedStatuses, updates) {
   const { ok } = isTaskStatus(taskId, allowedStatuses);
   if (!ok) return null;
   return agentStore.updateTask(taskId, updates);
 }
 
+function closeBrowserSession(taskId) {
+  browserTools.closeSession(taskId).catch(() => {});
+}
+
 function pauseTaskIfRunning(task, reason) {
   const msg = reason || 'Paused by admin.';
   try {
     task.log = Array.isArray(task.log) ? task.log : [];
     addLog(task, 'thought', `Task paused: ${msg}`);
     agentStore.updateTask(task.id, { status: 'blocked', log: task.log });
+    closeBrowserSession(task.id);
   } catch (_) {}
 }
 
 function shouldWaitForUpstreamData(task, blockedReason) {
   // Only auto-wait inside Command Center missions (parentMissionId set).
@@ -243,10 +256,11 @@ function scheduleWait(task, blockedReason) {
   const until = Date.now() + delayMs;
   addLog(task, 'thought', `Waiting for upstream data (${attempts}/8). Will retry in ${Math.round(delayMs / 1000)}s.`);
   if (attempts >= 8) {
     addLog(task, 'thought', `Blocked: upstream data did not arrive after ${attempts} waits. Last reason: ${blockedReason}`);
     updateTaskIfStatus(task.id, ['executing'], { status: 'blocked', log: task.log, waitAttempts: attempts, notBefore: null });
+    closeBrowserSession(task.id);
     return true;
   }
   updateTaskIfStatus(task.id, ['executing'], {
     status: 'executing',
     log: task.log,
@@ -255,13 +269,16 @@ function scheduleWait(task, blockedReason) {
     notBefore: new Date(until).toISOString()
   });
   return true;
 }
 
-async function executeTool(name, args) {
+async function executeTool(name, args, taskId) {
   const config = getConfig();
 
+  if (browserTools.handles(name)) {
+    return browserTools.executeBrowserTool(name, args, { sessionId: String(taskId || 'agent') });
+  }
   if (name === 'web_search') {
     const query = String(args.query || '').trim();
     if (!query) return 'No query provided.';
     const searxng = config.searxng || {};
     const results = await searxngLib.search(searxng.url, query, { limit: 8 });
@@ -300,10 +317,42 @@ async function executeTool(name, args) {
   // Skill plugin
   const result = await skillsLib.runSkill(name, args);
   return typeof result === 'object' ? JSON.stringify(result) : String(result);
 }
 
+function appendVisionImages(messages, images) {
+  if (images.length) {
+    messages.push({
+      role: 'user',
+      content: 'Screenshot(s) from the browser tool follow for visual context.',
+      images
+    });
+  }
+}
+
+function appendPendingVisionImages(messages, taskId) {
+  appendVisionImages(messages, browserTools.takePendingVisionImages(taskId));
+}
+
+function persistPendingVisionImages(task) {
+  const images = browserTools.takePendingVisionImages(task.id);
+  if (!images.length) return;
+  task.pendingVisionImages = [
+    ...(Array.isArray(task.pendingVisionImages) ? task.pendingVisionImages : []),
+    ...images
+  ];
+  agentStore.updateTask(task.id, { pendingVisionImages: task.pendingVisionImages });
+}
+
+function appendTaskPendingVisionImages(messages, task) {
+  const images = Array.isArray(task.pendingVisionImages) ? task.pendingVisionImages : [];
+  if (!images.length) return;
+  appendVisionImages(messages, images);
+  task.pendingVisionImages = [];
+  agentStore.updateTask(task.id, { pendingVisionImages: [] });
+}
+
 // ---- Phase handlers --------------------------------------------------------
 
 async function planTask(task) {
   if (isRunnerPaused()) {
     pauseTaskIfRunning(task, 'Agent runner is paused.');
@@ -331,10 +380,11 @@ async function planTask(task) {
     raw = data?.message?.content || '';
   } catch (e) {
     addLog(task, 'thought', `Planning LLM error: ${e.message}`);
     task.status = 'failed';
     updateTaskIfStatus(task.id, ['planning'], { status: 'failed', log: task.log });
+    closeBrowserSession(task.id);
     return;
   }
 
   let plan;
   try {
@@ -343,10 +393,11 @@ async function planTask(task) {
     if (!Array.isArray(plan) || plan.length === 0) throw new Error('empty');
   } catch (_) {
     addLog(task, 'thought', `Could not parse plan from LLM response: ${raw.slice(0, 200)}`);
     task.status = 'failed';
     updateTaskIfStatus(task.id, ['planning'], { status: 'failed', log: task.log });
+    closeBrowserSession(task.id);
     return;
   }
 
   const newPlan = plan.map((s, i) => ({
     step: Number(s.step) || i + 1,
@@ -394,10 +445,11 @@ async function executeStep(task) {
   stepAttempts[stepKey] = Number(stepAttempts[stepKey] || 0) + 1;
   updateTaskIfStatus(task.id, ['executing'], { stepAttempts });
   if (stepAttempts[stepKey] > maxStepAttempts) {
     addLog(task, 'thought', `Blocked: step retry limit reached (${stepAttempts[stepKey]}/${maxStepAttempts}) for "${step.description}"`);
     updateTaskIfStatus(task.id, ['executing'], { status: 'blocked', log: task.log, stepAttempts });
+    closeBrowserSession(task.id);
     return;
   }
 
   const planSummary = task.plan
     .map(s => `Step ${s.step} [${s.status}]: ${s.description}`)
@@ -429,10 +481,13 @@ async function executeStep(task) {
   const tools = buildToolDefinitions();
   const messages = [
     { role: 'system', content: systemMsg },
     { role: 'user', content: `Execute step ${step.step}: ${step.description}` }
   ];
+  // Screenshots captured before approval are stored on the task because the
+  // browser session may be closed by its idle sweeper while approval is pending.
+  appendTaskPendingVisionImages(messages, task);
 
   let maxRounds = 5;
   let stepDone = false;
   let stepBlocked = false;
   let blockedReason = '';
@@ -499,10 +554,11 @@ async function executeStep(task) {
 
       if (isHighRisk(name)) {
         addLog(task, 'approval_request',
           `Needs approval: ${name}(${JSON.stringify(args).slice(0, 200)})`
         );
+        persistPendingVisionImages(task);
         updateTaskIfStatus(task.id, ['executing'], {
           status: 'awaiting_approval',
           pendingApproval: { action: name, args, requestedAt: new Date().toISOString() },
           log: task.log
         });
@@ -510,17 +566,18 @@ async function executeStep(task) {
       }
 
       addLog(task, 'action', `${name}(${JSON.stringify(args).slice(0, 200)})`);
       let toolResult;
       try {
-        toolResult = await executeTool(name, args);
+        toolResult = await executeTool(name, args, task.id);
       } catch (e) {
         toolResult = `Error: ${e.message}`;
       }
       addLog(task, 'result', String(toolResult).slice(0, 1000));
       messages.push({ role: 'tool', tool_name: name, tool_call_id: tc.id, content: String(toolResult) });
     }
+    appendPendingVisionImages(messages, task.id);
     if (stepBlocked) break;
   }
 
   const updatedPlan = task.plan.map((s, i) => {
     if (i === task.currentStep && stepDone) return { ...s, status: 'done' };
@@ -550,10 +607,11 @@ async function executeStep(task) {
     const newStatus = (task.blockedBehavior === 'continue') ? 'executing' : 'blocked';
     if (task.blockedBehavior === 'notify') {
       notifyBlocked(task, blockedReason).catch(() => {});
     }
     updateTaskIfStatus(task.id, ['executing'], { status: newStatus, log: task.log, stepAttempts });
+    if (newStatus === 'blocked') closeBrowserSession(task.id);
   } else {
     updateTaskIfStatus(task.id, ['executing'], { log: task.log, stepAttempts });
   }
 }
 
@@ -581,19 +639,21 @@ async function learnFromTask(task) {
       { role: 'user', content: `Task: ${task.goal}\n\nLog:\n${logText.slice(0, 8000)}` }
     ]);
     raw = data?.message?.content || '{}';
   } catch (_) {
     agentStore.updateTask(task.id, { status: 'complete' });
+    closeBrowserSession(task.id);
     return;
   }
 
   let learnings;
   try {
     const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
     learnings = JSON.parse(cleaned);
   } catch (_) {
     agentStore.updateTask(task.id, { status: 'complete' });
+    closeBrowserSession(task.id);
     return;
   }
 
   // Strategy notes are low-risk: write freely
   if (Array.isArray(learnings.strategyNotes) && learnings.strategyNotes.length > 0) {
@@ -620,10 +680,11 @@ async function learnFromTask(task) {
         if (key) structuredMemory.setMemory(String(key), String(value || ''));
       }
       addLog(task, 'result', `Stored ${facts.length} memory fact(s)`);
       addLog(task, 'learn', 'Learning phase complete');
       agentStore.updateTask(task.id, { status: 'complete', log: task.log });
+      closeBrowserSession(task.id);
       return;
     }
 
     addLog(task, 'approval_request',
       `Learning: needs approval to store ${facts.length} memory fact(s): ${facts.map(f => f.key).join(', ')}`
@@ -636,10 +697,11 @@ async function learnFromTask(task) {
     return;
   }
 
   addLog(task, 'learn', 'Learning phase complete');
   agentStore.updateTask(task.id, { status: 'complete', log: task.log });
+  closeBrowserSession(task.id);
 }
 
 async function notifyBlocked(task, reason) {
   const config = getConfig();
   if (!config.email?.host || !config.email?.enabled || !config.email?.defaultTo) return;
@@ -748,16 +810,17 @@ async function resumeAfterApproval(task, approved, rejectionReason) {
       pendingApproval: null,
       status: 'complete',
       log: task.log,
       learnings: task.learnings
     });
+    closeBrowserSession(task.id);
     return;
   }
 
   let result;
   try {
-    result = await executeTool(pa.action, pa.args);
+    result = await executeTool(pa.action, pa.args, task.id);
     const learnings = { ...(task.learnings || {}) };
     if (pa.action === 'create_skill') {
       learnings.skillsCreated = [...(learnings.skillsCreated || []), String(pa.args.id || '?')];
     }
     if (pa.action === 'set_memory' || pa.action === 'append_memory') {
@@ -777,6 +840,16 @@ async function resumeAfterApproval(task, approved, rejectionReason) {
     log: task.log,
     learnings: task.learnings
   });
 }
 
-module.exports = { startAgentRunner, stopAgentRunner, resumeAfterApproval, isRunnerPaused, getRunnerState, parseStepSignal };
+module.exports = {
+  startAgentRunner,
+  stopAgentRunner,
+  resumeAfterApproval,
+  isRunnerPaused,
+  getRunnerState,
+  parseStepSignal,
+  appendPendingVisionImages,
+  persistPendingVisionImages,
+  appendTaskPendingVisionImages
+};
diff --git a/lib/browserTools.js b/lib/browserTools.js
new file mode 100644
index 0000000..615ad1a
--- /dev/null
+++ b/lib/browserTools.js
@@ -0,0 +1,451 @@
+'use strict';
+
+const path = require('path');
+const fs = require('fs');
+const dns = require('dns');
+const net = require('net');
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
+    if (h === '::' || h === '::1') return true;
+    if (h.startsWith('fc') || h.startsWith('fd')) return true; // ULA fc00::/7
+    const firstHextet = h.split(':')[0];
+    if (firstHextet && /^[0-9a-f]{1,4}$/.test(firstHextet)) {
+      const n = parseInt(firstHextet, 16);
+      if (n >= 0xfe80 && n <= 0xfebf) return true; // fe80::/10 link-local
+      if (n >= 0xfec0 && n <= 0xfeff) return true; // fec0::/10 site-local (deprecated)
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
+
+module.exports = {
+  BROWSER_TOOL_NAMES,
+  getBrowserConfig,
+  setBrowserConfigOverrideForTests,
+  isBrowserEnabled,
+  isPrivateHostnameOrIp,
+  assertAllowedUrl,
+  assertAllowedUrlResolved,
+  installPrivateNetworkRequestGuard,
+  truncateText,
+  handles,
+  getBrowserToolDefinitions,
+  executeBrowserTool,
+  closeSession,
+  closeAllSessions,
+  takePendingVisionImages
+};
diff --git a/lib/chatRunner.js b/lib/chatRunner.js
index afca754..645689e 100644
--- a/lib/chatRunner.js
+++ b/lib/chatRunner.js
@@ -10,24 +10,29 @@ const fetchUrlLib = require('./fetchUrl.js');
 const emailLib = require('./email.js');
 const logger = require('./logger.js');
 const structuredMemory = require('./structuredMemory.js');
 const { executeSchedulerTool, getSchedulerToolDefinitions } = require('./toolHandlers.js');
 const agentLoopTools = require('./agentLoopTools.js');
+const browserTools = require('./browserTools.js');
 
 /**
  * Run one assistant turn (non-streaming). Uses same tools and logic as the web chat.
  * @param {object} options
  * @param {string} options.user - Username (e.g. "channel_cli" or "telegram_123")
  * @param {string} [options.userContext] - Optional memory/profile scope user (defaults to options.user)
  * @param {Array<{role:string,content:string}>} options.messages - Conversation messages (no system)
  * @param {string} [options.customInstructions] - Per-chat instructions
  * @param {string} [options.agentId] - Optional agent id for different model
+ * @param {string} [options.sessionId] - Optional browser session id
  * @returns {Promise<{content: string, tokenStats?: {promptTokens:number, evalTokens:number, totalTokens:number, contextWindow:number, usagePct:number}}>}
  */
 async function runChatTurn(options) {
-  const { user, userContext, messages, customInstructions = '', agentId } = options;
+  const { user, userContext, messages, customInstructions = '', agentId, sessionId: optSessionId } = options;
   const memoryScopeUser = (typeof userContext === 'string' && userContext.trim()) ? userContext.trim() : user;
+  const browserSessionId = (typeof optSessionId === 'string' && optSessionId.trim())
+    ? optSessionId.trim()
+    : String(user || 'channel');
   const config = getConfig();
   const llm = resolveLlm(config, agentId);
   const contextWindow = llm.contextWindow;
   function enrichTokenStats(stats) {
     const promptTokens = Number(stats && stats.promptTokens) || 0;
@@ -111,10 +116,11 @@ async function runChatTurn(options) {
     ...(webSearchTool ? [webSearchTool] : []),
     fetchUrlTool,
     ...(sendEmailTool ? [sendEmailTool] : []),
     ...skillTools,
     ...getSchedulerToolDefinitions(),
+    ...browserTools.getBrowserToolDefinitions(),
     ...agentLoopTools.getExtraToolDefinitions({ isProjectChat: false })
   ];
 
   let content = '';
   let tokenStats = null;
@@ -197,10 +203,12 @@ async function runChatTurn(options) {
               structuredMemory.setMemory(key, value, memoryScopeUser);
               toolContent = `Stored structured memory for key \"${key}\".`;
             }
           } else if (['create_skill', 'add_heartbeat_job', 'update_skill', 'update_heartbeat_job', 'list_heartbeat_jobs', 'delete_heartbeat_job'].includes(name)) {
             toolContent = await executeSchedulerTool(name, args);
+          } else if (browserTools.handles(name)) {
+            toolContent = await browserTools.executeBrowserTool(name, args, { sessionId: browserSessionId });
           } else if (agentLoopTools.handles(name)) {
             toolContent = await agentLoopTools.executeExtra(name, args, {
               chatOwnerUser: user,
               missionScopeUser: memoryScopeUser
             });
@@ -212,10 +220,18 @@ async function runChatTurn(options) {
         } catch (err) {
           logger.warn('chatRunner tool error:', name, err.message);
           messagesForLlm.push({ role: 'tool', tool_name: name, tool_call_id: tc.id, content: String(err.message) });
         }
       }
+      const visionImages = browserTools.takePendingVisionImages(browserSessionId);
+      if (visionImages.length) {
+        messagesForLlm.push({
+          role: 'user',
+          content: 'Screenshot(s) from the browser tool follow for visual context.',
+          images: visionImages
+        });
+      }
     }
   } else {
     const out = await chatJson(llm, fullMessages);
     content = out.message?.content || '';
     if (out.eval_count != null || out.prompt_eval_count != null) {
diff --git a/lib/config.js b/lib/config.js
index 196d0fc..00173f3 100644
--- a/lib/config.js
+++ b/lib/config.js
@@ -127,10 +127,13 @@ function updateConfig(updates) {
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
diff --git a/lib/vllm.js b/lib/vllm.js
index 507fb3e..88b2765 100644
--- a/lib/vllm.js
+++ b/lib/vllm.js
@@ -58,10 +58,23 @@ function toOpenAIMessages(messages) {
         content: msg.content || null,
         tool_calls
       });
       continue;
     }
+    if (Array.isArray(msg.images) && msg.images.length > 0) {
+      out.push({
+        role: msg.role,
+        content: [
+          { type: 'text', text: String(msg.content ?? '') },
+          ...msg.images.map((image) => ({
+            type: 'image_url',
+            image_url: { url: `data:image/png;base64,${image}` }
+          }))
+        ]
+      });
+      continue;
+    }
     out.push({
       role: msg.role,
       content: String(msg.content ?? '')
     });
   }
@@ -202,7 +215,8 @@ module.exports = {
   vllmChatJson,
   vllmChatWithTools,
   vllmChatStream,
   listModels,
   getModelContextWindow,
-  vllmDescribeImage
+  vllmDescribeImage,
+  toOpenAIMessages
 };
diff --git a/package-lock.json b/package-lock.json
index a9c368d..1860098 100644
--- a/package-lock.json
+++ b/package-lock.json
@@ -18,14 +18,15 @@
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
@@ -2747,10 +2748,24 @@
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
@@ -4922,10 +4937,40 @@
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
diff --git a/package.json b/package.json
index dd0e4a3..27af395 100644
--- a/package.json
+++ b/package.json
@@ -5,14 +5,15 @@
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
@@ -23,10 +24,11 @@
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
diff --git a/public/config.html b/public/config.html
index d427b0e..8dff28a 100644
--- a/public/config.html
+++ b/public/config.html
@@ -47,10 +47,11 @@
       <div class="config-tabs" role="tablist">
         <button type="button" class="config-tab active" data-tab="server" role="tab" aria-selected="true">Server</button>
         <button type="button" class="config-tab" data-tab="auth" role="tab" aria-selected="false">Auth</button>
         <button type="button" class="config-tab" data-tab="ollama" role="tab" aria-selected="false">LLM</button>
         <button type="button" class="config-tab" data-tab="searxng" role="tab" aria-selected="false">SearXNG</button>
+        <button type="button" class="config-tab" data-tab="browser" role="tab" aria-selected="false">Browser</button>
         <button type="button" class="config-tab" data-tab="notifications" role="tab" aria-selected="false">Notifications</button>
         <button type="button" class="config-tab" data-tab="channels" role="tab" aria-selected="false">Channels</button>
         <button type="button" class="config-tab" data-tab="ui" role="tab" aria-selected="false">UI</button>
       </div>
 
@@ -144,10 +145,34 @@
           </div>
           <p class="section-desc">Use the web search test in Chat to verify SearXNG is working.</p>
         </section>
       </div>
 
+      <div id="panel-browser" class="config-panel" role="tabpanel" hidden>
+        <section class="section">
+          <h2>Browser (Playwright)</h2>
+          <p class="section-desc">Let the AI control a headless Chromium browser for JS-heavy pages and multi-step web flows. Requires <code>npx playwright install chromium</code> on the server.</p>
+          <div class="form-group">
+            <label><input type="checkbox" id="browserEnabled" /> Enable browser tools</label>
+          </div>
+          <div class="form-group">
+            <label><input type="checkbox" id="browserHeadless" /> Headless mode</label>
+          </div>
+          <div class="form-group">
+            <label><input type="checkbox" id="browserBlockPrivate" /> Block private/local network URLs</label>
+          </div>
+          <div class="form-group">
+            <label>Action timeout (ms)</label>
+            <input type="number" id="browserActionTimeoutMs" min="1000" step="1000" />
+          </div>
+          <div class="form-group">
+            <label>Idle session timeout (ms)</label>
+            <input type="number" id="browserIdleTimeoutMs" min="60000" step="1000" />
+          </div>
+        </section>
+      </div>
+
       <div id="panel-notifications" class="config-panel" role="tabpanel" hidden>
         <section class="section">
           <h2>Email (Notifications)</h2>
           <p class="section-desc">Configure SMTP so the AI can email you when you ask it to (e.g. "email me this summary").</p>
           <div class="form-group">
diff --git a/public/config.js b/public/config.js
index ac8642e..8b33c6d 100644
--- a/public/config.js
+++ b/public/config.js
@@ -155,10 +155,15 @@
     timezoneEl.value = c.timezone ?? '';
     usernameEl.value = c.auth?.username ?? 'admin';
     applyOllamaToDom(c.ollama);
     document.getElementById('searxngUrl').value = c.searxng?.url ?? '';
     document.getElementById('searxngEnabled').checked = c.searxng?.enabled === true;
+    document.getElementById('browserEnabled').checked = c.browser?.enabled !== false;
+    document.getElementById('browserHeadless').checked = c.browser?.headless !== false;
+    document.getElementById('browserBlockPrivate').checked = c.browser?.blockPrivateNetworks !== false;
+    document.getElementById('browserActionTimeoutMs').value = c.browser?.actionTimeoutMs ?? 30000;
+    document.getElementById('browserIdleTimeoutMs').value = c.browser?.idleTimeoutMs ?? 300000;
     const e = c.email || {};
     document.getElementById('emailHost').value = e.host ?? '';
     document.getElementById('emailPort').value = e.port ?? 25;
     document.getElementById('emailSecure').checked = e.secure === true;
     document.getElementById('emailUseAuth').checked = !!(e.auth && e.auth.user);
@@ -480,10 +485,17 @@
         auth: auth,
         searxng: {
           url: document.getElementById('searxngUrl').value.trim() || '',
           enabled: document.getElementById('searxngEnabled').checked
         },
+        browser: {
+          enabled: document.getElementById('browserEnabled').checked,
+          headless: document.getElementById('browserHeadless').checked,
+          blockPrivateNetworks: document.getElementById('browserBlockPrivate').checked,
+          actionTimeoutMs: Number(document.getElementById('browserActionTimeoutMs').value) || 30000,
+          idleTimeoutMs: Number(document.getElementById('browserIdleTimeoutMs').value) || 300000
+        },
         email: getEmailFromDom(),
         channels: getChannelsFromDom(),
         ui: {
           appName: (document.getElementById('appName').value || '').trim() || 'SHADOW_AI',
           showToolCalls: document.getElementById('showToolCalls').checked,
@@ -506,10 +518,15 @@
         timezoneEl.value = c.timezone ?? '';
         usernameEl.value = c.auth?.username ?? 'admin';
         applyOllamaToDom(c.ollama);
         document.getElementById('searxngUrl').value = c.searxng?.url ?? '';
         document.getElementById('searxngEnabled').checked = c.searxng?.enabled === true;
+        document.getElementById('browserEnabled').checked = c.browser?.enabled !== false;
+        document.getElementById('browserHeadless').checked = c.browser?.headless !== false;
+        document.getElementById('browserBlockPrivate').checked = c.browser?.blockPrivateNetworks !== false;
+        document.getElementById('browserActionTimeoutMs').value = c.browser?.actionTimeoutMs ?? 30000;
+        document.getElementById('browserIdleTimeoutMs').value = c.browser?.idleTimeoutMs ?? 300000;
         const e = c.email || {};
         document.getElementById('emailHost').value = e.host ?? '';
         document.getElementById('emailPort').value = e.port ?? 25;
         document.getElementById('emailSecure').checked = e.secure === true;
         document.getElementById('emailUseAuth').checked = !!(e.auth && e.auth.user);
diff --git a/server.js b/server.js
index ef0f9e3..03cfd37 100644
--- a/server.js
+++ b/server.js
@@ -23,10 +23,11 @@ const emailLib = require('./lib/email.js');
 const logger = require('./lib/logger.js');
 const systemPrompt = require('./lib/systemPrompt.js');
 const chatRunner = require('./lib/chatRunner.js');
 const { executeSchedulerTool, getSchedulerToolDefinitions } = require('./lib/toolHandlers.js');
 const agentLoopTools = require('./lib/agentLoopTools.js');
+const browserTools = require('./lib/browserTools.js');
 const chatHistorySearch = require('./lib/chatHistorySearch.js');
 const pipelineRunner = require('./lib/pipelineRunner.js');
 const pipelineObservability = require('./lib/pipelineObservability.js');
 const projectStore = require('./lib/projectStore.js');
 const projectImport = require('./lib/projectImport.js');
@@ -1000,10 +1001,11 @@ app.get('/api/config', (req, res) => {
     auth: { username: c.auth.username },
     ollama: c.ollama,
     heartbeat: c.heartbeat || [],
     webhooks: c.webhooks || [],
     searxng: c.searxng || { url: '', enabled: false },
+    browser: c.browser || { enabled: true, headless: true, blockPrivateNetworks: true, actionTimeoutMs: 30000, idleTimeoutMs: 300000 },
     email: (() => {
       const e = c.email || {};
       const safe = { ...e };
       if (safe.auth) safe.auth = { user: safe.auth.user || '' }; // never send pass
       return safe;
@@ -1273,10 +1275,11 @@ app.put('/api/config', (req, res) => {
     }
     if (updates.heartbeat && Array.isArray(updates.heartbeat)) config.heartbeat = updates.heartbeat;
     if (updates.webhooks && Array.isArray(updates.webhooks)) config.webhooks = updates.webhooks;
     if (updates.skills && updates.skills.enabledIds !== undefined) config.skills = { ...(config.skills || {}), enabledIds: updates.skills.enabledIds };
     if (updates.searxng && typeof updates.searxng === 'object') config.searxng = { ...(config.searxng || {}), ...updates.searxng };
+    if (updates.browser && typeof updates.browser === 'object') config.browser = { ...(config.browser || {}), ...updates.browser };
     if (updates.email && typeof updates.email === 'object') {
       config.email = { ...(config.email || {}), ...updates.email };
       if (updates.email.auth && typeof updates.email.auth === 'object') {
         config.email.auth = { ...(config.email.auth || {}), ...updates.email.auth };
         if (config.email.auth.pass === '' || config.email.auth.pass === undefined) delete config.email.auth.pass;
@@ -1329,10 +1332,11 @@ app.put('/api/config', (req, res) => {
         auth: { username: config.auth.username },
         ollama: config.ollama,
         heartbeat: config.heartbeat || [],
         webhooks: config.webhooks || [],
         searxng: config.searxng || {},
+        browser: config.browser || { enabled: true, headless: true, blockPrivateNetworks: true, actionTimeoutMs: 30000, idleTimeoutMs: 300000 },
         email: (() => {
           const e = config.email || {};
           const safe = { ...e };
           if (safe.auth) safe.auth = { user: safe.auth.user || '' };
           return safe;
@@ -1962,10 +1966,11 @@ app.post('/api/chat', chatLimiter, async (req, res) => {
       } : null;
       // Common tools (web search, URL fetch, email, skills, scheduler)
       const commonTools = [
         ...(webSearchTool ? [webSearchTool] : []),
         fetchUrlTool,
+        ...browserTools.getBrowserToolDefinitions(),
         ...(sendEmailTool ? [sendEmailTool] : []),
         ...skillTools,
         ...getSchedulerToolDefinitions(),
         ...agentLoopTools.getExtraToolDefinitions({ isProjectChat: !!(isProjectChat && projectId) })
       ];
@@ -2092,10 +2097,13 @@ app.post('/api/chat', chatLimiter, async (req, res) => {
                   structuredMemory.setMemory(key, value, effectiveUser || user || '');
                   content = `Stored structured memory for key \"${key}\".`;
                 }
               } else if (['create_skill', 'add_heartbeat_job', 'update_skill', 'update_heartbeat_job', 'list_heartbeat_jobs', 'delete_heartbeat_job'].includes(name)) {
                 content = await executeSchedulerTool(name, args);
+              } else if (browserTools.handles(name)) {
+                const sessionId = String(bodyChatId || '').trim() || ('web:' + (effectiveUser || user || 'anon'));
+                content = await browserTools.executeBrowserTool(name, args, { sessionId });
               } else if (agentLoopTools.handles(name)) {
                 content = await agentLoopTools.executeExtra(name, args, {
                   chatOwnerUser: effectiveUser || user || '',
                   missionScopeUser: effectiveUser || user || ''
                 });
@@ -2110,10 +2118,19 @@ app.post('/api/chat', chatLimiter, async (req, res) => {
               const errContent = String(err.message);
               res.write(`data: ${JSON.stringify({ toolResult: { name, args, result: errContent.slice(0, 500), error: true } })}\n\n`);
               messagesForOllama.push({ role: 'tool', tool_name: name, content: errContent });
             }
           }
+          const sessionId = String(bodyChatId || '').trim() || ('web:' + (effectiveUser || user || 'anon'));
+          const visionImages = browserTools.takePendingVisionImages(sessionId);
+          if (visionImages.length) {
+            messagesForOllama.push({
+              role: 'user',
+              content: 'Screenshot(s) from the browser tool follow for visual context.',
+              images: visionImages
+            });
+          }
         }
         assistantContent = finalContent || '';
         if (finalContent) res.write(`data: ${JSON.stringify({ content: finalContent })}\n\n`);
       } else {
         for await (const chunk of chatStream(llm, fullMessages, {}, (meta) => { tokenStats = enrichTokenStats(meta); })) {
diff --git a/tests/browser-chat-wiring.test.js b/tests/browser-chat-wiring.test.js
new file mode 100644
index 0000000..d943a7c
--- /dev/null
+++ b/tests/browser-chat-wiring.test.js
@@ -0,0 +1,38 @@
+'use strict';
+
+const fs = require('fs');
+const path = require('path');
+const test = require('node:test');
+const assert = require('node:assert/strict');
+
+const root = path.join(__dirname, '..');
+
+function source(file) {
+  return fs.readFileSync(path.join(root, file), 'utf8');
+}
+
+test('web chat wires browser tools with a stable web session and vision messages', () => {
+  const server = source('server.js');
+
+  assert.match(server, /const browserTools = require\('\.\/lib\/browserTools\.js'\);/);
+  assert.match(server, /\.\.\.browserTools\.getBrowserToolDefinitions\(\)/);
+  assert.match(server, /browserTools\.handles\(name\)/);
+  assert.match(server, /String\(bodyChatId \|\| ''\)\.trim\(\) \|\| \('web:' \+ \(effectiveUser \|\| user \|\| 'anon'\)\)/);
+  assert.match(server, /browserTools\.executeBrowserTool\(name, args, \{ sessionId \}\)/);
+  assert.match(server, /browserTools\.takePendingVisionImages\(sessionId\)/);
+  assert.match(server, /images: visionImages/);
+});
+
+test('channel runner accepts an explicit browser session and injects vision messages', () => {
+  const chatRunner = source('lib/chatRunner.js');
+
+  assert.match(chatRunner, /const browserTools = require\('\.\/browserTools\.js'\);/);
+  assert.match(chatRunner, /sessionId: optSessionId/);
+  assert.match(chatRunner, /const browserSessionId = \(typeof optSessionId === 'string' && optSessionId\.trim\(\)\)/);
+  assert.match(chatRunner, /: String\(user \|\| 'channel'\);/);
+  assert.match(chatRunner, /\.\.\.browserTools\.getBrowserToolDefinitions\(\)/);
+  assert.match(chatRunner, /browserTools\.handles\(name\)/);
+  assert.match(chatRunner, /browserTools\.executeBrowserTool\(name, args, \{ sessionId: browserSessionId \}\)/);
+  assert.match(chatRunner, /browserTools\.takePendingVisionImages\(browserSessionId\)/);
+  assert.match(chatRunner, /images: visionImages/);
+});
diff --git a/tests/browser-tools-guards.test.js b/tests/browser-tools-guards.test.js
new file mode 100644
index 0000000..d6b10db
--- /dev/null
+++ b/tests/browser-tools-guards.test.js
@@ -0,0 +1,180 @@
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
+  assertAllowedUrlResolved,
+  installPrivateNetworkRequestGuard,
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
+test('isPrivateHostnameOrIp blocks local IPv6 ranges and IPv4-mapped private', () => {
+  assert.equal(isPrivateHostnameOrIp('fe80::1'), true);
+  assert.equal(isPrivateHostnameOrIp('fe90::1'), true);
+  assert.equal(isPrivateHostnameOrIp('fec0::1'), true);
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
diff --git a/tests/task-4-vision.test.js b/tests/task-4-vision.test.js
new file mode 100644
index 0000000..bb555d2
--- /dev/null
+++ b/tests/task-4-vision.test.js
@@ -0,0 +1,94 @@
+'use strict';
+
+const test = require('node:test');
+const assert = require('node:assert/strict');
+
+const browserTools = require('../lib/browserTools.js');
+const agentStore = require('../lib/agentStore.js');
+const {
+  appendPendingVisionImages,
+  persistPendingVisionImages,
+  appendTaskPendingVisionImages
+} = require('../lib/agentRunner.js');
+const { toOpenAIMessages } = require('../lib/vllm.js');
+
+test('appendPendingVisionImages drains browser screenshots into a user message', () => {
+  const original = browserTools.takePendingVisionImages;
+  browserTools.takePendingVisionImages = (taskId) => {
+    assert.equal(taskId, 'task-4');
+    return ['first-base64', 'second-base64'];
+  };
+
+  try {
+    const messages = [];
+    appendPendingVisionImages(messages, 'task-4');
+    assert.deepEqual(messages, [{
+      role: 'user',
+      content: 'Screenshot(s) from the browser tool follow for visual context.',
+      images: ['first-base64', 'second-base64']
+    }]);
+  } finally {
+    browserTools.takePendingVisionImages = original;
+  }
+});
+
+test('vision screenshots queued before approval persist and are injected after resume', () => {
+  const originalTake = browserTools.takePendingVisionImages;
+  const originalUpdate = agentStore.updateTask;
+  const updates = [];
+  browserTools.takePendingVisionImages = (taskId) => {
+    assert.equal(taskId, 'task-4');
+    return ['approval-base64'];
+  };
+  agentStore.updateTask = (taskId, update) => {
+    updates.push({ taskId, update });
+  };
+
+  try {
+    const task = { id: 'task-4', pendingVisionImages: [] };
+    persistPendingVisionImages(task);
+    assert.deepEqual(task.pendingVisionImages, ['approval-base64']);
+    assert.deepEqual(updates, [{
+      taskId: 'task-4',
+      update: { pendingVisionImages: ['approval-base64'] }
+    }]);
+
+    const messages = [];
+    appendTaskPendingVisionImages(messages, task);
+    assert.deepEqual(messages, [{
+      role: 'user',
+      content: 'Screenshot(s) from the browser tool follow for visual context.',
+      images: ['approval-base64']
+    }]);
+    assert.deepEqual(task.pendingVisionImages, []);
+    assert.deepEqual(updates[1], {
+      taskId: 'task-4',
+      update: { pendingVisionImages: [] }
+    });
+  } finally {
+    browserTools.takePendingVisionImages = originalTake;
+    agentStore.updateTask = originalUpdate;
+  }
+});
+
+test('toOpenAIMessages serializes user images as multimodal content', () => {
+  const messages = toOpenAIMessages([{
+    role: 'user',
+    content: 'Inspect these screenshots.',
+    images: ['first-base64', 'second-base64']
+  }]);
+
+  assert.deepEqual(messages, [{
+    role: 'user',
+    content: [
+      { type: 'text', text: 'Inspect these screenshots.' },
+      { type: 'image_url', image_url: { url: 'data:image/png;base64,first-base64' } },
+      { type: 'image_url', image_url: { url: 'data:image/png;base64,second-base64' } }
+    ]
+  }]);
+});
+
+test('toOpenAIMessages preserves string content without images', () => {
+  const messages = toOpenAIMessages([{ role: 'user', content: 'No image.' }]);
+  assert.deepEqual(messages, [{ role: 'user', content: 'No image.' }]);
+});

