/**
 * docker-init.js
 * Applies environment variable overrides to config.json at container startup.
 * Runs once via docker-entrypoint.sh before the main server starts.
 * Only applies an env var when the current config value is missing or empty,
 * so UI saves are not overwritten on container restart.
 *
 * Supported env vars:
 *   OLLAMA_URL        - Ollama server URL  (e.g. http://host.docker.internal:11434)
 *   OLLAMA_MODEL      - Default model name (e.g. llama3.2)
 *   ADMIN_USER        - Login username     (default: admin)
 *   ADMIN_PASSWORD    - Login password     (plain text — will be bcrypt-hashed)
 *                       NOTE: setting this env var always overrides the stored password.
 *                       Remove it after first run if you want to manage the password via the UI.
 *   SEARXNG_URL       - SearXNG base URL   (enables web search when set)
 *   SEARXNG_ENABLED   - Set to "false" to disable even if SEARXNG_URL is set
 *   PORT              - HTTP port          (default: 9090)
 *   HOST              - Bind address       (default: 0.0.0.0)
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'config.json');

if (!fs.existsSync(CONFIG_PATH)) {
  console.log('[docker-init] config.json not found — skipping env var overrides');
  process.exit(0);
}

const config  = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
let   changed = false;

function applyIfEmpty(obj, key, value) {
  if (value === undefined || value === '') return;
  const cur = obj[key];
  if (cur === undefined || cur === null || cur === '') {
    obj[key] = value;
    changed   = true;
  }
}

function applyAlways(obj, key, value) {
  if (value !== undefined && obj[key] !== value) {
    obj[key] = value;
    changed   = true;
  }
}

const {
  OLLAMA_URL, OLLAMA_MODEL,
  ADMIN_USER, ADMIN_PASSWORD,
  SEARXNG_URL, SEARXNG_ENABLED,
  PORT, HOST
} = process.env;

config.ollama = config.ollama || {};
applyIfEmpty(config.ollama, 'mainUrl', OLLAMA_URL);
applyIfEmpty(config.ollama, 'mainModel', OLLAMA_MODEL);

if (PORT !== undefined && PORT !== '') {
  config.server = config.server || {};
  applyAlways(config.server, 'port', parseInt(PORT, 10));
}
if (HOST !== undefined && HOST !== '') {
  config.server = config.server || {};
  applyAlways(config.server, 'host', HOST);
}
config.auth = config.auth || {};
applyIfEmpty(config.auth, 'username', ADMIN_USER);
if (ADMIN_PASSWORD !== undefined && ADMIN_PASSWORD !== '') {
  const bcrypt = require('bcryptjs');
  config.auth.passwordHash = bcrypt.hashSync(ADMIN_PASSWORD, 12);
  changed = true;
  console.log('[docker-init] Admin password set from ADMIN_PASSWORD env var');
}
if (SEARXNG_URL !== undefined && SEARXNG_URL !== '') {
  config.searxng = config.searxng || {};
  applyAlways(config.searxng, 'url', SEARXNG_URL);
  applyAlways(config.searxng, 'enabled', SEARXNG_ENABLED !== 'false');
}

if (changed) {
  const configPath = fs.realpathSync ? fs.realpathSync(CONFIG_PATH) : CONFIG_PATH;
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
  console.log('[docker-init] Applied environment variable overrides to config.json');
} else {
  console.log('[docker-init] No env var overrides to apply');
}
