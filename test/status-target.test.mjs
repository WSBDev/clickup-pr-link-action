// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isStatusEvent, statusForPullRequest } from '../src/status-target.mjs';

const statuses = { review: 'in review', merged: 'complete' };

/** @type {Array<[string, boolean]>} */
const eventCases = [
  ['opened', true],
  ['reopened', true],
  ['ready_for_review', true],
  ['closed', true],
  // a push must never reset a status someone set by hand
  ['synchronize', false],
  ['edited', false],
  ['converted_to_draft', false],
  ['', false],
];

for (const [action, expected] of eventCases) {
  test(`event "${action}" ${expected ? 'can' : 'cannot'} change the task status`, () => {
    assert.equal(isStatusEvent(action), expected);
  });
}

/** @type {Array<[string, {open: boolean, merged: boolean, draft: boolean}, string | null]>} */
const stateCases = [
  ['open and ready', { open: true, merged: false, draft: false }, 'in review'],
  ['an open draft', { open: true, merged: false, draft: true }, null],
  ['merged', { open: false, merged: true, draft: false }, 'complete'],
  ['closed without merging', { open: false, merged: false, draft: false }, null],
];

for (const [name, state, expected] of stateCases) {
  test(`a pull request that is ${name} targets ${expected}`, () => {
    assert.equal(statusForPullRequest(state, statuses), expected);
  });
}

test('an empty status name switches that transition off', () => {
  const open = { open: true, merged: false, draft: false };
  const merged = { open: false, merged: true, draft: false };

  assert.equal(statusForPullRequest(open, { review: '', merged: 'complete' }), null);
  assert.equal(statusForPullRequest(merged, { review: 'in review', merged: '' }), null);
});
