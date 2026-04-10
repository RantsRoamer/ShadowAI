'use strict';

const { getConfig } = require('./config.js');
const chatStore = require('./chatStore.js');
const chatRunner = require('./chatRunner.js');
const channelLinks = require('./channelLinks.js');
const channelPrefs = require('./channelPrefs.js');
const logger = require('./logger.js');

let clientInstance = null;

function formatTokenStatsLine(tokenStats) {
  if (!tokenStats) return '';
  const p = Number(tokenStats.promptTokens) || 0;
  const e = Number(tokenStats.evalTokens) || 0;
  const pct = Number(tokenStats.usagePct) || 0;
  return `↑${p} ↓${e} • ${pct.toFixed(1)}% ctx`;
}

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

  const { Client, Events, GatewayIntentBits, Partials, REST, Routes, SlashCommandBuilder } = discord;
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

  client.on(Events.ClientReady, async () => {
    const tag = client.user ? client.user.tag : 'unknown';
    logger.info(`Discord bot connected as ${tag} (DMs enabled)`);
    try {
      await client.application.fetch();
      const appId = client.application?.id;
      if (appId) {
        const rest = new REST().setToken(dc.botToken.trim());
        const commands = [
          new SlashCommandBuilder().setName('reset').setDescription('Clear the conversation with the bot').toJSON()
        ];
        await rest.put(Routes.applicationCommands(appId), { body: commands });
        logger.info('Discord slash command /reset registered');
      }
    } catch (e) {
      logger.warn('Discord slash command registration failed ( /reset may still work if already registered ):', e.message);
    }
  });

  client.on('error', (e) => {
    logger.error('Discord client error:', e.message);
  });
  client.on('warn', (info) => {
    logger.warn('Discord client warn:', info);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== 'reset') return;
    const authorId = interaction.user && interaction.user.id;
    if (!authorId) return;
    const allowedIds = dc.allowedUserIds;
    if (Array.isArray(allowedIds) && allowedIds.length > 0 && !allowedIds.includes(authorId)) {
      try {
        await interaction.reply({ content: "You're not authorized to use this bot.", ephemeral: true });
      } catch (_) {}
      return;
    }
    const username = 'discord_' + authorId;
    const linkedUser = channelLinks.getLinkedAppUser(username);
    const memoryUser = linkedUser || username;
    try {
      chatStore.clearCurrentChat(username);
      await interaction.reply({ content: 'Chat cleared. Start a new conversation whenever you\'re ready.', ephemeral: false });
    } catch (e) {
      logger.warn('Discord /reset (slash) error:', e.message);
      try {
        await interaction.reply({ content: 'Could not clear chat.', ephemeral: true }).catch(() => {});
      } catch (_) {}
    }
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

    const trimmed = text.trim().toLowerCase();
    const verifyMatch = text.trim().match(/^\/verifyme\s+([A-Za-z0-9_-]{4,32})$/i);
    if (verifyMatch) {
      const out = channelLinks.verifyAndLink(username, verifyMatch[1]);
      if (out.ok) await message.reply(`Linked to ShadowAI user "${out.username}". This bot chat will now appear in that user's chat list.`);
      else await message.reply(out.error || 'Verification failed.');
      return;
    }
    if (trimmed === '/unlink') {
      const ok = channelLinks.unlinkChannel(username);
      await message.reply(ok ? 'Unlinked this bot chat from web user account.' : 'This bot chat was not linked.');
      return;
    }
    if (trimmed === '/whoami') {
      const linked = channelLinks.getLinkedAppUser(username);
      await message.reply(
        linked
          ? `Channel identity: \`${username}\`\nLinked ShadowAI user: \`${linked}\``
          : `Channel identity: \`${username}\`\nLinked ShadowAI user: (not linked)\nUse \`/verifyme <code>\` to link.`
      );
      return;
    }
    if (trimmed === '/stats') {
      const enabled = channelPrefs.toggleStats(username);
      await message.reply(enabled ? 'Token stats are now ON for this chat.' : 'Token stats are now OFF for this chat.');
      return;
    }
    if (['/reset', '/new'].includes(trimmed)) {
      try {
        chatStore.clearCurrentChat(username);
        await message.reply('Chat cleared. Start a new conversation whenever you\'re ready.');
      } catch (e) {
        logger.warn('Discord reset/new error:', e.message);
        try { await message.reply('Could not clear chat.'); } catch (_) {}
      }
      return;
    }

    const channel = message.channel;
    const typingInterval = setInterval(() => {
      channel.sendTyping().catch(() => {});
    }, 8000);

    try {
      await channel.sendTyping();
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
      const chunkSize = 2000;
      const parts = [];
      for (let i = 0; i < finalContent.length; i += chunkSize) parts.push(finalContent.slice(i, i + chunkSize));
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
