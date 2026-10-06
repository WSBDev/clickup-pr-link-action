// @ts-check

/** made-up task id of valid shape; not a real task */
export const TASK_ID = 'abc12345x';

/** made-up id of the list the task lives in */
export const LIST_ID = '900100200300';

/** placeholder clickup api key; never a real credential */
export const API_KEY = 'pk_test_not_a_real_key';

/** placeholder github token; never a real credential */
export const GITHUB_TOKEN = 'ghs_test_not_a_real_token';

/** statuses of the made-up list, in workflow order */
export const LIST_STATUSES = ['todo', 'in progress', 'in review', 'complete'];

/**
 * stands in for the pause between retries, so tests never wait on a real timer.
 *
 * @returns {Promise<void>} resolves at once
 */
export async function noSleep() {}

/**
 * builds the reply clickup gives when a task is read or its status is changed.
 *
 * @param {string} status - status name the task reports
 * @param {string} [name] - task title
 * @returns {import('./fake-fetch.mjs').CannedResponse} a 200 reply carrying the task
 */
export function taskReply(status, name = 'Example task') {
  return { status: 200, body: { id: TASK_ID, name, status: { status }, list: { id: LIST_ID } } };
}

/**
 * builds the reply clickup gives when a list is read.
 *
 * @param {string[]} [statuses] - status names in workflow order, first to last
 * @returns {import('./fake-fetch.mjs').CannedResponse} a 200 reply carrying the list and its statuses
 */
export function listReply(statuses = LIST_STATUSES) {
  const body = { id: LIST_ID, statuses: statuses.map((status, orderindex) => ({ status, orderindex })) };
  return { status: 200, body };
}

/**
 * builds an api error reply in clickup's shape.
 *
 * @param {number} status - http status of the reply
 * @param {string} ecode - clickup error code, e.g. "OAUTH_025"
 * @param {string} err - clickup error text
 * @returns {import('./fake-fetch.mjs').CannedResponse} the error reply
 */
export function errorReply(status, ecode, err) {
  return { status, body: { err, ECODE: ecode } };
}

/**
 * builds the reply github gives when a pull request is read.
 *
 * @param {{state?: 'open' | 'closed', merged?: boolean, draft?: boolean}} [fields] - pull request state; defaults to open, unmerged, not a draft
 * @returns {import('./fake-fetch.mjs').CannedResponse} a 200 reply carrying the pull request
 */
export function pullRequestReply({ state = 'open', merged = false, draft = false } = {}) {
  return { status: 200, body: { number: 7, state, merged, draft } };
}

/**
 * builds the error fetch throws when the network fails before an answer arrives.
 *
 * @returns {TypeError} a "fetch failed" error whose cause names the real reason, as node reports it
 */
export function networkFailure() {
  return new TypeError('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND api.clickup.com') });
}
