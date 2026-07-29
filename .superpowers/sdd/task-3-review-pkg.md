# Review Package Task 3
BASE: 39853ff0c3fdbb76a7ad9878a06ef9d86aafe607
HEAD: 91390cc7c33bd047b0321780917298072594915c

## Commits
91390cc Wire browser tools into web chat and channel runner.


## Stat
 lib/chatRunner.js                 | 18 +++++++++++++++++-
 server.js                         | 14 ++++++++++++++
 tests/browser-chat-wiring.test.js | 38 ++++++++++++++++++++++++++++++++++++++
 3 files changed, 69 insertions(+), 1 deletion(-)


## Diff
diff --git a/lib/chatRunner.js b/lib/chatRunner.js
index afca754..645689e 100644
--- a/lib/chatRunner.js
+++ b/lib/chatRunner.js
@@ -5,34 +5,39 @@ const systemPrompt = require('./systemPrompt.js');
 const { chatWithTools, chatJson, resolveLlm } = require('./llm.js');
 const personalityLib = require('./personality.js');
 const skillsLib = require('./skills.js');
 const searxngLib = require('./searxng.js');
 const fetchUrlLib = require('./fetchUrl.js');
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
     const evalTokens = Number(stats && stats.evalTokens) || 0;
     const total = promptTokens + evalTokens;
     const usagePct = contextWindow > 0 ? Math.min(100, (total / contextWindow) * 100) : 0;
     return { promptTokens, evalTokens, totalTokens: total, contextWindow, usagePct };
   }
@@ -106,20 +111,21 @@ async function runChatTurn(options) {
   };
   const tools = [
     appendMemoryTool,
     getMemoryTool,
     setMemoryTool,
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
   if (tools.length > 0) {
     let messagesForLlm = [...fullMessages];
     let maxRounds = 5;
     while (maxRounds-- > 0) {
       const data = await chatWithTools(llm, messagesForLlm, tools);
@@ -192,35 +198,45 @@ async function runChatTurn(options) {
           } else if (name === 'set_memory') {
             const key = args.key != null ? String(args.key).trim() : '';
             const value = args.value != null ? String(args.value) : '';
             if (!key) toolContent = 'Error: key is required.';
             else {
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
           } else {
             const result = await skillsLib.runSkill(name, args);
             toolContent = typeof result === 'object' ? JSON.stringify(result) : String(result);
           }
           messagesForLlm.push({ role: 'tool', tool_name: name, tool_call_id: tc.id, content: toolContent });
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
       tokenStats = enrichTokenStats({ promptTokens: out.prompt_eval_count || 0, evalTokens: out.eval_count || 0 });
     }
   }
   return { content, tokenStats: tokenStats || undefined };
 }
diff --git a/server.js b/server.js
index ef0f9e3..6887b2f 100644
--- a/server.js
+++ b/server.js
@@ -18,20 +18,21 @@ const searxngLib = require('./lib/searxng.js');
 const fetchUrlLib = require('./lib/fetchUrl.js');
 const structuredMemory = require('./lib/structuredMemory.js');
 const chatStore = require('./lib/chatStore.js');
 const channelLinks = require('./lib/channelLinks.js');
 const emailLib = require('./lib/email.js');
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
 const ragLib = require('./lib/rag.js');
 const agentStore = require('./lib/agentStore.js');
 const agentRunner = require('./lib/agentRunner.js');
 const myDataFs = require('./lib/myDataFs.js');
 const { buildMessagesWithAttachments } = require('./lib/chatAttachments.js');
@@ -1957,20 +1958,21 @@ app.post('/api/chat', chatLimiter, async (req, res) => {
           parameters: {
             type: 'object',
             properties: {}
           }
         }
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
       // For normal chats: allow global memory tools + skills
       // For project chats: allow project-specific memory tool + skills (no global memory tools to keep isolation)
       const tools = isProjectChat && projectId
         ? [
             ...(appendProjectMemoryTool ? [appendProjectMemoryTool] : []),
@@ -2087,38 +2089,50 @@ app.post('/api/chat', chatLimiter, async (req, res) => {
               } else if (name === 'set_memory') {
                 const key = args.key != null ? String(args.key).trim() : '';
                 const value = args.value != null ? String(args.value) : '';
                 if (!key) content = 'Error: key is required.';
                 else {
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
               } else {
                 const result = await skillsLib.runSkill(name, args);
                 content = typeof result === 'object' ? JSON.stringify(result) : String(result);
               }
               res.write(`data: ${JSON.stringify({ toolResult: { name, args, result: String(content).slice(0, 500) } })}\n\n`);
               messagesForOllama.push({ role: 'tool', tool_name: name, tool_call_id: tc.id, content });
             } catch (err) {
               logger.warn(`Tool "${name}" error:`, err.message);
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
           assistantContent += chunk;
           res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
         }
       }
       const newHistory = messages.concat([{ role: 'assistant', content: assistantContent }]);
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

