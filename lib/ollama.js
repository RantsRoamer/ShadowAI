const { getConfig } = require('./config.js');

// 10-minute default — Ollama can be slow on large models or long prompts.
// For streaming, this covers only the connection/first-header phase; the
// stream itself is not interrupted once it has started.
const FETCH_TIMEOUT_MS = 10 * 60 * 1000;

async function fetchWithTimeout(url, init, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') throw new Error(`Ollama request timed out after ${Math.round(timeoutMs / 1000)}s`);
    throw e;
  }
}

async function ollamaChat(baseUrl, model, messages, options = {}) {
  const url = `${baseUrl.replace(/\/$/, '')}/api/chat`;
  const body = {
    model: model || getConfig().ollama.mainModel,
    messages,
    stream: options.stream !== false,
    ...options
  };
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Ollama error ${res.status}: ${err}`);
  }
  return res;
}

async function ollamaChatJson(baseUrl, model, messages, options = {}) {
  const res = await ollamaChat(baseUrl, model, messages, { ...options, stream: false });
  return res.json();
}

/** Call chat with tools; returns full response JSON so caller can check message.tool_calls */
async function ollamaChatWithTools(baseUrl, model, messages, tools, options = {}) {
  const res = await ollamaChat(baseUrl, model, messages, { ...options, stream: false, tools });
  return res.json();
}

async function* ollamaChatStream(baseUrl, model, messages, options = {}, onMeta) {
  const res = await ollamaChat(baseUrl, model, messages, { ...options, stream: true });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (line.trim()) {
        try {
          const data = JSON.parse(line);
          if (data.message?.content) yield data.message.content;
          if (data.done) {
            if (typeof onMeta === 'function') {
              onMeta({ promptTokens: data.prompt_eval_count || 0, evalTokens: data.eval_count || 0 });
            }
            return;
          }
        } catch (_) {}
      }
    }
  }
}

async function listModels(baseUrl) {
  const url = `${baseUrl.replace(/\/$/, '')}/api/tags`;
  const res = await fetchWithTimeout(url, {});
  if (!res.ok) throw new Error(`Ollama tags error ${res.status}`);
  const data = await res.json();
  return (data.models || []).map(m => m.name);
}

function parseContextFromShowPayload(payload) {
  if (!payload || typeof payload !== 'object') return 0;
  const details = payload.details || {};
  if (details && typeof details.context_length === 'number' && details.context_length > 0) return details.context_length;
  const info = payload.model_info || {};
  for (const [k, v] of Object.entries(info)) {
    if (typeof v === 'number' && /context_length|num_ctx|ctx/i.test(k) && v > 0) return v;
  }
  const params = typeof details.parameters === 'string' ? details.parameters : '';
  const m = params.match(/(?:^|\s)num_ctx\s+(\d+)/i);
  if (m) return Number(m[1]) || 0;
  return 0;
}

async function getModelContextWindow(baseUrl, model) {
  const cleanBase = baseUrl.replace(/\/$/, '');
  const res = await fetchWithTimeout(`${cleanBase}/api/show`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: model, model })
  });
  if (!res.ok) throw new Error(`Ollama show error ${res.status}`);
  const data = await res.json();
  return parseContextFromShowPayload(data);
}

/**
 * Describe an image using a vision model. imageBase64 should be raw base64 (no data URL prefix).
 * Uses config.ollama.visionModel if set, otherwise mainModel (may not support images).
 */
async function ollamaDescribeImage(baseUrl, model, imageBase64, prompt) {
  const url = `${baseUrl.replace(/\/$/, '')}/api/chat`;
  const messages = [{
    role: 'user',
    content: prompt || 'Describe this image in detail so the description can be used as context for questions later. Include any text, data, or meaning visible.',
    images: [imageBase64]
  }];
  const body = { model, messages, stream: false };
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Ollama vision error ${res.status}: ${err}`);
  }
  const data = await res.json();
  return (data.message && data.message.content) ? String(data.message.content).trim() : '';
}

module.exports = { ollamaChat, ollamaChatJson, ollamaChatWithTools, ollamaChatStream, listModels, getModelContextWindow, ollamaDescribeImage };
