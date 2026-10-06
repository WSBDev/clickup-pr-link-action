// @ts-check
import { setTimeout as pause } from 'node:timers/promises';

const TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 3;

/** pause before the second and before the third attempt, in milliseconds */
const RETRY_PAUSES_MS = [1000, 3000];

/** longest a run waits for a rate limit to end; clickup's limit is counted per minute */
const MAX_RATE_LIMIT_PAUSE_MS = 60_000;

/**
 * @typedef {object} JsonReply
 * @property {number} status - http status of the reply
 * @property {boolean} ok - true for a 2xx status
 * @property {unknown} data - parsed json body, or null when the body is not json
 */

/**
 * waits for the given number of milliseconds.
 *
 * @typedef {(milliseconds: number) => Promise<unknown>} Sleep
 */

/**
 * strips a secret out of text that may end up in a log.
 *
 * @param {string} text - message to clean
 * @param {string} secret - value that must not appear; empty means there is nothing to strip
 * @returns {string} the message with every copy of the secret replaced
 * @example
 * redact('token abc123 rejected', 'abc123'); // 'token [redacted] rejected'
 */
export function redact(text, secret) {
  let clean = text;
  // node quotes a header value with its outer whitespace trimmed, so a secret that was stored with
  // a stray space or newline has to be matched in that form too
  for (const form of new Set([secret, secret.trim()])) {
    if (form) {
      clean = clean.replaceAll(form, '[redacted]');
    }
  }
  return clean;
}

/**
 * narrows an unknown value, such as a parsed json body, to a plain object.
 *
 * @param {unknown} value - value to test
 * @returns {value is Record<string, unknown>} true for non-null objects
 * @example
 * isRecord(JSON.parse('{"id":"x"}')); // true
 */
export function isRecord(value) {
  return typeof value === 'object' && value !== null;
}

/**
 * parses a reply body that should be json but may not be.
 *
 * @param {string} text - raw reply body
 * @returns {unknown} the parsed value, or null when the body is not json
 */
function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * says why a request got no answer.
 *
 * @param {unknown} error - what fetch threw
 * @returns {string} the error text, followed by the underlying cause when there is one
 * @remarks node reports every network failure as "fetch failed" and puts the real reason
 * (dns, reset, tls) in the error's cause.
 */
function describeTransportError(error) {
  if (!(error instanceof Error)) {
    return 'unknown error';
  }
  return error.cause instanceof Error ? `${error.message}: ${error.cause.message}` : error.message;
}

/**
 * works out how long to wait before retrying a reply that asked for a retry.
 *
 * @param {Headers} headers - headers of the reply
 * @param {number} nowMs - current time in milliseconds since the epoch
 * @param {number} fallbackMs - pause to use when the reply names no usable time
 * @returns {number} milliseconds to wait: the time the reply names, at least the fallback, at most one minute
 * @remarks a rate limit names its end either as Retry-After (seconds from now) or as
 * X-RateLimit-Reset (seconds since the epoch). a per-minute limit does not clear in a second or
 * two, so retrying on the usual short pauses would spend every attempt inside the same window.
 */
function retryPause(headers, nowMs, fallbackMs) {
  const retryAfterMs = Number(headers.get('retry-after')) * 1000;
  const untilResetMs = Number(headers.get('x-ratelimit-reset')) * 1000 - nowMs;
  const namedMs = retryAfterMs > 0 ? retryAfterMs : untilResetMs;

  if (!Number.isFinite(namedMs) || namedMs <= 0) {
    return fallbackMs;
  }
  return Math.min(Math.max(namedMs, fallbackMs), MAX_RATE_LIMIT_PAUSE_MS);
}

/**
 * sends one json request, retrying when the failure is likely to pass.
 *
 * @param {object} request - what to send
 * @param {typeof fetch} request.fetchImpl - fetch implementation; tests pass a stand-in
 * @param {string} request.url - full request url
 * @param {'GET' | 'PUT'} request.method - http method; both are safe to repeat
 * @param {Record<string, string>} request.headers - request headers
 * @param {Record<string, unknown>} [request.payload] - json body, for writes
 * @param {string} request.secret - credential carried in the headers; kept out of every error
 * @param {string} request.service - name of the service, used in error text
 * @param {Sleep} [request.sleep] - waits between attempts; tests pass a stand-in
 * @param {() => number} [request.now] - current time in milliseconds; tests pass a fixed clock
 * @returns {Promise<JsonReply>} the reply, whatever its status; the caller judges non-2xx replies
 * @throws {Error} when no complete answer arrives in three attempts: bad header value, network
 * failure, timeout
 * @remarks a 429, a 5xx, a 403 that carries Retry-After (how github signals a rate limit) or a
 * transport failure is retried twice, because the caller's trigger (a merged pull request) happens
 * only once. a rate limit is waited out for the time the service names. node quotes a malformed
 * header value in its own error text, so a transport error is rethrown with the secret stripped
 * and the original not attached.
 * @example
 * const reply = await requestJson({ fetchImpl: fetch, url, method: 'GET', headers, secret, service: 'ClickUp' });
 */
export async function requestJson({
  fetchImpl,
  url,
  method,
  headers,
  payload,
  secret,
  service,
  sleep = pause,
  now = Date.now,
}) {
  for (let attempt = 1; ; attempt += 1) {
    const isLastAttempt = attempt === MAX_ATTEMPTS;
    let wait = RETRY_PAUSES_MS[attempt - 1] ?? 0;

    try {
      const response = await fetchImpl(url, {
        method,
        headers: payload === undefined ? headers : { ...headers, 'Content-Type': 'application/json' },
        body: payload === undefined ? undefined : JSON.stringify(payload),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const text = await response.text();
      const isRateLimited =
        response.status === 429 || (response.status === 403 && response.headers.has('retry-after'));

      if (isLastAttempt || !(isRateLimited || response.status >= 500)) {
        return { status: response.status, ok: response.ok, data: parseJson(text) };
      }
      // only a rate limit is waited out for the time the reply names: a server error also carries
      // the rate-limit headers, and its reset time says nothing about when the error will pass
      if (isRateLimited) {
        wait = retryPause(response.headers, now(), wait);
      }
    } catch (error) {
      if (isLastAttempt) {
        throw new Error(redact(`${service} request got no answer: ${describeTransportError(error)}`, secret));
      }
    }

    await sleep(wait);
  }
}
