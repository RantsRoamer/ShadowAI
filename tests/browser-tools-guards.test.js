'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getBrowserConfig,
  setBrowserConfigOverrideForTests,
  isPrivateHostnameOrIp,
  assertAllowedUrl,
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

test('isPrivateHostnameOrIp blocks fe80::/10 link-local and IPv4-mapped private', () => {
  assert.equal(isPrivateHostnameOrIp('fe80::1'), true);
  assert.equal(isPrivateHostnameOrIp('fe90::1'), true);
  assert.equal(isPrivateHostnameOrIp('::ffff:127.0.0.1'), true);
  assert.equal(isPrivateHostnameOrIp('::ffff:10.1.2.3'), true);
  assert.equal(isPrivateHostnameOrIp('2001:db8::1'), false);
  assert.equal(isPrivateHostnameOrIp('example.com'), false);
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
