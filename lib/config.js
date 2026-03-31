const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const DEFAULT_CONFIG_PATH = path.join(__dirname, '..', 'config.default.json');

function getConfigPath() {
  try {
    return fs.realpathSync(CONFIG_PATH);
  } catch (_) {
    return CONFIG_PATH;
  }
}

function loadConfig() {
  let configPath;
  try {
    configPath = fs.existsSync(CONFIG_PATH) ? getConfigPath() : CONFIG_PATH;
  } catch (_) {
    configPath = CONFIG_PATH;
  }
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (e) {
    console.warn('Config load failed, using defaults:', e.message);
  }
  const defaultConfig = JSON.parse(fs.readFileSync(DEFAULT_CONFIG_PATH, 'utf8'));
  saveConfig(defaultConfig);
  return defaultConfig;
}

function saveConfig(config) {
  if (!config || typeof config !== 'object') return;
  const json = JSON.stringify(config, null, 2);
  const configPath = getConfigPath();
  fs.writeFileSync(configPath, json, 'utf8');
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
    const prev = config.ollama || {};
    const next = updates.ollama;
    config.ollama = {
      ...prev,
      ...next,
      agents: Array.isArray(next.agents) ? next.agents : (Array.isArray(prev.agents) ? prev.agents : [])
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
  if (updates.projectReport !== undefined) {
    config.projectReport = { ...(config.projectReport || {}), ...updates.projectReport };
    if (Array.isArray(updates.projectReport.projectIds)) config.projectReport.projectIds = updates.projectReport.projectIds;
  }
  if (updates.projectReports !== undefined && Array.isArray(updates.projectReports)) {
    config.projectReports = updates.projectReports;
  }
  if (updates.rag !== undefined) {
    config.rag = { ...(config.rag || {}), ...updates.rag };
  }
  if (updates.agent !== undefined) {
    config.agent = { ...(config.agent || {}), ...updates.agent };
  }
  saveConfig(config);
  global.__shadowConfig = config;
  return config;
}

/** Replace entire config and persist. Use when you have built the full merged config. */
function replaceConfig(fullConfig) {
  if (!fullConfig || typeof fullConfig !== 'object') return getConfig();
  global.__shadowConfig = fullConfig;
  saveConfig(fullConfig);
  return fullConfig;
}

module.exports = { getConfig, loadConfig, saveConfig, reloadConfig, updateConfig, replaceConfig, CONFIG_PATH };
