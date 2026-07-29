# Review Package Task 5 (re-review)
BASE: 1caaa2e5439568cc1515c2975f408929778b7b8e
HEAD: f093162b826eb6ed82f857d22f26300289213a3d

## Commits
f093162 Expose browser settings in config API.
ea29a17 Add browser config UI and documentation.


## Stat
 README.md          |  7 +++++++
 ROADMAP.md         |  6 ++----
 public/config.html | 25 +++++++++++++++++++++++++
 public/config.js   | 17 +++++++++++++++++
 server.js          |  3 +++
 5 files changed, 54 insertions(+), 4 deletions(-)


## Diff
diff --git a/README.md b/README.md
index d27a0ae..3785fe5 100644
--- a/README.md
+++ b/README.md
@@ -13,37 +13,44 @@ For ideas on extending ShadowAI (multi-channel messaging, voice, calendar, smart
 - **Multi-model** ΓÇö Main Brain model + optional agents (e.g. Coding Agent) from same or different Ollama URLs
 - **Config via UI** ΓÇö Server bind address (default `0.0.0.0`), port (default `9090`), auth, Ollama URLs and models
 - **Personality, memory & AI behavior** ΓÇö `personality.md`, `memory.md`, and `AIBEHAVIOR.md` (who you are / how the AI should help) are injected into every chat (web, CLI, Telegram, Discord, Matrix).
 - **Run code** ΓÇö In chat: `/run js <code>` or `/run py <code>`
 - **Self-update** ΓÇö Read/write project files: `/read path`, `/write path` + content, `/list [path]` (allowed extensions: .js, .json, .html, .css, .md, .txt, .ts, .py, etc.)
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
 
 ## Requirements
 
 - Node.js 18+
 - Ollama running locally (or on another host; set URL in Config)
 
 ## Quick start
 
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
 
 ### Build and run with Docker Compose
 
 From the project root:
 
diff --git a/ROADMAP.md b/ROADMAP.md
index 6945ba1..2c41706 100644
--- a/ROADMAP.md
+++ b/ROADMAP.md
@@ -71,24 +71,22 @@ Check schedule, create events, reminders (Google/Apple Calendar).
 
 - **Home Assistant** ΓÇö REST + WebSocket; expose as a skill or built-in tools: `call_ha_service(domain, service, data)`. Model can map ΓÇ£turn off living room lightsΓÇ¥ to the right service call.
 - **Generic HTTP** ΓÇö Skill that calls configurable URLs (GET/POST) so users can wire MQTT, IFTTT, or other APIs without coding.
 
 ---
 
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
 
 PDFs, summarize, extract.
 
 - **PDF text** ΓÇö Use a lib (e.g. `pdf-parse`) to extract text; tool `read_pdf(path_or_url)` ΓåÆ text for the model.
 - **Summarize / extract** ΓÇö No new infra: model already gets text; add ΓÇ£summarize thisΓÇ¥ / ΓÇ£extract key pointsΓÇ¥ as natural use of existing context.
 - **Office formats** ΓÇö Optional: docx/xlsx parsing for tables and headings; more dependencies.
diff --git a/public/config.html b/public/config.html
index d427b0e..8dff28a 100644
--- a/public/config.html
+++ b/public/config.html
@@ -42,20 +42,21 @@
   <main class="config-main">
     <div class="config-card">
       <h1>SYSTEM CONFIG</h1>
       <p class="config-note">Port and host changes require restarting the server.</p>
 
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
 
       <div id="panel-server" class="config-panel active" role="tabpanel">
         <section class="section">
           <h2>Server</h2>
           <div class="form-group">
             <label>Bind address</label>
@@ -139,20 +140,44 @@
             <label>SearXNG URL</label>
             <input type="url" id="searxngUrl" placeholder="https://search.example.com" />
           </div>
           <div class="form-group">
             <label><input type="checkbox" id="searxngEnabled" /> Enable web search for the AI</label>
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
             <label>SMTP host</label>
             <input type="text" id="emailHost" placeholder="smtp.example.com" />
           </div>
           <div class="form-group">
             <label>Port</label>
diff --git a/public/config.js b/public/config.js
index ac8642e..8b33c6d 100644
--- a/public/config.js
+++ b/public/config.js
@@ -150,20 +150,25 @@
     const res = await fetch('/api/config');
     if (!res.ok) return;
     const c = await res.json();
     hostEl.value = c.server?.host ?? '0.0.0.0';
     portEl.value = c.server?.port ?? 9090;
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
     document.getElementById('emailUser').value = e.auth?.user ?? '';
     document.getElementById('emailPass').value = '';
     document.getElementById('emailFrom').value = e.from ?? '';
     document.getElementById('emailDefaultTo').value = e.defaultTo ?? '';
     document.getElementById('emailEnabled').checked = e.enabled === true;
@@ -475,20 +480,27 @@
         server: {
           host: hostEl.value.trim() || '0.0.0.0',
           port: Math.max(1, Math.min(65535, parseInt(portEl.value, 10) || 9090))
         },
         timezone: timezoneEl.value.trim() || '',
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
           promptLibrary: document.getElementById('promptLibrary').checked
         },
         rag: getRagFromDom()
       };
 
@@ -501,20 +513,25 @@
       if (!res.ok) throw new Error(data.error || res.statusText);
       if (data.config) {
         const c = data.config;
         hostEl.value = c.server?.host ?? '0.0.0.0';
         portEl.value = c.server?.port ?? 9090;
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
         document.getElementById('emailUser').value = e.auth?.user ?? '';
         document.getElementById('emailFrom').value = e.from ?? '';
         document.getElementById('emailDefaultTo').value = e.defaultTo ?? '';
         document.getElementById('emailEnabled').checked = e.enabled === true;
         toggleEmailAuth();
diff --git a/server.js b/server.js
index 6887b2f..03cfd37 100644
--- a/server.js
+++ b/server.js
@@ -996,20 +996,21 @@ app.get('/api/config', (req, res) => {
   const c = getConfig();
   // Never expose credentials ΓÇö strip passwordHash and email.auth.pass
   res.json({
     server: c.server,
     timezone: c.timezone || '',
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
     })(),
     channels: (() => {
       const raw = c.channels || { apiKey: '', telegram: { enabled: false, botToken: '' }, discord: { enabled: false, botToken: '', allowedUserIds: [] }, matrix: { enabled: false, authMode: 'token', homeserverUrl: '', userId: '', accessToken: '', allowedUserIds: [] } };
       const out = { ...raw };
       if (out.matrix && typeof out.matrix === 'object') {
@@ -1269,20 +1270,21 @@ app.put('/api/config', (req, res) => {
         mainModel: next.mainModel !== undefined ? String(next.mainModel).trim() : (prev.mainModel || 'llama3.2'),
         temperature: next.temperature !== undefined ? Number(next.temperature) : (prev.temperature ?? 0.7),
         num_predict: next.num_predict !== undefined ? Number(next.num_predict) : (prev.num_predict ?? 2048),
         agents: Array.isArray(next.agents) ? next.agents : (Array.isArray(prev.agents) ? prev.agents : [])
       });
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
         if (!config.email.auth.user) config.email.auth = undefined;
       }
     }
     if (updates.ui && typeof updates.ui === 'object') {
       config.ui = { ...(config.ui || {}), ...updates.ui };
@@ -1325,20 +1327,21 @@ app.put('/api/config', (req, res) => {
     res.json({
       ok: true,
       config: {
         server: config.server,
         timezone: config.timezone || '',
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
         })(),
         channels: (() => {
           const ch = config.channels || { apiKey: '', telegram: { enabled: false, botToken: '' }, discord: { enabled: false, botToken: '', allowedUserIds: [] }, matrix: { enabled: false, authMode: 'token', homeserverUrl: '', userId: '', accessToken: '', password: '', allowedUserIds: [] } };
           const out = { ...ch };
           if (out.matrix && typeof out.matrix === 'object') {

