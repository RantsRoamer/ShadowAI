'use strict';

const { getConfig } = require('./config.js');
const personalityLib = require('./personality.js');
const skillsLib = require('./skills.js');
const logger = require('./logger.js');

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

module.exports = { buildSystemPrompt };
