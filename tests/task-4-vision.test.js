'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const browserTools = require('../lib/browserTools.js');
const { appendPendingVisionImages } = require('../lib/agentRunner.js');
const { toOpenAIMessages } = require('../lib/vllm.js');

test('appendPendingVisionImages drains browser screenshots into a user message', () => {
  const original = browserTools.takePendingVisionImages;
  browserTools.takePendingVisionImages = (taskId) => {
    assert.equal(taskId, 'task-4');
    return ['first-base64', 'second-base64'];
  };

  try {
    const messages = [];
    appendPendingVisionImages(messages, 'task-4');
    assert.deepEqual(messages, [{
      role: 'user',
      content: 'Screenshot(s) from the browser tool follow for visual context.',
      images: ['first-base64', 'second-base64']
    }]);
  } finally {
    browserTools.takePendingVisionImages = original;
  }
});

test('toOpenAIMessages serializes user images as multimodal content', () => {
  const messages = toOpenAIMessages([{
    role: 'user',
    content: 'Inspect these screenshots.',
    images: ['first-base64', 'second-base64']
  }]);

  assert.deepEqual(messages, [{
    role: 'user',
    content: [
      { type: 'text', text: 'Inspect these screenshots.' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,first-base64' } },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,second-base64' } }
    ]
  }]);
});

test('toOpenAIMessages preserves string content without images', () => {
  const messages = toOpenAIMessages([{ role: 'user', content: 'No image.' }]);
  assert.deepEqual(messages, [{ role: 'user', content: 'No image.' }]);
});
