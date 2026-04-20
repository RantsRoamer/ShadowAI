const test = require('node:test');
const assert = require('node:assert/strict');

const { buildMessagesWithAttachments } = require('../lib/chatAttachments.js');

test('buildMessagesWithAttachments adds document context and images to latest user message', () => {
  const baseMessages = [{ role: 'user', content: 'What does this file say?' }];
  const attachments = [
    { kind: 'document', name: 'notes.txt', text: 'Key project milestones and budget summary.' },
    { kind: 'image', name: 'diagram.png', mimeType: 'image/png', dataBase64: 'aGVsbG8=' }
  ];

  const out = buildMessagesWithAttachments(baseMessages, attachments, 5000);

  assert.equal(out.length, 2);
  assert.equal(out[0].role, 'user');
  assert.match(out[0].content, /Attached document content/i);
  assert.match(out[0].content, /notes\.txt/);

  assert.equal(out[1].role, 'user');
  assert.equal(out[1].content, 'What does this file say?');
  assert.deepEqual(out[1].images, ['aGVsbG8=']);
});
