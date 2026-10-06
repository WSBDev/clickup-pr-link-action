// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createClickUpClient } from '../src/clickup-client.mjs';
import { syncTaskStatus } from '../src/sync-status.mjs';
import {
  API_KEY,
  LIST_ID,
  TASK_ID,
  errorReply,
  listReply,
  noSleep,
  taskReply,
} from '../test-support/canned-replies.mjs';
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

/**
 * builds a task as the client returns it.
 *
 * @param {string} status - status the task had when the run first read it
 * @returns {import('../src/clickup-client.mjs').ClickUpTask} the task
 */
function taskWith(status) {
  return { id: TASK_ID, name: 'Example task', status, listId: LIST_ID };
}

/**
 * lists the http methods of recorded requests, in order.
 *
 * @param {import('../test-support/fake-fetch.mjs').RecordedRequest[]} requests - recorded requests
 * @returns {string[]} the methods
 */
function methodsOf(requests) {
  const methods = [];
  for (const request of requests) {
    methods.push(request.method);
  }
  return methods;
}

test('moves the task forward: reads the list, re-reads the task, then writes', async () => {
  const { client, requests } = clientWith([listReply(), taskReply('in progress'), taskReply('in review')]);

  const result = await syncTaskStatus({ task: taskWith('in progress'), targetStatus: 'in review', client });

  assert.deepEqual(result, { outcome: 'updated', from: 'in progress', to: 'in review' });
  assert.deepEqual(methodsOf(requests), ['GET', 'GET', 'PUT']);
  assert.deepEqual(JSON.parse(requests[2].body ?? ''), { status: 'in review' });
});

test('leaves the task alone when it already has the target status, whatever the letter case', async () => {
  const { client, requests } = clientWith([]);

  const result = await syncTaskStatus({ task: taskWith('In Review'), targetStatus: 'in review', client });

  assert.deepEqual(result, { outcome: 'unchanged', from: 'In Review', to: 'in review' });
  assert.equal(requests.length, 0);
});

test('never moves a task backwards: a completed task is not put back in review', async () => {
  const { client, requests } = clientWith([listReply(), taskReply('complete')]);

  const result = await syncTaskStatus({ task: taskWith('complete'), targetStatus: 'in review', client });

  assert.deepEqual(result, { outcome: 'kept', from: 'complete', to: 'in review' });
  assert.deepEqual(methodsOf(requests), ['GET', 'GET']);
});

test('a status that changed while the run was waiting is what counts, not the earlier reading', async () => {
  const { client, requests } = clientWith([listReply(), taskReply('complete')]);

  const result = await syncTaskStatus({ task: taskWith('in progress'), targetStatus: 'in review', client });

  assert.deepEqual(result, { outcome: 'kept', from: 'complete', to: 'in review' });
  assert.deepEqual(methodsOf(requests), ['GET', 'GET']);
});

test('a task that reached the target while the run was waiting is not written again', async () => {
  const { client, requests } = clientWith([listReply(), taskReply('in review')]);

  const result = await syncTaskStatus({ task: taskWith('in progress'), targetStatus: 'in review', client });

  assert.equal(result.outcome, 'unchanged');
  assert.deepEqual(methodsOf(requests), ['GET', 'GET']);
});

test('a task that has moved on past the target is left where it is', async () => {
  const statuses = ['todo', 'in review', 'complete', 'deployed'];
  const { client, requests } = clientWith([listReply(statuses), taskReply('deployed')]);

  const result = await syncTaskStatus({ task: taskWith('deployed'), targetStatus: 'complete', client });

  assert.equal(result.outcome, 'kept');
  assert.equal(requests.length, 2);
});

test('a target status the list does not have is an error, and nothing is written', async () => {
  const { client, requests } = clientWith([listReply()]);

  await assert.rejects(
    () => syncTaskStatus({ task: taskWith('in progress'), targetStatus: 'qa', client }),
    /no status named "qa"/,
  );
  assert.deepEqual(methodsOf(requests), ['GET']);
});

test('a task whose own status is missing from the list is still moved', async () => {
  const { client, requests } = clientWith([listReply(), taskReply('archived oddity'), taskReply('in review')]);

  const result = await syncTaskStatus({ task: taskWith('archived oddity'), targetStatus: 'in review', client });

  assert.equal(result.outcome, 'updated');
  assert.deepEqual(methodsOf(requests), ['GET', 'GET', 'PUT']);
});

test('a rejected status change is an error', async () => {
  const { client } = clientWith([listReply(), taskReply('in progress'), errorReply(400, 'CRTSK_001', 'Status does not exist')]);

  await assert.rejects(
    () => syncTaskStatus({ task: taskWith('in progress'), targetStatus: 'in review', client }),
    /Status does not exist/,
  );
});
