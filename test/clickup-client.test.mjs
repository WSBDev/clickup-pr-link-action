// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ClickUpApiError, createClickUpClient } from '../src/clickup-client.mjs';
import { API_KEY, TASK_ID, errorReply, networkFailure, taskReply } from '../test-support/clickup-replies.mjs';
import { createFakeFetch } from '../test-support/fake-fetch.mjs';

/**
 * builds a client wired to canned api outcomes.
 *
 * @param {import('../test-support/fake-fetch.mjs').CannedOutcome[]} outcomes - what each call does, in order
 * @returns {{client: import('../src/clickup-client.mjs').ClickUpClient, requests: import('../test-support/fake-fetch.mjs').RecordedRequest[]}} the client and its request log
 */
function clientWith(outcomes) {
  const { fetchImpl, requests } = createFakeFetch(outcomes);
  return { client: createClickUpClient({ apiKey: API_KEY, fetchImpl }), requests };
}

test('getTask reads the task and returns its id, name and status', async () => {
  const { client, requests } = clientWith([taskReply('in progress')]);

  const task = await client.getTask(TASK_ID);

  assert.deepEqual(task, { id: TASK_ID, name: 'Example task', status: 'in progress' });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, 'GET');
  assert.equal(requests[0].url, `https://api.clickup.com/api/v2/task/${TASK_ID}`);
  assert.equal(requests[0].headers.Authorization, API_KEY);
});

test('updateTaskStatus sends the new status as json', async () => {
  const { client, requests } = clientWith([taskReply('in review')]);

  await client.updateTaskStatus(TASK_ID, 'in review');

  assert.equal(requests[0].method, 'PUT');
  assert.equal(requests[0].url, `https://api.clickup.com/api/v2/task/${TASK_ID}`);
  assert.equal(requests[0].headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(requests[0].body ?? ''), { status: 'in review' });
});

test('a failed call throws an error carrying the http status and clickup error code', async () => {
  const { client } = clientWith([errorReply(400, 'CRTSK_001', 'Status does not exist')]);

  await assert.rejects(
    () => client.updateTaskStatus(TASK_ID, 'no such status'),
    (error) => {
      assert.ok(error instanceof ClickUpApiError);
      assert.equal(error.status, 400);
      assert.equal(error.ecode, 'CRTSK_001');
      assert.match(error.message, /Status does not exist/);
      return true;
    },
  );
});

test('an error never repeats the api key', async () => {
  const { client } = clientWith([errorReply(401, 'OAUTH_025', `Token invalid ${API_KEY}`)]);

  await assert.rejects(
    () => client.getTask(TASK_ID),
    (error) => {
      assert.ok(error instanceof ClickUpApiError);
      assert.equal(error.message.includes(API_KEY), false);
      return true;
    },
  );
});

test('a request that never reaches clickup still keeps the api key out of the error', async () => {
  const { client } = clientWith([new TypeError(`Headers.append: "${API_KEY}" is an invalid header value.`)]);

  await assert.rejects(
    () => client.getTask(TASK_ID),
    (error) => {
      assert.ok(error instanceof Error);
      assert.equal(error instanceof ClickUpApiError, false);
      assert.match(error.message, /invalid header value/);
      assert.equal(error.message.includes(API_KEY), false);
      return true;
    },
  );
});

test('a network failure reports the underlying reason, not just "fetch failed"', async () => {
  const { client } = clientWith([networkFailure()]);

  await assert.rejects(() => client.getTask(TASK_ID), /ENOTFOUND api\.clickup\.com/);
});

test('a non-json error body still produces a usable error', async () => {
  const { client } = clientWith([{ status: 502, body: '<html>Bad Gateway</html>' }]);

  await assert.rejects(
    () => client.getTask(TASK_ID),
    (error) => {
      assert.ok(error instanceof ClickUpApiError);
      assert.equal(error.status, 502);
      assert.equal(error.ecode, null);
      return true;
    },
  );
});

/** @type {Array<[string, import('../test-support/fake-fetch.mjs').CannedOutcome]>} */
const unseeableTaskReplies = [
  ['a 404', errorReply(404, 'ITEM_013', 'Task not found')],
  ['a "team not authorized" 401', errorReply(401, 'OAUTH_027', 'Team not authorized')],
  ['the last "team not authorized" code', errorReply(401, 'OAUTH_045', 'Team not authorized')],
  // codes outside the OAUTH family are about the item, not about the key
  ['an item-level 401', errorReply(401, 'ACCESS_999', 'You do not have access to this task')],
  ['an item-level 403', errorReply(403, 'ACCESS_999', 'You do not have access to this task')],
];

for (const [name, reply] of unseeableTaskReplies) {
  test(`getTask returns null on ${name}: the key cannot see the task`, async () => {
    const { client } = clientWith([reply]);

    assert.equal(await client.getTask(TASK_ID), null);
  });
}

/** @type {Array<[string, import('../test-support/fake-fetch.mjs').CannedOutcome]>} */
const fatalReplies = [
  ['an invalid token', errorReply(401, 'OAUTH_025', 'Token invalid')],
  ['a missing authorization header', errorReply(401, 'OAUTH_017', 'Authorization header required')],
  // an unrecognised OAUTH code must stay loud: a dead key may never pass as a missing task
  ['a 401 with an unknown OAUTH code', errorReply(401, 'OAUTH_999', 'Something new')],
  ['a 401 with no code', { status: 401, body: 'Unauthorized' }],
  ['a 403 with no code', { status: 403, body: 'Forbidden' }],
  ['a server error', { status: 500, body: 'Server error' }],
];

for (const [name, reply] of fatalReplies) {
  test(`getTask throws on ${name}`, async () => {
    const { client } = clientWith([reply]);

    await assert.rejects(() => client.getTask(TASK_ID), ClickUpApiError);
  });
}
