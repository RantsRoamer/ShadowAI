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

function ipv4FromMappedIpv6(hostname) {
  const dotted = /ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(hostname);
  if (dotted) return dotted[1];
  const hex = /ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(hostname);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
  }
  return null;
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
    const mappedIpv4 = ipv4FromMappedIpv6(h);
    if (mappedIpv4) {
      const pm = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(mappedIpv4);
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

const sessions = new Map(); // sessionId -> { browser, context, page, lastUsedAt, actionCount, pendingImages }
let idleTimer = null;

function safeId(id) {
  return String(id || 'unknown').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
}

function screenshotsDir(sessionId) {
  const dir = path.join(DATA_DIR, 'browser-screenshots', safeId(sessionId));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function takePendingVisionImages(sessionId) {
  const s = sessions.get(String(sessionId || ''));
  if (!s || !s.pendingImages || !s.pendingImages.length) return [];
  const out = s.pendingImages.slice();
  s.pendingImages = [];
  return out;
}

async function installPrivateNetworkRequestGuard(context, blockedRequests, cfg) {
  if (cfg.blockPrivateNetworks === false) return;
  await context.route('**/*', async (route) => {
    const request = route.request();
    try {
      assertAllowedUrl(request.url(), { blockPrivateNetworks: true });
      await route.continue();
    } catch (_) {
      blockedRequests.push({
        url: request.url(),
        isNavigation: request.isNavigationRequest()
      });
      await route.abort('blockedbyclient');
    }
  });
}

async function ensureSession(sessionId) {
  const id = String(sessionId || '').trim();
  if (!id) throw new Error('browser sessionId is required');
  let s = sessions.get(id);
  if (s && s.page) {
    s.lastUsedAt = Date.now();
    return s;
  }
  const cfg = getBrowserConfig();
  let playwright;
  try {
    playwright = require('playwright');
  } catch (_) {
    throw new Error('Playwright is not installed. Run: npm install playwright && npx playwright install chromium');
  }
  const browser = await playwright.chromium.launch({ headless: cfg.headless !== false });
  const context = await browser.newContext({
    serviceWorkers: cfg.blockPrivateNetworks === false ? 'allow' : 'block'
  });
  const blockedRequests = [];
  await installPrivateNetworkRequestGuard(context, blockedRequests, cfg);
  const page = await context.newPage();
  page.setDefaultTimeout(cfg.actionTimeoutMs || 30000);
  s = {
    browser,
    context,
    page,
    lastUsedAt: Date.now(),
    actionCount: 0,
    pendingImages: [],
    blockedRequests
  };
  sessions.set(id, s);
  ensureIdleSweeper();
  return s;
}

async function closeSession(sessionId) {
  const id = String(sessionId || '');
  const s = sessions.get(id);
  if (!s) return;
  sessions.delete(id);
  try { await s.context.close(); } catch (_) {}
  try { await s.browser.close(); } catch (_) {}
}

async function closeAllSessions() {
  for (const id of [...sessions.keys()]) await closeSession(id);
}

function bumpAction(s) {
  const cfg = getBrowserConfig();
  s.actionCount = (s.actionCount || 0) + 1;
  s.lastUsedAt = Date.now();
  if (s.actionCount > (cfg.maxActionsPerSession || 40)) {
    throw new Error('Browser action limit reached for this session. Call browser_close and start again.');
  }
}

async function saveScreenshot(sessionId, page) {
  const file = path.join(screenshotsDir(sessionId), `${Date.now()}.png`);
  const buf = await page.screenshot({ type: 'png', fullPage: false });
  fs.writeFileSync(file, buf);
  const b64 = buf.toString('base64');
  const s = sessions.get(String(sessionId));
  if (s) {
    s.pendingImages = s.pendingImages || [];
    s.pendingImages.push(b64);
  }
  return { file, relative: path.relative(path.join(__dirname, '..'), file) };
}

async function executeBrowserTool(name, args, ctx) {
  if (!isBrowserEnabled()) return 'Error: browser tools are disabled in config.';
  const sessionId = ctx && ctx.sessionId != null ? String(ctx.sessionId).trim() : '';
  if (!sessionId) return 'Error: browser sessionId is required.';
  args = args && typeof args === 'object' ? args : {};
  try {
    if (name === 'browser_close') {
      await closeSession(sessionId);
      return 'Browser session closed.';
    }
    if (name === 'browser_navigate') {
      const url = args.url != null ? String(args.url).trim() : '';
      if (!url) return 'Error: url is required.';
      assertAllowedUrl(url);
      const s = await ensureSession(sessionId);
      bumpAction(s);
      s.blockedRequests.length = 0;
      let resp;
      try {
        resp = await s.page.goto(url, { waitUntil: 'domcontentloaded', timeout: getBrowserConfig().actionTimeoutMs });
      } catch (err) {
        const blockedNavigation = s.blockedRequests.find((request) => request.isNavigation);
        if (blockedNavigation) {
          throw new Error(`Navigation blocked: ${blockedNavigation.url} is a private/local network address`);
        }
        throw err;
      }
      const blockedNavigation = s.blockedRequests.find((request) => request.isNavigation);
      if (blockedNavigation) {
        throw new Error(`Navigation blocked: ${blockedNavigation.url} is a private/local network address`);
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
      const title = await s.page.title();
      return `Navigated to ${s.page.url()}\nTitle: ${title || '(none)'}\nHTTP: ${resp ? resp.status() : 'n/a'}`;
    }
    const s = sessions.get(sessionId);
    if (!s || !s.page) return 'Error: no browser session. Call browser_navigate first.';
    if (name === 'browser_snapshot') {
      bumpAction(s);
      const title = await s.page.title();
      const text = truncateText(await s.page.innerText('body').catch(() => ''));
      let extra = '';
      if (args.screenshot === true) {
        const shot = await saveScreenshot(sessionId, s.page);
        extra = `\nScreenshot: ${shot.relative}`;
      }
      return `Title: ${title || '(none)'}\nURL: ${s.page.url()}\n\nContent:\n${text}${extra}`;
    }
    if (name === 'browser_click') {
      bumpAction(s);
      const selector = args.selector != null ? String(args.selector).trim() : '';
      const role = args.role != null ? String(args.role).trim() : '';
      const accessibleName = args.name != null ? String(args.name).trim() : '';
      if (selector) await s.page.click(selector);
      else if (role) await s.page.getByRole(role, accessibleName ? { name: accessibleName } : undefined).click();
      else return 'Error: provide selector or role(+name).';
      return 'Clicked successfully.';
    }
    if (name === 'browser_type') {
      bumpAction(s);
      const selector = args.selector != null ? String(args.selector).trim() : '';
      const text = args.text != null ? String(args.text) : '';
      if (!selector) return 'Error: selector is required.';
      if (args.clear !== false) await s.page.fill(selector, text);
      else await s.page.type(selector, text);
      if (args.submit === true) await s.page.press(selector, 'Enter');
      return 'Typed successfully.';
    }
    if (name === 'browser_screenshot') {
      bumpAction(s);
      const shot = await saveScreenshot(sessionId, s.page);
      return `Screenshot saved: ${shot.relative}`;
    }
    return `Error: unknown browser tool ${name}`;
  } catch (err) {
    logger.warn('browser tool error:', name, err.message);
    const msg = String(err && err.message ? err.message : err);
    if (/Executable doesn't exist|browserType\.launch/i.test(msg)) {
      return 'Error: Chromium not installed. Run: npx playwright install chromium';
    }
    return 'Error: ' + msg;
  }
}

function ensureIdleSweeper() {
  if (idleTimer) return;
  idleTimer = setInterval(() => {
    const idle = getBrowserConfig().idleTimeoutMs || 300000;
    const now = Date.now();
    for (const [id, s] of sessions.entries()) {
      if (now - (s.lastUsedAt || 0) > idle) closeSession(id).catch(() => {});
    }
  }, 60000);
  if (idleTimer.unref) idleTimer.unref();
}

module.exports = {
  BROWSER_TOOL_NAMES,
  getBrowserConfig,
  setBrowserConfigOverrideForTests,
  isBrowserEnabled,
  isPrivateHostnameOrIp,
  assertAllowedUrl,
  installPrivateNetworkRequestGuard,
  truncateText,
  handles,
  getBrowserToolDefinitions,
  executeBrowserTool,
  closeSession,
  closeAllSessions,
  takePendingVisionImages
};
