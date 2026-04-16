'use strict';

const { getConfig } = require('../config.js');
const { ollamaChatJson } = require('../ollama.js');
const hiveStore = require('./store.js');

function safeStr(s, max = 4000) {
  return String(s || '').trim().slice(0, max);
}

async function consolidateHiveMind(options = {}) {
  const cfg = getConfig();
  const baseUrl = cfg.ollama?.mainUrl || 'http://localhost:11434';
  const model = cfg.ollama?.mainModel || 'llama3.2';
  const limit = Number.isFinite(options.limit) ? Math.max(10, Math.min(200, options.limit)) : 80;

  const snap = hiveStore.getSnapshot();
  const { events } = hiveStore.listRecentEvents({ limit });

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
    '- Do NOT mention external LLM providers. Everything is Ollama-based.',
    '- No voice features.',
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

  const out = await ollamaChatJson(baseUrl, model, [
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
  });

  hiveStore.appendEvent({
    type: 'hivemind_consolidated',
    source: 'memory_curator',
    message: 'Hive mind snapshot consolidated',
    payload: { facts: pinnedFacts.length }
  });

  return next;
}

module.exports = { consolidateHiveMind };

