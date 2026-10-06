// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resolveTargetStatus } from '../src/status-target.mjs';

const statuses = { review: 'in review', merged: 'complete' };

/** @type {Array<[string, {action: string, merged: boolean, draft: boolean}, string | null]>} */
const cases = [
  ['opened', { action: 'opened', merged: false, draft: false }, 'in review'],
  ['opened as draft', { action: 'opened', merged: false, draft: true }, null],
  ['reopened', { action: 'reopened', merged: false, draft: false }, 'in review'],
  ['reopened as draft', { action: 'reopened', merged: false, draft: true }, null],
  ['marked ready for review', { action: 'ready_for_review', merged: false, draft: false }, 'in review'],
  ['merged', { action: 'closed', merged: true, draft: false }, 'complete'],
  ['closed without merging', { action: 'closed', merged: false, draft: false }, null],
  ['new commits pushed', { action: 'synchronize', merged: false, draft: false }, null],
  ['edited', { action: 'edited', merged: false, draft: false }, null],
  ['converted to draft', { action: 'converted_to_draft', merged: false, draft: true }, null],
];

for (const [name, event, expected] of cases) {
  test(`pull request ${name} targets ${expected}`, () => {
    assert.equal(resolveTargetStatus(event, statuses), expected);
  });
}

test('an empty status name switches that transition off', () => {
  const opened = { action: 'opened', merged: false, draft: false };
  const merged = { action: 'closed', merged: true, draft: false };

  assert.equal(resolveTargetStatus(opened, { review: '', merged: 'complete' }), null);
  assert.equal(resolveTargetStatus(merged, { review: 'in review', merged: '' }), null);
});
