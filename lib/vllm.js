'use strict';

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
    if (e.name === 'AbortError') throw new Error(`vLLM request timed out after ${Math.round(timeoutMs / 1000)}s`);
    throw e;
  }
}

function apiBase(baseUrl) {
  let u = String(baseUrl || '').replace(/\/$/, '');
  if (!u.endsWith('/v1')) u += '/v1';
  return u;
}

function authHeaders(apiKey) {
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

function toOpenAIMessages(messages) {
  const out = [];
  for (const msg of messages || []) {
    if (!msg || !msg.role) continue;
    if (msg.role === 'tool') {
      const toolCallId = msg.tool_call_id || msg.toolCallId
        || `call_${msg.tool_name || 'tool'}_${out.length}`;
      out.push({
        role: 'tool',
        tool_call_id: toolCallId,
        content: String(msg.content ?? '')
      });
      continue;
    }
    if (msg.role === 'assistant' && Array.isArray(msg.tool_calls) && msg.tool_calls.length) {
      const tool_calls = msg.tool_calls.map((tc, i) => ({
        id: tc.id || `call_${tc.function?.name || 'tool'}_${i}`,
        type: 'function',
        function: {
          name: tc.function?.name || '',
          arguments: typeof tc.function?.arguments === 'string'
            ? tc.function.arguments
            : JSON.stringify(tc.function?.arguments || {})
        }
      }));
      out.push({
        role: 'assistant',
        content: msg.content || null,
        tool_calls
      });
      continue;
    }
    out.push({
      role: msg.role,
      content: String(msg.content ?? '')
    });
  }
  return out;
}

function fromOpenAIChatResponse(data) {
  const choice = data.choices && data.choices[0];
  const msg = choice?.message || {};
  const tool_calls = (msg.tool_calls || []).map((tc, i) => ({
    id: tc.id || `call_${tc.function?.name || 'tool'}_${i}`,
    function: {
      name: tc.function?.name,
      arguments: tc.function?.arguments
    }
  }));
  return {
    message: {
      content: msg.content || '',
      tool_calls
    },
    prompt_eval_count: data.usage?.prompt_tokens || 0,
    eval_count: data.usage?.completion_tokens || 0
  };
}

function buildChatBody(model, messages, options = {}) {
  const body = {
    model,
    messages: toOpenAIMessages(messages),
    stream: options.stream === true
  };
  if (options.temperature != null) body.temperature = options.temperature;
  if (options.max_tokens != null) body.max_tokens = options.max_tokens;
  else if (options.num_predict != null) body.max_tokens = options.num_predict;
  if (Array.isArray(options.tools) && options.tools.length) {
    body.tools = options.tools;
    body.tool_choice = options.tool_choice || 'auto';
  }
  return body;
}

async function vllmChat(baseUrl, apiKey, model, messages, options = {}) {
  const url = `${apiBase(baseUrl)}/chat/completions`;
  const body = buildChatBody(model, messages, options);
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`vLLM error ${res.status}: ${err}`);
  }
  return res;
}

async function vllmChatJson(baseUrl, apiKey, model, messages, options = {}) {
  const res = await vllmChat(baseUrl, apiKey, model, messages, { ...options, stream: false });
  const data = await res.json();
  return fromOpenAIChatResponse(data);
}

async function vllmChatWithTools(baseUrl, apiKey, model, messages, tools, options = {}) {
  return vllmChatJson(baseUrl, apiKey, model, messages, { ...options, tools });
}

async function* vllmChatStream(baseUrl, apiKey, model, messages, options = {}, onMeta) {
  const res = await vllmChat(baseUrl, apiKey, model, messages, { ...options, stream: true });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let usage = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n');
    buffer = parts.pop() || '';
    for (const line of parts) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const data = JSON.parse(payload);
        if (data.usage) usage = data.usage;
        const delta = data.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch (_) {}
    }
  }
  if (typeof onMeta === 'function') {
    onMeta({
      promptTokens: usage?.prompt_tokens || 0,
      evalTokens: usage?.completion_tokens || 0
    });
  }
}

async function listModels(baseUrl, apiKey) {
  const url = `${apiBase(baseUrl)}/models`;
  const res = await fetchWithTimeout(url, { headers: authHeaders(apiKey) });
  if (!res.ok) throw new Error(`vLLM models error ${res.status}`);
  const data = await res.json();
  return (data.data || []).map(m => m.id || m.name).filter(Boolean);
}

async function getModelContextWindow() {
  return 0;
}

async function vllmDescribeImage(baseUrl, apiKey, model, imageBase64, prompt) {
  const url = `${apiBase(baseUrl)}/chat/completions`;
  const mime = 'image/jpeg';
  const messages = [{
    role: 'user',
    content: [
      { type: 'text', text: prompt || 'Describe this image in detail.' },
      { type: 'image_url', image_url: { url: `data:${mime};base64,${imageBase64}` } }
    ]
  }];
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({ model, messages, stream: false })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`vLLM vision error ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}

module.exports = {
  vllmChat,
  vllmChatJson,
  vllmChatWithTools,
  vllmChatStream,
  listModels,
  getModelContextWindow,
  vllmDescribeImage
};
