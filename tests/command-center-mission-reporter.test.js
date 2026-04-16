const test = require('node:test');
const assert = require('node:assert/strict');

const {
  shouldFinalizeMission,
  buildMissionCompletionPayload
} = require('../lib/commandCenter/missionReporter.js');

test('shouldFinalizeMission returns true when all child tasks are terminal and no report exists', () => {
  const mission = {
    id: 'mission_1',
    taskIds: ['a', 'b'],
    finalReport: null
  };
  const tasks = [
    { id: 'a', status: 'complete' },
    { id: 'b', status: 'failed' }
  ];

  assert.equal(shouldFinalizeMission(mission, tasks), true);
});

test('shouldFinalizeMission returns false when any child task is still active', () => {
  const mission = {
    id: 'mission_1',
    taskIds: ['a', 'b'],
    finalReport: null
  };
  const tasks = [
    { id: 'a', status: 'complete' },
    { id: 'b', status: 'executing' }
  ];

  assert.equal(shouldFinalizeMission(mission, tasks), false);
});

test('buildMissionCompletionPayload includes final status counts and last task notes', () => {
  const mission = {
    id: 'mission_1',
    title: 'Build command center',
    summary: 'Create modular mission control',
    taskIds: ['a', 'b']
  };
  const tasks = [
    {
      id: 'a',
      title: 'Add coordinator',
      status: 'complete',
      role: 'planner',
      log: [{ type: 'thought', content: 'Implemented routing.' }]
    },
    {
      id: 'b',
      title: 'Add UI',
      status: 'blocked',
      role: 'coder',
      log: [{ type: 'thought', content: 'Waiting on styling approval.' }]
    }
  ];

  const payload = buildMissionCompletionPayload(mission, tasks);

  assert.equal(payload.missionId, 'mission_1');
  assert.equal(payload.statusCounts.complete, 1);
  assert.equal(payload.statusCounts.blocked, 1);
  assert.match(payload.tasks[0].lastNote, /Implemented routing/);
  assert.match(payload.tasks[1].lastNote, /Waiting on styling approval/);
});

