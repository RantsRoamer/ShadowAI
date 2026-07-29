'use strict';

const path = require('path');
const fs = require('fs');
const { getConfig } = require('./config.js');
const { DATA_DIR } = require('./personality.js');
const logger = require('./logger.js');

const BROWSER_TOOL_NAMES = [
  'browser_navigate',
  'browser_snapshot',
  'browser_click',
  'browser_type',
  'browser_screenshot',
  'browser_close'
];

const TOOL_NAME_SET = new Set(BROWSER_TOOL_NAMES);

let configOverride = null; // tests only

function setBrowserConfigOverrideForTests(obj) {
  configOverride = obj;
}

function getBrowserConfig() {
  if (configOverride) return { ...defaultBrowserConfig(), ...configOverride };
  const b = getConfig().browser || {};
  return { ...defaultBrowserConfig(), ...b };
}

function defaultBrowserConfig() {
  return {
    enabled: true,
    headless: true,
    idleTimeoutMs: 300000,
    actionTimeoutMs: 30000,
    maxActionsPerSession: 40,
    maxTextChars: 80000,
    blockPrivateNetworks: true
  };
}

function isBrowserEnabled() {
  return getBrowserConfig().enabled !== false;
}

function isPrivateIpv4Octets(a, b) {
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

function isPrivateHostnameOrIp(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (h === 'localhost' || h === '0.0.0.0' || h.endsWith('.localhost')) return true;
  // IPv4
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
  if (m) return isPrivateIpv4Octets(+m[1], +m[2]);
  if (h.includes(':')) {
    if (h === '::1') return true;
    if (h.startsWith('fc') || h.startsWith('fd')) return true; // ULA fc00::/7
    const firstHextet = h.split(':')[0];
    if (firstHextet && /^[0-9a-f]{1,4}$/.test(firstHextet)) {
      const n = parseInt(firstHextet, 16);
      if (n >= 0xfe80 && n <= 0xfebf) return true; // fe80::/10 link-local
    }
    const mapped = /ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(h);
    if (mapped) {
      const pm = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(mapped[1]);
      if (pm) return isPrivateIpv4Octets(+pm[1], +pm[2]);
    }
  }
  return false;
}

function assertAllowedUrl(urlString, opts = {}) {
  let u;
  try { u = new URL(String(urlString || '').trim()); } catch (_) {
    throw new Error('Invalid URL');
  }
  if (!['http:', 'https:'].includes(u.protocol)) {
    throw new Error('Only http and https URLs are allowed');
  }
  const block = opts.blockPrivateNetworks !== undefined
    ? !!opts.blockPrivateNetworks
    : getBrowserConfig().blockPrivateNetworks !== false;
  if (block && isPrivateHostnameOrIp(u.hostname)) {
    throw new Error('URL blocked: private/local network addresses are not allowed');
  }
  return u;
}

function truncateText(text, maxChars) {
  const max = maxChars != null ? maxChars : getBrowserConfig().maxTextChars;
  const s = text == null ? '' : String(text);
  return s.length > max ? s.slice(0, max) : s;
}

function handles(name) {
  return TOOL_NAME_SET.has(name);
}

function getBrowserToolDefinitions() {
  if (!isBrowserEnabled()) return [];
  return [
    {
      type: 'function',
      function: {
        name: 'browser_navigate',
        description: 'Open a URL in this chat\'s browser session (creates session if needed). Prefer this over fetch_url for JS-heavy pages. Then use browser_snapshot.',
        parameters: {
          type: 'object',
          required: ['url'],
          properties: { url: { type: 'string', description: 'Full http(s) URL' } }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'browser_snapshot',
        description: 'Get the current page title and visible text from the browser session. Optionally include a screenshot.',
        parameters: {
          type: 'object',
          properties: {
            screenshot: { type: 'boolean', description: 'If true, also capture a screenshot' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'browser_click',
        description: 'Click an element in the browser session by CSS selector, or by role+name.',
        parameters: {
          type: 'object',
          properties: {
            selector: { type: 'string', description: 'CSS selector' },
            role: { type: 'string', description: 'ARIA role (e.g. button, link)' },
            name: { type: 'string', description: 'Accessible name when using role' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'browser_type',
        description: 'Type text into an input in the browser session.',
        parameters: {
          type: 'object',
          required: ['selector', 'text'],
          properties: {
            selector: { type: 'string' },
            text: { type: 'string' },
            clear: { type: 'boolean', description: 'Clear field before typing (default true)' },
            submit: { type: 'boolean', description: 'Press Enter after typing' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'browser_screenshot',
        description: 'Capture a PNG screenshot of the current page. Saved under data/browser-screenshots/.',
        parameters: { type: 'object', properties: {} }
      }
    },
    {
      type: 'function',
      function: {
        name: 'browser_close',
        description: 'Close this chat\'s browser session and free resources.',
        parameters: { type: 'object', properties: {} }
      }
    }
  ];
}

// Placeholders filled in Task 2:
// async function executeBrowserTool(name, args, ctx) { ... }
// async function closeSession(sessionId) { ... }
// function takePendingVisionImages(sessionId) { ... }

module.exports = {
  BROWSER_TOOL_NAMES,
  getBrowserConfig,
  setBrowserConfigOverrideForTests,
  isBrowserEnabled,
  isPrivateHostnameOrIp,
  assertAllowedUrl,
  truncateText,
  handles,
  getBrowserToolDefinitions
};
