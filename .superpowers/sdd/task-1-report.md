# Task 1 Report: Config defaults + URL guards + tool definitions

## What was implemented

- **`lib/browserTools.js`** — Foundation module with:
  - `getBrowserConfig()` / `isBrowserEnabled()` with defaults and test override hook
  - `isPrivateHostnameOrIp()` — blocks localhost, RFC1918, link-local, CGNAT, IPv6 ULA/loopback
  - `assertAllowedUrl()` — http/https only; optional private-network blocking
  - `truncateText()` — respects explicit max or config `maxTextChars`
  - `getBrowserToolDefinitions()` — 6 OpenAI-style tool defs when enabled, `[]` when disabled
  - `handles()` / `BROWSER_TOOL_NAMES` — name registry for the 6 browser tools
  - Placeholder comments for Task 2 (`executeBrowserTool`, `closeSession`, `takePendingVisionImages`)
- **`config.default.json`** — Added `browser` section with all defaults from the plan
- **`lib/config.js`** — `updateConfig` merges `updates.browser` after `agentLoop` branch
- **`.gitignore`** — Added `data/browser-screenshots/`
- **`tests/browser-tools-guards.test.js`** — Unit tests for guards, truncation, and tool-definition gating

No Playwright launch or execution logic was added (deferred to Task 2).

## What was tested and results

| Command | Result |
|---------|--------|
| `node --test tests/browser-tools-guards.test.js` | **5/5 pass** |
| `node --test tests/chat-attachments.test.js` | **1/1 pass** (sanity check on existing tests) |

## TDD Evidence

### RED (Step 1.2)

```
node --test tests/browser-tools-guards.test.js

Error: Cannot find module '../lib/browserTools.js'
Require stack:
- N:\AI Projects\ShadowAI\tests\browser-tools-guards.test.js
```

Exit code: 1 — module missing as expected.

### GREEN (Step 1.5)

```
node --test tests/browser-tools-guards.test.js

✔ isPrivateHostnameOrIp blocks localhost and RFC1918
✔ assertAllowedUrl rejects non-http and private hosts when blocking
✔ assertAllowedUrl allows loopback when blockPrivateNetworks false
✔ truncateText respects max
✔ getBrowserToolDefinitions respects enabled flag via setBrowserConfigOverrideForTests
ℹ tests 5
ℹ pass 5
ℹ fail 0
```

Exit code: 0.

## Files changed

| File | Action |
|------|--------|
| `lib/browserTools.js` | Created |
| `tests/browser-tools-guards.test.js` | Created |
| `config.default.json` | Modified — added `browser` defaults |
| `lib/config.js` | Modified — `updateConfig` browser merge |
| `.gitignore` | Modified — `data/browser-screenshots/` |

## Commit

```
0f3b7d1 Add browser tool config, URL guards, and tool definitions.
```

## Self-review findings

1. **Matches brief verbatim** — Function signatures, defaults, tool definitions, and test cases align with the task plan.
2. **Unused imports in `browserTools.js`** — `path`, `fs`, `DATA_DIR`, and `logger` are imported per the brief template but unused in Task 1; intentional placeholders for Task 2.
3. **`getBrowserConfig` imported but unused in tests** — Required by brief import list; used indirectly via `truncateText` default and override hook in defs test.
4. **Private-network coverage** — Includes CGNAT (100.64–127.x) and IPv6 ULA/link-local beyond the minimal test cases; consistent with brief implementation.
5. **No integration yet** — Module is not wired into agent loop or chat routes; that is expected for Task 1.

## Issues / concerns

- **Minor:** Unused imports will trigger linter warnings if strict unused-import rules are added later; safe to remove in Task 2 when Playwright code uses them, or leave until then.
- **None blocking** — All specified interfaces and tests are in place; ready for Task 2 (Playwright session/execute).

## Important finding fix (IPv6 / IPv4-mapped private blocking)

**Commit:** `e908740` — Fix IPv6 and IPv4-mapped private URL blocking.

**Changes:**
- `isPrivateHostnameOrIp` now blocks full `fe80::/10` link-local range (not only `fe80:` prefix)
- Blocks IPv4-mapped IPv6 private/loopback addresses (e.g. `::ffff:127.0.0.1`, `::ffff:10.1.2.3`)
- Preserves existing RFC1918, localhost, CGNAT, ULA, and `::1` blocking

**Regression test command and output:**

```
node --test tests/browser-tools-guards.test.js

✔ isPrivateHostnameOrIp blocks localhost and RFC1918
✔ isPrivateHostnameOrIp blocks fe80::/10 link-local and IPv4-mapped private
✔ assertAllowedUrl rejects non-http and private hosts when blocking
✔ assertAllowedUrl allows loopback when blockPrivateNetworks false
✔ truncateText respects max
✔ getBrowserToolDefinitions respects enabled flag via setBrowserConfigOverrideForTests
ℹ tests 6
ℹ pass 6
ℹ fail 0
```

Exit code: 0.

## IPv4-mapped IPv6 canonicalization fix

**Commit:** `82aca35` — Harden IPv4-mapped IPv6 private URL blocking.

**Root cause:** Node's `URL` canonicalizes `http://[::ffff:127.0.0.1]/` to hostname `[::ffff:7f00:1]` (hex-mapped form). Prior `isPrivateHostnameOrIp` only matched dotted `::ffff:127.0.0.1`, so `assertAllowedUrl` did not block the canonicalized path.

**Changes:**
- Added `ipv4FromMappedIpv6()` — detects dotted (`::ffff:127.0.0.1`) and hex (`::ffff:7f00:1`, `::ffff:a01:203`) IPv4-mapped forms; converts hex payload to IPv4 and reuses `isPrivateIpv4Octets`
- Bracket stripping and case-insensitive `ffff` matching preserved via existing lowercasing
- New `assertAllowedUrl` integration tests for `http://[::ffff:127.0.0.1]/` and `http://[::ffff:10.1.2.3]/`

**Regression test command and output:**

```
node --test tests/browser-tools-guards.test.js

✔ isPrivateHostnameOrIp blocks localhost and RFC1918
✔ isPrivateHostnameOrIp blocks fe80::/10 link-local and IPv4-mapped private
✔ assertAllowedUrl blocks IPv4-mapped IPv6 private addresses
✔ assertAllowedUrl rejects non-http and private hosts when blocking
✔ assertAllowedUrl allows loopback when blockPrivateNetworks false
✔ truncateText respects max
✔ getBrowserToolDefinitions respects enabled flag via setBrowserConfigOverrideForTests
ℹ tests 7
ℹ pass 7
ℹ fail 0
```

Exit code: 0.
