const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const { getConfig, saveConfig } = require('./config.js');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'users.db');

let dbPromise = null;

const ROLE_ORDER = {
  guest: 0,
  user: 1,
  admin: 2
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function initDb() {
  ensureDataDir();
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) return reject(err);
      db.serialize(() => {
        db.run(
          'CREATE TABLE IF NOT EXISTS users (username TEXT PRIMARY KEY, passwordHash TEXT NOT NULL, role TEXT NOT NULL)',
          (err2) => {
            if (err2) return reject(err2);
            // Seed initial admin from config.auth if table is empty
            db.get('SELECT COUNT(*) AS count FROM users', (err3, row) => {
              if (err3) return reject(err3);
              if (row && row.count === 0) {
                try {
                  const cfg = getConfig();
                  const auth = cfg.auth || { username: 'admin', passwordHash: 'admin' };
                  const username = auth.username || 'admin';
                  let passwordHash = auth.passwordHash || 'admin';
                  if (!passwordHash.startsWith('$2')) {
                    passwordHash = bcrypt.hashSync(passwordHash, 12);
                    cfg.auth.passwordHash = passwordHash;
                    saveConfig(cfg);
                    global.__shadowConfig = cfg;
                  }
                  db.run(
                    'INSERT INTO users (username, passwordHash, role) VALUES (?, ?, ?)',
                    [username, passwordHash, 'admin'],
                    (err4) => {
                      if (err4) return reject(err4);
                      resolve(db);
                    }
                  );
                } catch (e) {
                  return reject(e);
                }
              } else {
                resolve(db);
              }
            });
          }
        );
      });
    });
  });
}

function getDb() {
  if (!dbPromise) dbPromise = initDb();
  return dbPromise;
}

async function authenticate(username, password) {
  const db = await getDb();
  const user = await new Promise((resolve, reject) => {
    db.get('SELECT username, passwordHash, role FROM users WHERE username = ?', [username], (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
    });
  });
  if (!user) return null;
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return null;
  return { username: user.username, role: user.role || 'user' };
}

async function listUsers() {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    db.all('SELECT username, role FROM users ORDER BY username', (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

async function createUser({ username, password, role }) {
  const db = await getDb();
  const cleanUser = String(username || '').trim();
  const cleanRole = ROLE_ORDER[role] !== undefined ? role : 'user';
  if (!cleanUser || !password) throw new Error('Username and password are required');
  const hash = await bcrypt.hash(password, 12);
  return new Promise((resolve, reject) => {
    db.run(
      'INSERT INTO users (username, passwordHash, role) VALUES (?, ?, ?)',
      [cleanUser, hash, cleanRole],
      (err) => {
        if (err) return reject(err);
        resolve({ username: cleanUser, role: cleanRole });
      }
    );
  });
}

async function updateUser(username, updates) {
  const db = await getDb();
  const cleanUser = String(username || '').trim();
  if (!cleanUser) throw new Error('Username is required');
  const fields = [];
  const params = [];
  if (updates.password) {
    const hash = await bcrypt.hash(updates.password, 12);
    fields.push('passwordHash = ?');
    params.push(hash);
  }
  if (updates.role && ROLE_ORDER[updates.role] !== undefined) {
    fields.push('role = ?');
    params.push(updates.role);
  }
  if (fields.length === 0) return;
  params.push(cleanUser);
  return new Promise((resolve, reject) => {
    db.run(`UPDATE users SET ${fields.join(', ')} WHERE username = ?`, params, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

async function deleteUser(username) {
  const db = await getDb();
  const cleanUser = String(username || '').trim();
  if (!cleanUser) throw new Error('Username is required');
  return new Promise((resolve, reject) => {
    db.run('DELETE FROM users WHERE username = ?', [cleanUser], (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

function authMiddleware(req, res, next) {
  // Attach currentUser from session (string username or { username, role })
  if (req.session && req.session.user) {
    if (typeof req.session.user === 'string') {
      req.currentUser = { username: req.session.user, role: 'admin' };
    } else {
      req.currentUser = {
        username: req.session.user.username,
        role: req.session.user.role || 'user'
      };
    }
  } else {
    req.currentUser = null;
  }

  if (req.path === '/login' || req.path === '/api/login' || req.path === '/api/auth' ||
      req.path === '/api/app-name' ||
      req.path === '/api/channel/chat' ||
      req.path.startsWith('/api/webhook/receive/') ||
      req.path.startsWith('/static/') || (req.path === '/' && req.method === 'GET')) {
    return next();
  }
  if (req.currentUser && req.currentUser.username) {
    return next();
  }
  // API routes should never redirect to HTML login pages — always return JSON.
  // This prevents frontend fetch() calls from receiving HTML and silently "breaking".
  if (req.path.startsWith('/api/') || req.xhr || req.headers.accept?.includes('application/json')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return res.redirect('/login');
}

function requireAdmin(req, res, next) {
  if (!req.currentUser || req.currentUser.role !== 'admin') {
    res.status(403).json({ error: 'Forbidden' });
    return false;
  }
  if (typeof next === 'function') {
    next();
  }
  return true;
}

module.exports = {
  authMiddleware,
  authenticate,
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  requireAdmin,
  ROLE_ORDER
};
