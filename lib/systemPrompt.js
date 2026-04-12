'use strict';

const { getConfig } = require('./config.js');
const personalityLib = require('./personality.js');
const structuredMemory = require('./structuredMemory.js');
const skillsLib = require('./skills.js');
const projectStore = require('./projectStore.js');
const logger = require('./logger.js');

/** IANA zone from structured memory (per user) overrides server Config → Timezone. */
function resolveEffectiveTimezone(userContext = '') {
  const globalTz = (() => {
    const c = getConfig();
    return typeof c.timezone === 'string' && c.timezone.trim() ? c.timezone.trim() : '';
  })();
  const u = typeof userContext === 'string' ? userContext.trim() : '';
  if (!u) return globalTz;
  try {
    const fromFacts =
      (structuredMemory.getMemory('timezone', u) || '').trim() ||
      (structuredMemory.getMemory('user_timezone', u) || '').trim();
    return fromFacts || globalTz;
  } catch (_) {
    return globalTz;
  }
}

function formatTimeContextLine(tz) {
  const now = new Date();
  if (tz) {
    try {
      const fmt = new Intl.DateTimeFormat(undefined, {
        dateStyle: 'full',
        timeStyle: 'long',
        timeZone: tz
      });
      return fmt.format(now) + ` (timezone: ${tz})`;
    } catch (_) {
      const fmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'long' });
      return fmt.format(now) + ' (server local time; configured timezone invalid: ' + tz + ')';
    }
  }
  const fmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'long' });
  return fmt.format(now) + ' (server local time; no explicit timezone configured)';
}

function buildSystemPrompt(customInstructions = '', userContext = '') {
  let text = 'You are ShadowAI, a helpful assistant. ';
  const personality = personalityLib.readPersonality(userContext).trim();
  if (personality) {
    text += '\n\n--- Your personality (follow this) ---\n' + personality + '\n--- End personality ---\n\n';
  }
  const behavior = personalityLib.readBehavior(userContext).trim();
  if (behavior) {
    text += '\n--- Who the user is / how to help (follow this) ---\n' + behavior + '\n--- End AI behavior ---\n\n';
  }
  const memory = personalityLib.readMemory(userContext).trim();
  if (memory) {
    text += '--- Things to remember (you have an append_memory tool to add to this; do not ask the user to run /read or /write) ---\n' + memory + '\n--- End memory ---\n\n';
  }
  const structured = structuredMemory.readAll(userContext);
  const factKeys = structured && structured.facts ? Object.keys(structured.facts) : [];
  if (factKeys.length > 0) {
    const sampleKeys = factKeys.slice(0, 15);
    text += '--- Structured memory (key → value; use get_memory/set_memory to access) ---\n';
    for (const k of sampleKeys) {
      text += `${k}: ${structured.facts[k]}\n`;
    }
    if (factKeys.length > sampleKeys.length) {
      text += `(+ ${factKeys.length - sampleKeys.length} more keys)\n`;
    }
    text += '--- End structured memory ---\n\n';
  }

  // Timezone-aware current time: Config → Timezone, or per-user structured memory keys timezone / user_timezone.
  try {
    const tz = resolveEffectiveTimezone(userContext);
    const timeStr = formatTimeContextLine(tz);
    text += '\n\nCurrent time context: ' + timeStr + '. When the user asks for the current time, local time, or "what time is it", answer using this time and timezone instead of UTC or your own internal clock.';
  } catch (e) {
    logger.warn('buildSystemPrompt: time context error:', e.message);
  }
  text += 'The user can run code by sending: /run js <code> or /run py <code>. They can read a file: /read <path>, write: /write <path> then newline then content, list dir: /list [path]. You can suggest these commands. Use the append_memory tool proactively for durable, future-useful user facts (identity, preferences, goals, important dates, recurring constraints), even if the user did not explicitly say "remember this". Do not save transient one-off details (temporary URLs, throwaway errors, short-lived statuses). Do not ask the user to run /read or /write for memory. The append_memory tool runs automatically. Memory is already in your context above so you can answer "who am I" etc. from it. Be concise and technical. Use markdown for structure (headers, **bold**, lists, tables) and emojis when they add clarity or a friendly tone.';
  text += ' When the user describes who they are and how you should help them in one go (e.g. "You are my AI assistant who helps me with X. I am a Y. I\'m getting married on Z..."), use append_memory to save it, then tell them: "I\'ve saved this to memory. For it to always be in context in every chat (including CLI/Telegram/Discord/Matrix), add or paste it into **PERSONALITY → AI Behavior** (data/AIBEHAVIOR.md)."';
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
  text += '\n\n**Scheduled tasks (Heartbeat):** When the user asks for something to run on a schedule (e.g. "run X every day at 7am", "email me the weather at 8am"), you MUST (1) create_skill — create a skill that does the work (e.g. fetch data, compute something, return a string or { subject, text }). The skill runs in isolation and returns content; (2) add_heartbeat_job — add a job with type "skill", that skillId, schedule (cron e.g. 0 7 * * * for 7am server time), and if they want the result emailed set emailResult: true and emailSubject. The Heartbeat system is an internal scheduler that checks every 30 seconds and runs jobs when their cron is due. No special job types—always use a skill plus a heartbeat job. When the user asks to CHANGE an existing scheduled task or skill, use list_heartbeat_jobs to find the job id, then update_heartbeat_job (e.g. change schedule or name), or update_skill to change what the skill does.';
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

/**
 * Build system prompt for a project-scoped chat. Project memory is included and
 * the global personality / AI behavior are applied so tone and user context
 * stay consistent, but no global memory or other project data is injected.
 * Projects remain isolated in terms of facts/content.
 * @param {string} projectId
 * @param {string} customInstructions
 * @param {boolean} includeMemoryInSystem - if false, memory is not embedded here (caller injects it in conversation)
 */
function buildProjectSystemPrompt(projectId, customInstructions = '', includeMemoryInSystem = true, userContext = '') {
  const project = projectStore.getProject(projectId);
  const name = project ? project.name : 'Project';
  let text = `You are ShadowAI assisting with the project "${name}". Answer ONLY from the project memory that appears in the conversation. Do not use or refer to information from other projects or global memory—this chat is isolated to this project.\n\n`;

  // Apply global personality & AI behavior so the assistant keeps the same tone
  // and understanding of who the user is, even in project chats.
  try {
    const personality = personalityLib.readPersonality(userContext).trim();
    if (personality) {
      text += '--- Your personality (follow this) ---\n' + personality + '\n--- End personality ---\n\n';
    }
    const behavior = personalityLib.readBehavior(userContext).trim();
    if (behavior) {
      text += '--- Who the user is / how to help (follow this) ---\n' + behavior + '\n--- End AI behavior ---\n\n';
    }
    const memory = personalityLib.readMemory(userContext).trim();
    if (memory) {
      text += '--- User memory profile (informational context about the user) ---\n' + memory + '\n--- End user memory profile ---\n\n';
    }
    const structured = structuredMemory.readAll(userContext);
    const factKeys = structured && structured.facts ? Object.keys(structured.facts) : [];
    if (factKeys.length > 0) {
      const sampleKeys = factKeys.slice(0, 15);
      text += '--- User structured profile (key → value; informational) ---\n';
      for (const k of sampleKeys) {
        text += `${k}: ${structured.facts[k]}\n`;
      }
      if (factKeys.length > sampleKeys.length) {
        text += `(+ ${factKeys.length - sampleKeys.length} more keys)\n`;
      }
      text += '--- End user structured profile ---\n\n';
    }
  } catch (e) {
    logger.warn('buildProjectSystemPrompt: personality error:', e.message);
  }
  // Same time resolution as main chat (server timezone + per-user structured memory override).
  try {
    const tz = resolveEffectiveTimezone(userContext);
    const timeStr = formatTimeContextLine(tz);
    text += 'Current time context for this chat: ' + timeStr + '. Use this when the user asks about the current time.\n\n';
  } catch (e) {
    logger.warn('buildProjectSystemPrompt: time context error:', e.message);
  }
  if (includeMemoryInSystem) {
    const memory = projectStore.readProjectMemory(projectId).trim();
    if (memory) {
      text += '--- PROJECT MEMORY (use this to answer all questions) ---\n' + memory + '\n--- END PROJECT MEMORY ---\n\n';
    } else {
      text += 'The project has no memory yet.\n\n';
    }
  } else {
    text += 'The next message contains the PROJECT MEMORY. Use it to answer the user\'s questions. Do not say you cannot see it.\n\n';
  }
  text += 'Be concise and helpful. Use markdown. When the user shares important information about this project, use the append_project_memory tool to save it. ';
  text += 'When updating information that already exists (for example, changing a budget, timeline, or status), reuse the same sectionTitle so that section is overwritten instead of duplicated. Keep one up-to-date section per topic (e.g. "Budget", "Timeline", "Key decisions").';
  const custom = (customInstructions || '').trim();
  if (custom) {
    text += '\n\n--- Custom instructions ---\n' + custom + '\n--- End ---';
  }
  return text;
}

module.exports = { buildSystemPrompt, buildProjectSystemPrompt };
