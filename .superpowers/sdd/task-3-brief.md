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

(If `visionModel` unset but main model already accepts images in this deployment, still attach when `visionImages.length` â€” prefer: attach whenever `visionImages.length`, matching chat attachment behavior.)

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
