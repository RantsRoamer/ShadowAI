'use strict';

const { getConfig } = require('./config.js');
const personalityLib = require('./personality.js');
const structuredMemory = require('./structuredMemory.js');
const skillsLib = require('./skills.js');
const projectStore = require('./projectStore.js');
const logger = require('./logger.js');

function buildSystemPrompt(customInstructions = '') {
  let text = 'You are ShadowAI, a helpful assistant. ';
  const personality = personalityLib.readPersonality().trim();
  if (personality) {
    text += '\n\n--- Your personality (follow this) ---\n' + personality + '\n--- End personality ---\n\n';
  }
  const behavior = personalityLib.readBehavior().trim();
  if (behavior) {
    text += '\n--- Who the user is / how to help (follow this) ---\n' + behavior + '\n--- End AI behavior ---\n\n';
  }
  const memory = personalityLib.readMemory().trim();
  if (memory) {
    text += '--- Things to remember (you have an append_memory tool to add to this; do not ask the user to run /read or /write) ---\n' + memory + '\n--- End memory ---\n\n';
  }
  const structured = structuredMemory.readAll();
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
  text += 'The user can run code by sending: /run js <code> or /run py <code>. They can read a file: /read <path>, write: /write <path> then newline then content, list dir: /list [path]. You can suggest these commands. When the user asks you to REMEMBER something (e.g. "remember my name is X"), you must use the append_memory tool to save it—do not tell the user to run /read or /write. The append_memory tool runs automatically. Memory is already in your context above so you can answer "who am I" etc. from it. Be concise and technical. Use markdown for structure (headers, **bold**, lists, tables) and emojis when they add clarity or a friendly tone.';
  text += ' When the user describes who they are and how you should help them in one go (e.g. "You are my AI assistant who helps me with X. I am a Y. I\'m getting married on Z..."), use append_memory to save it, then tell them: "I\'ve saved this to memory. For it to always be in context in every chat (including CLI/Telegram/Discord), add or paste it into **PERSONALITY → AI Behavior** (data/AIBEHAVIOR.md)."';
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
 * Build system prompt for a project-scoped chat. Only project memory is included;
 * no global personality, memory, or other project data. Projects are isolated.
 */
function buildProjectSystemPrompt(projectId, customInstructions = '') {
  const project = projectStore.getProject(projectId);
  const name = project ? project.name : 'Project';
  let text = `You are ShadowAI assisting with the project "${name}". Answer only from this project's context and memory. Do not use or refer to information from other projects or global memory—this chat is isolated to this project.\n\n`;
  // Read from disk every time so newly added content (import, drop, append_project_memory) is immediately available
  const memory = projectStore.readProjectMemory(projectId).trim();
  if (memory) {
    text += 'CRITICAL — Project memory (below): This block contains the project\'s current memory: notes, descriptions of uploaded images (what was extracted from them), and text from imported documents. You MUST use this content to answer the user\'s questions. When the user asks about an image, a document, or anything in this project, your answer MUST be based on the text in the memory block below. Do not say you cannot see images or access files—the memory block already contains the image description or document text.\n\n';
    text += '--- PROJECT MEMORY (use this to answer all questions about this project) ---\n' + memory + '\n--- END PROJECT MEMORY ---\n\n';
    text += 'Answer questions about images, documents, and notes using only the PROJECT MEMORY content above. If the answer is in that block, give it; if not, say so and suggest adding or importing the information.\n\n';
  } else {
    text += 'The project has no memory yet. The user can add notes or import documents/images to build context.\n\n';
  }
  text += 'Be concise and helpful. Use markdown for structure. When the user shares important information about this project (e.g. decisions, key dates, contacts, requirements), use the append_project_memory tool to save it so it is available for future questions.';
  const custom = (customInstructions || '').trim();
  if (custom) {
    text += '\n\n--- Custom instructions for this chat ---\n' + custom + '\n--- End custom instructions ---';
  }
  return text;
}

module.exports = { buildSystemPrompt, buildProjectSystemPrompt };
