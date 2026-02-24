/**
 * Fetch a webpage and return title + plain text content for the AI.
 * Only http/https; 15s timeout; response body capped to avoid huge context.
 */
const MAX_BODY_CHARS = 120000;
const MAX_TEXT_CHARS = 80000;
const TIMEOUT_MS = 15000;

function extractTitle(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 500) : '';
}

function htmlToText(html) {
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '');
  s = s
    .replace(/<\/p>|<\/div>|<\/tr>|<\/li>|<\/h[1-6]>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/\s+/g, ' ')
    .trim();
  return s.slice(0, MAX_TEXT_CHARS);
}

async function fetchPage(url) {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only http and https URLs are allowed');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'ShadowAI/1.0 (Web assistant; +https://github.com/shadow-ai)',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      redirect: 'follow'
    });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    let body = await res.text();
    if (body.length > MAX_BODY_CHARS) body = body.slice(0, MAX_BODY_CHARS);
    if (contentType.includes('text/html') || body.trimStart().toLowerCase().startsWith('<!')) {
      const title = extractTitle(body);
      const text = htmlToText(body);
      return { url: res.url || url, title, content: text };
    }
    return { url: res.url || url, title: '', content: body.slice(0, MAX_TEXT_CHARS) };
  } catch (e) {
    clearTimeout(timeout);
    if (e.name === 'AbortError') throw new Error('Request timed out');
    throw e;
  }
}

module.exports = { fetchPage };
