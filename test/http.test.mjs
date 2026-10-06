// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { redact, requestJson } from '../src/http.mjs';
import { API_KEY, networkFailure } from '../test-support/canned-replies.mjs';
import { createFakeFetch } from '../test-support/fake-fetch.mjs';

/**
 * sends one request through requestJson against canned outcomes, recording the retry pauses.
 *
 * @param {import('../test-support/fake-fetch.mjs').CannedOutcome[]} outcomes - what each attempt does, in order
 * @param {{method?: 'GET' | 'PUT', payload?: Record<string, unknown>}} [request] - request overrides
 * @returns {{reply: Promise<import('../src/http.mjs').JsonReply>, requests: import('../test-support/fake-fetch.mjs').RecordedRequest[], pauses: number[]}} the pending reply, the request log and the pauses asked for
 */
function send(outcomes, { method = 'GET', payload } = {}) {
  const { fetchImpl, requests } = createFakeFetch(outcomes);
  /** @type {number[]} */
  const pauses = [];

  const reply = requestJson({
    fetchImpl,
    url: 'https://api.example.test/thing',
    method,
    headers: { Authorization: API_KEY },
    payload,
    secret: API_KEY,
    service: 'Example',
    sleep: async (milliseconds) => {
      pauses.push(milliseconds);
    },
    now: () => NOW_MS,
  });
  return { reply, requests, pauses };
}

/** the fixed "current time" the tests run at, in milliseconds since the epoch */
const NOW_MS = 1_700_000_000_000;

/**
 * builds a rate-limit reply that names when the limit resets, the way clickup does.
 *
 * @param {number} secondsFromNow - how far in the future the reset lies; negative for the past
 * @returns {import('../test-support/fake-fetch.mjs').CannedResponse} a 429 reply with an X-RateLimit-Reset header
 */
function rateLimited(secondsFromNow) {
  return { status: 429, body: {}, headers: { 'X-RateLimit-Reset': String(NOW_MS / 1000 + secondsFromNow) } };
}

test('a rate limit that names its reset time is waited out', async () => {
  const { reply, pauses } = send([rateLimited(20), { status: 200, body: {} }]);

  assert.equal((await reply).status, 200);
  assert.deepEqual(pauses, [20_000]);
});

test('a rate-limit wait is capped at one minute', async () => {
  const { reply, pauses } = send([rateLimited(300), { status: 200, body: {} }]);
  await reply;

  assert.deepEqual(pauses, [60_000]);
});

test('a reset time that has already passed falls back to the usual pause', async () => {
  const { reply, pauses } = send([rateLimited(-5), { status: 200, body: {} }]);
  await reply;

  assert.deepEqual(pauses, [1000]);
});

test('a server error keeps to the short pause even when the reply names a far-off rate-limit reset', async () => {
  const down = { status: 503, body: '', headers: { 'X-RateLimit-Reset': String(NOW_MS / 1000 + 3000) } };
  const { reply, pauses } = send([down, { status: 200, body: {} }]);
  await reply;

  assert.deepEqual(pauses, [1000]);
});

test('a refusal that says when to retry is retried then, the way github signals a rate limit', async () => {
  const throttled = { status: 403, body: { message: 'secondary rate limit' }, headers: { 'Retry-After': '5' } };
  const { reply, requests, pauses } = send([throttled, { status: 200, body: {} }]);

  assert.equal((await reply).status, 200);
  assert.equal(requests.length, 2);
  assert.deepEqual(pauses, [5000]);
});

test('a plain 403 is a refusal, not a rate limit, and is not retried', async () => {
  const { reply, requests } = send([{ status: 403, body: { message: 'Forbidden' } }]);

  assert.equal((await reply).status, 403);
  assert.equal(requests.length, 1);
});

test('redact also strips a secret that was stored with stray whitespace around it', () => {
  assert.equal(redact('bad header "pk_abc"', ' pk_abc\n'), 'bad header "[redacted]"');
});

test('returns the status, the ok flag and the parsed body', async () => {
  const { reply } = send([{ status: 200, body: { hello: 'world' } }]);

  assert.deepEqual(await reply, { status: 200, ok: true, data: { hello: 'world' } });
});

test('a body that is not json parses to null', async () => {
  const { reply } = send([{ status: 502, body: '<html>Bad Gateway</html>' }, { status: 404, body: 'gone' }]);

  assert.deepEqual(await reply, { status: 404, ok: false, data: null });
});

test('sends the method, the headers and a json body', async () => {
  const { reply, requests } = send([{ status: 200, body: {} }], { method: 'PUT', payload: { status: 'in review' } });
  await reply;

  assert.equal(requests[0].method, 'PUT');
  assert.equal(requests[0].url, 'https://api.example.test/thing');
  assert.equal(requests[0].headers.Authorization, API_KEY);
  assert.equal(requests[0].headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(requests[0].body ?? ''), { status: 'in review' });
});

test('a rate limit is retried after a pause', async () => {
  const { reply, requests, pauses } = send([{ status: 429, body: {} }, { status: 200, body: { ok: true } }]);

  assert.equal((await reply).status, 200);
  assert.equal(requests.length, 2);
  assert.deepEqual(pauses, [1000]);
});

test('server errors are retried twice, with a longer second pause', async () => {
  const { reply, requests, pauses } = send([
    { status: 502, body: '' },
    { status: 503, body: '' },
    { status: 200, body: {} },
  ]);

  assert.equal((await reply).status, 200);
  assert.equal(requests.length, 3);
  assert.deepEqual(pauses, [1000, 3000]);
});

test('after three failed attempts the last reply is handed back', async () => {
  const { reply, requests } = send([
    { status: 500, body: '' },
    { status: 500, body: '' },
    { status: 500, body: '' },
  ]);

  assert.equal((await reply).status, 500);
  assert.equal(requests.length, 3);
});

test('a client error is not retried', async () => {
  const { reply, requests, pauses } = send([{ status: 400, body: { err: 'bad' } }]);

  assert.equal((await reply).status, 400);
  assert.equal(requests.length, 1);
  assert.deepEqual(pauses, []);
});

test('a network failure is retried', async () => {
  const { reply, requests } = send([networkFailure(), { status: 200, body: {} }]);

  assert.equal((await reply).status, 200);
  assert.equal(requests.length, 2);
});

test('three network failures throw, naming the service and the underlying reason', async () => {
  const { reply, requests } = send([networkFailure(), networkFailure(), networkFailure()]);

  await assert.rejects(reply, /Example request got no answer: fetch failed: getaddrinfo ENOTFOUND/);
  assert.equal(requests.length, 3);
});

test('a transport error never repeats the secret', async () => {
  const leak = new TypeError(`Headers.append: "${API_KEY}" is an invalid header value.`);
  const { reply } = send([leak, leak, leak]);

  await assert.rejects(reply, (error) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /invalid header value/);
    assert.equal(error.message.includes(API_KEY), false);
    return true;
  });
});

test('redact replaces every copy of the secret and leaves text alone when there is none', () => {
  assert.equal(redact(`a ${API_KEY} b ${API_KEY}`, API_KEY), 'a [redacted] b [redacted]');
  assert.equal(redact('nothing to hide', ''), 'nothing to hide');
});
