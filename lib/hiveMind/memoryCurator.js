'use strict';

const fs = require('fs');
const path = require('path');
const { getConfig } = require('../config.js');
const { chatJson, resolveLlm } = require('../llm.js');
const hiveStore = require('./store.js');

function safeStr(s, max = 4000) {
  return String(s || '').trim().slice(0, max);
}

function listScopeUsers() {
  const usersDir = path.join(hiveStore.HIVEMIND_DIR, 'users');
  try {
    if (!fs.existsSync(usersDir)) return [];
    return fs.readdirSync(usersDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .filter(Boolean);
  } catch (_) {
    return [];
  }
}

async function consolidateHiveMind(options = {}) {
  const cfg = getConfig();
  const llm = resolveLlm(cfg);
  const limit = Number.isFinite(options.limit) ? Math.max(10, Math.min(200, options.limit)) : 80;
  const scopeUser = options.scopeUser != null ? String(options.scopeUser) : '';

  const snap = hiveStore.getSnapshot({ scopeUser });
  const { events } = hiveStore.listRecentEvents({ limit, scopeUser });

  const system = [
    'You are the Hive Mind memory curator for ShadowAI.',
    'Your task: produce a concise, high-signal shared state update from recent events.',
    '',
    'Return ONLY strict JSON with this schema:',
    '{',
    '  "workingSummary": string,               // 3-8 bullet lines max, plain text',
    '  "pinnedFacts": string[],                // durable facts/preferences/projects worth keeping',
    '  "pinnedNotes": string                   // optional short notes; empty string ok',
    '}',
    '',
    'Rules:',
    '- Keep it lightweight. No long prose.',
    '- Prefer durable, reusable facts over transient logs.',
    '- Do NOT invent facts that are not grounded in the events/snapshot.',
    '- If there is little signal, return empty arrays/strings rather than inventing.'
  ].join('\n');

  const user = [
    'CURRENT SNAPSHOT:',
    JSON.stringify({
      updatedAt: snap.updatedAt || null,
      workingSummary: safeStr(snap.workingSummary || '', 1200),
      pinned: snap.pinned || {}
    }, null, 2),
    '',
    'RECENT EVENTS (newest first):',
    JSON.stringify(events.slice(0, limit), null, 2)
  ].join('\n');

  const out = await chatJson(llm, [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ]);

  const raw = String(out?.message?.content || '').trim();
  const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  const parsed = JSON.parse(cleaned);

  const workingSummary = safeStr(parsed && parsed.workingSummary ? parsed.workingSummary : '', 2000);
  const pinnedFactsRaw = Array.isArray(parsed && parsed.pinnedFacts) ? parsed.pinnedFacts : [];
  const pinnedFacts = pinnedFactsRaw
    .map(x => safeStr(x, 240))
    .filter(Boolean)
    .slice(0, 30);
  const pinnedNotes = safeStr(parsed && parsed.pinnedNotes ? parsed.pinnedNotes : '', 2000);

  const nextPinned = {
    facts: pinnedFacts,
    notes: pinnedNotes
  };

  const next = hiveStore.updateSnapshot({
    workingSummary,
    pinned: nextPinned
  }, { scopeUser });

  hiveStore.appendEvent({
    type: 'hivemind_consolidated',
    source: 'memory_curator',
    message: 'Hive mind snapshot consolidated',
    payload: { facts: pinnedFacts.length, scopeUser: scopeUser || null }
  }, { scopeUser });

  return next;
}

/** Consolidate global hive + each per-user hive (Command Center UI reads user scope). */
async function consolidateAllHiveScopes(options = {}) {
  const results = [];
  results.push({ scopeUser: '', snap: await consolidateHiveMind({ ...options, scopeUser: '' }) });
  for (const userKey of listScopeUsers()) {
    try {
      const snap = await consolidateHiveMind({ ...options, scopeUser: userKey });
      results.push({ scopeUser: userKey, snap });
    } catch (e) {
      results.push({ scopeUser: userKey, error: e.message });
    }
  }
  return results;
}

module.exports = { consolidateHiveMind, consolidateAllHiveScopes, listScopeUsers };
