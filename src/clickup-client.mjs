// @ts-check
import { isRecord, redact, requestJson } from './http.mjs';

const BASE_URL = 'https://api.clickup.com/api/v2';

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
 * @property {string} listId - id of the list the task lives in; the list defines the statuses
 */

/**
 * @typedef {object} ClickUpClient
 * @property {(taskId: string) => Promise<ClickUpTask | null>} getTask - reads one task; null when
 * the task does not exist or the key cannot see it
 * @property {(listId: string) => Promise<string[]>} getListStatuses - reads a list's status names,
 * first to last in workflow order
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
 * validates the task fields this action relies on.
 *
 * @param {unknown} data - parsed reply of the get-task call
 * @returns {ClickUpTask} the validated task
 * @throws {Error} when the reply lacks an id, a name, a status name or a list id
 */
function readTask(data) {
  if (
    !isRecord(data) ||
    !isRecord(data.status) ||
    !isRecord(data.list) ||
    typeof data.id !== 'string' ||
    typeof data.name !== 'string' ||
    typeof data.status.status !== 'string' ||
    typeof data.list.id !== 'string'
  ) {
    throw new Error('ClickUp returned a task without an id, name, status or list');
  }
  return { id: data.id, name: data.name, status: data.status.status, listId: data.list.id };
}

/**
 * reads the status names of a list reply, in workflow order.
 *
 * @param {unknown} data - parsed reply of the get-list call
 * @returns {string[]} status names, first to last
 * @throws {Error} when the reply has no statuses, or one lacks a name or a position
 * @remarks clickup gives each status an "orderindex"; the reply is not guaranteed to be sorted by it.
 */
function readListStatuses(data) {
  const entries = isRecord(data) && Array.isArray(data.statuses) ? data.statuses : [];
  const positioned = [];

  for (const entry of entries) {
    const position = isRecord(entry) ? Number(entry.orderindex) : Number.NaN;
    if (!isRecord(entry) || typeof entry.status !== 'string' || entry.orderindex === null || !Number.isFinite(position)) {
      throw new Error('ClickUp returned a list without usable statuses');
    }
    positioned.push({ name: entry.status, position });
  }
  if (positioned.length === 0) {
    throw new Error('ClickUp returned a list without usable statuses');
  }

  positioned.sort(byPosition);
  return positioned.map(nameOf);
}

/**
 * orders two statuses by their position in the list's workflow.
 *
 * @param {{position: number}} left - one status
 * @param {{position: number}} right - the other status
 * @returns {number} negative when left comes first, positive when right does
 */
function byPosition(left, right) {
  return left.position - right.position;
}

/**
 * picks the name out of a positioned status.
 *
 * @param {{name: string}} status - a status with its name
 * @returns {string} the status name
 */
function nameOf(status) {
  return status.name;
}

/**
 * creates a minimal clickup api client for reading a task and setting its status.
 *
 * @param {object} options - client settings
 * @param {string} options.apiKey - clickup personal api token, sent as the Authorization header
 * @param {typeof fetch} [options.fetchImpl] - fetch implementation; tests pass a stand-in
 * @param {import('./http.mjs').Sleep} [options.sleep] - waits between retries; tests pass a stand-in
 * @returns {ClickUpClient} the client
 * @remarks every failure message has the api key stripped out, so messages are safe to print in
 * a workflow log.
 * @example
 * const client = createClickUpClient({ apiKey: process.env.CLICKUP_API_KEY ?? '' });
 * const task = await client.getTask('abc12345x');
 */
export function createClickUpClient({ apiKey, fetchImpl = fetch, sleep }) {
  /**
   * sends one api request and returns the parsed reply.
   *
   * @param {'GET' | 'PUT'} method - http method
   * @param {string} path - path under the api root, starting with a slash
   * @param {Record<string, unknown>} [payload] - json body, for writes
   * @returns {Promise<unknown>} the parsed reply body
   * @throws {ClickUpApiError} when clickup answers with a non-2xx status
   * @throws {Error} when no answer arrives
   */
  async function request(method, path, payload) {
    const reply = await requestJson({
      fetchImpl,
      url: `${BASE_URL}${path}`,
      method,
      headers: { Authorization: apiKey },
      payload,
      secret: apiKey,
      service: 'ClickUp',
      sleep,
    });

    if (!reply.ok) {
      const { data } = reply;
      const ecode = isRecord(data) && typeof data.ECODE === 'string' ? data.ECODE : null;
      const detail = isRecord(data) && typeof data.err === 'string' ? data.err : 'no error detail in the reply';
      throw new ClickUpApiError(
        reply.status,
        ecode,
        redact(`ClickUp answered HTTP ${reply.status}${ecode ? ` (${ecode})` : ''}: ${detail}`, apiKey),
      );
    }
    return reply.data;
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
   * reads the status names of one list.
   *
   * @param {string} listId - clickup list id
   * @returns {Promise<string[]>} status names, first to last in workflow order
   * @throws {ClickUpApiError} when clickup refuses the call
   * @throws {Error} when no answer arrives or the reply has no usable statuses
   */
  async function getListStatuses(listId) {
    return readListStatuses(await request('GET', `/list/${encodeURIComponent(listId)}`));
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

  return { getTask, getListStatuses, updateTaskStatus };
}
