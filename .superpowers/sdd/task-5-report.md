# Task 5 Report: Config UI + docs

## Completed

- Added **Browser** tab to `public/config.html` (after SearXNG) with enable, headless, block-private-networks, action timeout, and idle session timeout controls.
- Wired browser field load/save in `public/config.js` on initial fetch and after save response; save payload includes `browser` object merged by existing `updateConfig` / `replaceConfig` in `lib/config.js`.
- Updated `README.md` with Browser tools feature bullet and `npx playwright install chromium` install note under Quick start.
- Updated `ROADMAP.md` §6 to note built-in Playwright tools are implemented; MCP wrapper remains future work.

## Verification

Command:

```powershell
node --test tests/
```

Result: directory form fails on Node.js v25.6.0 (MODULE_NOT_FOUND).

Fallback:

```powershell
node --test tests/*.test.js
```

Result: 32 passed, 0 failed, 0 skipped. Integration tests ran against local Chromium fixture.

## Commit

```
Add browser config UI and documentation.
```

Files: `public/config.html`, `public/config.js`, `README.md`, `ROADMAP.md`

## Notes

- UI exposes five browser settings; `maxActionsPerSession` and `maxTextChars` remain config-default only (not in brief).
- No new automated tests for config UI (static HTML/JS; server-side config merge already covered by prior tasks).

## Config API follow-up (Important finding)

**Issue:** Config UI could not load or save browser settings because `GET /api/config` and `PUT /api/config` in `server.js` omitted the `browser` field (unlike `lib/config.js` merge path used elsewhere).

**Fix:**

- `GET /api/config`: expose `browser` with defaults matching `config.default.json` / SearXNG pattern.
- `PUT /api/config`: merge `updates.browser` next to `updates.searxng`.
- PUT response `config` whitelist: include `browser` with the same defaults.

**Verification:** `node --check server.js` passed. Diff confirms `browser` added at all three sites; no unrelated config fields changed.

**Commit:** `Expose browser settings in config API.` (file: `server.js`)
