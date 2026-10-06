// @ts-check

/**
 * @typedef {object} PullRequestState
 * @property {boolean} open - true while the pull request is open
 * @property {boolean} merged - true once the pull request has been merged
 * @property {boolean} draft - true while the pull request is a draft
 */

/**
 * @typedef {object} StatusNames
 * @property {string} review - status for a pull request that is open for review; empty switches it off
 * @property {string} merged - status for a merged pull request; empty switches it off
 */

/** event actions after which the task status is brought in line with the pull request */
const STATUS_EVENTS = new Set(['opened', 'reopened', 'ready_for_review', 'closed']);

/**
 * tells whether a pull request event is one that may change the task status.
 *
 * @param {string} action - the pull_request event action, e.g. "opened" or "synchronize"
 * @returns {boolean} true for opened, reopened, ready_for_review and closed
 * @remarks pushes ("synchronize") and edits are left out on purpose, so they never reset a status
 * someone set by hand.
 * @example
 * isStatusEvent('synchronize'); // false
 */
export function isStatusEvent(action) {
  return STATUS_EVENTS.has(action);
}

/**
 * decides which status a clickup task should have for the state its pull request is in.
 *
 * @param {PullRequestState} state - current state of the pull request
 * @param {StatusNames} statuses - status names configured for this workflow
 * @returns {string | null} the status to set, or null when the task must be left as it is
 * @remarks the answer depends only on the state, never on which event was seen, so runs that
 * arrive late or out of order still settle on the right status. a draft and a pull request closed
 * without merging change nothing.
 * @example
 * statusForPullRequest({ open: false, merged: true, draft: false }, { review: 'in review', merged: 'complete' }); // 'complete'
 */
export function statusForPullRequest(state, statuses) {
  if (state.merged) {
    return statuses.merged || null;
  }
  if (state.open && !state.draft) {
    return statuses.review || null;
  }
  return null;
}
