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
const refusedStatus = errorReply(400, 'CRTSK_001', 'Status does not exist');
const open = pullRequestReply();
const merged = pullRequestReply({ state: 'closed', merged: true });
const githubDown = { status: 500, body: 'Server error' };
const outage = [networkFailure(), networkFailure(), networkFailure()];

/** api replies for an open pull request whose task goes from in progress to in review */
const toReview = [taskReply('in progress'), open, listReply(), taskReply('in progress'), taskReply('in review')];

/** api replies for a merge event whose task goes from in review to complete; github is not asked */
const toComplete = [taskReply('in review'), listReply(), taskReply('in review'), taskReply('complete')];

/** api replies up to a status write that clickup then refuses */
const toRefusal = [taskReply('in progress'), open, listReply(), taskReply('in progress'), refusedStatus];

/**
 * picks the warning annotation out of captured log lines.
 *
 * @param {string[]} lines - captured log lines
 * @returns {string} the first "::warning::" line, or an empty string when there is none
 */
function warningLine(lines) {
  return lines.find((line) => line.startsWith('::warning::')) ?? '';
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
  const { io, outputs, lines, requests } = harness(openedEnv, toReview);

  const hadProblem = await runSync(io);

  assert.equal(hadProblem, false);
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
  assert.equal(warningLine(lines), '');
});

test('a merge event moves its task to complete on its own word: a merge cannot be undone, so github is not asked', async () => {
  const { io, requests } = harness(mergedEnv, toComplete);

  await runSync(io);

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

  await runSync(io);

  assert.deepEqual(lastWrite(requests), { status: 'complete' });
});

test('re-running an old "opened" run after the merge leaves a completed task alone', async () => {
  const { io, requests } = harness(openedEnv, [taskReply('complete'), merged]);

  await runSync(io);

  assert.equal(requests.length, 2);
});

test('a task that has moved on since the merge is not dragged back by a re-run', async () => {
  const statuses = ['todo', 'in progress', 'in review', 'complete', 'deployed'];
  const { io, lines, requests } = harness(mergedEnv, [taskReply('deployed'), listReply(statuses), taskReply('deployed')]);

  await runSync(io);

  assert.equal(lastWrite(requests), null);
  assert.ok(lines.some((line) => line.includes('"deployed"') && line.includes('"complete"')));
});

test('a draft pull request leaves the status alone', async () => {
  const { io, outputs, requests } = harness(openedEnv, [taskReply('in progress'), pullRequestReply({ draft: true })]);

  await runSync(io);

  assert.deepEqual(outputs, resolved);
  assert.equal(requests.length, 2);
});

test('a pull request closed without merging leaves the status alone', async () => {
  const env = { ...openedEnv, EVENT_ACTION: 'closed' };
  const { io, requests } = harness(env, [taskReply('in review'), pullRequestReply({ state: 'closed' })]);

  await runSync(io);

  assert.equal(requests.length, 2);
});

test('a push publishes the task for the link step but never touches the status or github', async () => {
  const { io, outputs, requests } = harness(pushedEnv, [taskReply('blocked')]);

  await runSync(io);

  assert.deepEqual(outputs, resolved);
  assert.equal(requests.length, 1);
});

test('a pull request that names no task is left alone without any lookup, and is no problem', async () => {
  const env = { ...openedEnv, BRANCH_NAME: 'staging', PR_TITLE: 'Prod deployment' };
  const { io, outputs, requests } = harness(env);

  assert.equal(await runSync(io), false);
  assert.deepEqual(outputs, unresolved);
  assert.equal(requests.length, 0);
});

test('an id-shaped word in the branch is passed over for the task named in the title', async () => {
  const env = { ...openedEnv, BRANCH_NAME: 'fix/base64url-padding', PR_TITLE: `#${TASK_ID} Fix padding` };
  const { io, outputs, requests } = harness(env, [notFound, ...toReview]);

  await runSync(io);

  assert.equal(outputs.clickup_id, TASK_ID);
  assert.equal(requests[0].url, 'https://api.clickup.com/api/v2/task/base64url');
});

test('the branch task is used even when the title mentions another task', async () => {
  const env = { ...openedEnv, PR_TITLE: 'Follow-up to #other001a' };
  const { io, outputs, requests } = harness(env, toReview);

  await runSync(io);

  assert.equal(outputs.clickup_id, TASK_ID);
  assert.equal(requests.some((request) => request.url.includes('other001a')), false);
});

test('a missing api key is no problem at all when the run is denied secrets by design', async () => {
  const { io, lines, requests } = harness({ ...openedEnv, CLICKUP_API_KEY: '', SECRETS_WITHHELD: 'true' });

  assert.equal(await runSync(io), false);
  assert.equal(requests.length, 0);
  assert.equal(warningLine(lines), '');
});

test('github being unreadable is no problem for an event that asks for nothing', async () => {
  const env = { ...openedEnv, PR_DRAFT: 'true' };
  const { io, lines } = harness(env, [taskReply('in progress'), githubDown, githubDown, githubDown]);

  assert.equal(await runSync(io), false);
  assert.equal(warningLine(lines), '');
});

test('an api key saved with stray whitespace around it is used without the whitespace', async () => {
  const { io, requests } = harness({ ...pushedEnv, CLICKUP_API_KEY: ` ${API_KEY}\n` }, [taskReply('in progress')]);

  await runSync(io);

  assert.equal(requests[0].headers.Authorization, API_KEY);
});

/**
 * every way the action can come up short: the run reports a problem, as a warning that matches the
 * first pattern (and not the second, when there is one), and never as an error or a rejection.
 *
 * @type {Array<[string, Record<string, string>, import('../test-support/fake-fetch.mjs').CannedOutcome[], RegExp, RegExp?]>}
 */
const problems = [
  ['clickup knowing none of the ids', openedEnv, [notFound], new RegExp(TASK_ID)],
  ['a dead api key', openedEnv, [deadKey], /Token invalid.*CLICKUP_API_KEY/],
  ['a dead api key at merge', mergedEnv, [deadKey], /Token invalid/],
  ['a missing api key', { ...openedEnv, CLICKUP_API_KEY: '' }, [], /clickup_api_key is empty/],
  ['a clickup outage', openedEnv, outage, /ENOTFOUND/, /CLICKUP_API_KEY/],
  ['a refused status change', openedEnv, toRefusal, /is linked, but its status could not be changed.*Status does not exist/],
  ['a status the list does not have', { ...openedEnv, REVIEW_STATUS: 'qa' }, [taskReply('in progress'), open, listReply()], /no status named "qa"/],
  ['github being unable to confirm the pull request is open', openedEnv, [taskReply('in progress'), githubDown, githubDown, githubDown], /GitHub/],
  ['a missing github token', { ...openedEnv, GITHUB_TOKEN: '' }, [taskReply('in progress')], /GitHub/],
];

for (const [name, env, outcomes, expected, unexpected] of problems) {
  test(`${name} is a warning and never blocks the pull request`, async () => {
    const { io, lines } = harness(env, outcomes);

    assert.equal(await runSync(io), true);

    assert.match(warningLine(lines), expected);
    if (unexpected) {
      assert.doesNotMatch(warningLine(lines), unexpected);
    }
    assert.equal(lines.some((line) => line.startsWith('::error::')), false);
  });
}

test('a fault inside the action itself is a warning too, not a rejection', async () => {
  const { io, lines } = harness(pushedEnv, [taskReply('in progress')]);
  io.setOutput = () => {
    throw new Error('disk full');
  };

  assert.equal(await runSync(io), true);
  assert.match(warningLine(lines), /disk full/);
});

test('a refused status change still publishes the task, so the link is added', async () => {
  const { io, outputs } = harness(openedEnv, toRefusal);

  await runSync(io);

  assert.deepEqual(outputs, resolved);
});

test('a task that cannot be found publishes nothing and stops before github is asked', async () => {
  const { io, outputs, requests } = harness(openedEnv, [notFound]);

  await runSync(io);

  assert.deepEqual(outputs, unresolved);
  assert.equal(requests.length, 1);
});

test('a status the list does not have is never written', async () => {
  const env = { ...openedEnv, REVIEW_STATUS: 'qa' };
  const { io, requests } = harness(env, [taskReply('in progress'), open, listReply()]);

  await runSync(io);

  assert.equal(lastWrite(requests), null);
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

  await runSync(io);

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

  await runSync(io);

  assert.equal(outputs.task_title, 'Line one Line two');
});
