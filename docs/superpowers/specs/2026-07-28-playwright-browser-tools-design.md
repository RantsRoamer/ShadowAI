# Playwright Browser Tools — Design Spec
**Date:** 2026-07-28
**Status:** Approved

---

## Overview

Add Playwright-based browser tools so ShadowAI can snapshot JS-rendered pages and run multi-step interactive automation (navigate, click, type, screenshot). Sessions are per-chat (or per agent task). Tools are available in web chat, channel clients, and the autonomous agent. Browser support is enabled by default, with hard network/timeout guards.

This implements ROADMAP §6 (browser control / web automation) as a built-in tool module, not as a skill or MCP wrapper.

---

## Goals

- Snapshot JS-heavy pages that `fetch_url` cannot handle.
- Support interactive multi-step flows within one conversation/session.
- Wire the same tools into web chat, channels (`chatRunner`), and the autonomous agent (`agentRunner`).
- Persist screenshots to disk; attach image bytes to the next model turn when vision is available.
- Keep the chat/agent loops resilient: tool failures return strings, never crash the loop.

## Non-goals (v1)

- Multi-tab / multi-page management beyond one page per session
- File downloads, PDF print, video, geolocation spoofing
- Non-Chromium browsers
- MCP Playwright server
- Recorded scripts / codegen UI
- Autonomous agent without approval for click/type/close

---

## Architecture

### Module: `lib/browserTools.js`

Owns:

1. **Session store** — `Map<sessionId, { browser, context, page, lastUsedAt, actionCount }>`
2. **Lifecycle** — create on first browser tool use; idle timeout; explicit `browser_close`; cleanup hooks when chat ends / agent task finishes
3. **Guards** — URL protocol check, private-network block, timeouts, max actions per session, `config.browser.enabled` gate
4. **Tool API** — `getBrowserToolDefinitions()`, `handles(name)`, `executeBrowserTool(name, args, ctx)`, `closeSession(sessionId)`, `closeAllSessions()`

Pattern matches `lib/agentLoopTools.js` / `lib/toolHandlers.js`: definitions + dispatch, no central registry class.

### Session keying

| Consumer | Session id |
|----------|------------|
| Web chat | Chat thread id (or equivalent stable chat id already used in the SSE loop) |
| Channels (`chatRunner`) | Channel conversation / chat id passed into the runner |
| Autonomous agent | Agent task id |

One Playwright `BrowserContext` + one `Page` per session. Headless Chromium by default.

### Wiring

| File | Change |
|------|--------|
| `server.js` | Include browser tool defs when enabled; dispatch via `executeBrowserTool`; pass chat session id; pass screenshot images into next LLM round when vision available |
| `lib/chatRunner.js` | Same for channel tool loop |
| `lib/agentRunner.js` | Same for agent tool loop; risk tiers (below) |
| `config.default.json` | Add `browser` section |
| Config UI (`public/config.js` or equivalent) | Toggle / fields if other feature flags are already mirrored there |
| `package.json` | Add `playwright` dependency |
| README / ROADMAP | Install note (`npx playwright install chromium`); mark browser automation progress |

```
LLM ← tool schemas (browser_* when enabled)
  ↓ tool_calls
executeBrowserTool(name, args, { sessionId, ... })
  ↓
Playwright session (per sessionId)
  ↓ string result (+ optional screenshot path/base64 for vision)
role: tool message → next LLM round
```

---

## Tool surface

| Tool | Parameters (summary) | Behavior |
|------|----------------------|----------|
| `browser_navigate` | `url` (required) | Create session if needed; `page.goto` with load wait + short settle; return final URL + title |
| `browser_snapshot` | `screenshot?` (bool, default false) | Return title + visible/content text (truncated); optional screenshot |
| `browser_click` | `selector` (CSS) or `role`+`name` | Click target; return short confirmation or clear error |
| `browser_type` | `selector`, `text`; optional `clear`, `submit` | Fill/type; optional Enter; return confirmation |
| `browser_screenshot` | (none required) | Save PNG; return path + meta; queue image for vision turn |
| `browser_close` | (none) | Close context/browser for this session; remove from map |

### Result shape

All tools return a **string** suitable for `role: 'tool'` messages (same as `fetch_url` / other built-ins). Screenshots additionally produce side effects:

- File: `data/browser-screenshots/<sessionId>/<timestamp>.png`
- Optional vision payload: raw base64 PNG for the next model round when a vision-capable path is configured (reuse existing Ollama `images` attachment pattern from `lib/chatAttachments.js` / project import)

Text truncation uses `config.browser.maxTextChars` (default 80000), aligned with `fetch_url` limits.

---

## Config

Add to `config.default.json`:

```json
{
  "browser": {
    "enabled": true,
    "headless": true,
    "idleTimeoutMs": 300000,
    "actionTimeoutMs": 30000,
    "maxActionsPerSession": 40,
    "maxTextChars": 80000,
    "blockPrivateNetworks": true
  }
}
```

When `enabled` is false, browser tools are omitted from tool definition arrays (not merely rejected at execute time).

---

## Security

- **Protocols:** only `http:` and `https:`
- **Private networks:** when `blockPrivateNetworks` is true, reject hosts that resolve to / are literal `localhost`, loopback, RFC1918, link-local, or similar private ranges (including IPv6 ULA/link-local where practical)
- **Timeouts:** Playwright action timeout from `actionTimeoutMs`; navigate/settling bounded
- **Action cap:** refuse further actions after `maxActionsPerSession` until `browser_close` or idle cleanup
- **Idle cleanup:** sessions unused for `idleTimeoutMs` are closed automatically
- **Headless default:** no visible browser window on the server host unless `headless: false`

---

## Autonomous agent risk tiers

Extend `lib/agentRunner.js` sets:

| Tier | Tools |
|------|--------|
| Low-risk (no approval) | `browser_navigate`, `browser_snapshot`, `browser_screenshot` |
| High-risk (approval) | `browser_click`, `browser_type`, `browser_close` |

Rationale: reading/navigating is similar to `fetch_url`; clicking/typing can submit forms or change remote state; close frees resources but is gated to avoid surprising session loss mid-plan without user awareness in autonomous runs.

Session id for agent runs is the task id. Close session when task reaches a terminal status (complete / failed / blocked cleanup path) as well as on explicit `browser_close`.

---

## Screenshot + vision flow

1. Tool writes PNG under `data/browser-screenshots/<sessionId>/`.
2. Tool result string includes absolute-or-data-relative path, dimensions if cheap, and reminder that the image may also be attached for vision.
3. If vision is available — defined as `config.ollama.visionModel` set, or the active chat/agent model already receiving `images` the same way user chat attachments do:
   - Queue base64 image on the session context.
   - On the next LLM call in that tool loop, attach `images: [base64]` to an appropriate message (prefer injecting via the existing images-on-user-message convention used by Ollama), then clear the queue.
4. If vision is not available, text-only path + description is sufficient; no hard failure.

Exact injection point may differ slightly between `server.js` SSE loop and `chatRunner` / `agentRunner`, but behavior must be equivalent: model that supports images sees the screenshot on the turn after the tool returns.

---

## Error handling

Return clear tool-result strings for:

- Browser disabled
- Invalid / blocked URL
- Timeout
- Missing session (action before navigate, or after close)
- Selector / target not found
- Action cap exceeded
- Playwright / Chromium not installed

Never throw out of the tool loop uncaught; log warnings via existing `logger`.

---

## Dependencies & install

- Add `playwright` to `package.json` dependencies.
- Document: after `npm install`, run `npx playwright install chromium` (or document that first use may fail with a clear error until browsers are installed).
- Prefer launching Chromium only; do not require Firefox/WebKit in v1.

---

## Testing

| Layer | Coverage |
|-------|----------|
| Unit | URL guard (private IPs / localhost blocked); enabled gate omits defs; text truncation helpers; session action cap logic (mockable without browser where possible) |
| Integration | Skip when Chromium is not installed. When installed: spin up an ephemeral local HTTP fixture server and run navigate + snapshot with `blockPrivateNetworks: false` **only inside that test** (test config override, not a production escape hatch). Export URL-guard helpers so unit tests cover blocking without launching a browser. |
| Manual | Enable browser, ask chat to open a public page, snapshot, click, screenshot |

Add `data/browser-screenshots/` to `.gitignore` (existing `data/` rules do not ignore this path today).

---

## Docs & roadmap

- README: browser tools section + Chromium install step
- ROADMAP §6: note built-in Playwright tools as implemented / in progress for v1 scope
- Optional Config UI: mirror `browser.enabled` (and key timeouts) if the Config page already exposes similar toggles for SearXNG/email

---

## Implementation order (guidance for plan)

1. Config + `lib/browserTools.js` session/guards/core actions
2. Wire `server.js` + `chatRunner.js`
3. Wire `agentRunner.js` risk tiers + session cleanup
4. Screenshot disk + vision attachment in tool loops
5. Tests + README/ROADMAP + config UI if applicable

---

## Decisions log

| Decision | Choice |
|----------|--------|
| Scope | Snapshot + interactive control |
| Sessions | Per-chat / per-agent-task |
| Availability | Web chat, channels, autonomous agent |
| Security | Enabled by default + hard limits (timeouts, private-network block) |
| Screenshots | Disk path + vision attach when available |
| Integration style | Built-in module (`lib/browserTools.js`), not skill or MCP |
| Browser | Headless Chromium via Playwright |
