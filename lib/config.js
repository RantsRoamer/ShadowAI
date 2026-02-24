const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const DEFAULT_CONFIG_PATH = path.join(__dirname, '..', 'config.default.json');

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    }
  } catch (e) {
    console.warn('Config load failed, using defaults:', e.message);
  }
  const defaultConfig = JSON.parse(fs.readFileSync(DEFAULT_CONFIG_PATH, 'utf8'));
  saveConfig(defaultConfig);
  return defaultConfig;
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
}

function getConfig() {
  if (!global.__shadowConfig) {
    global.__shadowConfig = loadConfig();
  }
  return global.__shadowConfig;
}

function reloadConfig() {
  global.__shadowConfig = loadConfig();
  return getConfig();
}

function updateConfig(updates) {
  const config = getConfig();
  if (updates.server !== undefined) {
    config.server = { ...config.server, ...updates.server };
  }
  if (updates.auth !== undefined) {
    config.auth = { ...config.auth, ...updates.auth };
  }
  if (updates.ollama !== undefined) {
    config.ollama = {
      ...config.ollama,
      ...updates.ollama,
      ...(Array.isArray(updates.ollama.agents) && { agents: updates.ollama.agents })
    };
  }
  if (updates.heartbeat !== undefined && Array.isArray(updates.heartbeat)) {
    config.heartbeat = updates.heartbeat;
  }
  if (updates.skills !== undefined && updates.skills.enabledIds !== undefined) {
    config.skills = config.skills || {};
    config.skills.enabledIds = updates.skills.enabledIds;
  }
  if (updates.searxng !== undefined) {
    config.searxng = { ...(config.searxng || {}), ...updates.searxng };
  }
  if (updates.email !== undefined) {
    config.email = { ...(config.email || {}), ...updates.email };
    if (updates.email.auth) {
      config.email.auth = { ...(config.email.auth || {}), ...updates.email.auth };
      if (updates.email.auth.pass === '' || updates.email.auth.pass === undefined)
        delete config.email.auth.pass;
      if (!config.email.auth.user) config.email.auth = undefined;
    }
  }
  if (updates.sessionSecret !== undefined) {
    config.sessionSecret = updates.sessionSecret;
  }
  saveConfig(config);
  global.__shadowConfig = config;
  return config;
}

module.exports = { getConfig, loadConfig, saveConfig, reloadConfig, updateConfig, CONFIG_PATH };
