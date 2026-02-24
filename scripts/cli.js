#!/usr/bin/env node
'use strict';

/**
 * ShadowAI CLI — send a message to the running ShadowAI server and print the reply.
 * Requires channels API key to be set in Config → Channels.
 *
 * Env:
 *   SHADOWAI_API_KEY  API key (must match Config → Channels)
 *   SHADOWAI_URL      Base URL (default http://localhost:9090)
 *
 * Usage:
 *   node scripts/cli.js "Your message here"
 *   echo "Your message" | node scripts/cli.js
 */

const baseUrl = (process.env.SHADOWAI_URL || 'http://localhost:9090').replace(/\/$/, '');
const apiKey = (process.env.SHADOWAI_API_KEY || '').trim();

function getMessageFromArgs() {
  const args = process.argv.slice(2);
  if (args.length > 0) return args.join(' ').trim();
  return null;
}

function getMessageFromStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve(null);
    const chunks = [];
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(chunks.join('').trim() || null));
  });
}

async function main() {
  const fromArgs = getMessageFromArgs();
  const fromStdin = await getMessageFromStdin();
  const message = (fromArgs || fromStdin || '').trim();
  if (!message) {
    console.error('Usage: node scripts/cli.js "message"');
    console.error('   or: echo "message" | node scripts/cli.js');
    console.error('Set SHADOWAI_API_KEY and optionally SHADOWAI_URL');
    process.exit(1);
  }
  if (!apiKey) {
    console.error('SHADOWAI_API_KEY is not set. Set it in Config → Channels and use the same value here.');
    process.exit(1);
  }

  const url = `${baseUrl}/api/channel/chat`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
    body: JSON.stringify({ message, userId: 'cli' })
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (_) {
    console.error('Invalid JSON response:', text.slice(0, 200));
    process.exit(1);
  }
  if (!res.ok) {
    console.error(data.error || res.statusText || text);
    process.exit(1);
  }
  if (data.content != null) console.log(data.content);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
