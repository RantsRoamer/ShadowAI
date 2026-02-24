const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { getConfig, reloadConfig, updateConfig, saveConfig } = require('./lib/config.js');
const { ollamaChatStream, ollamaChatWithTools, listModels } = require('./lib/ollama.js');
const { authMiddleware, checkAuth } = require('./lib/auth.js');
const { runCode } = require('./lib/runCode.js');
const { readFile, writeFile, listFiles } = require('./lib/selfUpdate.js');
const skillsLib = require('./lib/skills.js');
const personalityLib = require('./lib/personality.js');
const heartbeatLib = require('./lib/heartbeat.js');
const searxngLib = require('./lib/searxng.js');
const fetchUrlLib = require('./lib/fetchUrl.js');
const chatStore = require('./lib/chatStore.js');
const emailLib = require('./lib/email.js');
const logger = require('./lib/logger.js');

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
// Body parsing
// ---------------------------------------------------------------------------
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

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
// System prompt builder
// ---------------------------------------------------------------------------
function buildSystemPrompt(customInstructions = '') {
  let text = 'You are ShadowAI, a helpful assistant. ';
  const personality = personalityLib.readPersonality().trim();
  if (personality) {
    text += '\n\n--- Your personality (follow this) ---\n' + personality + '\n--- End personality ---\n\n';
  }
  const memory = personalityLib.readMemory().trim();
  if (memory) {
    text += '--- Things to remember (you have an append_memory tool to add to this; do not ask the user to run /read or /write) ---\n' + memory + '\n--- End memory ---\n\n';
  }
  text += 'The user can run code by sending: /run js <code> or /run py <code>. They can read a file: /read <path>, write: /write <path> then newline then content, list dir: /list [path]. You can suggest these commands. When the user asks you to REMEMBER something (e.g. "remember my name is X"), you must use the append_memory tool to save it—do not tell the user to run /read or /write. The append_memory tool runs automatically. Memory is already in your context above so you can answer "who am I" etc. from it. Be concise and technical. Use markdown for structure (headers, **bold**, lists, tables) and emojis when they add clarity or a friendly tone.';
  text += ' When the user asks you to write code or create a skill, tell them to select the Coding Agent (or the coding agent they configured) from the model dropdown at the top of the chat for better results.';
  try {
    skillsLib.ensureEnabledSkillsLoaded();
    const skills = skillsLib.listSkills().filter(s => s.enabled && s.loaded);
    if (skills.length > 0) {
      text += '\n\nAvailable skills (user can run with /skill <id> [JSON args]): ' +
        skills.map(s => `"${s.id}" (${s.name}): ${s.description}`).join('; ') +
        '. You also have these as tools—when you use a tool it runs automatically and you get the result. Use the appropriate tool when it would help (e.g. ping a host when the user asks to check connectivity). Prefer using tools over suggesting /run or /skill when a skill fits the request.';
      const enabledIds = (getConfig().skills || {}).enabledIds;
      if (Array.isArray(enabledIds) && enabledIds.length > 0) {
        text += ' Currently enabled skills (remember these are on): ' + enabledIds.join(', ') + '.';
      }
    }
    text += '\n\nWhen the user asks you to CREATE a new skill/plugin you MUST output it in this exact format so the system can create the files. Use this block (copy exactly, no extra text inside the block):\nSKILL_ID: <id>\nSKILL_NAME: <display name>\nSKILL_DESCRIPTION: <short description>\nSKILL_CODE:\n<full run.js code - must export run(args) or module.exports = { run }>\nEND_SKILL_CODE\nAfter the block, say "Click the Create skill button below to add this skill, then enable it on the Skills page."';
  } catch (e) {
    logger.warn('buildSystemPrompt: skills error:', e.message);
  }
  const searxng = getConfig().searxng || {};
  if (searxng.url && searxng.enabled) {
    text += '\n\nYou have a web_search tool that lets you search the live internet via SearXNG. '
      + 'Use it whenever the user asks about current events, external facts, websites, APIs, or anything you need to look up. '
      + 'Call it with a clear search query, then base your answer on the returned results. '
      + 'Do NOT say that you lack internet or browsing access—when you need outside information, use the web_search tool instead.';
  }
  text += '\n\nYou have a fetch_url tool to fetch a webpage and read its content. When the user gives you a URL or asks you to check a website, call fetch_url with that URL (must be http or https), then summarize or answer using the returned title and content.';
  const email = getConfig().email || {};
  if (email.host && email.from && email.defaultTo && email.enabled) {
    text += '\n\nYou have a send_email tool. When the user asks you to email them something (a summary, a file, a reminder, etc.), call send_email with subject and text. Do NOT pass a "to" parameter (or pass it only when the user explicitly gives a different email address)—when "to" is omitted, the system sends to the configured default address. Use the default whenever the user says "email me", "send it to me", or does not specify who to send to.';
  }
  const custom = (customInstructions || '').trim();
  if (custom) {
    text += '\n\n--- Custom instructions for this chat (follow these) ---\n' + custom + '\n--- End custom instructions ---';
  }
  return text;
}

// ---------------------------------------------------------------------------
// Routes — public
// ---------------------------------------------------------------------------
app.get('/', (req, res) => {
  if (req.session && req.session.user) return res.redirect('/app');
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
app.get('/app',         (req, res) => res.sendFile(path.join(PUBLIC, 'app.html')));
app.get('/config',      (req, res) => res.sendFile(path.join(PUBLIC, 'config.html')));
app.get('/skills',      (req, res) => res.sendFile(path.join(PUBLIC, 'skills.html')));
app.get('/personality', (req, res) => res.sendFile(path.join(PUBLIC, 'personality.html')));
app.get('/heartbeat',   (req, res) => res.sendFile(path.join(PUBLIC, 'heartbeat.html')));
app.get('/debug',       (req, res) => res.sendFile(path.join(PUBLIC, 'debug.html')));
app.get('/editor',      (req, res) => res.sendFile(path.join(PUBLIC, 'editor.html')));

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
app.get('/api/config', (req, res) => {
  const c = getConfig();
  // Never expose credentials — strip passwordHash and email.auth.pass
  res.json({
    server: c.server,
    auth: { username: c.auth.username },
    ollama: c.ollama,
    heartbeat: c.heartbeat || [],
    searxng: c.searxng || { url: '', enabled: false },
    email: (() => {
      const e = c.email || {};
      const safe = { ...e };
      if (safe.auth) safe.auth = { user: safe.auth.user || '' }; // never send pass
      return safe;
    })()
  });
});

app.put('/api/config', (req, res) => {
  try {
    const updates = req.body || {};
    if (updates.server) updateConfig({ server: updates.server });
    if (updates.auth) {
      const authUpdates = { ...updates.auth };
      // Hash any new plaintext password before storing
      if (authUpdates.passwordHash && !authUpdates.passwordHash.startsWith('$2')) {
        authUpdates.passwordHash = bcrypt.hashSync(authUpdates.passwordHash, 12);
      }
      const next = { ...getConfig().auth, ...authUpdates };
      if (updates.auth.passwordHash === '') delete next.passwordHash;
      updateConfig({ auth: next });
    }
    if (updates.ollama) updateConfig({ ollama: updates.ollama });
    if (updates.heartbeat) {
      updateConfig({ heartbeat: updates.heartbeat });
      heartbeatLib.startHeartbeat();
    }
    if (updates.searxng) updateConfig({ searxng: updates.searxng });
    if (updates.email) updateConfig({ email: updates.email });
    reloadConfig();
    // Return config with sensitive fields stripped
    const c = getConfig();
    res.json({
      ok: true,
      config: {
        server: c.server,
        auth: { username: c.auth.username },
        ollama: c.ollama,
        heartbeat: c.heartbeat || [],
        searxng: c.searxng || {},
        email: (() => {
          const e = c.email || {};
          const safe = { ...e };
          if (safe.auth) safe.auth = { user: safe.auth.user || '' };
          return safe;
        })()
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
// Chat history / sessions
// ---------------------------------------------------------------------------
app.get('/api/chats', (req, res) => {
  const user = req.session && req.session.user;
  if (!user) return res.json({ chats: [], currentChatId: null });
  res.json(chatStore.listChats(user));
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
  const data = user ? chatStore.readChat(user, chatId) : { messages: [], title: null, customInstructions: '' };
  res.json({ messages: data.messages, title: data.title, customInstructions: data.customInstructions });
});

app.post('/api/chat/reset', (req, res) => {
  const user = req.session && req.session.user;
  if (user) chatStore.clearCurrentChat(user);
  res.json({ ok: true });
});

app.put('/api/chat/history', (req, res) => {
  const messages = req.body?.messages;
  const chatId = req.body?.chatId;
  if (!Array.isArray(messages)) return res.status(400).json({ error: 'messages array required' });
  const user = req.session && req.session.user;
  if (user) chatStore.writeChat(user, messages, chatId);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Main chat endpoint (streaming + tool calls)
// ---------------------------------------------------------------------------
app.post('/api/chat', chatLimiter, async (req, res) => {
  const { messages, agentId, stream: wantStream, chatId: bodyChatId, customInstructions } = req.body || {};
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array required' });
  }
  const user = req.session && req.session.user;
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
  const systemPrompt = {
    role: 'system',
    content: buildSystemPrompt(typeof customInstructions === 'string' ? customInstructions : '')
  };
  const fullMessages = [systemPrompt, ...messages];

  if (wantStream !== false) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    let assistantContent = '';
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
      const tools = [appendMemoryTool, ...(webSearchTool ? [webSearchTool] : []), fetchUrlTool, ...(sendEmailTool ? [sendEmailTool] : []), ...skillTools];

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
              } else {
                const result = await skillsLib.runSkill(name, args);
                content = typeof result === 'object' ? JSON.stringify(result) : String(result);
              }
              messagesForOllama.push({ role: 'tool', tool_name: name, content });
            } catch (err) {
              logger.warn(`Tool "${name}" error:`, err.message);
              messagesForOllama.push({ role: 'tool', tool_name: name, content: String(err.message) });
            }
          }
        }
        assistantContent = finalContent || '';
        if (finalContent) res.write(`data: ${JSON.stringify({ content: finalContent })}\n\n`);
      } else {
        for await (const chunk of ollamaChatStream(baseUrl, model, fullMessages, ollamaOptions)) {
          assistantContent += chunk;
          res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
        }
      }
      req.session.chatHistory = messages.concat([{ role: 'assistant', content: assistantContent }]);
      const newHistory = messages.concat([{ role: 'assistant', content: assistantContent }]);
      if (user) {
        const usedId = chatStore.writeChat(user, newHistory, bodyChatId);
        res.write('data: ' + JSON.stringify({ done: true, chatId: usedId }) + '\n\n');
      } else {
        res.write('data: {"done":true}\n\n');
      }
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
    if (req.session) req.session.chatHistory = newHistory;
    const usedChatId = user ? chatStore.writeChat(user, newHistory, bodyChatId) : null;
    res.json({ message: out.message, chatId: usedChatId });
  } catch (e) {
    logger.error('POST /api/chat non-stream error:', e.message);
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
