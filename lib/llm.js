'use strict';

const ollama = require('./ollama.js');
const vllm = require('./vllm.js');

const PROVIDERS = { OLLAMA: 'ollama', VLLM: 'vllm' };

function normalizeProvider(value) {
  const p = String(value || PROVIDERS.OLLAMA).toLowerCase();
  return p === PROVIDERS.VLLM ? PROVIDERS.VLLM : PROVIDERS.OLLAMA;
}

function defaultBaseUrl(provider) {
  return provider === PROVIDERS.VLLM ? 'http://localhost:8000' : 'http://localhost:11434';
}

function defaultModel(provider) {
  return provider === PROVIDERS.VLLM ? '' : 'llama3.2';
}

/**
 * Resolve LLM endpoint from config and optional agent id.
 * Config lives under `ollama` for backward compatibility; `provider` selects Ollama vs vLLM.
 */
function resolveLlm(config, agentId) {
  const o = (config && config.ollama) || {};
  let provider = normalizeProvider(o.provider);
  let baseUrl = o.mainUrl || defaultBaseUrl(provider);
  let model = o.mainModel || defaultModel(provider);
  let apiKey = o.apiKey || '';

  if (agentId && Array.isArray(o.agents)) {
    const agent = o.agents.find(a => a && a.id === agentId && a.enabled);
    if (agent) {
      if (agent.provider) provider = normalizeProvider(agent.provider);
      if (agent.url) baseUrl = agent.url;
      if (agent.model) model = agent.model;
      if (agent.apiKey) apiKey = agent.apiKey;
    }
  }

  const options = {};
  if (o.temperature != null && o.temperature !== '') options.temperature = Number(o.temperature);
  if (o.num_predict != null && o.num_predict !== '') {
    options.num_predict = Number(o.num_predict);
    options.max_tokens = Number(o.num_predict);
  }

  const contextWindow = Number(o.num_ctx) > 0 ? Number(o.num_ctx) : 8192;
  return { provider, baseUrl, model, apiKey, options, contextWindow };
}

function normalizeToolCalls(toolCalls) {
  return (toolCalls || []).map((tc, i) => ({
    ...tc,
    id: tc.id || `call_${tc.function?.name || 'tool'}_${i}`
  }));
}

async function chatJson(endpoint, messages, extraOptions = {}) {
  const ep = endpoint;
  const opts = { ...ep.options, ...extraOptions };
  if (ep.provider === PROVIDERS.VLLM) {
    return vllm.vllmChatJson(ep.baseUrl, ep.apiKey, ep.model, messages, opts);
  }
  return ollama.ollamaChatJson(ep.baseUrl, ep.model, messages, opts);
}

async function chatWithTools(endpoint, messages, tools, extraOptions = {}) {
  const ep = endpoint;
  const opts = { ...ep.options, ...extraOptions };
  let data;
  if (ep.provider === PROVIDERS.VLLM) {
    data = await vllm.vllmChatWithTools(ep.baseUrl, ep.apiKey, ep.model, messages, tools, opts);
  } else {
    data = await ollama.ollamaChatWithTools(ep.baseUrl, ep.model, messages, tools, opts);
  }
  if (data.message) data.message.tool_calls = normalizeToolCalls(data.message.tool_calls);
  return data;
}

async function* chatStream(endpoint, messages, extraOptions = {}, onMeta) {
  const ep = endpoint;
  const opts = { ...ep.options, ...extraOptions };
  if (ep.provider === PROVIDERS.VLLM) {
    yield* vllm.vllmChatStream(ep.baseUrl, ep.apiKey, ep.model, messages, opts, onMeta);
    return;
  }
  yield* ollama.ollamaChatStream(ep.baseUrl, ep.model, messages, opts, onMeta);
}

async function listModels(endpoint) {
  const ep = typeof endpoint === 'string'
    ? { provider: PROVIDERS.OLLAMA, baseUrl: endpoint, apiKey: '' }
    : endpoint;
  if (ep.provider === PROVIDERS.VLLM) {
    return vllm.listModels(ep.baseUrl, ep.apiKey);
  }
  return ollama.listModels(ep.baseUrl);
}

async function getModelContextWindow(endpoint, model) {
  const ep = typeof endpoint === 'object' && endpoint.baseUrl
    ? endpoint
    : { provider: PROVIDERS.OLLAMA, baseUrl: endpoint };
  if (ep.provider === PROVIDERS.VLLM) {
    const ctx = await vllm.getModelContextWindow();
    if (ctx > 0) return ctx;
    const cfg = require('./config.js').getConfig();
    return Number(cfg.ollama?.num_ctx) > 0 ? Number(cfg.ollama.num_ctx) : 8192;
  }
  return ollama.getModelContextWindow(ep.baseUrl, model);
}

async function describeImage(endpoint, model, imageBase64, prompt) {
  const ep = endpoint;
  if (ep.provider === PROVIDERS.VLLM) {
    return vllm.vllmDescribeImage(ep.baseUrl, ep.apiKey, model, imageBase64, prompt);
  }
  return ollama.ollamaDescribeImage(ep.baseUrl, model, imageBase64, prompt);
}

module.exports = {
  PROVIDERS,
  normalizeProvider,
  resolveLlm,
  chatJson,
  chatWithTools,
  chatStream,
  listModels,
  getModelContextWindow,
  describeImage
};
