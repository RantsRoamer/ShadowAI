'use strict';

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const chatStore = require('./chatStore.js');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CHATS_DIR = path.join(DATA_DIR, 'chats');
const DB_PATH = path.join(DATA_DIR, 'chat_history_fts.db');

const MAX_BODY = 12000;
const SNIPPET = 320;

let dbPromise = null;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function openDb() {
  ensureDataDir();
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) return reject(err);
      db.serialize(() => {
        db.run(
          `CREATE VIRTUAL TABLE IF NOT EXISTS chat_hist_fts USING fts5(
            username UNINDEXED,
            chat_id UNINDEXED,
            msg_idx UNINDEXED,
            role UNINDEXED,
            chat_title,
            body,
            tokenize = 'porter unicode61'
          )`,
          (e2) => {
            if (e2) return reject(e2);
            resolve(db);
          }
        );
      });
    });
  });
}

function getDb() {
  if (!dbPromise) dbPromise = openDb();
  return dbPromise;
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

/** Build a safe FTS5 MATCH string from user input (token AND). */
function ftsMatchQuery(raw) {
  const s = String(raw || '').trim().slice(0, 400);
  if (!s) return '';
  const parts = s.split(/\s+/).filter(Boolean).slice(0, 14);
  if (parts.length === 0) return '';
  return parts
    .map((p) => {
      const esc = p.replace(/"/g, '""');
      return `body : "${esc}"`;
    })
    .join(' AND ');
}

function normalizeUsername(u) {
  return chatStore.safeUsername(u);
}

/**
 * Replace FTS rows for one chat with current messages.
 */
async function reindexChat(username, chatId) {
  const user = normalizeUsername(username);
  const chat = chatStore.getChat(user, chatId);
  if (!chat) return;
  const db = await getDb();
  await run(db, 'DELETE FROM chat_hist_fts WHERE username = ? AND chat_id = ?', [user, chatId]);
  const title = String(chat.title || 'Chat').slice(0, 200);
  const messages = Array.isArray(chat.messages) ? chat.messages : [];
  let idx = 0;
  for (const m of messages) {
    const role = String(m && m.role ? m.role : '').slice(0, 32);
    const body = String(m && m.content != null ? m.content : '').slice(0, MAX_BODY);
    if (!body.trim()) {
      idx++;
      continue;
    }
    await run(
      db,
      `INSERT INTO chat_hist_fts (username, chat_id, msg_idx, role, chat_title, body) VALUES (?, ?, ?, ?, ?, ?)`,
      [user, chatId, idx, role, title, body]
    );
    idx++;
  }
}

async function removeChat(username, chatId) {
  const user = normalizeUsername(username);
  const db = await getDb();
  await run(db, 'DELETE FROM chat_hist_fts WHERE username = ? AND chat_id = ?', [user, chatId]);
}

/**
 * @param {string} username - chat store user id
 * @param {string} query
 * @param {{ limit?: number, chatId?: string }} [opts]
 * @returns {Promise<Array<{ chatId: string, chatTitle: string, role: string, msgIdx: number, snippet: string }>>}
 */
async function search(username, query, opts = {}) {
  const user = normalizeUsername(username);
  const match = ftsMatchQuery(query);
  if (!match) return [];
  const limit = Math.min(40, Math.max(1, Number(opts.limit) || 15));
  const db = await getDb();
  const chatId = opts.chatId ? String(opts.chatId).trim() : '';
  const sql = chatId
    ? `SELECT username, chat_id, msg_idx, role, chat_title, body FROM chat_hist_fts WHERE chat_hist_fts MATCH ? AND username = ? AND chat_id = ? LIMIT ?`
    : `SELECT username, chat_id, msg_idx, role, chat_title, body FROM chat_hist_fts WHERE chat_hist_fts MATCH ? AND username = ? LIMIT ?`;
  const params = chatId ? [match, user, chatId, limit] : [match, user, limit];
  const rows = await all(db, sql, params);
  return rows.map((r) => ({
    chatId: r.chat_id,
    chatTitle: r.chat_title || 'Chat',
    role: r.role || '',
    msgIdx: Number(r.msg_idx) || 0,
    snippet: String(r.body || '').replace(/\s+/g, ' ').trim().slice(0, SNIPPET)
  }));
}

async function reindexAllUsers() {
  ensureDataDir();
  if (!fs.existsSync(CHATS_DIR)) return;
  const files = fs.readdirSync(CHATS_DIR).filter((f) => f.endsWith('.json'));
  for (const file of files) {
    const safeName = file.slice(0, -5);
    let data;
    try {
      data = JSON.parse(fs.readFileSync(path.join(CHATS_DIR, file), 'utf8'));
    } catch (_) {
      continue;
    }
    if (!data || !Array.isArray(data.chats)) continue;
    for (const c of data.chats) {
      if (c && c.id) {
        try {
          await reindexChat(safeName, c.id);
        } catch (e) {
          /* ignore per-chat errors */
        }
      }
    }
  }
}

module.exports = {
  search,
  reindexChat,
  removeChat,
  reindexAllUsers,
  ftsMatchQuery
};
