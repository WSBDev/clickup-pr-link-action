// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runExtract, runSyncStatus } from '../src/commands.mjs';
import { API_KEY, TASK_ID, errorReply, networkFailure, taskReply } from '../test-support/clickup-replies.mjs';
import { createFakeFetch } from '../test-support/fake-fetch.mjs';

/**
 * builds the io bundle a command runs against, capturing outputs and log lines.
 *
 * @param {Record<string, string | undefined>} env - environment the command reads
 * @param {import('../test-support/fake-fetch.mjs').CannedOutcome[]} [outcomes] - what each clickup api call does, in order
 * @returns {{io: import('../src/commands.mjs').CommandIo, outputs: Record<string, string>, lines: string[], requests: import('../test-support/fake-fetch.mjs').RecordedRequest[]}} the io bundle and everything it captured
 */
function harness(env, outcomes = []) {
  /** @type {Record<string, string>} */
  const outputs = {};
  /** @type {string[]} */
  const lines = [];
  const { fetchImpl, requests } = createFakeFetch(outcomes);

  return {
    io: {
      env,
      fetchImpl,
      setOutput: (name, value) => {
        outputs[name] = value;
      },
      log: (line) => {
        lines.push(line);
      },
    },
    outputs,
    lines,
    requests,
  };
}

/** environment for a non-draft pull request that was just opened */
const openedEnv = {
  CLICKUP_ID: TASK_ID,
  CLICKUP_API_KEY: API_KEY,
  EVENT_ACTION: 'opened',
  PR_MERGED: 'false',
  PR_DRAFT: 'false',
  REVIEW_STATUS: 'in review',
  MERGED_STATUS: 'complete',
};

test('extract writes the id and task url as step outputs', async () => {
  const { io, outputs } = harness({ BRANCH_NAME: `${TASK_ID}/add-login`, PR_TITLE: '', PR_BODY: '' });

  const exitCode = await runExtract(io);

  assert.equal(exitCode, 0);
  assert.deepEqual(outputs, { clickup_id: TASK_ID, task_url: `https://app.clickup.com/t/${TASK_ID}` });
});

test('extract writes empty outputs when the pull request names no task', async () => {
  const { io, outputs } = harness({ BRANCH_NAME: 'staging', PR_TITLE: 'Prod deployment', PR_BODY: '' });

  const exitCode = await runExtract(io);

  assert.equal(exitCode, 0);
  assert.deepEqual(outputs, { clickup_id: '', task_url: '' });
});

test('sync-status moves the task to review when a pull request opens', async () => {
  const { io, requests } = harness(openedEnv, [taskReply('in progress'), taskReply('in review')]);

  const exitCode = await runSyncStatus(io);

  assert.equal(exitCode, 0);
  assert.deepEqual(JSON.parse(requests[1].body ?? ''), { status: 'in review' });
});

test('sync-status moves the task to complete when a pull request merges', async () => {
  const { io, requests } = harness({ ...openedEnv, EVENT_ACTION: 'closed', PR_MERGED: 'true' }, [
    taskReply('in review'),
    taskReply('complete'),
  ]);

  const exitCode = await runSyncStatus(io);

  assert.equal(exitCode, 0);
  assert.deepEqual(JSON.parse(requests[1].body ?? ''), { status: 'complete' });
});

test('sync-status does nothing, and needs no api key, for an event with no status change', async () => {
  const { io, requests } = harness({ ...openedEnv, EVENT_ACTION: 'synchronize', CLICKUP_API_KEY: '' });

  const exitCode = await runSyncStatus(io);

  assert.equal(exitCode, 0);
  assert.equal(requests.length, 0);
});

test('sync-status fails when a status change is due but the api key is missing', async () => {
  const { io, lines, requests } = harness({ ...openedEnv, CLICKUP_API_KEY: '' });

  const exitCode = await runSyncStatus(io);

  assert.equal(exitCode, 1);
  assert.equal(requests.length, 0);
  assert.ok(lines.some((line) => line.startsWith('::error::')));
});

test('sync-status passes without an api key when the run is denied secrets by design', async () => {
  const { io, lines, requests } = harness({ ...openedEnv, CLICKUP_API_KEY: '', SECRETS_WITHHELD: 'true' });

  const exitCode = await runSyncStatus(io);

  assert.equal(exitCode, 0);
  assert.equal(requests.length, 0);
  assert.equal(lines.some((line) => line.startsWith('::error::')), false);
});

test('sync-status refuses an id that is not shaped like a clickup task id', async () => {
  const { io, requests } = harness({ ...openedEnv, CLICKUP_ID: '../../user' });

  const exitCode = await runSyncStatus(io);

  assert.equal(exitCode, 1);
  assert.equal(requests.length, 0);
});

test('sync-status warns and passes when the task cannot be seen', async () => {
  const { io, lines } = harness(openedEnv, [errorReply(404, 'ITEM_013', 'Task not found')]);

  const exitCode = await runSyncStatus(io);

  assert.equal(exitCode, 0);
  assert.ok(lines.some((line) => line.startsWith('::warning::')));
});

test('sync-status fails loudly when clickup rejects the change, and says what to check', async () => {
  const { io, lines } = harness(openedEnv, [
    taskReply('in progress'),
    errorReply(400, 'CRTSK_001', 'Status does not exist'),
  ]);

  const exitCode = await runSyncStatus(io);

  assert.equal(exitCode, 1);
  const errorLine = lines.find((line) => line.startsWith('::error::')) ?? '';
  assert.match(errorLine, /Status does not exist/);
  assert.match(errorLine, /CLICKUP_API_KEY/);
});

test('sync-status reports a network failure as one, without pointing at the api key', async () => {
  const { io, lines } = harness(openedEnv, [networkFailure()]);

  const exitCode = await runSyncStatus(io);

  assert.equal(exitCode, 1);
  const errorLine = lines.find((line) => line.startsWith('::error::')) ?? '';
  assert.match(errorLine, /ENOTFOUND/);
  assert.doesNotMatch(errorLine, /CLICKUP_API_KEY/);
});

test('log lines cannot smuggle workflow commands out of a clickup error message', async () => {
  const { io, lines } = harness(openedEnv, [
    taskReply('in progress'),
    errorReply(400, 'CRTSK_001', 'bad\n::set-output name=x::y'),
  ]);

  await runSyncStatus(io);

  assert.equal(lines.every((line) => !line.includes('\n')), true);
});

test('log lines never contain the api key', async () => {
  const { io, lines } = harness(openedEnv, [errorReply(401, 'OAUTH_025', `Token invalid ${API_KEY}`)]);

  const exitCode = await runSyncStatus(io);

  assert.equal(exitCode, 1);
  assert.equal(lines.some((line) => line.includes(API_KEY)), false);
});
