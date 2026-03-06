const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CHATS_DIR = path.join(DATA_DIR, 'chats');

function safeUsername(username) {
  if (!username || typeof username !== 'string') return 'default';
  return username.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'default';
}

function getChatPath(username) {
  const safe = safeUsername(username);
  return path.join(CHATS_DIR, safe + '.json');
}

function ensureChatsDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(CHATS_DIR)) fs.mkdirSync(CHATS_DIR, { recursive: true });
}

function newId() {
  return crypto.randomBytes(8).toString('hex');
}

function loadRaw(username) {
  ensureChatsDir();
  const filePath = getChatPath(username);
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (e) {
    console.warn('Chat load failed:', e.message);
  }
  return null;
}

function saveRaw(username, data) {
  ensureChatsDir();
  const filePath = getChatPath(username);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

/** Migrate old single-chat format { messages } to { chats, currentChatId }.
 *  Returns { data, migrated } so the caller can persist immediately. */
function migrateIfNeeded(data) {
  if (!data) return { data: { chats: [], currentChatId: null }, migrated: false };
  if (Array.isArray(data.chats)) {
    return {
      data: {
        chats: data.chats,
        currentChatId: data.currentChatId || (data.chats[0] && data.chats[0].id) || null
      },
      migrated: false
    };
  }
  if (Array.isArray(data.messages)) {
    const id = newId();
    const chat = {
      id,
      title: 'Chat',
      messages: data.messages,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      customInstructions: ''
    };
    return { data: { chats: [chat], currentChatId: id }, migrated: true };
  }
  return { data: { chats: [], currentChatId: null }, migrated: false };
}

function getData(username) {
  const raw = loadRaw(username);
  const { data, migrated } = migrateIfNeeded(raw);
  // Persist immediately after migration so we don't re-run it on every load
  if (migrated) saveRaw(username, data);
  return data;
}

function listChats(username) {
  const { chats, currentChatId } = getData(username);
  return { chats: chats.map(c => ({ id: c.id, title: c.title, createdAt: c.createdAt, updatedAt: c.updatedAt })), currentChatId };
}

const CHANNEL_PREFIXES = ['channel_', 'telegram_', 'discord_', 'project_'];
function isChannelUsername(safeName) {
  return typeof safeName === 'string' && CHANNEL_PREFIXES.some(p => safeName.startsWith(p));
}

/** List all channel users (channel_*, telegram_*, discord_*) and their chats for the web UI. */
function listAllChannelChats() {
  ensureChatsDir();
  const files = fs.readdirSync(CHATS_DIR);
  const result = [];
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const safeName = file.slice(0, -5);
    if (!isChannelUsername(safeName)) continue;
    try {
      const { chats, currentChatId } = listChats(safeName);
      if (chats.length === 0) continue;
      let label = safeName;
      if (safeName === 'channel_cli') label = 'CLI';
      else if (safeName.startsWith('telegram_')) label = 'Telegram (' + safeName.slice(8) + ')';
      else if (safeName.startsWith('discord_')) label = 'Discord (' + safeName.slice(8) + ')';
      else if (safeName.startsWith('channel_')) label = 'Channel (' + safeName.slice(8) + ')';
      result.push({ username: safeName, label, chats, currentChatId });
    } catch (_) {}
  }
  result.sort((a, b) => {
    const aMax = a.chats.reduce((t, c) => (c.updatedAt > t ? c.updatedAt : t), '');
    const bMax = b.chats.reduce((t, c) => (c.updatedAt > t ? c.updatedAt : t), '');
    return (bMax || '').localeCompare(aMax || '');
  });
  return result;
}

function getChat(username, chatId) {
  const { chats } = getData(username);
  return chats.find(c => c.id === chatId) || null;
}

function createChat(username) {
  const data = getData(username);
  const id = newId();
  const now = new Date().toISOString();
  const chat = { id, title: 'New chat', messages: [], createdAt: now, updatedAt: now, customInstructions: '' };
  data.chats.unshift(chat);
  data.currentChatId = id;
  saveRaw(username, data);
  return { id, title: chat.title };
}

function setCurrentChatId(username, chatId) {
  const data = getData(username);
  if (data.chats.some(c => c.id === chatId)) {
    data.currentChatId = chatId;
    saveRaw(username, data);
  }
}

function saveChatMessages(username, chatId, messages) {
  const data = getData(username);
  const chat = data.chats.find(c => c.id === chatId);
  if (!chat) return;
  chat.messages = Array.isArray(messages) ? messages : [];
  chat.updatedAt = new Date().toISOString();
  const firstUser = chat.messages.find(m => m.role === 'user');
  if (firstUser && (chat.title === 'New chat' || !chat.title)) {
    // Slice then trim to avoid titles ending with a space or mid-word
    chat.title = String(firstUser.content || '').trim().slice(0, 48).trim() || 'New chat';
  }
  saveRaw(username, data);
}

function deleteChat(username, chatId) {
  const data = getData(username);
  const idx = data.chats.findIndex(c => c.id === chatId);
  if (idx === -1) return false;
  data.chats.splice(idx, 1);
  if (data.currentChatId === chatId) {
    data.currentChatId = data.chats.length ? data.chats[0].id : null;
  }
  saveRaw(username, data);
  return true;
}

function updateChat(username, chatId, updates) {
  const data = getData(username);
  const chat = data.chats.find(c => c.id === chatId);
  if (!chat) return false;
  if (updates.title !== undefined) {
    chat.title = String(updates.title).trim().slice(0, 120).trim() || chat.title;
  }
  if (updates.customInstructions !== undefined) {
    chat.customInstructions = typeof updates.customInstructions === 'string' ? updates.customInstructions : '';
  }
  chat.updatedAt = new Date().toISOString();
  saveRaw(username, data);
  return true;
}

/** Return messages for a chat; if chatId given, set as current. Returns { messages, title, customInstructions } for the active chat. */
function readChat(username, chatId) {
  const data = getData(username);
  if (chatId && data.chats.some(c => c.id === chatId)) {
    data.currentChatId = chatId;
    saveRaw(username, data);
  }
  const id = data.currentChatId || (data.chats[0] && data.chats[0].id);
  const chat = id ? data.chats.find(c => c.id === id) : null;
  return {
    messages: chat ? chat.messages : [],
    title: chat ? chat.title : null,
    customInstructions: chat && typeof chat.customInstructions === 'string' ? chat.customInstructions : ''
  };
}

/** Write messages to current chat (or chatId if provided). Creates chat if none. Returns the chat id used. */
function writeChat(username, messages, chatId) {
  let data = getData(username);
  let targetId = chatId || data.currentChatId;
  if (!targetId && Array.isArray(messages) && messages.length > 0) {
    const created = createChat(username);
    targetId = created.id;
    data = getData(username);
  }
  if (targetId) {
    saveChatMessages(username, targetId, messages);
  }
  return targetId;
}

function getCurrentChatMeta(username) {
  const data = getData(username);
  const id = data.currentChatId || (data.chats[0] && data.chats[0].id);
  const chat = id ? data.chats.find(c => c.id === id) : null;
  return chat ? { title: chat.title, customInstructions: chat.customInstructions || '' } : { title: null, customInstructions: '' };
}

/** Clear current chat messages. */
function clearCurrentChat(username) {
  const data = getData(username);
  const id = data.currentChatId || (data.chats[0] && data.chats[0].id);
  if (id) saveChatMessages(username, id, []);
}

module.exports = {
  listChats,
  listAllChannelChats,
  isChannelUsername,
  getChat,
  createChat,
  setCurrentChatId,
  updateChat,
  saveChatMessages,
  deleteChat,
  readChat,
  writeChat,
  getCurrentChatMeta,
  clearCurrentChat,
  safeUsername
};
