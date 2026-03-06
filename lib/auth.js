const bcrypt = require('bcryptjs');
const { getConfig } = require('./config.js');

function authMiddleware(req, res, next) {
  if (req.path === '/login' || req.path === '/api/login' || req.path === '/api/auth' ||
      req.path === '/api/app-name' ||
      req.path === '/api/channel/chat' ||
      req.path.startsWith('/api/webhook/receive/') ||
      req.path.startsWith('/static/') || req.path === '/' && req.method === 'GET') {
    return next();
  }
  if (req.session && req.session.user === getConfig().auth.username) {
    return next();
  }
  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return res.redirect('/login');
}

function checkAuth(username, password) {
  const { auth } = getConfig();
  let passOk;
  if (auth.passwordHash && auth.passwordHash.startsWith('$2')) {
    // Bcrypt hash — compare properly
    passOk = bcrypt.compareSync(password, auth.passwordHash);
  } else {
    // Plain-text legacy (will be migrated on next startup)
    passOk = password === auth.passwordHash;
  }
  return auth.username === username && passOk;
}

module.exports = { authMiddleware, checkAuth };
