// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createClickUpClient } from '../src/clickup-client.mjs';
import { syncTaskStatus } from '../src/sync-status.mjs';
import { API_KEY, TASK_ID, errorReply, taskReply } from '../test-support/clickup-replies.mjs';
import { createFakeFetch } from '../test-support/fake-fetch.mjs';

const taskId = TASK_ID;

/**
 * builds a clickup client wired to canned api outcomes.
 *
 * @param {import('../test-support/fake-fetch.mjs').CannedOutcome[]} outcomes - what each call does, in order
 * @returns {{client: import('../src/clickup-client.mjs').ClickUpClient, requests: import('../test-support/fake-fetch.mjs').RecordedRequest[]}} the client and its request log
 */
function clientWith(outcomes) {
  const { fetchImpl, requests } = createFakeFetch(outcomes);
  return { client: createClickUpClient({ apiKey: API_KEY, fetchImpl }), requests };
}

test('no target status means no api call at all', async () => {
  const { client, requests } = clientWith([]);

  const result = await syncTaskStatus({ taskId, targetStatus: null, client });

  assert.deepEqual(result, { outcome: 'no_target', taskId });
  assert.equal(requests.length, 0);
});

test('moves the task when its status differs from the target', async () => {
  const { client, requests } = clientWith([taskReply('in progress'), taskReply('in review')]);

  const result = await syncTaskStatus({ taskId, targetStatus: 'in review', client });

  assert.deepEqual(result, { outcome: 'updated', taskId, from: 'in progress', to: 'in review' });
  assert.deepEqual(requests.map((request) => request.method), ['GET', 'PUT']);
});

test('leaves the task alone when it already has the target status', async () => {
  const { client, requests } = clientWith([taskReply('In Review')]);

  const result = await syncTaskStatus({ taskId, targetStatus: 'in review', client });

  assert.deepEqual(result, { outcome: 'unchanged', taskId, from: 'In Review', to: 'in review' });
  assert.deepEqual(requests.map((request) => request.method), ['GET']);
});

test('reports a task the key cannot see without trying to update it', async () => {
  const { client, requests } = clientWith([errorReply(401, 'OAUTH_027', 'Team not authorized')]);

  const result = await syncTaskStatus({ taskId, targetStatus: 'in review', client });

  assert.deepEqual(result, { outcome: 'task_unavailable', taskId });
  assert.equal(requests.length, 1);
});

test('a dead api key is an error, not a skip', async () => {
  const { client } = clientWith([errorReply(401, 'OAUTH_025', 'Token invalid')]);

  await assert.rejects(() => syncTaskStatus({ taskId, targetStatus: 'in review', client }), /Token invalid/);
});

test('a rejected status change is an error', async () => {
  const { client } = clientWith([taskReply('in progress'), errorReply(400, 'CRTSK_001', 'Status does not exist')]);

  await assert.rejects(() => syncTaskStatus({ taskId, targetStatus: 'in review', client }), /Status does not exist/);
});
