'use strict';

const { getConfig } = require('./config.js');
const chatHistorySearch = require('./chatHistorySearch.js');
const coordinator = require('./commandCenter/coordinator.js');

function agentLoopFlags() {
  const cfg = getConfig();
  const a = cfg.agentLoop && typeof cfg.agentLoop === 'object' ? cfg.agentLoop : {};
  return {
    chatHistorySearch: a.chatHistorySearch !== false,
    subagentMissions: a.subagentMissions !== false
  };
}

function getExtraToolDefinitions({ isProjectChat = false } = {}) {
  const flags = agentLoopFlags();
  const out = [];
  if (!isProjectChat && flags.chatHistorySearch) {
    out.push({
      type: 'function',
      function: {
        name: 'search_chat_history',
        description:
          'Search the user\'s past chat messages (all threads for this account) using full-text search. Use when the user asks what was said before, to recall a decision, name, link, or topic from earlier conversations. Returns short snippets with chat title and role—not full transcripts.',
        parameters: {
          type: 'object',
          required: ['query'],
          properties: {
            query: { type: 'string', description: 'Keywords or phrase to find (e.g. "docker compose", "API key")' },
            chat_id: { type: 'string', description: 'Optional: limit search to one chat thread id if known' }
          }
        }
      }
    });
  }
  if (!isProjectChat && flags.subagentMissions) {
    out.push({
      type: 'function',
      function: {
        name: 'dispatch_subagent_mission',
        description:
          'Spawn a Command Center mission: break work into subtasks and queue background agents (research, coder, etc.). Use when the user wants parallel/delegated work, a multi-step research or coding push, or explicitly asks for "agents" or "mission mode". Tell them tasks appear on /autoagent and /command-center.',
        parameters: {
          type: 'object',
          required: ['mission'],
          properties: {
            mission: { type: 'string', description: 'Clear goal for the coordinator to triage into subtasks' }
          }
        }
      }
    });
  }
  return out;
}

/**
 * @param {string} name
 * @param {object} args
 * @param {{ chatOwnerUser: string, missionScopeUser: string }} ctx
 */
async function executeExtra(name, args, ctx) {
  const chatOwner = String(ctx.chatOwnerUser || '').trim();
  const missionUser = String(ctx.missionScopeUser != null ? ctx.missionScopeUser : ctx.chatOwnerUser || '').trim();

  if (name === 'search_chat_history') {
    const q = args.query != null ? String(args.query).trim() : '';
    const chatId = args.chat_id != null ? String(args.chat_id).trim() : '';
    if (!q) return 'No search query provided.';
    if (!chatOwner) return 'Cannot search: no user scope.';
    const rows = await chatHistorySearch.search(chatOwner, q, { limit: 18, chatId: chatId || undefined });
    if (rows.length === 0) {
      return 'No matches in indexed chat history. (New messages are indexed after they are saved; very recent turns may not appear yet.)';
    }
    return rows
      .map((r, i) => {
        const title = r.chatTitle || 'Chat';
        return `${i + 1}. [${title}] #${r.msgIdx} (${r.role}) ${r.snippet}${r.snippet.length >= 320 ? '…' : ''}`;
      })
      .join('\n');
  }

  if (name === 'dispatch_subagent_mission') {
    const mission = args.mission != null ? String(args.mission).trim() : '';
    if (!mission) return 'Error: mission text is required.';
    const out = await coordinator.dispatchMission(mission, { user: missionUser });
    const lines = [
      `Mission: ${out.title} (${out.missionId})`,
      out.summary ? `Summary: ${out.summary}` : '',
      'Queued tasks:',
      ...out.tasks.map((t) => `  • ${t.title} [${t.id}] status=${t.status} role=${t.role || '—'}`)
    ].filter(Boolean);
    return lines.join('\n');
  }

  return 'Unknown agent-loop tool: ' + name;
}

function handles(name) {
  return name === 'search_chat_history' || name === 'dispatch_subagent_mission';
}

module.exports = {
  getExtraToolDefinitions,
  executeExtra,
  handles
};
