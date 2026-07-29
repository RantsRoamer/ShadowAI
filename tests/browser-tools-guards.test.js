'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getBrowserConfig,
  setBrowserConfigOverrideForTests,
  isPrivateHostnameOrIp,
  assertAllowedUrl,
  assertAllowedUrlResolved,
  installPrivateNetworkRequestGuard,
  truncateText,
  getBrowserToolDefinitions,
  handles,
  BROWSER_TOOL_NAMES
} = require('../lib/browserTools.js');

test('isPrivateHostnameOrIp blocks localhost and RFC1918', () => {
  assert.equal(isPrivateHostnameOrIp('localhost'), true);
  assert.equal(isPrivateHostnameOrIp('127.0.0.1'), true);
  assert.equal(isPrivateHostnameOrIp('10.0.0.1'), true);
  assert.equal(isPrivateHostnameOrIp('192.168.1.1'), true);
  assert.equal(isPrivateHostnameOrIp('172.16.5.1'), true);
  assert.equal(isPrivateHostnameOrIp('example.com'), false);
});

test('isPrivateHostnameOrIp blocks local IPv6 ranges and IPv4-mapped private', () => {
  assert.equal(isPrivateHostnameOrIp('fe80::1'), true);
  assert.equal(isPrivateHostnameOrIp('fe90::1'), true);
  assert.equal(isPrivateHostnameOrIp('fec0::1'), true);
  assert.equal(isPrivateHostnameOrIp('::ffff:127.0.0.1'), true);
  assert.equal(isPrivateHostnameOrIp('::ffff:10.1.2.3'), true);
  assert.equal(isPrivateHostnameOrIp('::ffff:7f00:1'), true);
  assert.equal(isPrivateHostnameOrIp('::ffff:a01:203'), true);
  assert.equal(isPrivateHostnameOrIp('[::ffff:7f00:1]'), true);
  assert.equal(isPrivateHostnameOrIp('2001:db8::1'), false);
  assert.equal(isPrivateHostnameOrIp('example.com'), false);
});

test('assertAllowedUrl blocks IPv4-mapped IPv6 private addresses', () => {
  assert.throws(
    () => assertAllowedUrl('http://[::ffff:127.0.0.1]/', { blockPrivateNetworks: true }),
    /private|blocked|local/i
  );
  assert.throws(
    () => assertAllowedUrl('http://[::ffff:10.1.2.3]/', { blockPrivateNetworks: true }),
    /private|blocked|local/i
  );
});

test('assertAllowedUrlResolved rejects hostnames resolving to private addresses', async () => {
  await assert.rejects(
    () => assertAllowedUrlResolved('https://example.com/', {
      blockPrivateNetworks: true,
      lookup: async (hostname, options) => {
        assert.equal(hostname, 'example.com');
        assert.deepEqual(options, { all: true, verbatim: true });
        return [{ address: '203.0.113.10', family: 4 }, { address: 'fec0::1', family: 6 }];
      }
    }),
    /private|blocked|local/i
  );
});

test('assertAllowedUrlResolved permits hostnames resolving to public addresses', async () => {
  const u = await assertAllowedUrlResolved('https://example.com/', {
    blockPrivateNetworks: true,
    lookup: async () => [{ address: '203.0.113.10', family: 4 }]
  });
  assert.equal(u.hostname, 'example.com');
});

test('assertAllowedUrl rejects non-http and private hosts when blocking', () => {
  assert.throws(() => assertAllowedUrl('file:///tmp/x'), /http/i);
  assert.throws(() => assertAllowedUrl('http://127.0.0.1/', { blockPrivateNetworks: true }), /private|blocked|local/i);
  const u = assertAllowedUrl('https://example.com/path', { blockPrivateNetworks: true });
  assert.equal(u.hostname, 'example.com');
});

test('assertAllowedUrl allows loopback when blockPrivateNetworks false', () => {
  const u = assertAllowedUrl('http://127.0.0.1:8765/', { blockPrivateNetworks: false });
  assert.equal(u.hostname, '127.0.0.1');
});

test('request guard resolves hostnames and aborts private navigation and subresources', async () => {
  let routeHandler;
  const context = {
    route: async (pattern, handler) => {
      assert.equal(pattern, '**/*');
      routeHandler = handler;
    }
  };
  const blockedRequests = [];
  await installPrivateNetworkRequestGuard(context, blockedRequests, {
    blockPrivateNetworks: true,
    lookup: async (hostname) => {
      if (hostname === 'redirected-private.test') {
        return [{ address: '127.0.0.1', family: 4 }];
      }
      return [{ address: '203.0.113.10', family: 4 }];
    }
  });

  const navigationRoute = {
    request: () => ({
      url: () => 'http://127.0.0.1/private',
      isNavigationRequest: () => true
    }),
    abort: async (reason) => assert.equal(reason, 'blockedbyclient')
  };
  await routeHandler(navigationRoute);
  assert.deepEqual(blockedRequests, [{
    url: 'http://127.0.0.1/private',
    isNavigation: true
  }]);

  await routeHandler({
    request: () => ({
      url: () => 'http://192.168.1.10/script.js',
      isNavigationRequest: () => false
    }),
    abort: async (reason) => assert.equal(reason, 'blockedbyclient')
  });
  assert.deepEqual(blockedRequests[1], {
    url: 'http://192.168.1.10/script.js',
    isNavigation: false
  });

  let redirectedPrivateContinued = false;
  let redirectedPrivateAborted = false;
  await routeHandler({
    request: () => ({
      url: () => 'https://redirected-private.test/landing',
      isNavigationRequest: () => true
    }),
    continue: async () => { redirectedPrivateContinued = true; },
    abort: async (reason) => {
      redirectedPrivateAborted = true;
      assert.equal(reason, 'blockedbyclient');
    }
  });
  assert.equal(redirectedPrivateContinued, false);
  assert.equal(redirectedPrivateAborted, true);
  assert.deepEqual(blockedRequests[2], {
    url: 'https://redirected-private.test/landing',
    isNavigation: true
  });

  let continued = false;
  await routeHandler({
    request: () => ({
      url: () => 'https://example.com/script.js',
      isNavigationRequest: () => false
    }),
    continue: async () => { continued = true; }
  });
  assert.equal(continued, true);
});

test('truncateText respects max', () => {
  assert.equal(truncateText('abcdef', 3), 'abc');
});

test('getBrowserToolDefinitions respects enabled flag via setBrowserConfigOverrideForTests', () => {
  assert.ok(Array.isArray(BROWSER_TOOL_NAMES));
  assert.equal(BROWSER_TOOL_NAMES.length, 6);
  for (const n of BROWSER_TOOL_NAMES) assert.equal(handles(n), true);
  assert.equal(handles('fetch_url'), false);

  setBrowserConfigOverrideForTests({ enabled: false });
  assert.deepEqual(getBrowserToolDefinitions(), []);
  setBrowserConfigOverrideForTests({ enabled: true });
  assert.equal(getBrowserToolDefinitions().length, 6);
  assert.deepEqual(
    getBrowserToolDefinitions().map((t) => t.function.name),
    BROWSER_TOOL_NAMES
  );
  setBrowserConfigOverrideForTests(null);
});
