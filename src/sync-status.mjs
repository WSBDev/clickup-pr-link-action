// @ts-check

/**
 * @typedef {object} SyncResult
 * @property {'no_target' | 'task_unavailable' | 'unchanged' | 'updated'} outcome - what happened
 * @property {string} taskId - the task the result is about
 * @property {string} [from] - status the task had, when it could be read
 * @property {string} [to] - status that was wanted, when the task could be read
 */

/**
 * compares two status names the way clickup does: ignoring case and outer whitespace.
 *
 * @param {string} left - one status name
 * @param {string} right - the other status name
 * @returns {boolean} true when both name the same status
 */
function isSameStatus(left, right) {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

/**
 * brings one clickup task to a target status.
 *
 * @param {object} input - what to sync
 * @param {string} input.taskId - clickup task id
 * @param {string | null} input.targetStatus - status to set, or null for "leave it alone"
 * @param {import('./clickup-client.mjs').ClickUpClient} input.client - clickup api client
 * @returns {Promise<SyncResult>} the outcome; no api call is made for a null target, and no write
 * when the task already has the target status or cannot be seen
 * @throws {Error} when the api key is rejected, the status change is refused, or the request fails
 * @example
 * const result = await syncTaskStatus({ taskId: 'abc12345x', targetStatus: 'in review', client });
 * // { outcome: 'updated', taskId: 'abc12345x', from: 'in progress', to: 'in review' }
 */
export async function syncTaskStatus({ taskId, targetStatus, client }) {
  if (targetStatus === null) {
    return { outcome: 'no_target', taskId };
  }

  const task = await client.getTask(taskId);
  if (task === null) {
    return { outcome: 'task_unavailable', taskId };
  }

  if (isSameStatus(task.status, targetStatus)) {
    return { outcome: 'unchanged', taskId, from: task.status, to: targetStatus };
  }

  await client.updateTaskStatus(taskId, targetStatus);
  return { outcome: 'updated', taskId, from: task.status, to: targetStatus };
}
