// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createClickUpClient } from '../src/clickup-client.mjs';
import { resolveTask } from '../src/resolve-task.mjs';
import { API_KEY, LIST_ID, TASK_ID, errorReply, noSleep, taskReply } from '../test-support/canned-replies.mjs';
import { createFakeFetch } from '../test-support/fake-fetch.mjs';

/**
 * builds a clickup client wired to canned api outcomes.
 *
 * @param {import('../test-support/fake-fetch.mjs').CannedOutcome[]} outcomes - what each call does, in order
 * @returns {{client: import('../src/clickup-client.mjs').ClickUpClient, requests: import('../test-support/fake-fetch.mjs').RecordedRequest[]}} the client and its request log
 */
function clientWith(outcomes) {
  const { fetchImpl, requests } = createFakeFetch(outcomes);
  return { client: createClickUpClient({ apiKey: API_KEY, fetchImpl, sleep: noSleep }), requests };
}

const notFound = errorReply(404, 'ITEM_013', 'Task not found');

test('the first candidate clickup knows is the task, and nothing further is looked up', async () => {
  const { client, requests } = clientWith([taskReply('in progress')]);

  const task = await resolveTask([TASK_ID, 'other001a'], client);

  assert.deepEqual(task, { id: TASK_ID, name: 'Example task', status: 'in progress', listId: LIST_ID });
  assert.equal(requests.length, 1);
});

test('candidates clickup does not know are skipped, in order', async () => {
  const { client, requests } = clientWith([notFound, taskReply('in progress')]);

  const task = await resolveTask(['1a2b3c4d', TASK_ID], client);

  assert.equal(task?.id, TASK_ID);
  assert.deepEqual(
    requests.map((request) => request.url),
    ['https://api.clickup.com/api/v2/task/1a2b3c4d', `https://api.clickup.com/api/v2/task/${TASK_ID}`],
  );
});

test('no task is found when clickup knows none of the candidates', async () => {
  const { client } = clientWith([notFound, notFound]);

  assert.equal(await resolveTask(['1a2b3c4d', 'base64url'], client), null);
});

test('no candidates means no lookup', async () => {
  const { client, requests } = clientWith([]);

  assert.equal(await resolveTask([], client), null);
  assert.equal(requests.length, 0);
});

test('a dead api key stops the search at once', async () => {
  const { client, requests } = clientWith([errorReply(401, 'OAUTH_025', 'Token invalid')]);

  await assert.rejects(() => resolveTask([TASK_ID, 'other001a'], client), /Token invalid/);
  assert.equal(requests.length, 1);
});
