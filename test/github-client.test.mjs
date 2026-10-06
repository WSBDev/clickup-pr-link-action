// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createGitHubClient } from '../src/github-client.mjs';
import { GITHUB_TOKEN, noSleep, pullRequestReply } from '../test-support/canned-replies.mjs';
import { createFakeFetch } from '../test-support/fake-fetch.mjs';

/**
 * builds a github client wired to canned api outcomes.
 *
 * @param {import('../test-support/fake-fetch.mjs').CannedOutcome[]} outcomes - what each call does, in order
 * @param {string} [apiUrl] - api root override
 * @returns {{client: import('../src/github-client.mjs').GitHubClient, requests: import('../test-support/fake-fetch.mjs').RecordedRequest[]}} the client and its request log
 */
function clientWith(outcomes, apiUrl) {
  const { fetchImpl, requests } = createFakeFetch(outcomes);
  return { client: createGitHubClient({ token: GITHUB_TOKEN, fetchImpl, apiUrl, sleep: noSleep }), requests };
}

test('getPullRequest reads the live state of an open draft', async () => {
  const { client, requests } = clientWith([pullRequestReply({ draft: true })]);

  const state = await client.getPullRequest('acme/widgets', 7);

  assert.deepEqual(state, { open: true, merged: false, draft: true });
  assert.equal(requests[0].method, 'GET');
  assert.equal(requests[0].url, 'https://api.github.com/repos/acme/widgets/pulls/7');
  assert.equal(requests[0].headers.Authorization, `Bearer ${GITHUB_TOKEN}`);
});

test('getPullRequest reports a merged pull request as closed and merged', async () => {
  const { client } = clientWith([pullRequestReply({ state: 'closed', merged: true })]);

  assert.deepEqual(await client.getPullRequest('acme/widgets', 7), { open: false, merged: true, draft: false });
});

test('getPullRequest honours a different api root', async () => {
  const { client, requests } = clientWith([pullRequestReply()], 'https://github.example.test/api/v3');

  await client.getPullRequest('acme/widgets', 7);

  assert.equal(requests[0].url, 'https://github.example.test/api/v3/repos/acme/widgets/pulls/7');
});

test('a refused call throws with the http status and without the token', async () => {
  const { client } = clientWith([{ status: 404, body: { message: `Not Found ${GITHUB_TOKEN}` } }]);

  await assert.rejects(
    () => client.getPullRequest('acme/widgets', 7),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /HTTP 404/);
      assert.match(error.message, /Not Found/);
      assert.equal(error.message.includes(GITHUB_TOKEN), false);
      return true;
    },
  );
});

test('a reply that is not a pull request is an error', async () => {
  const { client } = clientWith([{ status: 200, body: { state: 'open' } }]);

  await assert.rejects(() => client.getPullRequest('acme/widgets', 7), /without a state, merged or draft/);
});

test('a repository name that is not owner/name is refused before any request', async () => {
  const { client, requests } = clientWith([]);

  await assert.rejects(() => client.getPullRequest('acme/widgets/../../user', 7), /not a repository name/);
  assert.equal(requests.length, 0);
});
