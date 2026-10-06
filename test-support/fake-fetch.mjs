// @ts-check

/**
 * @typedef {object} RecordedRequest
 * @property {string} url - full request url
 * @property {string} method - http method
 * @property {Record<string, string>} headers - request headers as sent
 * @property {string | undefined} body - raw request body, if any
 */

/**
 * @typedef {object} CannedResponse
 * @property {number} status - http status to reply with
 * @property {unknown} body - reply body; strings are sent raw, anything else as json
 */

/**
 * what one call to the stand-in does: answer with a canned response, or throw the given error the
 * way fetch does when a request never gets an answer.
 *
 * @typedef {CannedResponse | Error} CannedOutcome
 */

/**
 * builds a fetch stand-in that plays back canned outcomes in order and records every request.
 *
 * @param {CannedOutcome[]} outcomes - what each call does, one per call, in order
 * @returns {{fetchImpl: typeof fetch, requests: RecordedRequest[]}} the stand-in and its request log
 * @remarks the stand-in throws when called more often than there are outcomes, so an unexpected
 * extra api call fails the test instead of passing silently.
 */
export function createFakeFetch(outcomes) {
  /** @type {RecordedRequest[]} */
  const requests = [];
  const queue = [...outcomes];

  /** @type {typeof fetch} */
  const fetchImpl = async (input, init) => {
    requests.push({
      url: String(input),
      method: init?.method ?? 'GET',
      headers: /** @type {Record<string, string>} */ (init?.headers ?? {}),
      body: typeof init?.body === 'string' ? init.body : undefined,
    });

    const next = queue.shift();
    if (!next) {
      throw new Error(`unexpected request: ${init?.method ?? 'GET'} ${String(input)}`);
    }
    if (next instanceof Error) {
      throw next;
    }

    const raw = typeof next.body === 'string' ? next.body : JSON.stringify(next.body);
    return new Response(raw, { status: next.status });
  };

  return { fetchImpl, requests };
}
