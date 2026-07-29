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
  // Caller must pass session via closure â€” change signature to executeTool(name, args, taskId)
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
