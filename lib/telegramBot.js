'use strict';

const { getConfig } = require('./config.js');
const chatStore = require('./chatStore.js');
const chatRunner = require('./chatRunner.js');
const logger = require('./logger.js');

let botInstance = null;

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
    const chatId = msg.chat && msg.chat.id;
    const trimmed = text.trim().toLowerCase();

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
      const { content } = await chatRunner.runChatTurn({
        user: username,
        messages,
        customInstructions: (data && data.customInstructions) || '',
        agentId: null
      });
      messages.push({ role: 'assistant', content });
      chatStore.writeChat(username, messages);
      await bot.sendMessage(chatId, content.slice(0, 4096));
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
