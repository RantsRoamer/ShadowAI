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

  logger.info('Discord bot: starting (enable DMs in Developer Portal → Bot → MESSAGE CONTENT INTENT)');

  let discord;
  try {
    discord = require('discord.js');
  } catch (e) {
    logger.warn('Discord bot skipped: install discord.js (npm install discord.js)');
    return;
  }

  const { Client, Events, GatewayIntentBits, Partials } = discord;
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent
    ],
    partials: [
      Partials.Channel,
      Partials.Message,
      Partials.User
    ]
  });
  clientInstance = client;

  client.on(Events.ClientReady, () => {
    const tag = client.user ? client.user.tag : 'unknown';
    logger.info(`Discord bot connected as ${tag} (DMs enabled)`);
  });

  client.on('error', (e) => {
    logger.error('Discord client error:', e.message);
  });
  client.on('warn', (info) => {
    logger.warn('Discord client warn:', info);
  });

  client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;
    const text = message.content;
    if (!text || typeof text !== 'string') return;
    const authorId = message.author && message.author.id;
    if (!authorId) return;

    const isDM = !message.guild;
    logger.info(`Discord message from ${authorId} (${isDM ? 'DM' : 'guild'})`);

    const allowedIds = dc.allowedUserIds;
    if (Array.isArray(allowedIds) && allowedIds.length > 0 && !allowedIds.includes(authorId)) {
      try {
        await message.reply("You're not authorized to use this bot.");
      } catch (err) {
        logger.warn('Discord bot: could not send not-authorized reply:', err.message);
      }
      return;
    }

    const username = 'discord_' + authorId;

    const channel = message.channel;
    const typingInterval = setInterval(() => {
      channel.sendTyping().catch(() => {});
    }, 8000);

    try {
      await channel.sendTyping();
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
      } catch (sendErr) {
        logger.warn('Discord bot: could not send error reply:', sendErr.message);
      }
    } finally {
      clearInterval(typingInterval);
    }
  });

  client.login(dc.botToken.trim()).then(() => {
    logger.info('Discord bot: login call completed (wait for "connected as" to confirm ready)');
  }).catch((e) => {
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
