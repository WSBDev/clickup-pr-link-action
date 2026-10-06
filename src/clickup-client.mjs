// @ts-check

const BASE_URL = 'https://api.clickup.com/api/v2';
const TIMEOUT_MS = 10_000;

/**
 * clickup error codes for "this key is not authorized for the workspace that owns the task":
 * OAUTH_023, OAUTH_026, OAUTH_027 and OAUTH_029 to OAUTH_045.
 */
const TEAM_NOT_AUTHORIZED = /^OAUTH_0(?:23|26|27|29|3\d|4[0-5])$/;

/**
 * @typedef {object} ClickUpTask
 * @property {string} id - task id
 * @property {string} name - task title
 * @property {string} status - current status name, as clickup spells it
 */

/**
 * @typedef {object} ClickUpClient
 * @property {(taskId: string) => Promise<ClickUpTask | null>} getTask - reads one task; null when
 * the task does not exist or the key cannot see it
 * @property {(taskId: string, status: string) => Promise<void>} updateTaskStatus - sets a task's status
 */

/** a clickup api call that was answered with a non-2xx status */
export class ClickUpApiError extends Error {
  /**
   * @param {number} status - http status of the reply
   * @param {string | null} ecode - clickup's own error code, when the reply carried one
   * @param {string} message - description safe to log; never contains the api key
   */
  constructor(status, ecode, message) {
    super(message);
    this.name = 'ClickUpApiError';
    this.status = status;
    this.ecode = ecode;
  }
}

/**
 * tells a task the api key cannot see apart from every other failure.
 *
 * @param {unknown} error - anything thrown by a request
 * @returns {boolean} true for "not found" and for refusals that are about the task, not the key
 * @remarks clickup answers 401 both for a dead key and for a task outside the key's reach; only the
 * error code tells them apart. codes in the OAUTH family are about the key, so of those only the
 * documented "team not authorized" ones count as a missing task. any other OAUTH code, and any
 * refusal with no code at all, stays a failure, so a broken credential can never pass as a
 * missing task.
 */
function isTaskUnavailable(error) {
  if (!(error instanceof ClickUpApiError)) {
    return false;
  }
  if (error.status === 404) {
    return true;
  }
  if ((error.status !== 401 && error.status !== 403) || error.ecode === null) {
    return false;
  }
  return !error.ecode.startsWith('OAUTH_') || TEAM_NOT_AUTHORIZED.test(error.ecode);
}

/**
 * narrows an unknown value to a plain object.
 *
 * @param {unknown} value - value to test
 * @returns {value is Record<string, unknown>} true for non-null objects
 */
function isRecord(value) {
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
 * validates the task fields this action relies on.
 *
 * @param {unknown} data - parsed reply of the get-task call
 * @returns {ClickUpTask} the validated task
 * @throws {Error} when the reply lacks an id, a name or a status name
 */
function readTask(data) {
  if (
    !isRecord(data) ||
    !isRecord(data.status) ||
    typeof data.id !== 'string' ||
    typeof data.name !== 'string' ||
    typeof data.status.status !== 'string'
  ) {
    throw new Error('ClickUp returned a task without an id, name or status');
  }
  return { id: data.id, name: data.name, status: data.status.status };
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
 * creates a minimal clickup api client for reading a task and setting its status.
 *
 * @param {object} options - client settings
 * @param {string} options.apiKey - clickup personal api token, sent as the Authorization header
 * @param {typeof fetch} [options.fetchImpl] - fetch implementation; tests pass a stand-in
 * @returns {ClickUpClient} the client
 * @remarks every failure message has the api key stripped out, so messages are safe to print in
 * a workflow log.
 * @example
 * const client = createClickUpClient({ apiKey: process.env.CLICKUP_API_KEY ?? '' });
 * const task = await client.getTask('abc12345x');
 */
export function createClickUpClient({ apiKey, fetchImpl = fetch }) {
  /**
   * strips the api key out of text that may end up in a log.
   *
   * @param {string} text - message to clean
   * @returns {string} the message with every copy of the api key replaced
   */
  function redact(text) {
    return apiKey ? text.replaceAll(apiKey, '[redacted]') : text;
  }

  /**
   * sends one api request and returns the parsed reply.
   *
   * @param {'GET' | 'PUT'} method - http method
   * @param {string} path - path under the api root, starting with a slash
   * @param {Record<string, unknown>} [payload] - json body, for writes
   * @returns {Promise<unknown>} the parsed reply body
   * @throws {ClickUpApiError} when clickup answers with a non-2xx status
   * @throws {Error} when no complete answer arrives: bad header value, network failure, timeout
   * @remarks node quotes a malformed header value in its own error text, so a transport error is
   * rethrown with the key stripped and without the original error attached.
   */
  async function request(method, path, payload) {
    let response;
    let text;
    try {
      response = await fetchImpl(`${BASE_URL}${path}`, {
        method,
        headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
        body: payload === undefined ? undefined : JSON.stringify(payload),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      text = await response.text();
    } catch (error) {
      throw new Error(redact(`ClickUp request got no answer: ${describeTransportError(error)}`));
    }
    const data = parseJson(text);

    if (!response.ok) {
      const ecode = isRecord(data) && typeof data.ECODE === 'string' ? data.ECODE : null;
      const detail = isRecord(data) && typeof data.err === 'string' ? data.err : 'no error detail in the reply';
      throw new ClickUpApiError(
        response.status,
        ecode,
        redact(`ClickUp answered HTTP ${response.status}${ecode ? ` (${ecode})` : ''}: ${detail}`),
      );
    }
    return data;
  }

  /**
   * reads one task.
   *
   * @param {string} taskId - clickup task id
   * @returns {Promise<ClickUpTask | null>} the task, or null when it does not exist or the key cannot see it
   * @throws {ClickUpApiError} when the key is rejected or clickup fails for another reason
   * @throws {Error} when no answer arrives or the reply is not a task
   */
  async function getTask(taskId) {
    try {
      return readTask(await request('GET', `/task/${encodeURIComponent(taskId)}`));
    } catch (error) {
      if (isTaskUnavailable(error)) {
        return null;
      }
      throw error;
    }
  }

  /**
   * sets the status of one task.
   *
   * @param {string} taskId - clickup task id
   * @param {string} status - name of a status that exists on the task's list
   * @returns {Promise<void>}
   * @throws {ClickUpApiError} when clickup refuses the change, e.g. the list has no such status
   * @throws {Error} when no answer arrives
   */
  async function updateTaskStatus(taskId, status) {
    await request('PUT', `/task/${encodeURIComponent(taskId)}`, { status });
  }

  return { getTask, updateTaskStatus };
}
