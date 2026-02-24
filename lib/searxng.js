/**
 * SearXNG search API client.
 * GET /search?q=query&format=json
 * Response: { results: [ { title, url, content }, ... ] }
 */
async function search(baseUrl, query, options = {}) {
  const url = new URL(baseUrl.replace(/\/$/, '') + '/search');
  url.searchParams.set('q', String(query).trim());
  url.searchParams.set('format', 'json');
  if (options.pageno) url.searchParams.set('pageno', options.pageno);
  if (options.language) url.searchParams.set('language', options.language);
  if (options.safesearch != null) url.searchParams.set('safesearch', options.safesearch);
  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`SearXNG error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const results = data.results || [];
  return results.slice(0, options.limit ?? 10).map(r => ({
    title: r.title || '',
    url: r.url || '',
    content: r.content || ''
  }));
}

/**
 * Run a search and return debug info (request URL, status, error, results count, raw snippet).
 * Does not throw; returns an object suitable for diagnostics.
 */
async function searchDebug(baseUrl, query, options = {}) {
  const limit = options.limit ?? 5;
  const out = {
    config: { baseUrl: baseUrl || '(empty)', query: query || '(empty)' },
    requestUrl: null,
    statusCode: null,
    ok: null,
    error: null,
    resultsCount: 0,
    results: [],
    rawBodySnippet: null,
    durationMs: null
  };
  if (!baseUrl || !String(query).trim()) {
    out.error = !baseUrl ? 'baseUrl is empty' : 'query is empty';
    return out;
  }
  const start = Date.now();
  try {
    const url = new URL(baseUrl.replace(/\/$/, '') + '/search');
    url.searchParams.set('q', String(query).trim());
    url.searchParams.set('format', 'json');
    out.requestUrl = url.toString();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(out.requestUrl, { signal: controller.signal });
    clearTimeout(timeout);
    out.durationMs = Date.now() - start;
    out.statusCode = res.status;
    out.ok = res.ok;
    const text = await res.text();
    out.rawBodySnippet = text.length > 800 ? text.slice(0, 800) + '...' : text;
    if (!res.ok) {
      out.error = `HTTP ${res.status}: ${text.slice(0, 200)}`;
      return out;
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      out.error = 'Response is not JSON: ' + e.message;
      return out;
    }
    const results = data.results || [];
    out.resultsCount = results.length;
    out.results = results.slice(0, limit).map(r => ({
      title: r.title || '',
      url: r.url || '',
      content: (r.content || '').slice(0, 120)
    }));
  } catch (e) {
    out.durationMs = Date.now() - start;
    out.error = e.name === 'AbortError' ? 'Request timed out (15s)' : (e.message || String(e));
  }
  return out;
}

module.exports = { search, searchDebug };
