// @ts-check

/**
 * @typedef {object} PullRequestEvent
 * @property {string} action - the pull_request event action, e.g. "opened" or "closed"
 * @property {boolean} merged - true once the pull request has been merged
 * @property {boolean} draft - true while the pull request is a draft
 */

/**
 * @typedef {object} StatusNames
 * @property {string} review - status for a pull request that is open for review; empty switches it off
 * @property {string} merged - status for a merged pull request; empty switches it off
 */

/** event actions that put a pull request in front of reviewers */
const REVIEW_ACTIONS = new Set(['opened', 'reopened', 'ready_for_review']);

/**
 * decides which status a clickup task should take for a pull request event.
 *
 * @param {PullRequestEvent} event - the pull request event being handled
 * @param {StatusNames} statuses - status names configured for this workflow
 * @returns {string | null} the status to set, or null when the event must not change the task
 * @remarks drafts are left alone until they are marked ready, a pull request closed without
 * merging changes nothing, and pushes ("synchronize") never reset a status someone set by hand.
 * @example
 * resolveTargetStatus({ action: 'closed', merged: true, draft: false }, { review: 'in review', merged: 'complete' }); // 'complete'
 */
export function resolveTargetStatus(event, statuses) {
  if (event.action === 'closed') {
    return event.merged ? statuses.merged || null : null;
  }
  if (REVIEW_ACTIONS.has(event.action) && !event.draft) {
    return statuses.review || null;
  }
  return null;
}
