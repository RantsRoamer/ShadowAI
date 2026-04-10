'use strict';

const { getConfig } = require('./config.js');
const chatStore = require('./chatStore.js');
const chatRunner = require('./chatRunner.js');
const channelLinks = require('./channelLinks.js');
const channelPrefs = require('./channelPrefs.js');
const logger = require('./logger.js');

let botInstance = null;
const CHUNK = 4096;

function formatTokenStatsLine(tokenStats) {
  if (!tokenStats) return '';
  const p = Number(tokenStats.promptTokens) || 0;
  const e = Number(tokenStats.evalTokens) || 0;
  const pct = Number(tokenStats.usagePct) || 0;
  return `↑${p} ↓${e} • ${pct.toFixed(1)}% ctx`;
}

/**
 * Start Telegram bot if config.channels.telegram.enabled and botToken are set.
 * Requires optional dependency: npm install node-telegram-bot-api
 */
function startTelegramBot() {
  const channels = getConfig().channels || {};
  const tg = channels.telegram || {};
  if (!tg.enabled || !(tg.botToken || '').trim()) return;

  let TelegramBot;
  try {
    TelegramBot = require('node-telegram-bot-api');
  } catch (e) {
    logger.warn('Telegram bot skipped: install node-telegram-bot-api (npm install node-telegram-bot-api)');
    return;
  }

  const token = tg.botToken.trim();
  const bot = new TelegramBot(token, { polling: true });
  botInstance = bot;

  bot.on('message', async (msg) => {
    const text = msg.text;
    if (!text || typeof text !== 'string') return;
    const fromId = msg.from && msg.from.id;
    if (!fromId) return;
    const username = 'telegram_' + fromId;
    const linkedUser = channelLinks.getLinkedAppUser(username);
    const memoryUser = linkedUser || username;
    const chatId = msg.chat && msg.chat.id;
    const trimmed = text.trim().toLowerCase();

    const verifyMatch = text.trim().match(/^\/verify\s+([A-Za-z0-9_-]{4,32})$/i);
    if (verifyMatch) {
      const out = channelLinks.verifyAndLink(username, verifyMatch[1]);
      if (out.ok) await bot.sendMessage(chatId, `Linked to ShadowAI user "${out.username}". This bot chat will now appear in that user's chat list.`);
      else await bot.sendMessage(chatId, out.error || 'Verification failed.');
      return;
    }
    if (trimmed === '/unlink') {
      const ok = channelLinks.unlinkChannel(username);
      await bot.sendMessage(chatId, ok ? 'Unlinked this bot chat from web user account.' : 'This bot chat was not linked.');
      return;
    }
    if (trimmed === '/whoami') {
      const linked = channelLinks.getLinkedAppUser(username);
      await bot.sendMessage(
        chatId,
        linked
          ? `Channel identity: \`${username}\`\nLinked ShadowAI user: \`${linked}\``
          : `Channel identity: \`${username}\`\nLinked ShadowAI user: (not linked)\nUse \`/verify <code>\` to link.`
      );
      return;
    }
    if (trimmed === '/stats') {
      const enabled = channelPrefs.toggleStats(username);
      await bot.sendMessage(chatId, enabled ? 'Token stats are now ON for this chat.' : 'Token stats are now OFF for this chat.');
      return;
    }

    if (['/reset', '/new'].includes(trimmed)) {
      try {
        chatStore.clearCurrentChat(username);
        await bot.sendMessage(chatId, 'Chat cleared. Start a new conversation whenever you\'re ready.');
      } catch (e) {
        logger.warn('Telegram reset/new error:', e.message);
        try { await bot.sendMessage(chatId, 'Could not clear chat.'); } catch (_) {}
      }
      return;
    }

    try {
      const data = chatStore.readChat(username);
      const messages = (data && data.messages) ? [...data.messages] : [];
      messages.push({ role: 'user', content: text });
      const { content, tokenStats } = await chatRunner.runChatTurn({
        user: username,
        userContext: memoryUser,
        messages,
        customInstructions: (data && data.customInstructions) || '',
        agentId: null
      });
      const statsLine = channelPrefs.isStatsEnabled(username) ? formatTokenStatsLine(tokenStats) : '';
      const finalContent = statsLine ? `${content}\n\n${statsLine}` : content;
      messages.push({ role: 'assistant', content: finalContent });
      chatStore.writeChat(username, messages);
      for (let i = 0; i < finalContent.length; i += CHUNK) {
        await bot.sendMessage(chatId, finalContent.slice(i, i + CHUNK));
      }
    } catch (e) {
      logger.error('Telegram bot message error:', e.message);
      try {
        await bot.sendMessage(chatId, 'Sorry, something went wrong. Please try again.');
      } catch (_) {}
    }
  });

  logger.info('Telegram bot started (long polling)');
}

function stopTelegramBot() {
  if (botInstance && botInstance.stopPolling) {
    botInstance.stopPolling();
    botInstance = null;
    logger.info('Telegram bot stopped');
  }
}

module.exports = { startTelegramBot, stopTelegramBot };
