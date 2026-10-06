// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runSync } from '../src/commands.mjs';
import {
  API_KEY,
  GITHUB_TOKEN,
  LIST_ID,
  TASK_ID,
  errorReply,
  listReply,
  networkFailure,
  noSleep,
  pullRequestReply,
  taskReply,
} from '../test-support/canned-replies.mjs';
import { createFakeFetch } from '../test-support/fake-fetch.mjs';

/**
 * builds the io bundle the command runs against, capturing outputs and log lines.
 *
 * @param {Record<string, string | undefined>} env - environment the command reads
 * @param {import('../test-support/fake-fetch.mjs').CannedOutcome[]} [outcomes] - what each api call does, in order
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
      sleep: noSleep,
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

/** environment for a non-draft pull request that was just opened from a branch carrying the task id */
const openedEnv = {
  BRANCH_NAME: `${TASK_ID}/add-login`,
  PR_TITLE: 'Add login page',
  CLICKUP_API_KEY: API_KEY,
  EVENT_ACTION: 'opened',
  PR_MERGED: 'false',
  PR_DRAFT: 'false',
  REVIEW_STATUS: 'in review',
  MERGED_STATUS: 'complete',
  GITHUB_TOKEN,
  GITHUB_REPOSITORY: 'acme/widgets',
  PR_NUMBER: '7',
};

/** environment for the same pull request after a push */
const pushedEnv = { ...openedEnv, EVENT_ACTION: 'synchronize' };

/** environment for the same pull request after it merged */
const mergedEnv = { ...openedEnv, EVENT_ACTION: 'closed', PR_MERGED: 'true' };

const resolved = { clickup_id: TASK_ID, task_url: `https://app.clickup.com/t/${TASK_ID}`, task_title: 'Example task' };
const unresolved = { clickup_id: '', task_url: '', task_title: '' };
const notFound = errorReply(404, 'ITEM_013', 'Task not found');
const deadKey = errorReply(401, 'OAUTH_025', 'Token invalid');
const open = pullRequestReply();
const merged = pullRequestReply({ state: 'closed', merged: true });
const githubDown = { status: 500, body: 'Server error' };

/** api replies for an open pull request whose task goes from in progress to in review */
const toReview = [taskReply('in progress'), open, listReply(), taskReply('in progress'), taskReply('in review')];

/** api replies for a merge event whose task goes from in review to complete; github is not asked */
const toComplete = [taskReply('in review'), listReply(), taskReply('in review'), taskReply('complete')];

/**
 * picks the error annotation out of captured log lines.
 *
 * @param {string[]} lines - captured log lines
 * @returns {string} the first "::error::" line, or an empty string when there is none
 */
function errorLine(lines) {
  return lines.find((line) => line.startsWith('::error::')) ?? '';
}

/**
 * reads the status a recorded request asked clickup to set.
 *
 * @param {import('../test-support/fake-fetch.mjs').RecordedRequest[]} requests - recorded requests
 * @returns {unknown} the json body of the last request, which is the write when one was made
 */
function lastWrite(requests) {
  const last = requests.at(-1);
  return last?.method === 'PUT' ? JSON.parse(last.body ?? '') : null;
}

test('an opened pull request moves its task to review and publishes the task for the link step', async () => {
  const { io, outputs, requests } = harness(openedEnv, toReview);

  assert.equal(await runSync(io), 0);
  assert.deepEqual(outputs, resolved);
  assert.deepEqual(
    requests.map((request) => `${request.method} ${request.url}`),
    [
      `GET https://api.clickup.com/api/v2/task/${TASK_ID}`,
      'GET https://api.github.com/repos/acme/widgets/pulls/7',
      `GET https://api.clickup.com/api/v2/list/${LIST_ID}`,
      `GET https://api.clickup.com/api/v2/task/${TASK_ID}`,
      `PUT https://api.clickup.com/api/v2/task/${TASK_ID}`,
    ],
  );
  assert.deepEqual(lastWrite(requests), { status: 'in review' });
});

test('a merge event moves its task to complete on its own word: a merge cannot be undone, so github is not asked', async () => {
  const { io, requests } = harness(mergedEnv, toComplete);

  assert.equal(await runSync(io), 0);
  assert.deepEqual(lastWrite(requests), { status: 'complete' });
  assert.equal(requests.some((request) => request.url.includes('api.github.com')), false);
});

test('for an event that says "open", the live pull request state decides', async () => {
  const { io, requests } = harness(openedEnv, [
    taskReply('in review'),
    merged,
    listReply(),
    taskReply('in review'),
    taskReply('complete'),
  ]);

  assert.equal(await runSync(io), 0);
  assert.deepEqual(lastWrite(requests), { status: 'complete' });
});

test('re-running an old "opened" run after the merge leaves a completed task alone', async () => {
  const { io, requests } = harness(openedEnv, [taskReply('complete'), merged]);

  assert.equal(await runSync(io), 0);
  assert.equal(requests.length, 2);
});

test('a task that has moved on since the merge is not dragged back by a re-run', async () => {
  const statuses = ['todo', 'in progress', 'in review', 'complete', 'deployed'];
  const { io, lines, requests } = harness(mergedEnv, [taskReply('deployed'), listReply(statuses), taskReply('deployed')]);

  assert.equal(await runSync(io), 0);
  assert.equal(lastWrite(requests), null);
  assert.ok(lines.some((line) => line.includes('"deployed"') && line.includes('"complete"')));
});

test('a draft pull request leaves the status alone', async () => {
  const { io, outputs, requests } = harness(openedEnv, [taskReply('in progress'), pullRequestReply({ draft: true })]);

  assert.equal(await runSync(io), 0);
  assert.deepEqual(outputs, resolved);
  assert.equal(requests.length, 2);
});

test('a pull request closed without merging leaves the status alone', async () => {
  const env = { ...openedEnv, EVENT_ACTION: 'closed' };
  const { io, requests } = harness(env, [taskReply('in review'), pullRequestReply({ state: 'closed' })]);

  assert.equal(await runSync(io), 0);
  assert.equal(requests.length, 2);
});

test('a push publishes the task for the link step but never touches the status or github', async () => {
  const { io, outputs, requests } = harness(pushedEnv, [taskReply('blocked')]);

  assert.equal(await runSync(io), 0);
  assert.deepEqual(outputs, resolved);
  assert.equal(requests.length, 1);
});

test('a pull request that names no task is left alone without any lookup', async () => {
  const env = { ...openedEnv, BRANCH_NAME: 'staging', PR_TITLE: 'Prod deployment' };
  const { io, outputs, requests } = harness(env);

  assert.equal(await runSync(io), 0);
  assert.deepEqual(outputs, unresolved);
  assert.equal(requests.length, 0);
});

test('an id-shaped word in the branch is passed over for the task named in the title', async () => {
  const env = { ...openedEnv, BRANCH_NAME: 'fix/base64url-padding', PR_TITLE: `#${TASK_ID} Fix padding` };
  const { io, outputs, requests } = harness(env, [notFound, ...toReview]);

  assert.equal(await runSync(io), 0);
  assert.equal(outputs.clickup_id, TASK_ID);
  assert.equal(requests[0].url, 'https://api.clickup.com/api/v2/task/base64url');
});

test('the branch task is used even when the title mentions another task', async () => {
  const env = { ...openedEnv, PR_TITLE: 'Follow-up to #other001a' };
  const { io, outputs, requests } = harness(env, toReview);

  assert.equal(await runSync(io), 0);
  assert.equal(outputs.clickup_id, TASK_ID);
  assert.equal(requests.some((request) => request.url.includes('other001a')), false);
});

test('when clickup knows none of the ids the run warns and passes, without asking github', async () => {
  const { io, outputs, lines, requests } = harness(openedEnv, [notFound]);

  assert.equal(await runSync(io), 0);
  assert.deepEqual(outputs, unresolved);
  assert.equal(requests.length, 1);
  assert.ok(lines.some((line) => line.startsWith('::warning::') && line.includes(TASK_ID)));
});

test('a dead api key fails a run that owes a status change, and says what to check', async () => {
  const { io, outputs, lines } = harness(openedEnv, [deadKey]);

  assert.equal(await runSync(io), 1);
  assert.deepEqual(outputs, unresolved);
  assert.match(errorLine(lines), /Token invalid/);
  assert.match(errorLine(lines), /CLICKUP_API_KEY/);
});

/** @type {Array<[string, Record<string, string>]>} */
const nothingOwedCases = [
  ['a push', pushedEnv],
  ['a draft', { ...openedEnv, PR_DRAFT: 'true' }],
  ['a pull request closed without merging', { ...openedEnv, EVENT_ACTION: 'closed' }],
  ['a workflow with both status changes switched off', { ...openedEnv, REVIEW_STATUS: '', MERGED_STATUS: '' }],
];

for (const [name, env] of nothingOwedCases) {
  test(`a dead api key only warns on ${name}, which owes no status change`, async () => {
    const { io, lines } = harness(env, [deadKey]);

    assert.equal(await runSync(io), 0);
    assert.equal(errorLine(lines), '');
    assert.ok(lines.some((line) => line.startsWith('::warning::') && line.includes('Token invalid')));
  });
}

test('a missing api key fails a run that owes a status change', async () => {
  const { io, lines, requests } = harness({ ...openedEnv, CLICKUP_API_KEY: '' });

  assert.equal(await runSync(io), 1);
  assert.equal(requests.length, 0);
  assert.match(errorLine(lines), /clickup_api_key is empty/);
});

test('a missing api key passes when the run is denied secrets by design', async () => {
  const { io, lines, requests } = harness({ ...openedEnv, CLICKUP_API_KEY: '', SECRETS_WITHHELD: 'true' });

  assert.equal(await runSync(io), 0);
  assert.equal(requests.length, 0);
  assert.equal(errorLine(lines), '');
});

test('a missing api key passes on a push', async () => {
  const { io, lines } = harness({ ...pushedEnv, CLICKUP_API_KEY: '' });

  assert.equal(await runSync(io), 0);
  assert.equal(errorLine(lines), '');
});

test('an api key saved with stray whitespace around it is used without the whitespace', async () => {
  const { io, requests } = harness({ ...pushedEnv, CLICKUP_API_KEY: ` ${API_KEY}\n` }, [taskReply('in progress')]);

  assert.equal(await runSync(io), 0);
  assert.equal(requests[0].headers.Authorization, API_KEY);
});

test('a refused status change fails the run but still publishes the task for the link step', async () => {
  const { io, outputs, lines } = harness(openedEnv, [
    taskReply('in progress'),
    open,
    listReply(),
    taskReply('in progress'),
    errorReply(400, 'CRTSK_001', 'Status does not exist'),
  ]);

  assert.equal(await runSync(io), 1);
  assert.deepEqual(outputs, resolved);
  assert.match(errorLine(lines), /Status does not exist/);
});

test('a status the list does not have fails the run and names the status, without a write', async () => {
  const env = { ...openedEnv, REVIEW_STATUS: 'qa' };
  const { io, lines, requests } = harness(env, [taskReply('in progress'), open, listReply()]);

  assert.equal(await runSync(io), 1);
  assert.equal(requests.length, 3);
  assert.match(errorLine(lines), /no status named "qa"/);
});

test('a network failure is reported as one, without pointing at the api key', async () => {
  const { io, lines } = harness(openedEnv, [networkFailure(), networkFailure(), networkFailure()]);

  assert.equal(await runSync(io), 1);
  assert.match(errorLine(lines), /ENOTFOUND/);
  assert.doesNotMatch(errorLine(lines), /CLICKUP_API_KEY/);
});

test('when github cannot confirm the pull request is still open, the status is not touched and the run fails', async () => {
  const { io, outputs, lines, requests } = harness(openedEnv, [
    taskReply('in progress'),
    githubDown,
    githubDown,
    githubDown,
  ]);

  assert.equal(await runSync(io), 1);
  assert.deepEqual(outputs, resolved);
  assert.equal(requests.length, 4);
  assert.match(errorLine(lines), /GitHub/);
});

test('when github cannot be read for an event that asks for nothing, the run passes', async () => {
  const env = { ...openedEnv, PR_DRAFT: 'true' };
  const { io, lines } = harness(env, [taskReply('in progress'), githubDown, githubDown, githubDown]);

  assert.equal(await runSync(io), 0);
  assert.equal(errorLine(lines), '');
});

test('without a github token an open pull request cannot be confirmed either', async () => {
  const { io, lines, requests } = harness({ ...openedEnv, GITHUB_TOKEN: '' }, [taskReply('in progress')]);

  assert.equal(await runSync(io), 1);
  assert.equal(requests.length, 1);
  assert.match(errorLine(lines), /GitHub/);
});

test('a status name with a percent sign is logged as written', async () => {
  const env = { ...openedEnv, REVIEW_STATUS: '50% done' };
  const statuses = ['todo', 'in progress', '50% done', 'complete'];
  const { io, lines } = harness(env, [
    taskReply('in progress'),
    open,
    listReply(statuses),
    taskReply('in progress'),
    taskReply('50% done'),
  ]);

  assert.equal(await runSync(io), 0);
  assert.ok(lines.some((line) => line.includes('to "50% done"')));
});

test('log lines cannot smuggle workflow commands, in either of the forms the runner reads', async () => {
  const hostile = 'x\n::set-output name=a::b ##[set-output name=c;]d';
  const first = harness(openedEnv, [
    taskReply('in progress'),
    open,
    listReply(),
    taskReply('in progress'),
    errorReply(400, 'CRTSK_001', hostile),
  ]);
  const second = harness(openedEnv, [
    taskReply(hostile),
    open,
    listReply(['todo', hostile, 'in review']),
    taskReply(hostile),
    taskReply('in review'),
  ]);

  await runSync(first.io);
  await runSync(second.io);

  const lines = [...first.lines, ...second.lines];
  assert.ok(lines.length > 0);
  assert.equal(lines.some((line) => line.includes('\n') || line.includes('##[')), false);
});

test('log lines never contain the api key or the github token', async () => {
  const leakyKey = errorReply(401, 'OAUTH_025', `Token invalid ${API_KEY}`);
  const leakyToken = { status: 403, body: { message: `Bad credentials ${GITHUB_TOKEN}` } };
  const first = harness(openedEnv, [leakyKey]);
  const second = harness(openedEnv, [taskReply('in progress'), leakyToken]);

  await runSync(first.io);
  await runSync(second.io);

  const lines = [...first.lines, ...second.lines];
  assert.ok(lines.length > 0);
  assert.equal(lines.some((line) => line.includes(API_KEY) || line.includes(GITHUB_TOKEN)), false);
});

test('a task title spanning lines is published as a single line', async () => {
  const { io, outputs } = harness(pushedEnv, [taskReply('in progress', 'Line one\nLine two')]);

  assert.equal(await runSync(io), 0);
  assert.equal(outputs.task_title, 'Line one Line two');
});
