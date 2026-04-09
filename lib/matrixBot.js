'use strict';

const path = require('path');
const { getConfig } = require('./config.js');
const chatStore = require('./chatStore.js');
const chatRunner = require('./chatRunner.js');
const logger = require('./logger.js');

let clientInstance = null;

const CHUNK = 16000;

function matrixUsernameForSender(sender) {
  if (!sender || typeof sender !== 'string') return 'matrix_unknown';
  const local = sender.replace(/^@/, '').replace(/:/g, '_').replace(/[^a-zA-Z0-9_-]/g, '_');
  return ('matrix_' + local).slice(0, 64);
}

/**
 * Obtain an access token via Matrix Client-Server API (Synapse and spec-compliant servers).
 * @param {string} homeserverUrl - e.g. https://matrix.example.org
 * @param {string} userId - local part (alice) or full MXID (@alice:example.org)
 * @param {string} password
 */
async function matrixLoginWithPassword(homeserverUrl, userId, password) {
  const base = homeserverUrl.replace(/\/$/, '');
  const url = `${base}/_matrix/client/v3/login`;
  const body = {
    type: 'm.login.password',
    identifier: {
      type: 'm.id.user',
      user: userId.trim()
    },
    password: String(password),
    initial_device_display_name: 'ShadowAI'
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error || data.errcode || res.statusText || 'login failed';
    throw new Error(msg);
  }
  if (!data.access_token) {
    throw new Error('Matrix login: no access_token in response');
  }
  return data.access_token;
}

/**
 * Matrix (Synapse / any Matrix homeserver) bot using matrix-bot-sdk.
 * Configure in CONFIG → Channels: homeserver URL, and either an access token or username+password (login API).
 * Invite the bot to a room or DM; optional dependency: npm install matrix-bot-sdk
 */
async function startMatrixBotAsync() {
  const channels = getConfig().channels || {};
  const mx = channels.matrix || {};
  if (!mx.enabled) return;
  const homeserverUrl = (mx.homeserverUrl || '').trim();
  if (!homeserverUrl) {
    logger.warn('Matrix bot: enabled but homeserverUrl is missing');
    return;
  }

  const authMode = String(mx.authMode || 'token').toLowerCase() === 'password' ? 'password' : 'token';
  let accessToken = (mx.accessToken || '').trim();

  if (authMode === 'password') {
    const userId = (mx.userId || '').trim();
    const password = (mx.password || '').trim();
    if (!userId || !password) {
      logger.warn('Matrix bot: auth mode is password but userId or password is missing');
      return;
    }
    try {
      accessToken = await matrixLoginWithPassword(homeserverUrl, userId, password);
      logger.info('Matrix bot: signed in via Client-Server login API');
    } catch (e) {
      logger.error('Matrix bot: login API failed:', e.message);
      return;
    }
  } else if (!accessToken) {
    const userId = (mx.userId || '').trim();
    const password = (mx.password || '').trim();
    if (userId && password) {
      try {
        accessToken = await matrixLoginWithPassword(homeserverUrl, userId, password);
        logger.info('Matrix bot: no access token in config; signed in with stored userId and password');
      } catch (e) {
        logger.error('Matrix bot: login API failed:', e.message);
        return;
      }
    } else {
      logger.warn('Matrix bot: set an access token, or userId + password, or switch auth to password mode');
      return;
    }
  }

  if (!accessToken) {
    logger.warn('Matrix bot: could not obtain access token');
    return;
  }

  let sdk;
  try {
    sdk = require('matrix-bot-sdk');
  } catch (e) {
    logger.warn('Matrix bot skipped: install matrix-bot-sdk (npm install matrix-bot-sdk)');
    return;
  }

  const { MatrixClient, AutojoinRoomsMixin, SimpleFsStorageProvider } = sdk;
  const storagePath = path.join(__dirname, '..', 'data', 'matrix-bot-storage.json');
  const storage = new SimpleFsStorageProvider(storagePath);
  const client = new MatrixClient(homeserverUrl, accessToken, storage);
  clientInstance = client;

  AutojoinRoomsMixin.setupOnClient(client);

  let botUserId = null;
  client.on('room.message', async (roomId, event) => {
    try {
      if (!botUserId) botUserId = await client.getUserId();
      const sender = event.sender;
      if (!sender || sender === botUserId) return;

      const content = event.content || {};
      const msgtype = content.msgtype;
      if (msgtype !== 'm.text' && msgtype !== 'm.emote') return;

      let text = content.body;
      if (typeof text !== 'string' || !text.trim()) return;

      const allowed = mx.allowedUserIds;
      if (Array.isArray(allowed) && allowed.length > 0) {
        const ok = allowed.some((id) => (id || '').trim() === sender);
        if (!ok) {
          try {
            await client.sendText(roomId, 'You are not authorized to use this bot.');
          } catch (e) {
            logger.warn('Matrix bot: could not send not-authorized reply:', e.message);
          }
          return;
        }
      }

      const username = matrixUsernameForSender(sender);
      const trimmed = text.trim().toLowerCase();
      if (trimmed === 'reset' || trimmed === '!reset') {
        try {
          chatStore.clearCurrentChat(username);
          await client.sendText(roomId, 'Chat cleared. Start a new conversation whenever you\'re ready.');
        } catch (e) {
          logger.warn('Matrix reset error:', e.message);
          try {
            await client.sendText(roomId, 'Could not clear chat.');
          } catch (_) {}
        }
        return;
      }

      try {
        const data = chatStore.readChat(username);
        const messages = (data && data.messages) ? [...data.messages] : [];
        messages.push({ role: 'user', content: text });
        const { content: reply } = await chatRunner.runChatTurn({
          user: username,
          messages,
          customInstructions: (data && data.customInstructions) || '',
          agentId: null
        });
        messages.push({ role: 'assistant', content: reply });
        chatStore.writeChat(username, messages);

        for (let i = 0; i < reply.length; i += CHUNK) {
          const part = reply.slice(i, i + CHUNK);
          await client.sendText(roomId, part);
        }
      } catch (e) {
        logger.error('Matrix bot message error:', e.message);
        try {
          await client.sendText(roomId, 'Sorry, something went wrong. Please try again.');
        } catch (sendErr) {
          logger.warn('Matrix bot: could not send error reply:', sendErr.message);
        }
      }
    } catch (e) {
      logger.error('Matrix bot room.message handler:', e.message);
    }
  });

  client.start().then(() => {
    logger.info('Matrix bot: sync started');
  }).catch((e) => {
    logger.error('Matrix bot start failed:', e.message);
    clientInstance = null;
  });
}

function startMatrixBot() {
  startMatrixBotAsync().catch((e) => {
    logger.error('Matrix bot:', e.message);
  });
}

function stopMatrixBot() {
  if (clientInstance && typeof clientInstance.stop === 'function') {
    clientInstance.stop();
    clientInstance = null;
    logger.info('Matrix bot stopped');
  }
}

module.exports = { startMatrixBot, stopMatrixBot };
