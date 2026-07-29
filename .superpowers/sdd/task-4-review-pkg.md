# Review Package Task 4 (re-review 2)
BASE: 91390cc7c33bd047b0321780917298072594915c
HEAD: 1caaa2e5439568cc1515c2975f408929778b7b8e

## Commits
1caaa2e Fix approval-resume browser vision images
59f15f7 Fix vision handling in approval and vLLM
c1accd7 Wire browser tools into autonomous agent with approval tiers.


## Stat
 .superpowers/sdd/task-4-report.md | 58 ++++++++++++++++++++++++
 lib/agentRunner.js                | 85 ++++++++++++++++++++++++++++++++---
 lib/vllm.js                       | 16 ++++++-
 tests/task-4-vision.test.js       | 94 +++++++++++++++++++++++++++++++++++++++
 4 files changed, 246 insertions(+), 7 deletions(-)


## Diff
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
diff --git a/lib/agentRunner.js b/lib/agentRunner.js
index 813776d..aacc9a3 100644
--- a/lib/agentRunner.js
+++ b/lib/agentRunner.js
@@ -5,25 +5,32 @@ const { chatWithTools, chatJson, resolveLlm } = require('./llm.js');
 const agentStore = require('./agentStore.js');
 const skillsLib = require('./skills.js');
 const searxngLib = require('./searxng.js');
 const fetchUrlLib = require('./fetchUrl.js');
 const emailLib = require('./email.js');
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
 
 function isRunnerPaused() {
   return runnerPaused;
 }
 
 function getRunnerState() {
@@ -67,20 +74,21 @@ function buildToolDefinitions() {
     });
   }
   tools.push({
     type: 'function',
     function: {
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
       parameters: { type: 'object', required: ['key'], properties: { key: { type: 'string' } } }
     }
   });
 
   // High-risk tools (require approval)
@@ -202,26 +210,31 @@ function isTaskStatus(taskId, allowedStatuses) {
   const allowed = Array.isArray(allowedStatuses) ? allowedStatuses : [allowedStatuses];
   return { ok: allowed.includes(fresh.status), task: fresh };
 }
 
 function updateTaskIfStatus(taskId, allowedStatuses, updates) {
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
   if (!task || !task.parentMissionId) return false;
   const r = String(blockedReason || '').toLowerCase();
   if (!r) return false;
   return (
     r.includes('no raw data') ||
@@ -238,35 +251,39 @@ function shouldWaitForUpstreamData(task, blockedReason) {
 }
 
 function scheduleWait(task, blockedReason) {
   const attempts = Number(task.waitAttempts || 0) + 1;
   const delayMs = Math.min(120000, 15000 * attempts); // 15s, 30s, 45s ... up to 2 minutes
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
     waitAttempts: attempts,
     waitingFor: String(blockedReason || 'upstream data').slice(0, 400),
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
     return results.length === 0
       ? 'No results.'
       : results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.content || ''}`).join('\n\n');
   }
   if (name === 'fetch_url') {
@@ -295,20 +312,52 @@ async function executeTool(name, args) {
     return `Email sent to ${to}.`;
   }
   if (name === 'create_skill') {
     return await executeSchedulerTool('create_skill', args);
   }
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
     return;
   }
   if (!isTaskStatus(task.id, ['planning']).ok) return;
   const llm = resolveLlmForTask(task);
   const strategy = agentStore.readStrategy();
@@ -326,32 +375,34 @@ async function planTask(task) {
   try {
     const data = await chatJson(llm, [
       { role: 'system', content: systemMsg },
       { role: 'user', content: `Goal: ${task.goal}` }
     ]);
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
     const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
     plan = JSON.parse(cleaned);
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
     description: String(s.description || ''),
     status: 'pending'
   }));
   addLog(task, 'thought', `Plan created: ${newPlan.length} steps`);
   updateTaskIfStatus(task.id, ['planning'], {
@@ -389,20 +440,21 @@ async function executeStep(task) {
     return;
   }
 
   const stepKey = String(task.currentStep);
   const stepAttempts = { ...(task.stepAttempts || {}) };
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
     .join('\n');
   const recentLog = task.log.slice(-20)
     .map(e => `[${e.type}] ${e.content}`)
     .join('\n');
 
@@ -424,20 +476,23 @@ async function executeStep(task) {
     'Use tools to accomplish this step. When the step is fully complete, respond with exactly: STEP_DONE',
     'If you are blocked and need human input, respond with exactly: STEP_BLOCKED: <brief reason>',
     'Otherwise, use tools and briefly describe what you are doing.'
   ].filter((line) => line != null).join('\n');
 
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
   let lastToolSig = '';
   let repeatedToolCalls = 0;
 
   while (maxRounds-- > 0) {
     if (isRunnerPaused()) {
@@ -494,38 +549,40 @@ async function executeStep(task) {
         stepBlocked = true;
         blockedReason = `repeated identical tool call loop detected (${name})`;
         addLog(task, 'thought', `Detected tool loop: ${sig.slice(0, 180)}`);
         break;
       }
 
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
         return;
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
     return s;
   });
 
   if (stepDone) {
     const nextStep = task.currentStep + 1;
@@ -545,20 +602,21 @@ async function executeStep(task) {
     if (shouldWaitForUpstreamData(task, blockedReason)) {
       const handled = scheduleWait(task, blockedReason);
       if (handled) return;
     }
     addLog(task, 'thought', `Blocked: ${blockedReason}`);
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
 
 async function learnFromTask(task) {
   if (isRunnerPaused()) {
     pauseTaskIfRunning(task, 'Agent runner is paused.');
     return;
   }
@@ -576,29 +634,31 @@ async function learnFromTask(task) {
 
   let raw = '{}';
   try {
     const data = await chatJson(llm, [
       { role: 'system', content: systemMsg },
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
     for (const note of learnings.strategyNotes) {
       if (note) agentStore.appendStrategy(String(note));
     }
     addLog(task, 'learn', `Added ${learnings.strategyNotes.length} strategy note(s) to memory`);
   }
@@ -615,36 +675,38 @@ async function learnFromTask(task) {
     const requireApprovalForFacts = cfg.agent?.requireApprovalForFacts;
     const mustApprove = (requireApprovalForFacts === true) || (!isCommandCenterMission && requireApprovalForFacts !== false);
 
     if (!mustApprove) {
       for (const { key, value } of facts) {
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
     );
     agentStore.updateTask(task.id, {
       status: 'awaiting_approval',
       pendingApproval: { action: 'store_facts', args: { facts }, requestedAt: new Date().toISOString() },
       log: task.log
     });
     return;
   }
 
   addLog(task, 'learn', 'Learning phase complete');
   agentStore.updateTask(task.id, { status: 'complete', log: task.log });
+  closeBrowserSession(task.id);
 }
 
 async function notifyBlocked(task, reason) {
   const config = getConfig();
   if (!config.email?.host || !config.email?.enabled || !config.email?.defaultTo) return;
   try {
     await emailLib.sendMail(config.email, {
       to: config.email.defaultTo,
       subject: `Agent task blocked: ${task.title}`,
       text: `Task "${task.title}" is blocked and needs your attention.\n\nReason: ${reason}\n\nTask ID: ${task.id}\n\nReview at /autoagent`
@@ -743,26 +805,27 @@ async function resumeAfterApproval(task, approved, rejectionReason) {
       }
     }
     addLog(task, 'result', `Stored ${pa.args.facts?.length || 0} memory fact(s)`);
     addLog(task, 'learn', 'Learning phase complete');
     agentStore.updateTask(task.id, {
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
       const key = pa.args.key || (pa.args.text || '').slice(0, 30);
       learnings.factsAdded = [...(learnings.factsAdded || [])];
       if (!learnings.factsAdded.includes(key)) learnings.factsAdded.push(key);
     }
     task.learnings = learnings;
@@ -772,11 +835,21 @@ async function resumeAfterApproval(task, approved, rejectionReason) {
 
   addLog(task, 'result', String(result).slice(0, 1000));
   agentStore.updateTask(task.id, {
     pendingApproval: null,
     status: 'executing',
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
diff --git a/lib/vllm.js b/lib/vllm.js
index 507fb3e..88b2765 100644
--- a/lib/vllm.js
+++ b/lib/vllm.js
@@ -53,20 +53,33 @@ function toOpenAIMessages(messages) {
             : JSON.stringify(tc.function?.arguments || {})
         }
       }));
       out.push({
         role: 'assistant',
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
   return out;
 }
 
 function fromOpenAIChatResponse(data) {
   const choice = data.choices && data.choices[0];
@@ -197,12 +210,13 @@ async function vllmDescribeImage(baseUrl, apiKey, model, imageBase64, prompt) {
   return data.choices?.[0]?.message?.content?.trim() || '';
 }
 
 module.exports = {
   vllmChat,
   vllmChatJson,
   vllmChatWithTools,
   vllmChatStream,
   listModels,
   getModelContextWindow,
-  vllmDescribeImage
+  vllmDescribeImage,
+  toOpenAIMessages
 };
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

