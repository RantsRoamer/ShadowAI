'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const browserTools = require('../lib/browserTools.js');
const agentStore = require('../lib/agentStore.js');
const {
  appendPendingVisionImages,
  persistPendingVisionImages,
  appendTaskPendingVisionImages
} = require('../lib/agentRunner.js');
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

test('vision screenshots queued before approval persist and are injected after resume', () => {
  const originalTake = browserTools.takePendingVisionImages;
  const originalUpdate = agentStore.updateTask;
  const updates = [];
  browserTools.takePendingVisionImages = (taskId) => {
    assert.equal(taskId, 'task-4');
    return ['approval-base64'];
  };
  agentStore.updateTask = (taskId, update) => {
    updates.push({ taskId, update });
  };

  try {
    const task = { id: 'task-4', pendingVisionImages: [] };
    persistPendingVisionImages(task);
    assert.deepEqual(task.pendingVisionImages, ['approval-base64']);
    assert.deepEqual(updates, [{
      taskId: 'task-4',
      update: { pendingVisionImages: ['approval-base64'] }
    }]);

    const messages = [];
    appendTaskPendingVisionImages(messages, task);
    assert.deepEqual(messages, [{
      role: 'user',
      content: 'Screenshot(s) from the browser tool follow for visual context.',
      images: ['approval-base64']
    }]);
    assert.deepEqual(task.pendingVisionImages, []);
    assert.deepEqual(updates[1], {
      taskId: 'task-4',
      update: { pendingVisionImages: [] }
    });
  } finally {
    browserTools.takePendingVisionImages = originalTake;
    agentStore.updateTask = originalUpdate;
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
