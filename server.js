const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { getConfig, reloadConfig, updateConfig, saveConfig, replaceConfig } = require('./lib/config.js');
const { ollamaChatStream, ollamaChatWithTools, listModels } = require('./lib/ollama.js');
const { authMiddleware, checkAuth } = require('./lib/auth.js');
const { runCode } = require('./lib/runCode.js');
const { readFile, writeFile, listFiles } = require('./lib/selfUpdate.js');
const skillsLib = require('./lib/skills.js');
const personalityLib = require('./lib/personality.js');
const heartbeatLib = require('./lib/heartbeat.js');
const searxngLib = require('./lib/searxng.js');
const fetchUrlLib = require('./lib/fetchUrl.js');
const structuredMemory = require('./lib/structuredMemory.js');
const chatStore = require('./lib/chatStore.js');
const emailLib = require('./lib/email.js');
const logger = require('./lib/logger.js');
const systemPrompt = require('./lib/systemPrompt.js');
const chatRunner = require('./lib/chatRunner.js');
const { executeSchedulerTool, getSchedulerToolDefinitions } = require('./lib/toolHandlers.js');
const pipelineRunner = require('./lib/pipelineRunner.js');
const projectStore = require('./lib/projectStore.js');
const projectImport = require('./lib/projectImport.js');

const app = express();
const PUBLIC = path.join(__dirname, 'public');

// ---------------------------------------------------------------------------
// Security headers (helmet)
// Configure CSP to allow the CDN libraries the frontend actually uses
// ---------------------------------------------------------------------------
app.use(helmet({
  // Disable HSTS — this is a local HTTP server, not a public HTTPS site.
  // HSTS would cause browsers to remember to use HTTPS and break the connection.
  strictTransportSecurity: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://cdn.jsdelivr.net"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdn.jsdelivr.net"],
      fontSrc: ["'self'", "https://fonts.googleapis.com", "https://fonts.gstatic.com"],
      connectSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      // Disable upgrade-insecure-requests — it tells browsers to force HTTPS,
      // which breaks a local HTTP-only server.
      upgradeInsecureRequests: null
    }
  }
}));

// ---------------------------------------------------------------------------
// Rate limiters
// ---------------------------------------------------------------------------
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests — slow down.' }
});

const runLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests — slow down.' }
});

// ---------------------------------------------------------------------------
// Body parsing (large limit for project import: PDFs/images sent as base64)
// ---------------------------------------------------------------------------
const JSON_LIMIT = '50mb';
app.use(bodyParser.json({ limit: JSON_LIMIT }));
app.use(bodyParser.urlencoded({ extended: true, limit: JSON_LIMIT }));

// ---------------------------------------------------------------------------
// Session — secret generated once and persisted in config
// ---------------------------------------------------------------------------
let sessionSecret = getConfig().sessionSecret;
if (!sessionSecret) {
  sessionSecret = crypto.randomBytes(32).toString('hex');
  updateConfig({ sessionSecret });
  logger.info('Generated and saved new session secret');
}

app.use(session({
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, sameSite: 'strict', maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

app.use(authMiddleware);
app.use('/static', express.static(PUBLIC));

// ---------------------------------------------------------------------------
// System prompt builder (delegates to lib)
// ---------------------------------------------------------------------------
function buildSystemPrompt(customInstructions = '') {
  return systemPrompt.buildSystemPrompt(customInstructions);
}

// ---------------------------------------------------------------------------
// Routes — public
// ---------------------------------------------------------------------------
app.get('/', (req, res) => {
  if (req.session && req.session.user) return res.redirect('/dashboard');
  res.redirect('/login');
});

app.get('/login', (req, res) => {
  if (req.session && req.session.user) return res.redirect('/app');
  res.sendFile(path.join(PUBLIC, 'login.html'));
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  if (checkAuth(username, password)) {
    req.session.user = username;
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'Invalid credentials' });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy((e) => {
    if (e) logger.warn('Session destroy error:', e.message);
  });
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Routes — protected pages
// ---------------------------------------------------------------------------
app.get('/dashboard',   (req, res) => res.sendFile(path.join(PUBLIC, 'dashboard.html')));
app.get('/app',         (req, res) => res.sendFile(path.join(PUBLIC, 'app.html')));
app.get('/config',      (req, res) => res.sendFile(path.join(PUBLIC, 'config.html')));
app.get('/skills',      (req, res) => res.sendFile(path.join(PUBLIC, 'skills.html')));
app.get('/personality', (req, res) => res.sendFile(path.join(PUBLIC, 'personality.html')));
app.get('/heartbeat',   (req, res) => res.sendFile(path.join(PUBLIC, 'heartbeat.html')));
app.get('/agents',      (req, res) => res.sendFile(path.join(PUBLIC, 'agents.html')));
app.get('/pipelines',   (req, res) => res.sendFile(path.join(PUBLIC, 'pipelines.html')));
app.get('/debug',       (req, res) => res.sendFile(path.join(PUBLIC, 'debug.html')));
app.get('/editor',      (req, res) => res.sendFile(path.join(PUBLIC, 'editor.html')));
app.get('/projects',    (req, res) => res.sendFile(path.join(PUBLIC, 'projects.html')));
app.get('/project',     (req, res) => res.sendFile(path.join(PUBLIC, 'project.html')));

// ---------------------------------------------------------------------------
// Personality & memory
// ---------------------------------------------------------------------------
app.get('/api/personality', (req, res) => {
  try {
    res.json({ content: personalityLib.readPersonality() });
  } catch (e) {
    logger.error('GET /api/personality:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/personality', (req, res) => {
  try {
    personalityLib.writePersonality(req.body?.content ?? '');
    res.json({ ok: true });
  } catch (e) {
    logger.error('PUT /api/personality:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/memory', (req, res) => {
  try {
    res.json({ content: personalityLib.readMemory() });
  } catch (e) {
    logger.error('GET /api/memory:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/memory', (req, res) => {
  try {
    personalityLib.writeMemory(req.body?.content ?? '');
    res.json({ ok: true });
  } catch (e) {
    logger.error('PUT /api/memory:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/memory/append', (req, res) => {
  try {
    const text = req.body?.text ?? '';
    if (!text.trim()) return res.status(400).json({ error: 'text required' });
    personalityLib.appendMemory(text);
    res.json({ ok: true });
  } catch (e) {
    logger.error('POST /api/memory/append:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/behavior', (req, res) => {
  try {
    res.json({ content: personalityLib.readBehavior() });
  } catch (e) {
    logger.error('GET /api/behavior:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/behavior', (req, res) => {
  try {
    personalityLib.writeBehavior(req.body?.content ?? '');
    res.json({ ok: true });
  } catch (e) {
    logger.error('PUT /api/behavior:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Projects (isolated project-specific chats and memory)
// ---------------------------------------------------------------------------
app.get('/api/projects', (req, res) => {
  try {
    res.json(projectStore.listProjects());
  } catch (e) {
    logger.error('GET /api/projects:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Project reports (multiple: each has name, schedule, toEmail, projectIds, reportPrompt)
app.get('/api/projects/reports', (req, res) => {
  try {
    const projectReport = require('./lib/projectReport.js');
    res.json(projectReport.getReports());
  } catch (e) {
    logger.error('GET /api/projects/reports:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/projects/reports', (req, res) => {
  try {
    const projectReport = require('./lib/projectReport.js');
    const body = req.body || {};
    const reports = projectReport.getReports();
    const newReport = projectReport.normalizeReport({
      id: projectReport.newReportId(),
      name: body.name,
      enabled: body.enabled,
      schedule: body.schedule,
      toEmail: body.toEmail,
      projectIds: Array.isArray(body.projectIds) ? body.projectIds : [],
      reportPrompt: body.reportPrompt
    });
    reports.push(newReport);
    projectReport.persistReports(reports);
    res.status(201).json(newReport);
  } catch (e) {
    logger.error('POST /api/projects/reports:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/projects/reports/:reportId', (req, res) => {
  try {
    const projectReport = require('./lib/projectReport.js');
    const report = projectReport.getReports().find((r) => r.id === req.params.reportId);
    if (!report) return res.status(404).json({ error: 'Report not found' });
    res.json(report);
  } catch (e) {
    logger.error('GET /api/projects/reports/:reportId:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/projects/reports/:reportId', (req, res) => {
  try {
    const projectReport = require('./lib/projectReport.js');
    const body = req.body || {};
    const reports = projectReport.getReports();
    const idx = reports.findIndex((r) => r.id === req.params.reportId);
    if (idx === -1) return res.status(404).json({ error: 'Report not found' });
    const updated = projectReport.normalizeReport({ ...reports[idx], ...body, id: reports[idx].id });
    reports[idx] = updated;
    projectReport.persistReports(reports);
    res.json(updated);
  } catch (e) {
    logger.error('PUT /api/projects/reports/:reportId:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/projects/reports/:reportId', (req, res) => {
  try {
    const projectReport = require('./lib/projectReport.js');
    const reports = projectReport.getReports().filter((r) => r.id !== req.params.reportId);
    if (reports.length === projectReport.getReports().length) return res.status(404).json({ error: 'Report not found' });
    projectReport.persistReports(reports);
    res.json({ ok: true });
  } catch (e) {
    logger.error('DELETE /api/projects/reports/:reportId:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/projects/reports/:reportId/send', async (req, res) => {
  try {
    const projectReport = require('./lib/projectReport.js');
    const result = await projectReport.sendReportNow(req.params.reportId);
    if (!result.ok) return res.status(400).json(result);
    res.json({ ok: true });
  } catch (e) {
    logger.error('POST /api/projects/reports/:reportId/send:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/projects', (req, res) => {
  try {
    const name = (req.body && req.body.name != null) ? String(req.body.name).trim() : 'Untitled project';
    const project = projectStore.createProject(name || 'Untitled project');
    if (!project) return res.status(400).json({ error: 'Failed to create project' });
    res.json(project);
  } catch (e) {
    logger.error('POST /api/projects:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/projects/:id', (req, res) => {
  try {
    const project = projectStore.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    res.json(project);
  } catch (e) {
    logger.error('GET /api/projects/:id:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/projects/:id', (req, res) => {
  try {
    const project = projectStore.updateProject(req.params.id, req.body || {});
    if (!project) return res.status(404).json({ error: 'Project not found' });
    res.json(project);
  } catch (e) {
    logger.error('PUT /api/projects/:id:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/projects/:id', (req, res) => {
  try {
    const ok = projectStore.deleteProject(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Project not found' });
    res.json({ ok: true });
  } catch (e) {
    logger.error('DELETE /api/projects/:id:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/projects/:id/memory', (req, res) => {
  try {
    const project = projectStore.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    res.json({ content: projectStore.readProjectMemory(req.params.id) });
  } catch (e) {
    logger.error('GET /api/projects/:id/memory:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/projects/:id/memory', (req, res) => {
  try {
    const project = projectStore.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    projectStore.writeProjectMemory(req.params.id, req.body?.content ?? '');
    res.json({ ok: true });
  } catch (e) {
    logger.error('PUT /api/projects/:id/memory:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/projects/:id/import', async (req, res) => {
  try {
    const projectId = req.params.id;
    const project = projectStore.getProject(projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const type = (req.body && req.body.type) ? String(req.body.type).toLowerCase() : '';
    const filename = (req.body && req.body.filename != null) ? String(req.body.filename).trim() : '';
    const summarize = !!(req.body && req.body.summarize);

    let result;
    if (type === 'text') {
      const text = req.body?.text != null ? String(req.body.text) : '';
      result = projectImport.importText(projectId, text, req.body?.sectionTitle ? String(req.body.sectionTitle) : null);
      if (!result.ok) return res.status(400).json({ error: result.error || 'Import failed' });
      if (summarize && result.content) {
        const summary = await projectImport.summarizeContent(result.content);
        if (summary) {
          const sectionTitle = filename ? `Summary: ${filename}` : 'Summary';
          projectStore.appendProjectMemory(projectId, summary, sectionTitle);
        }
        return res.json({ ok: true, summary: summary || null });
      }
      return res.json({ ok: true });
    }
    if (type === 'pdf') {
      const content = req.body?.content;
      if (content == null) return res.status(400).json({ error: 'content (base64) required for PDF' });
      const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content, 'base64');
      result = await projectImport.importPdf(projectId, buffer, filename || 'document.pdf');
      if (!result.ok) return res.status(400).json({ error: result.error || 'Import failed' });
      if (summarize && result.content) {
        const summary = await projectImport.summarizeContent(result.content);
        if (summary) {
          const sectionTitle = filename ? `Summary: ${filename}` : 'Summary';
          projectStore.appendProjectMemory(projectId, summary, sectionTitle);
        }
        return res.json({ ok: true, chars: result.chars, summary: summary || null });
      }
      return res.json({ ok: true, chars: result.chars });
    }
    if (type === 'image') {
      const content = req.body?.content;
      if (content == null) return res.status(400).json({ error: 'content (base64 or data URL) required for image' });
      result = await projectImport.importImage(projectId, content, filename || 'image');
      if (!result.ok) return res.status(400).json({ error: result.error || 'Import failed' });
      if (summarize && result.content) {
        const summary = await projectImport.summarizeContent(result.content);
        if (summary) {
          const sectionTitle = filename ? `Summary: ${filename}` : 'Summary';
          projectStore.appendProjectMemory(projectId, summary, sectionTitle);
        }
        return res.json({ ok: true, summary: summary || null });
      }
      return res.json({ ok: true });
    }
    if (type === 'docx') {
      const content = req.body?.content;
      if (content == null) return res.status(400).json({ error: 'content (base64) required for Word document' });
      const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content, 'base64');
      result = await projectImport.importDocx(projectId, buffer, filename || 'document.docx');
      if (!result.ok) return res.status(400).json({ error: result.error || 'Import failed' });
      if (summarize && result.content) {
        const summary = await projectImport.summarizeContent(result.content);
        if (summary) {
          const sectionTitle = filename ? `Summary: ${filename}` : 'Summary';
          projectStore.appendProjectMemory(projectId, summary, sectionTitle);
        }
        return res.json({ ok: true, chars: result.chars, summary: summary || null });
      }
      return res.json({ ok: true, chars: result.chars });
    }
    if (type === 'doc') {
      const content = req.body?.content;
      if (content == null) return res.status(400).json({ error: 'content (base64) required for Word .doc file' });
      const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content, 'base64');
      result = await projectImport.importDoc(projectId, buffer, filename || 'document.doc');
      if (!result.ok) return res.status(400).json({ error: result.error || 'Import failed' });
      if (summarize && result.content) {
        const summary = await projectImport.summarizeContent(result.content);
        if (summary) {
          const sectionTitle = filename ? `Summary: ${filename}` : 'Summary';
          projectStore.appendProjectMemory(projectId, summary, sectionTitle);
        }
        return res.json({ ok: true, chars: result.chars, summary: summary || null });
      }
      return res.json({ ok: true, chars: result.chars });
    }
    return res.status(400).json({ error: 'type must be text, pdf, image, doc, or docx' });
  } catch (e) {
    logger.error('POST /api/projects/:id/import:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Structured memory
// ---------------------------------------------------------------------------
app.get('/api/structured-memory', (req, res) => {
  try {
    res.json(structuredMemory.readAll());
  } catch (e) {
    logger.error('GET /api/structured-memory:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/structured-memory', (req, res) => {
  try {
    structuredMemory.writeAll(req.body || {});
    res.json({ ok: true });
  } catch (e) {
    logger.error('PUT /api/structured-memory:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------
app.get('/api/skills', (req, res) => {
  try {
    skillsLib.ensureEnabledSkillsLoaded();
    res.json({ skills: skillsLib.listSkills() });
  } catch (e) {
    logger.error('GET /api/skills:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/skills/:id', (req, res) => {
  try {
    const meta = skillsLib.getSkillMeta(req.params.id);
    const code = skillsLib.getSkillCode(req.params.id);
    if (!meta) return res.status(404).json({ error: 'Skill not found' });
    res.json({ id: req.params.id, name: meta.name, description: meta.description || '', code: code || '' });
  } catch (e) {
    logger.error('GET /api/skills/:id:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/skills/:id', (req, res) => {
  const { name, description, code } = req.body || {};
  try {
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (code !== undefined) updates.code = code;
    const skill = skillsLib.updateSkill(req.params.id, updates);
    res.json({ ok: true, skill });
  } catch (e) {
    logger.warn('PUT /api/skills/:id:', e.message);
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/skills/:id/enabled', (req, res) => {
  const enabled = req.body?.enabled === true;
  try {
    skillsLib.setSkillEnabled(req.params.id, enabled);
    const enabledList = skillsLib.listSkills().filter(s => s.enabled).map(s => s.id);
    updateConfig({ skills: { enabledIds: enabledList } });
    res.json({ ok: true, enabled });
  } catch (e) {
    logger.warn('PUT /api/skills/:id/enabled:', e.message);
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/skills/run', runLimiter, async (req, res) => {
  const { id, args } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id required' });
  try {
    const result = await skillsLib.runSkill(id, args || {});
    res.json({ ok: true, result });
  } catch (e) {
    logger.warn('POST /api/skills/run:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/skills/:id', (req, res) => {
  const id = req.params.id;
  const fs = require('fs');
  const skillDir = skillsLib.getSkillDir(id);
  if (!skillDir) return res.status(404).json({ error: 'Skill not found' });
  try {
    skillsLib.unloadSkill(id);
    fs.rmSync(skillDir, { recursive: true });
    res.json({ ok: true });
  } catch (e) {
    logger.error('DELETE /api/skills/:id:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/skills/create', (req, res) => {
  const { id, name, description, code } = req.body || {};
  if (!id || typeof code !== 'string') {
    return res.status(400).json({ error: 'id and code required' });
  }
  try {
    const skill = skillsLib.createSkill(id, name, description, code);
    res.json({ ok: true, skill });
  } catch (e) {
    logger.warn('POST /api/skills/create:', e.message);
    res.status(400).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
app.get('/api/app-name', (req, res) => {
  const c = getConfig();
  const name = (c.ui && c.ui.appName != null && String(c.ui.appName).trim()) ? String(c.ui.appName).trim() : 'SHADOW_AI';
  res.json({ appName: name });
});

app.get('/api/config', (req, res) => {
  const c = getConfig();
  // Never expose credentials — strip passwordHash and email.auth.pass
  res.json({
    server: c.server,
    timezone: c.timezone || '',
    auth: { username: c.auth.username },
    ollama: c.ollama,
    heartbeat: c.heartbeat || [],
    webhooks: c.webhooks || [],
    searxng: c.searxng || { url: '', enabled: false },
    email: (() => {
      const e = c.email || {};
      const safe = { ...e };
      if (safe.auth) safe.auth = { user: safe.auth.user || '' }; // never send pass
      return safe;
    })(),
    channels: c.channels || { apiKey: '', telegram: { enabled: false, botToken: '' }, discord: { enabled: false, botToken: '' } },
    ui: c.ui || { showToolCalls: true, promptLibrary: true, appName: 'SHADOW_AI' }
  });
});

app.put('/api/config', (req, res) => {
  try {
    const updates = req.body || {};
    if (!updates || typeof updates !== 'object') {
      return res.status(400).json({ error: 'Invalid request body' });
    }

    const current = getConfig();
    const config = JSON.parse(JSON.stringify(current));

    if (updates.server && typeof updates.server === 'object') {
      config.server = { ...config.server, ...updates.server };
    }
    if (updates.auth && typeof updates.auth === 'object') {
      const authUpdates = { ...updates.auth };
      if (authUpdates.passwordHash && !String(authUpdates.passwordHash).startsWith('$2')) {
        authUpdates.passwordHash = bcrypt.hashSync(authUpdates.passwordHash, 12);
      }
      config.auth = { ...config.auth, ...authUpdates };
      if (updates.auth.passwordHash === '') delete config.auth.passwordHash;
    }
    if (updates.ollama && typeof updates.ollama === 'object') {
      const prev = config.ollama || {};
      const next = updates.ollama;
      config.ollama = {
        mainUrl: next.mainUrl !== undefined ? String(next.mainUrl).trim() : (prev.mainUrl || 'http://localhost:11434'),
        mainModel: next.mainModel !== undefined ? String(next.mainModel).trim() : (prev.mainModel || 'llama3.2'),
        temperature: next.temperature !== undefined ? Number(next.temperature) : (prev.temperature ?? 0.7),
        num_predict: next.num_predict !== undefined ? Number(next.num_predict) : (prev.num_predict ?? 2048),
        agents: Array.isArray(next.agents) ? next.agents : (Array.isArray(prev.agents) ? prev.agents : [])
      };
    }
    if (updates.heartbeat && Array.isArray(updates.heartbeat)) config.heartbeat = updates.heartbeat;
    if (updates.webhooks && Array.isArray(updates.webhooks)) config.webhooks = updates.webhooks;
    if (updates.skills && updates.skills.enabledIds !== undefined) config.skills = { ...(config.skills || {}), enabledIds: updates.skills.enabledIds };
    if (updates.searxng && typeof updates.searxng === 'object') config.searxng = { ...(config.searxng || {}), ...updates.searxng };
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
    }
    if (typeof updates.timezone === 'string') {
      config.timezone = updates.timezone.trim();
    }
    if (updates.channels && typeof updates.channels === 'object') {
      config.channels = {
        apiKey: updates.channels.apiKey !== undefined ? String(updates.channels.apiKey) : (config.channels && config.channels.apiKey) || '',
        telegram: { ...(config.channels && config.channels.telegram), ...(updates.channels.telegram || {}), enabled: !!(updates.channels.telegram && updates.channels.telegram.enabled), botToken: (updates.channels.telegram && updates.channels.telegram.botToken !== undefined) ? String(updates.channels.telegram.botToken) : (config.channels && config.channels.telegram && config.channels.telegram.botToken) || '' },
        discord: { ...(config.channels && config.channels.discord), ...(updates.channels.discord || {}), enabled: !!(updates.channels.discord && updates.channels.discord.enabled), botToken: (updates.channels.discord && updates.channels.discord.botToken !== undefined) ? String(updates.channels.discord.botToken) : (config.channels && config.channels.discord && config.channels.discord.botToken) || '', allowedUserIds: Array.isArray(updates.channels.discord && updates.channels.discord.allowedUserIds) ? updates.channels.discord.allowedUserIds.filter(id => typeof id === 'string').map(s => s.trim()).filter(Boolean) : (config.channels && config.channels.discord && config.channels.discord.allowedUserIds) || [] }
      };
    } else if (!config.channels) {
      config.channels = { apiKey: '', telegram: { enabled: false, botToken: '' }, discord: { enabled: false, botToken: '', allowedUserIds: [] } };
    }

    replaceConfig(config);

    if (config.heartbeat && config.heartbeat.length > 0) heartbeatLib.startHeartbeat();

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
        email: (() => {
          const e = config.email || {};
          const safe = { ...e };
          if (safe.auth) safe.auth = { user: safe.auth.user || '' };
          return safe;
        })(),
        channels: config.channels || { apiKey: '', telegram: { enabled: false, botToken: '' }, discord: { enabled: false, botToken: '', allowedUserIds: [] } },
        ui: config.ui || { showToolCalls: true, promptLibrary: true, appName: 'SHADOW_AI' }
      }
    });
  } catch (e) {
    logger.error('PUT /api/config:', e.message);
    res.status(400).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Notifications / email test
// ---------------------------------------------------------------------------
app.post('/api/notifications/test-email', async (req, res) => {
  const c = getConfig().email || {};
  if (!c.host || !c.from || !c.defaultTo) {
    return res.status(400).json({ error: 'Configure host, From, and To (default) first, then save.' });
  }
  try {
    await emailLib.sendMail(c, {
      to: c.defaultTo,
      subject: 'ShadowAI test email',
      text: 'This is a test email from ShadowAI. If you received this, email notifications are working.'
    });
    res.json({ ok: true, message: 'Test email sent.' });
  } catch (e) {
    logger.error('Test email failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Debug endpoints
// ---------------------------------------------------------------------------
app.get('/api/debug/searxng', (req, res) => {
  const c = getConfig().searxng || {};
  res.json({
    config: { url: c.url || '', enabled: c.enabled === true },
    toolInChat: !!(c.url && c.enabled)
  });
});

app.post('/api/debug/searxng', async (req, res) => {
  const query = (req.body && req.body.query) ? String(req.body.query).trim() : 'hello world';
  const c = getConfig().searxng || {};
  const baseUrl = c.url || '';
  try {
    const debug = await searxngLib.searchDebug(baseUrl, query, { limit: 5 });
    res.json({ config: { url: baseUrl, enabled: c.enabled === true }, ...debug });
  } catch (e) {
    logger.error('POST /api/debug/searxng:', e.message);
    res.status(500).json({ config: { url: baseUrl, enabled: c.enabled === true }, error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Ollama models
// ---------------------------------------------------------------------------
app.get('/api/ollama/models', async (req, res) => {
  const url = req.query.url || getConfig().ollama.mainUrl;
  try {
    const models = await listModels(url);
    res.json({ models });
  } catch (e) {
    logger.warn('GET /api/ollama/models:', e.message);
    res.status(502).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Heartbeat
// ---------------------------------------------------------------------------
app.post('/api/heartbeat/run/:id', async (req, res) => {
  const id = req.params.id;
  const jobs = (getConfig().heartbeat || []).filter(j => j.id === id);
  if (!jobs.length) return res.status(404).json({ error: 'Job not found' });
  try {
    const result = await heartbeatLib.runJob(jobs[0]);
    res.json({ ok: true, result });
  } catch (e) {
    logger.error('POST /api/heartbeat/run/:id:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Webhook receiver (inbound — no session auth, rate-limited)
// ---------------------------------------------------------------------------
app.post('/api/webhook/receive/:id', runLimiter, async (req, res) => {
  const id = req.params.id;
  const webhooks = getConfig().webhooks || [];
  const webhook = webhooks.find(w => w.id === id);
  if (!webhook || !webhook.enabled) return res.status(404).json({ error: 'Webhook not found or disabled' });
  if (webhook.secret) {
    const provided = (req.headers['x-webhook-secret'] || '').trim();
    if (!provided || provided !== webhook.secret) return res.status(401).json({ error: 'Invalid webhook secret' });
  }
  try {
    const bodyStr = JSON.stringify(req.body || {});
    const context = { body: bodyStr, ...(typeof req.body === 'object' && req.body !== null ? req.body : {}) };
    function subVars(str) {
      return String(str || '').replace(/\{\{(\w+)\}\}/g, (_, k) => context[k] != null ? String(context[k]) : '');
    }
    let result;
    if (webhook.action === 'skill' && webhook.skillId) {
      result = await skillsLib.runSkill(webhook.skillId, req.body || {});
    } else if (webhook.action === 'prompt' && webhook.prompt) {
      const cfg = getConfig();
      const data = await require('./lib/ollama.js').ollamaChatJson(
        cfg.ollama.mainUrl, cfg.ollama.mainModel,
        [{ role: 'user', content: subVars(webhook.prompt) }]
      );
      result = data?.message?.content || '';
    } else {
      result = 'No action configured';
    }
    logger.info('[Webhook] received', id, '(', webhook.name, ')');
    res.json({ ok: true, result });
  } catch (e) {
    logger.error('[Webhook] receive error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Chat history / sessions
// ---------------------------------------------------------------------------
app.get('/api/chats', (req, res) => {
  const user = req.session && req.session.user;
  if (!user) return res.json({ chats: [], currentChatId: null, channelChats: [] });
  const data = chatStore.listChats(user);
  const channelChats = chatStore.listAllChannelChats();
  res.json({ chats: data.chats, currentChatId: data.currentChatId, channelChats });
});

app.post('/api/chats', (req, res) => {
  const user = req.session && req.session.user;
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  try {
    res.json(chatStore.createChat(user));
  } catch (e) {
    logger.error('POST /api/chats:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/chats/:id', (req, res) => {
  const user = req.session && req.session.user;
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const deleted = chatStore.deleteChat(user, req.params.id);
  if (!deleted) return res.status(404).json({ error: 'Chat not found' });
  const data = chatStore.listChats(user);
  res.json({ ok: true, currentChatId: data.currentChatId, chats: data.chats });
});

app.patch('/api/chats/:id', (req, res) => {
  const user = req.session && req.session.user;
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const { title, customInstructions } = req.body || {};
  const updated = chatStore.updateChat(user, req.params.id, { title, customInstructions });
  if (!updated) return res.status(404).json({ error: 'Chat not found' });
  res.json({ ok: true });
});

app.get('/api/chat/history', (req, res) => {
  const user = req.session && req.session.user;
  const chatId = req.query.chatId || undefined;
  const channelOwner = (req.query.username || '').trim();
  const effectiveUser = (user && channelOwner && chatStore.isChannelUsername(channelOwner)) ? channelOwner : user;
  const data = effectiveUser ? chatStore.readChat(effectiveUser, chatId) : { messages: [], title: null, customInstructions: '' };
  res.json({ messages: data.messages, title: data.title, customInstructions: data.customInstructions });
});

app.post('/api/chat/reset', (req, res) => {
  const user = req.session && req.session.user;
  const channelOwner = (req.body && req.body.username != null) ? String(req.body.username).trim() : '';
  const effectiveUser = (user && channelOwner && chatStore.isChannelUsername(channelOwner)) ? channelOwner : user;
  if (effectiveUser) chatStore.clearCurrentChat(effectiveUser);
  res.json({ ok: true });
});

app.put('/api/chat/history', (req, res) => {
  const messages = req.body?.messages;
  const chatId = req.body?.chatId;
  if (!Array.isArray(messages)) return res.status(400).json({ error: 'messages array required' });
  const user = req.session && req.session.user;
  const channelOwner = (req.body?.username || '').trim();
  const effectiveUser = (user && channelOwner && chatStore.isChannelUsername(channelOwner)) ? channelOwner : user;
  if (effectiveUser) chatStore.writeChat(effectiveUser, messages, chatId);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Main chat endpoint (streaming + tool calls)
// ---------------------------------------------------------------------------
app.post('/api/chat', chatLimiter, async (req, res) => {
  const { messages, agentId, stream: wantStream, chatId: bodyChatId, customInstructions, channelChatOwner, projectId: bodyProjectId } = req.body || {};
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array required' });
  }
  const user = req.session && req.session.user;
  const channelOwner = (channelChatOwner || '').trim();
  const effectiveUser = (user && channelOwner && chatStore.isChannelUsername(channelOwner)) ? channelOwner : user;
  const config = getConfig();
  let baseUrl = config.ollama.mainUrl;
  let model = config.ollama.mainModel;
  if (agentId && config.ollama.agents) {
    const agent = config.ollama.agents.find(a => a.id === agentId && a.enabled);
    if (agent) {
      baseUrl = agent.url || baseUrl;
      model = agent.model;
    }
  }
  const ollamaOptions = {};
  if (config.ollama.temperature != null && config.ollama.temperature !== '') ollamaOptions.temperature = Number(config.ollama.temperature);
  if (config.ollama.num_predict != null && config.ollama.num_predict !== '') ollamaOptions.num_predict = Number(config.ollama.num_predict);
  const isProjectChat = channelOwner && channelOwner.startsWith('project_');
  // Use explicit projectId from body (same as Memory tab) so we always read the correct project's memory
  const projectId = (isProjectChat && (bodyProjectId || channelOwner.slice(7)))
    ? String(bodyProjectId || channelOwner.slice(7)).trim()
    : null;
  if (isProjectChat && projectId) {
    const memPath = projectStore.getProjectMemoryPath(projectId);
    const projectMemoryRaw = projectStore.readProjectMemory(projectId);
    logger.info('[Project chat] projectId=%s path=%s memoryLength=%d', projectId, memPath || 'none', projectMemoryRaw ? projectMemoryRaw.length : 0);
    if (!projectMemoryRaw || !projectMemoryRaw.trim()) {
      logger.warn('[Project chat] memory empty for projectId=%s (file may be missing or empty: %s)', projectId, memPath || '');
    }
  }
  // Build system prompt; for project chat we keep it short and inject memory as first user message so model reliably sees it
  const projectMemoryContent = isProjectChat && projectId ? projectStore.readProjectMemory(projectId).trim() : '';
  const systemContent = isProjectChat && projectId
    ? systemPrompt.buildProjectSystemPrompt(projectId, typeof customInstructions === 'string' ? customInstructions : '', !projectMemoryContent)
    : buildSystemPrompt(typeof customInstructions === 'string' ? customInstructions : '');
  const systemPromptMsg = {
    role: 'system',
    content: systemContent
  };
  let fullMessages = [systemPromptMsg, ...messages];
  if (isProjectChat && projectId && projectMemoryContent) {
    const memoryBlock = 'PROJECT MEMORY (use this to answer the user\'s questions that follow):\n\n---\n' + projectMemoryContent + '\n---\n\nNow answer the user\'s question using only the memory above.';
    fullMessages = [systemPromptMsg, { role: 'user', content: memoryBlock }, ...messages];
  }

  if (wantStream !== false) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    let assistantContent = '';
    let tokenStats = null;
    try {
      skillsLib.ensureEnabledSkillsLoaded();
      const enabledSkills = skillsLib.listSkills().filter(s => s.enabled && s.loaded);
      const appendMemoryTool = {
        type: 'function',
        function: {
          name: 'append_memory',
          description: 'Save a fact to the AI\'s memory (data/memory.md). Use this when the user asks you to remember something (e.g. their name, a preference). Memory is then included in your context on the next turn. Do not ask the user to run /read or /write—call this tool.',
          parameters: {
            type: 'object',
            required: ['text'],
            properties: { text: { type: 'string', description: 'The fact to remember (e.g. "User name: John")' } }
          }
        }
      };
      const skillTools = enabledSkills.map(s => ({
        type: 'function',
        function: {
          name: s.id,
          description: s.description || s.name || `Skill: ${s.id}`,
          parameters: { type: 'object', description: 'Arguments for the skill (e.g. host, count)' }
        }
      }));
      const searxng = getConfig().searxng || {};
      const webSearchTool = (searxng.url && searxng.enabled) ? {
        type: 'function',
        function: {
          name: 'web_search',
          description: 'Search the internet via SearXNG. Use when the user asks about current events, facts, or anything you need to look up.',
          parameters: {
            type: 'object',
            required: ['query'],
            properties: { query: { type: 'string', description: 'Search query' } }
          }
        }
      } : null;
      const fetchUrlTool = {
        type: 'function',
        function: {
          name: 'fetch_url',
          description: 'Fetch a webpage and get its title and text content. Use when the user gives you a URL or asks you to read/check a website.',
          parameters: {
            type: 'object',
            required: ['url'],
            properties: { url: { type: 'string', description: 'Full URL (http or https) to fetch' } }
          }
        }
      };
      const emailCfg = getConfig().email || {};
      const sendEmailTool = (emailCfg.host && emailCfg.from && emailCfg.defaultTo && emailCfg.enabled) ? {
        type: 'function',
        function: {
          name: 'send_email',
          description: 'Send an email. Use when the user asks you to email them something (e.g. a summary, notes, a reminder). Omit "to" when the user says "email me" or does not give an address—the system will use the configured default recipient. Only include "to" when the user explicitly provides a different email address.',
          parameters: {
            type: 'object',
            required: ['subject', 'text'],
            properties: {
              to: { type: 'string', description: 'Recipient email. Omit or leave empty to use the configured default.' },
              subject: { type: 'string', description: 'Email subject' },
              text: { type: 'string', description: 'Plain-text body of the email' }
            }
          }
        }
      } : null;
      const getMemoryTool = {
        type: 'function',
        function: {
          name: 'get_memory',
          description: 'Get a structured memory value from data/memory.json by key. Use this for key-value facts like timezone, current project, etc. (not for free-form notes).',
          parameters: {
            type: 'object',
            required: ['key'],
            properties: { key: { type: 'string', description: 'Memory key' } }
          }
        }
      };
      const setMemoryTool = {
        type: 'function',
        function: {
          name: 'set_memory',
          description: 'Set a structured memory value in data/memory.json. Use this to store or update key-value facts (e.g. user timezone, current project).',
          parameters: {
            type: 'object',
            required: ['key', 'value'],
            properties: {
              key: { type: 'string', description: 'Memory key' },
              value: { type: 'string', description: 'Memory value' }
            }
          }
        }
      };
      const appendProjectMemoryTool = (isProjectChat && projectId) ? {
        type: 'function',
        function: {
          name: 'append_project_memory',
          description: 'Save important information to this project\'s memory (project memory file). Use when the user shares facts, decisions, dates, contacts, or requirements they want remembered for this project.',
          parameters: {
            type: 'object',
            required: ['text'],
            properties: {
              text: { type: 'string', description: 'The information to save (e.g. "Launch date: March 2025")' },
              sectionTitle: { type: 'string', description: 'Optional section heading (e.g. "Key dates")' }
            }
          }
        }
      } : null;
      // Common tools (web search, URL fetch, email, skills, scheduler)
      const commonTools = [
        ...(webSearchTool ? [webSearchTool] : []),
        fetchUrlTool,
        ...(sendEmailTool ? [sendEmailTool] : []),
        ...skillTools,
        ...getSchedulerToolDefinitions()
      ];
      // For normal chats: allow global memory tools + skills
      // For project chats: allow project-specific memory tool + skills (no global memory tools to keep isolation)
      const tools = isProjectChat && projectId
        ? [
            ...(appendProjectMemoryTool ? [appendProjectMemoryTool] : []),
            ...commonTools
          ]
        : [
            appendMemoryTool,
            getMemoryTool,
            setMemoryTool,
            ...commonTools
          ];

      if (tools.length > 0) {
        let messagesForOllama = [...fullMessages];
        let finalContent = '';
        let maxRounds = 5;
        while (maxRounds-- > 0) {
          const data = await ollamaChatWithTools(baseUrl, model, messagesForOllama, tools, ollamaOptions);
          const msg = data.message || {};
          const toolCalls = msg.tool_calls || [];
          if (toolCalls.length === 0) {
            finalContent = msg.content || '';
            if (data.eval_count != null || data.prompt_eval_count != null) {
              tokenStats = { promptTokens: data.prompt_eval_count || 0, evalTokens: data.eval_count || 0 };
            }
            break;
          }
          messagesForOllama.push({
            role: 'assistant',
            content: msg.content || '',
            tool_calls: toolCalls
          });
          for (const tc of toolCalls) {
            const name = tc.function?.name;
            let args = tc.function?.arguments;
            if (typeof args === 'string') {
              try { args = JSON.parse(args); } catch (e) { args = {}; }
            }
            if (typeof args !== 'object' || args === null) args = {};

            // Notify the client which tool is being called
            res.write(`data: ${JSON.stringify({ toolCall: name })}\n\n`);

            try {
              let content;
              if (name === 'append_memory') {
                const text = args.text != null ? String(args.text).trim() : '';
                if (text) personalityLib.appendMemory(text);
                content = text ? 'Saved to memory.' : 'No text provided.';
              } else if (name === 'append_project_memory' && projectId) {
                const text = args.text != null ? String(args.text).trim() : '';
                const sectionTitle = args.sectionTitle != null ? String(args.sectionTitle).trim() : null;
                if (text) projectStore.appendProjectMemory(projectId, text, sectionTitle || undefined);
                content = text ? 'Saved to project memory.' : 'No text provided.';
              } else if (name === 'web_search') {
                const query = args.query != null ? String(args.query).trim() : '';
                if (!query) content = 'No query provided.';
                else {
                  const searxngCfg = getConfig().searxng || {};
                  const results = await searxngLib.search(searxngCfg.url, query, { limit: 8 });
                  content = results.length === 0
                    ? 'No results found.'
                    : results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.content || ''}`).join('\n\n');
                }
              } else if (name === 'fetch_url') {
                const url = args.url != null ? String(args.url).trim() : '';
                if (!url) content = 'No URL provided.';
                else {
                  try {
                    const page = await fetchUrlLib.fetchPage(url);
                    content = 'Title: ' + (page.title || '(none)') + '\nURL: ' + page.url + '\n\nContent:\n' + (page.content || '').slice(0, 60000);
                  } catch (err) {
                    logger.warn('fetch_url tool error:', err.message);
                    content = 'Error: ' + err.message;
                  }
                }
              } else if (name === 'send_email') {
                const subject = args.subject != null ? String(args.subject).trim() : '';
                const text = args.text != null ? String(args.text) : '';
                const toArg = args.to != null ? String(args.to).trim() : '';
                const cfg = getConfig().email || {};
                const looksLikeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+/.test(toArg);
                const to = looksLikeEmail ? toArg : (cfg.defaultTo || '').trim();
                if (!subject && !text) content = 'No subject or body provided.';
                else if (!to) content = 'Error: No recipient. Set "Default To" in Config → Notifications.';
                else {
                  try {
                    await emailLib.sendMail(cfg, { to, subject: subject || '(No subject)', text: text || '(No content)' });
                    content = 'Email sent to ' + to + '.';
                  } catch (err) {
                    logger.error('send_email tool error:', err.message);
                    content = 'Error: ' + err.message;
                  }
                }
              } else if (name === 'get_memory') {
                const key = args.key != null ? String(args.key).trim() : '';
                content = key ? structuredMemory.getMemory(key) : '';
              } else if (name === 'set_memory') {
                const key = args.key != null ? String(args.key).trim() : '';
                const value = args.value != null ? String(args.value) : '';
                if (!key) content = 'Error: key is required.';
                else {
                  structuredMemory.setMemory(key, value);
                  content = `Stored structured memory for key \"${key}\".`;
                }
              } else if (['create_skill', 'add_heartbeat_job', 'update_skill', 'update_heartbeat_job', 'list_heartbeat_jobs'].includes(name)) {
                content = await executeSchedulerTool(name, args);
              } else {
                const result = await skillsLib.runSkill(name, args);
                content = typeof result === 'object' ? JSON.stringify(result) : String(result);
              }
              res.write(`data: ${JSON.stringify({ toolResult: { name, args, result: String(content).slice(0, 500) } })}\n\n`);
              messagesForOllama.push({ role: 'tool', tool_name: name, content });
            } catch (err) {
              logger.warn(`Tool "${name}" error:`, err.message);
              const errContent = String(err.message);
              res.write(`data: ${JSON.stringify({ toolResult: { name, args, result: errContent.slice(0, 500), error: true } })}\n\n`);
              messagesForOllama.push({ role: 'tool', tool_name: name, content: errContent });
            }
          }
        }
        assistantContent = finalContent || '';
        if (finalContent) res.write(`data: ${JSON.stringify({ content: finalContent })}\n\n`);
      } else {
        for await (const chunk of ollamaChatStream(baseUrl, model, fullMessages, ollamaOptions, (meta) => { tokenStats = meta; })) {
          assistantContent += chunk;
          res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
        }
      }
      const newHistory = messages.concat([{ role: 'assistant', content: assistantContent }]);
      if (tokenStats) res.write(`data: ${JSON.stringify({ tokenStats })}\n\n`);
      if (effectiveUser) {
        const usedId = chatStore.writeChat(effectiveUser, newHistory, bodyChatId);
        res.write('data: ' + JSON.stringify({ done: true, chatId: usedId }) + '\n\n');
      } else {
        res.write('data: {"done":true}\n\n');
      }
      if (req.session && effectiveUser === user) req.session.chatHistory = newHistory;
    } catch (e) {
      logger.error('POST /api/chat stream error:', e.message);
      res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
    }
    return res.end();
  }

  // Non-streaming fallback
  const { ollamaChatJson } = require('./lib/ollama.js');
  try {
    const out = await ollamaChatJson(baseUrl, model, fullMessages, ollamaOptions);
    const assistantContent = out.message?.content || '';
    const newHistory = messages.concat([{ role: 'assistant', content: assistantContent }]);
    if (req.session && effectiveUser === user) req.session.chatHistory = newHistory;
    const usedChatId = effectiveUser ? chatStore.writeChat(effectiveUser, newHistory, bodyChatId) : null;
    res.json({ message: out.message, chatId: usedChatId });
  } catch (e) {
    logger.error('POST /api/chat non-stream error:', e.message);
    res.status(502).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Channel API (CLI / bots) — API key auth, no session
// ---------------------------------------------------------------------------
app.post('/api/channel/chat', chatLimiter, async (req, res) => {
  const channels = getConfig().channels || {};
  const apiKey = (channels.apiKey || '').trim();
  const keyFromHeader = (req.headers['x-api-key'] || '').trim();
  const keyFromBody = (req.body && req.body.apiKey != null) ? String(req.body.apiKey).trim() : '';
  const provided = keyFromHeader || keyFromBody;
  if (!apiKey) return res.status(503).json({ error: 'Channels API key not configured' });
  if (provided !== apiKey) return res.status(401).json({ error: 'Invalid or missing API key' });

  const message = req.body && req.body.message != null ? String(req.body.message).trim() : '';
  if (!message) return res.status(400).json({ error: 'message required' });
  const userId = (req.body && req.body.userId != null) ? String(req.body.userId) : 'cli';
  const username = 'channel_' + userId;

  try {
    const data = chatStore.readChat(username);
    const messages = (data && data.messages) ? [...data.messages] : [];
    messages.push({ role: 'user', content: message });
    const { content } = await chatRunner.runChatTurn({ user: username, messages, customInstructions: (data && data.customInstructions) || '', agentId: null });
    messages.push({ role: 'assistant', content });
    const usedChatId = chatStore.writeChat(username, messages);
    res.json({ content, chatId: usedChatId });
  } catch (e) {
    logger.error('POST /api/channel/chat:', e.message);
    res.status(502).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Code execution
// ---------------------------------------------------------------------------
app.post('/api/run', runLimiter, async (req, res) => {
  const { language, code, timeout } = req.body || {};
  if (!code || typeof code !== 'string') {
    return res.status(400).json({ error: 'code required' });
  }
  const t = Math.min(Number(timeout) || 30000, 60000);
  try {
    const result = await runCode(language || 'js', code, t);
    res.json(result);
  } catch (e) {
    logger.error('POST /api/run:', e.message);
    res.status(500).json({ stdout: '', stderr: e.message, exitCode: -1 });
  }
});

// ---------------------------------------------------------------------------
// File access (self-update)
// ---------------------------------------------------------------------------
app.get('/api/files', (req, res) => {
  try {
    res.json({ files: listFiles(req.query.path || '.') });
  } catch (e) {
    logger.warn('GET /api/files:', e.message);
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/file', (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: 'path required' });
  try {
    res.json({ path: filePath, content: readFile(filePath) });
  } catch (e) {
    logger.warn('GET /api/file:', e.message);
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/file', (req, res) => {
  const { path: filePath, content } = req.body || {};
  if (!filePath || content === undefined) {
    return res.status(400).json({ error: 'path and content required' });
  }
  try {
    writeFile(filePath, content);
    res.json({ ok: true });
  } catch (e) {
    logger.warn('PUT /api/file:', e.message);
    res.status(400).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Editor AI assist (streaming)
// ---------------------------------------------------------------------------
app.post('/api/editor/assist', chatLimiter, async (req, res) => {
  const { path: filePath, content, instruction, agentId } = req.body || {};
  if (!instruction || typeof instruction !== 'string') {
    return res.status(400).json({ error: 'instruction required' });
  }

  const config = getConfig();
  let baseUrl = config.ollama.mainUrl;
  let model   = config.ollama.mainModel;
  if (agentId && config.ollama.agents) {
    const agent = config.ollama.agents.find(a => a.id === agentId && a.enabled);
    if (agent) { baseUrl = agent.url || baseUrl; model = agent.model; }
  }

  const ollamaOptions = {};
  if (config.ollama.temperature != null && config.ollama.temperature !== '') ollamaOptions.temperature = Number(config.ollama.temperature);

  const fileHint = filePath ? `File: ${filePath}\n` : '';
  const codeBlock = content
    ? `\`\`\`\n${content}\n\`\`\``
    : '(no file open)';

  const systemPrompt = 'You are a senior software engineer. The user will show you code and ask you to help. When you modify or rewrite code, always output the complete updated file inside a single fenced code block so it can be applied directly. Be concise. Do not repeat the unchanged parts with ellipsis—always output the full file content inside the code block.';
  const userMessage  = `${fileHint}${codeBlock}\n\n${instruction}`;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    for await (const chunk of ollamaChatStream(baseUrl, model, [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userMessage }
    ], ollamaOptions)) {
      res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
    }
    res.write('data: {"done":true}\n\n');
  } catch (e) {
    logger.error('POST /api/editor/assist:', e.message);
    res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
  }
  res.end();
});

// ---------------------------------------------------------------------------
// Prompt library
// ---------------------------------------------------------------------------
const PROMPTS_PATH = path.join(__dirname, 'data', 'prompts.json');

function readPrompts() {
  const fs = require('fs');
  try {
    if (fs.existsSync(PROMPTS_PATH)) return JSON.parse(fs.readFileSync(PROMPTS_PATH, 'utf8'));
  } catch (_) {}
  return [];
}

function writePrompts(arr) {
  const fs = require('fs');
  const dir = path.dirname(PROMPTS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(PROMPTS_PATH, JSON.stringify(arr, null, 2), 'utf8');
}

app.get('/api/prompts', (req, res) => {
  res.json(readPrompts());
});

app.post('/api/prompts', (req, res) => {
  const { title, content } = req.body || {};
  if (!title || !content) return res.status(400).json({ error: 'title and content required' });
  const prompts = readPrompts();
  const id = crypto.randomUUID();
  prompts.push({ id, title: String(title).trim().slice(0, 120), content: String(content) });
  writePrompts(prompts);
  res.json({ ok: true, id });
});

app.delete('/api/prompts/:id', (req, res) => {
  writePrompts(readPrompts().filter(p => p.id !== req.params.id));
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Pipelines
// ---------------------------------------------------------------------------
app.get('/api/pipelines', (req, res) => {
  try {
    res.json(pipelineRunner.readPipelines());
  } catch (e) {
    logger.error('GET /api/pipelines:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/pipelines', (req, res) => {
  try {
    const pipelines = pipelineRunner.readPipelines();
    const pipeline = { id: 'pipe_' + crypto.randomBytes(6).toString('hex'), name: 'New pipeline', enabled: true, lastRunAt: null, nodes: [], connections: [], ...(req.body || {}) };
    pipelines.push(pipeline);
    pipelineRunner.writePipelines(pipelines);
    res.json({ ok: true, pipeline });
  } catch (e) {
    logger.error('POST /api/pipelines:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/pipelines/:id', (req, res) => {
  try {
    const pipelines = pipelineRunner.readPipelines();
    const idx = pipelines.findIndex(p => p.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Pipeline not found' });
    pipelines[idx] = { ...pipelines[idx], ...(req.body || {}), id: req.params.id };
    pipelineRunner.writePipelines(pipelines);
    res.json({ ok: true, pipeline: pipelines[idx] });
  } catch (e) {
    logger.error('PUT /api/pipelines/:id:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/pipelines/:id', (req, res) => {
  try {
    const pipelines = pipelineRunner.readPipelines();
    const filtered = pipelines.filter(p => p.id !== req.params.id);
    if (filtered.length === pipelines.length) return res.status(404).json({ error: 'Pipeline not found' });
    pipelineRunner.writePipelines(filtered);
    res.json({ ok: true });
  } catch (e) {
    logger.error('DELETE /api/pipelines/:id:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/pipelines/:id/run', runLimiter, async (req, res) => {
  try {
    const pipelines = pipelineRunner.readPipelines();
    const pipeline = pipelines.find(p => p.id === req.params.id);
    if (!pipeline) return res.status(404).json({ error: 'Pipeline not found' });
    const context = await pipelineRunner.runPipeline(pipeline);
    const now = new Date().toISOString();
    const idx = pipelines.findIndex(p => p.id === req.params.id);
    if (idx !== -1) { pipelines[idx] = { ...pipelines[idx], lastRunAt: now }; pipelineRunner.writePipelines(pipelines); }
    res.json({ ok: true, context });
  } catch (e) {
    logger.error('POST /api/pipelines/:id/run:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
app.get('/api/dashboard', async (req, res) => {
  const fs = require('fs');
  try {
    const user = req.session && req.session.user;
    const config = getConfig();

    // Chats
    let chatsTotal = 0;
    let recentChats = [];
    if (user) {
      try {
        const { chats } = chatStore.listChats(user);
        chatsTotal = chats.length;
        recentChats = chats
          .slice()
          .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
          .slice(0, 5)
          .map(c => ({
            id: c.id,
            title: c.title,
            updatedAt: c.updatedAt,
            messageCount: (() => {
              try { const d = chatStore.getChat(user, c.id); return d ? d.messages.length : 0; } catch (_) { return 0; }
            })()
          }));
      } catch (_) {}
    }

    // Heartbeat
    const heartbeatJobs = config.heartbeat || [];
    const cronParser = require('cron-parser');
    const jobsInfo = heartbeatJobs.map(j => {
      let nextRunAt = null;
      if (j.enabled !== false && j.schedule) {
        try {
          const interval = cronParser.parseExpression(j.schedule, { currentDate: new Date(), utc: false });
          nextRunAt = interval.next().toDate().toISOString();
        } catch (_) {}
      }
      return { name: j.name, schedule: j.schedule, lastRunAt: j.lastRunAt || null, nextRunAt, enabled: j.enabled !== false };
    });

    // Webhooks
    const webhookList = config.webhooks || [];

    // Pipelines
    const PIPELINES_PATH = path.join(__dirname, 'data', 'pipelines.json');
    let pipelines = [];
    try { if (fs.existsSync(PIPELINES_PATH)) pipelines = JSON.parse(fs.readFileSync(PIPELINES_PATH, 'utf8')); } catch (_) {}

    // Skills
    skillsLib.ensureEnabledSkillsLoaded();
    const allSkills = skillsLib.listSkills();

    // Memory
    const DATA_DIR = path.join(__dirname, 'data');
    const MEMORY_PATH = path.join(DATA_DIR, 'memory.md');
    let freeformLines = 0;
    try { if (fs.existsSync(MEMORY_PATH)) freeformLines = fs.readFileSync(MEMORY_PATH, 'utf8').split('\n').filter(l => l.trim()).length; } catch (_) {}
    const smData = structuredMemory.readAll();
    const structuredKeys = Object.keys(smData.facts || {}).length;

    // Projects
    const projectsList = projectStore.listProjects();
    const recentProjects = projectsList.slice(0, 5);

    // Ollama
    let ollamaConnected = false;
    try { await listModels(config.ollama.mainUrl); ollamaConnected = true; } catch (_) {}

    res.json({
      chats: { total: chatsTotal, recent: recentChats },
      projects: { total: projectsList.length, recent: recentProjects },
      heartbeat: {
        total: heartbeatJobs.length,
        enabled: heartbeatJobs.filter(j => j.enabled !== false).length,
        jobs: jobsInfo
      },
      webhooks: { total: webhookList.length, enabled: webhookList.filter(w => w.enabled !== false).length },
      pipelines: { total: pipelines.length, enabled: pipelines.filter(p => p.enabled !== false).length },
      skills: { total: allSkills.length, enabled: allSkills.filter(s => s.enabled).length },
      memory: { freeformLines, structuredKeys },
      ollama: { connected: ollamaConnected, url: config.ollama.mainUrl, model: config.ollama.mainModel }
    });
  } catch (e) {
    logger.error('GET /api/dashboard:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Startup helpers
// ---------------------------------------------------------------------------

/** Auto-migrate any plain-text password to a bcrypt hash at startup */
function migratePasswordIfNeeded() {
  const config = getConfig();
  if (config.auth && config.auth.passwordHash && !config.auth.passwordHash.startsWith('$2')) {
    config.auth.passwordHash = bcrypt.hashSync(config.auth.passwordHash, 12);
    saveConfig(config);
    global.__shadowConfig = config;
    logger.info('Password auto-migrated to bcrypt hash — please update config if needed');
  }
}

/** Warn on startup if Ollama is unreachable */
async function checkOllamaHealth() {
  const config = getConfig();
  try {
    await listModels(config.ollama.mainUrl);
    logger.info('Ollama connection OK:', config.ollama.mainUrl);
  } catch (e) {
    logger.warn('Cannot connect to Ollama at', config.ollama.mainUrl);
    logger.warn('  → Check your Ollama URL in Config (/config) or ensure Ollama is running.');
  }
}

function start() {
  migratePasswordIfNeeded();

  const config = getConfig();
  const { host, port } = config.server;
  const server = app.listen(port, host, () => {
    logger.info(`ShadowAI listening on http://${host}:${port}`);
  });

  heartbeatLib.startHeartbeat();
  pipelineRunner.startScheduler();

  try {
    const telegramBot = require('./lib/telegramBot.js');
    telegramBot.startTelegramBot();
  } catch (e) {
    logger.warn('Telegram bot init error:', e.message);
  }
  try {
    const discordBot = require('./lib/discordBot.js');
    discordBot.startDiscordBot();
  } catch (e) {
    logger.warn('Discord bot init error:', e.message);
  }

  try {
    const enabledList = skillsLib.listSkills().filter(s => s.enabled).map(s => s.id);
    if (enabledList.length > 0) updateConfig({ skills: { enabledIds: enabledList } });
  } catch (e) {
    logger.warn('Startup skills init error:', e.message);
  }

  // Run Ollama health check asynchronously — don't block startup
  checkOllamaHealth().catch(e => logger.warn('Ollama health check error:', e.message));

  return server;
}

if (require.main === module) {
  start();
}

module.exports = { app, start };
