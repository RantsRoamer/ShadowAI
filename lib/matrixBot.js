'use strict';

const fs = require('fs');
const path = require('path');
const { getConfig } = require('./config.js');
const chatStore = require('./chatStore.js');
const chatRunner = require('./chatRunner.js');
const logger = require('./logger.js');

let clientInstance = null;
const warnedDecryptRooms = new Set();

const CHUNK = 16000;
/** Ignore timeline backlog on first sync — only react to relatively recent messages */
const MAX_MESSAGE_AGE_MS = 15 * 60 * 1000;

/** Client base URL only — strip trailing slash and accidental /_matrix/client suffix */
function normalizeHomeserverUrl(url) {
  let u = String(url || '').trim().replace(/\/+$/, '');
  u = u.replace(/\/_matrix\/client\/?$/, '');
  return u;
}

function getPersistentMatrixDeviceId() {
  const dataDir = path.join(__dirname, '..', 'data');
  const file = path.join(dataDir, 'matrix-device-id.txt');
  try {
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    if (fs.existsSync(file)) {
      const existing = fs.readFileSync(file, 'utf8').trim();
      if (/^[A-Z0-9]{6,16}$/.test(existing)) return existing;
    }
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let id = '';
    for (let i = 0; i < 10; i += 1) id += alphabet[Math.floor(Math.random() * alphabet.length)];
    fs.writeFileSync(file, id, 'utf8');
    return id;
  } catch (_) {
    return '';
  }
}

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
  const base = normalizeHomeserverUrl(homeserverUrl);
  const url = `${base}/_matrix/client/v3/login`;
  const body = {
    type: 'm.login.password',
    identifier: {
      type: 'm.id.user',
      user: userId.trim()
    },
    device_id: getPersistentMatrixDeviceId(),
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
 * matrix-bot-sdk may pass a MessageEvent wrapper or a plain event object.
 */
function normalizeRoomMessageEvent(event) {
  const raw = event && typeof event.raw === 'object' ? event.raw : event;
  if (!raw || typeof raw !== 'object') return null;
  const sender =
    typeof event.sender === 'string'
      ? event.sender
      : typeof raw.sender === 'string'
        ? raw.sender
        : '';
  const content =
    event && event.content && typeof event.content === 'object'
      ? event.content
      : raw.content && typeof raw.content === 'object'
        ? raw.content
        : {};
  let originServerTs = 0;
  if (typeof event.timestamp === 'number') originServerTs = event.timestamp;
  else if (typeof raw.origin_server_ts === 'number') originServerTs = raw.origin_server_ts;
  return { sender, content, originServerTs, raw };
}

function isPlaintextMessageContent(content) {
  if (!content || typeof content !== 'object') return false;
  const mt = content.msgtype;
  const body = content.body;
  if (typeof body !== 'string' || !body.trim()) return false;
  if (!mt || mt === 'm.text' || mt === 'm.emote' || mt === 'm.notice') return true;
  if (mt === 'm.image' || mt === 'm.video' || mt === 'm.audio' || mt === 'm.file') return true;
  return false;
}

function stringifyIfPresent(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

function buildMatrixAttachmentContext(content, client) {
  if (!content || typeof content !== 'object') return '';
  const mt = content.msgtype || '';
  if (!['m.image', 'm.video', 'm.audio', 'm.file'].includes(mt)) return '';
  const info = content.info && typeof content.info === 'object' ? content.info : {};
  const lines = [];
  lines.push('[Attachment received in Matrix]');
  lines.push(`type: ${mt}`);
  if (content.body) lines.push(`name: ${content.body}`);
  if (info.mimetype) lines.push(`mime: ${info.mimetype}`);
  if (info.size != null) lines.push(`size_bytes: ${info.size}`);
  if (info.duration != null) lines.push(`duration_ms: ${info.duration}`);
  if (info.w != null || info.h != null) lines.push(`dimensions: ${info.w || '?'}x${info.h || '?'}`);
  if (content.filename) lines.push(`filename: ${content.filename}`);

  const mxc = stringifyIfPresent(content.url);
  if (mxc.startsWith('mxc://')) {
    lines.push(`mxc_url: ${mxc}`);
    try {
      lines.push(`download_url: ${client.mxcToHttp(mxc)}`);
    } catch (_) {}
  } else if (mxc) {
    lines.push(`url: ${mxc}`);
  }

  const thumb = stringifyIfPresent(info.thumbnail_url);
  if (thumb.startsWith('mxc://')) {
    lines.push(`thumbnail_mxc: ${thumb}`);
    try {
      lines.push(`thumbnail_url: ${client.mxcToHttp(thumb)}`);
    } catch (_) {}
  } else if (thumb) {
    lines.push(`thumbnail_url: ${thumb}`);
  }

  if (content.external_url) lines.push(`external_url: ${content.external_url}`);
  return lines.join('\n');
}

async function setTyping(client, roomId, userId, isTyping, timeoutMs = 30000) {
  if (!roomId || !userId) return;
  const path = `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/typing/${encodeURIComponent(userId)}`;
  try {
    await client.doRequest('PUT', path, null, { typing: !!isTyping, timeout: timeoutMs });
  } catch (_) {}
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
  const homeserverUrl = normalizeHomeserverUrl(mx.homeserverUrl || '');
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

  const { MatrixClient, AutojoinRoomsMixin, SimpleFsStorageProvider, RustSdkCryptoStorageProvider } = sdk;
  const storagePath = path.join(__dirname, '..', 'data', 'matrix-bot-storage.json');
  const storage = new SimpleFsStorageProvider(storagePath);
  const cryptoPath = path.join(__dirname, '..', 'data', 'matrix-crypto');
  let cryptoStore = null;
  let cryptoEnabled = false;
  try {
    cryptoStore = new RustSdkCryptoStorageProvider(cryptoPath);
    cryptoEnabled = true;
  } catch (e) {
    logger.warn('Matrix bot: crypto store init failed, encrypted rooms may not work:', e.message);
  }
  const client = new MatrixClient(homeserverUrl, accessToken, storage, cryptoStore);
  clientInstance = client;
  let botUserId = null;

  AutojoinRoomsMixin.setupOnClient(client);

  client.on('room.encrypted_event', (_roomId, _ev) => {
    if (!cryptoEnabled) {
      logger.warn(
        'Matrix bot: received encrypted event but crypto is not available. Install/rebuild crypto deps and restart.'
      );
    }
  });
  client.on('room.failed_decryption', (_roomId, _ev, err) => {
    const roomId = _roomId || '';
    const msg = err && err.message ? err.message : 'unknown decryption error';
    if (!warnedDecryptRooms.has(roomId)) {
      warnedDecryptRooms.add(roomId);
      logger.warn('Matrix bot: could not decrypt encrypted message. ' + msg);
      if (roomId) {
        client.sendText(
          roomId,
          'I cannot decrypt this message yet because I do not have the room key. '
          + 'In your Matrix client, verify/trust this bot device and enable key sharing with it, then send a new message. '
          + 'If needed, re-invite this bot to a fresh encrypted DM so a new session key is shared.'
        ).catch(() => {});
      }
    }
  });

  client.on('room.join', async (roomId, _event) => {
    try {
      if (!botUserId) botUserId = await client.getUserId();
      const members = await client.getJoinedRoomMembers(roomId).catch(() => []);
      const isLikelyDm = Array.isArray(members) && members.length <= 2;
      if (!isLikelyDm) return;

      let encrypted = false;
      try {
        const enc = await client.getRoomStateEvent(roomId, 'm.room.encryption', '');
        encrypted = !!enc;
      } catch (_) {}

      if (encrypted && !cryptoEnabled) {
        await client.sendText(
          roomId,
          'Hi! I joined your DM, but encrypted message support is not active yet on the server. Ask the admin to enable Matrix crypto support, then restart ShadowAI.'
        );
      } else {
        await client.sendText(roomId, 'Hi! DM received. Send a message any time and I will reply.');
      }
    } catch (e) {
      logger.warn('Matrix bot room.join handler:', e.message);
    }
  });

  client.on('room.message', async (roomId, event) => {
    try {
      if (!botUserId) botUserId = await client.getUserId();
      const norm = normalizeRoomMessageEvent(event);
      if (!norm) return;
      const { sender, content, originServerTs } = norm;

      if (originServerTs && Date.now() - originServerTs > MAX_MESSAGE_AGE_MS) {
        return;
      }

      if (!sender || sender === botUserId) return;

      if (!isPlaintextMessageContent(content)) return;

      const baseText = content.body;
      const attachmentContext = buildMatrixAttachmentContext(content, client);
      const text = attachmentContext ? `${baseText}\n\n${attachmentContext}` : baseText;

      const allowed = mx.allowedUserIds;
      if (Array.isArray(allowed) && allowed.length > 0) {
        const ok = allowed.some((id) => (id || '').trim() === sender.trim());
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
        let typingStopped = false;
        const stopTyping = async () => {
          if (typingStopped) return;
          typingStopped = true;
          if (typingTimer) clearInterval(typingTimer);
          await setTyping(client, roomId, botUserId, false, 0);
        };
        await setTyping(client, roomId, botUserId, true, 30000);
        const typingTimer = setInterval(() => {
          setTyping(client, roomId, botUserId, true, 30000).catch(() => {});
        }, 20000);

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
        await stopTyping();
      } catch (e) {
        logger.error('Matrix bot message error:', e.message);
        await setTyping(client, roomId, botUserId, false, 0);
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
    logger.info(
      'Matrix bot: sync loop running — invite the bot to a room/DM and send a message'
        + (cryptoEnabled ? ' (encrypted rooms supported)' : ' (encrypted rooms require crypto backend)')
    );
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
