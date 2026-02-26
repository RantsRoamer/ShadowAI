const { getConfig } = require('./config.js');

async function ollamaChat(baseUrl, model, messages, options = {}) {
  const url = `${baseUrl.replace(/\/$/, '')}/api/chat`;
  const body = {
    model: model || getConfig().ollama.mainModel,
    messages,
    stream: options.stream !== false,
    ...options
  };
  const res = await fetch(url, {
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
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Ollama tags error ${res.status}`);
  const data = await res.json();
  return (data.models || []).map(m => m.name);
}

module.exports = { ollamaChat, ollamaChatJson, ollamaChatWithTools, ollamaChatStream, listModels };
