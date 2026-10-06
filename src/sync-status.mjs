// @ts-check

/**
 * @typedef {object} SyncResult
 * @property {'unchanged' | 'kept' | 'updated'} outcome - "unchanged": the task already had the
 * status; "kept": the task is further along than the status and was left there; "updated": the
 * status was written
 * @property {string} from - status the task had
 * @property {string} to - status that was wanted
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
 * finds where a status sits in a list's workflow.
 *
 * @param {string[]} statuses - the list's status names, first to last
 * @param {string} name - status to look for
 * @returns {number} its zero-based position, or -1 when the list has no such status
 */
function positionOf(statuses, name) {
  for (const [position, status] of statuses.entries()) {
    if (isSameStatus(status, name)) {
      return position;
    }
  }
  return -1;
}

/**
 * brings one clickup task forward to a target status.
 *
 * @param {object} input - what to sync
 * @param {import('./clickup-client.mjs').ClickUpTask} input.task - the task as last read
 * @param {string} input.targetStatus - status the task should have
 * @param {import('./clickup-client.mjs').ClickUpClient} input.client - clickup api client
 * @returns {Promise<SyncResult>} the outcome; nothing is written when the task already has the
 * status or is further along in its list's workflow
 * @throws {Error} when the list has no status with that name, clickup refuses the change, or a
 * request fails
 * @remarks a task is only ever moved forward: a late or re-run "opened" job cannot put a completed
 * task back in review, and a re-run cannot drag back a task someone has since moved on. the
 * status is read again right before the write, because the run may have waited on a rate limit
 * since it first read the task, and another run may have moved the task in the meantime. clickup
 * offers no conditional write, so the instant between that read and the write stays open.
 * @example
 * const result = await syncTaskStatus({ task, targetStatus: 'in review', client });
 * // { outcome: 'updated', from: 'in progress', to: 'in review' }
 */
export async function syncTaskStatus({ task, targetStatus, client }) {
  if (isSameStatus(task.status, targetStatus)) {
    return { outcome: 'unchanged', from: task.status, to: targetStatus };
  }

  const statuses = await client.getListStatuses(task.listId);
  const targetPosition = positionOf(statuses, targetStatus);
  if (targetPosition === -1) {
    throw new Error(
      `The task's list has no status named "${targetStatus}". Add it to the list, or set review_status / merged_status to a status the list has`,
    );
  }

  const current = (await client.getTask(task.id))?.status ?? task.status;
  if (isSameStatus(current, targetStatus)) {
    return { outcome: 'unchanged', from: current, to: targetStatus };
  }
  if (positionOf(statuses, current) > targetPosition) {
    return { outcome: 'kept', from: current, to: targetStatus };
  }

  await client.updateTaskStatus(task.id, targetStatus);
  return { outcome: 'updated', from: current, to: targetStatus };
}
