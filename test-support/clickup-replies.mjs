// @ts-check

/** made-up task id of valid shape; not a real task */
export const TASK_ID = 'abc12345x';

/** placeholder api key; never a real credential */
export const API_KEY = 'pk_test_not_a_real_key';

/**
 * builds the reply clickup gives when a task is read or its status is changed.
 *
 * @param {string} status - status name the task reports
 * @returns {import('./fake-fetch.mjs').CannedResponse} a 200 reply carrying the task
 */
export function taskReply(status) {
  return { status: 200, body: { id: TASK_ID, name: 'Example task', status: { status } } };
}

/**
 * builds a clickup error reply.
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
 * builds the error fetch throws when the network fails before clickup can answer.
 *
 * @returns {TypeError} a "fetch failed" error whose cause names the real reason, as node reports it
 */
export function networkFailure() {
  return new TypeError('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND api.clickup.com') });
}
