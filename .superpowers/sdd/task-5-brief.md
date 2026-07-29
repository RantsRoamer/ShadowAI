### Task 5: Config UI + docs

**Files:**
- Modify: `public/config.html`
- Modify: `public/config.js`
- Modify: `README.md`
- Modify: `ROADMAP.md`

- [ ] **Step 5.1: Add Browser tab to config UI**

In `public/config.html`, add a tab button next to SearXNG:

```html
<button type="button" class="config-tab" data-tab="browser" role="tab" aria-selected="false">Browser</button>
```

Add panel:

```html
<div id="panel-browser" class="config-panel" role="tabpanel" hidden>
  <section class="section">
    <h2>Browser (Playwright)</h2>
    <p class="section-desc">Let the AI control a headless Chromium browser for JS-heavy pages and multi-step web flows. Requires <code>npx playwright install chromium</code> on the server.</p>
    <div class="form-group">
      <label><input type="checkbox" id="browserEnabled" /> Enable browser tools</label>
    </div>
    <div class="form-group">
      <label><input type="checkbox" id="browserHeadless" /> Headless mode</label>
    </div>
    <div class="form-group">
      <label><input type="checkbox" id="browserBlockPrivate" /> Block private/local network URLs</label>
    </div>
    <div class="form-group">
      <label>Action timeout (ms)</label>
      <input type="number" id="browserActionTimeoutMs" min="1000" step="1000" />
    </div>
    <div class="form-group">
      <label>Idle session timeout (ms)</label>
      <input type="number" id="browserIdleTimeoutMs" min="60000" step="1000" />
    </div>
  </section>
</div>
```

- [ ] **Step 5.2: Load/save in `public/config.js`**

On load (near searxng fields):

```js
document.getElementById('browserEnabled').checked = c.browser?.enabled !== false;
document.getElementById('browserHeadless').checked = c.browser?.headless !== false;
document.getElementById('browserBlockPrivate').checked = c.browser?.blockPrivateNetworks !== false;
document.getElementById('browserActionTimeoutMs').value = c.browser?.actionTimeoutMs ?? 30000;
document.getElementById('browserIdleTimeoutMs').value = c.browser?.idleTimeoutMs ?? 300000;
```

On save payload:

```js
browser: {
  enabled: document.getElementById('browserEnabled').checked,
  headless: document.getElementById('browserHeadless').checked,
  blockPrivateNetworks: document.getElementById('browserBlockPrivate').checked,
  actionTimeoutMs: Number(document.getElementById('browserActionTimeoutMs').value) || 30000,
  idleTimeoutMs: Number(document.getElementById('browserIdleTimeoutMs').value) || 300000
}
```

Ensure the config POST endpoint merges `browser` (already handled if `updateConfig` / replaceConfig receives full object â€” if save sends full config via replace, include `browser` in the assembled object like searxng).

- [ ] **Step 5.3: Update README.md**

Add a short **Browser tools** bullet under features and an install note:

```markdown
- **Browser tools** â€” Playwright Chromium tools (`browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`, `browser_screenshot`, `browser_close`) for JS-rendered pages and interactive flows. Enabled by default; configure under Config â†’ Browser.

After `npm install`, install Chromium once:

```bash
npx playwright install chromium
```
```

- [ ] **Step 5.4: Update ROADMAP.md Â§6**

Note that built-in Playwright tools (v1: navigate/snapshot/click/type/screenshot/close, per-chat sessions) are implemented; MCP wrapper remains future work.

- [ ] **Step 5.5: Final test run**

Run: `node --test tests/`  
Expected: all PASS (integration skip only if Chromium absent)

- [ ] **Step 5.6: Commit**

```bash
git add public/config.html public/config.js README.md ROADMAP.md
git commit -m "Add browser config UI and documentation."
```

---
