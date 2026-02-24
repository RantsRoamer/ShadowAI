'use strict';

const { getConfig } = require('./config.js');
const systemPrompt = require('./systemPrompt.js');
const { ollamaChatWithTools, ollamaChatJson } = require('./ollama.js');
const personalityLib = require('./personality.js');
const skillsLib = require('./skills.js');
const searxngLib = require('./searxng.js');
const fetchUrlLib = require('./fetchUrl.js');
const emailLib = require('./email.js');
const logger = require('./logger.js');

/**
 * Run one assistant turn (non-streaming). Uses same tools and logic as the web chat.
 * @param {object} options
 * @param {string} options.user - Username (e.g. "channel_cli" or "telegram_123")
 * @param {Array<{role:string,content:string}>} options.messages - Conversation messages (no system)
 * @param {string} [options.customInstructions] - Per-chat instructions
 * @param {string} [options.agentId] - Optional agent id for different model
 * @returns {Promise<{content: string}>}
 */
async function runChatTurn(options) {
  const { user, messages, customInstructions = '', agentId } = options;
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

  const systemContent = systemPrompt.buildSystemPrompt(customInstructions);
  const fullMessages = [{ role: 'system', content: systemContent }, ...messages];

  skillsLib.ensureEnabledSkillsLoaded();
  const enabledSkills = skillsLib.listSkills().filter(s => s.enabled && s.loaded);
  const appendMemoryTool = {
    type: 'function',
    function: {
      name: 'append_memory',
      description: 'Save a fact to the AI\'s memory. Use when the user asks you to remember something.',
      parameters: { type: 'object', required: ['text'], properties: { text: { type: 'string' } } }
    }
  };
  const skillTools = enabledSkills.map(s => ({
    type: 'function',
    function: { name: s.id, description: s.description || s.name || `Skill: ${s.id}`, parameters: { type: 'object' } }
  }));
  const searxng = getConfig().searxng || {};
  const webSearchTool = (searxng.url && searxng.enabled) ? {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the internet via SearXNG.',
      parameters: { type: 'object', required: ['query'], properties: { query: { type: 'string' } } }
    }
  } : null;
  const fetchUrlTool = {
    type: 'function',
    function: {
      name: 'fetch_url',
      description: 'Fetch a webpage and get its content.',
      parameters: { type: 'object', required: ['url'], properties: { url: { type: 'string' } } }
    }
  };
  const emailCfg = getConfig().email || {};
  const sendEmailTool = (emailCfg.host && emailCfg.from && emailCfg.defaultTo && emailCfg.enabled) ? {
    type: 'function',
    function: {
      name: 'send_email',
      description: 'Send an email. Omit "to" to use the default recipient.',
      parameters: {
        type: 'object',
        required: ['subject', 'text'],
        properties: { to: { type: 'string' }, subject: { type: 'string' }, text: { type: 'string' } }
      }
    }
  } : null;
  const tools = [appendMemoryTool, ...(webSearchTool ? [webSearchTool] : []), fetchUrlTool, ...(sendEmailTool ? [sendEmailTool] : []), ...skillTools];

  let content = '';
  if (tools.length > 0) {
    let messagesForOllama = [...fullMessages];
    let maxRounds = 5;
    while (maxRounds-- > 0) {
      const data = await ollamaChatWithTools(baseUrl, model, messagesForOllama, tools, ollamaOptions);
      const msg = data.message || {};
      const toolCalls = msg.tool_calls || [];
      if (toolCalls.length === 0) {
        content = msg.content || '';
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
          try { args = JSON.parse(args); } catch (_) { args = {}; }
        }
        if (typeof args !== 'object' || args === null) args = {};
        try {
          let toolContent;
          if (name === 'append_memory') {
            const text = args.text != null ? String(args.text).trim() : '';
            if (text) personalityLib.appendMemory(text);
            toolContent = text ? 'Saved to memory.' : 'No text provided.';
          } else if (name === 'web_search') {
            const query = args.query != null ? String(args.query).trim() : '';
            if (!query) toolContent = 'No query provided.';
            else {
              const searxngCfg = getConfig().searxng || {};
              const results = await searxngLib.search(searxngCfg.url, query, { limit: 8 });
              toolContent = results.length === 0 ? 'No results found.' : results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.content || ''}`).join('\n\n');
            }
          } else if (name === 'fetch_url') {
            const url = args.url != null ? String(args.url).trim() : '';
            if (!url) toolContent = 'No URL provided.';
            else {
              try {
                const page = await fetchUrlLib.fetchPage(url);
                toolContent = 'Title: ' + (page.title || '(none)') + '\nURL: ' + page.url + '\n\nContent:\n' + (page.content || '').slice(0, 60000);
              } catch (err) {
                toolContent = 'Error: ' + err.message;
              }
            }
          } else if (name === 'send_email') {
            const subject = args.subject != null ? String(args.subject).trim() : '';
            const text = args.text != null ? String(args.text) : '';
            const toArg = args.to != null ? String(args.to).trim() : '';
            const cfg = getConfig().email || {};
            const looksLikeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+/.test(toArg);
            const to = looksLikeEmail ? toArg : (cfg.defaultTo || '').trim();
            if (!subject && !text) toolContent = 'No subject or body provided.';
            else if (!to) toolContent = 'Error: No recipient. Set "Default To" in Config → Notifications.';
            else {
              try {
                await emailLib.sendMail(cfg, { to, subject: subject || '(No subject)', text: text || '(No content)' });
                toolContent = 'Email sent to ' + to + '.';
              } catch (err) {
                toolContent = 'Error: ' + err.message;
              }
            }
          } else {
            const result = await skillsLib.runSkill(name, args);
            toolContent = typeof result === 'object' ? JSON.stringify(result) : String(result);
          }
          messagesForOllama.push({ role: 'tool', tool_name: name, content: toolContent });
        } catch (err) {
          logger.warn('chatRunner tool error:', name, err.message);
          messagesForOllama.push({ role: 'tool', tool_name: name, content: String(err.message) });
        }
      }
    }
  } else {
    const out = await ollamaChatJson(baseUrl, model, fullMessages, ollamaOptions);
    content = out.message?.content || '';
  }
  return { content };
}

module.exports = { runChatTurn };
