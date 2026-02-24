'use strict';

const { getConfig } = require('./config.js');
const chatStore = require('./chatStore.js');
const chatRunner = require('./chatRunner.js');
const logger = require('./logger.js');

let clientInstance = null;

/**
 * Start Discord bot if config.channels.discord.enabled and botToken are set.
 * Requires optional dependency: npm install discord.js
 * In Discord Developer Portal enable MESSAGE CONTENT INTENT for the bot.
 */
function startDiscordBot() {
  const channels = getConfig().channels || {};
  const dc = channels.discord || {};
  if (!dc.enabled || !(dc.botToken || '').trim()) return;

  let discord;
  try {
    discord = require('discord.js');
  } catch (e) {
    logger.warn('Discord bot skipped: install discord.js (npm install discord.js)');
    return;
  }

  const { Client, Events, GatewayIntentBits } = discord;
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent
    ]
  });
  clientInstance = client;

  client.on(Events.ClientReady, () => {
    logger.info('Discord bot started');
  });

  client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;
    const text = message.content;
    if (!text || typeof text !== 'string') return;
    const authorId = message.author && message.author.id;
    if (!authorId) return;

    const allowedIds = dc.allowedUserIds;
    if (Array.isArray(allowedIds) && allowedIds.length > 0 && !allowedIds.includes(authorId)) {
      return;
    }

    const username = 'discord_' + authorId;

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
      const chunkSize = 2000;
      const parts = [];
      for (let i = 0; i < content.length; i += chunkSize) parts.push(content.slice(i, i + chunkSize));
      if (parts.length > 0) await message.reply(parts[0]);
      for (let i = 1; i < parts.length; i++) await message.channel.send(parts[i]);
    } catch (e) {
      logger.error('Discord bot message error:', e.message);
      try {
        await message.reply('Sorry, something went wrong. Please try again.');
      } catch (_) {}
    }
  });

  client.login(dc.botToken.trim()).catch((e) => {
    logger.error('Discord bot login failed:', e.message);
    clientInstance = null;
  });
}

function stopDiscordBot() {
  if (clientInstance && clientInstance.destroy) {
    clientInstance.destroy();
    clientInstance = null;
    logger.info('Discord bot stopped');
  }
}

module.exports = { startDiscordBot, stopDiscordBot };
