'use strict';

const MAX_DOC_CONTEXT_CHARS_DEFAULT = 80000;

function toSafeString(value) {
  return value == null ? '' : String(value);
}

function normalizeIncomingAttachments(attachments) {
  if (!Array.isArray(attachments)) return [];
  const out = [];
  for (const item of attachments) {
    if (!item || typeof item !== 'object') continue;
    const kind = toSafeString(item.kind).trim().toLowerCase();
    const name = toSafeString(item.name).trim().slice(0, 260);
    if (kind === 'image') {
      const dataBase64 = toSafeString(item.dataBase64).trim();
      if (!dataBase64) continue;
      out.push({
        kind: 'image',
        name: name || 'image',
        mimeType: toSafeString(item.mimeType).trim() || 'image/*',
        dataBase64
      });
      continue;
    }
    if (kind === 'document') {
      const text = toSafeString(item.text).trim();
      if (!text) continue;
      out.push({
        kind: 'document',
        name: name || 'document',
        text
      });
    }
  }
  return out;
}

function buildDocumentContextMessage(documents, maxChars) {
  if (!documents.length) return null;
  const lines = ['Attached document content (use this as source material when answering):', ''];
  let usedChars = 0;
  for (const doc of documents) {
    if (usedChars >= maxChars) break;
    const remaining = maxChars - usedChars;
    const body = doc.text.slice(0, remaining);
    lines.push(`Document: ${doc.name}`);
    lines.push(body);
    lines.push('');
    usedChars += body.length;
  }
  const content = lines.join('\n').trim();
  return content ? { role: 'user', content } : null;
}

function buildMessagesWithAttachments(messages, attachments, maxDocChars = MAX_DOC_CONTEXT_CHARS_DEFAULT) {
  const normalized = normalizeIncomingAttachments(attachments);
  if (!normalized.length || !Array.isArray(messages) || messages.length === 0) return messages;

  const docs = normalized.filter(a => a.kind === 'document' && a.text);
  const images = normalized.filter(a => a.kind === 'image' && a.dataBase64).map(a => a.dataBase64);

  const out = messages.slice();
  const docCtx = buildDocumentContextMessage(docs, Math.max(2000, Number(maxDocChars) || MAX_DOC_CONTEXT_CHARS_DEFAULT));
  if (docCtx) out.splice(out.length - 1, 0, docCtx);

  if (images.length > 0) {
    const last = out[out.length - 1] || {};
    if (last.role === 'user') {
      out[out.length - 1] = { ...last, images };
    }
  }
  return out;
}

module.exports = { normalizeIncomingAttachments, buildMessagesWithAttachments };
