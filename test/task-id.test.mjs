// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isTaskIdShape, listTaskIdCandidates, taskUrl } from '../src/task-id.mjs';

/** @type {Array<[string, string[]]>} */
const branchCases = [
  ['abc12345x/add-login', ['abc12345x']],
  ['feature/abc12345x-add-login', ['abc12345x']],
  ['CU-abc12345x_Auto-generated-naming_Jane-doe', ['abc12345x']],
  ['fix/abc1234x/login', ['abc1234x']],
  ['feature/checkout-page-pagination', []],
  ['feature/portfolio-page-redesign', []],
  // a bare run of digits in a branch is far more often a date than a task
  ['release/20261006', []],
  ['staging', []],
  ['', []],
  // a word that merely has the shape of an id is a candidate too; clickup decides which is a task
  ['fix/base64url-padding-abc12345x', ['base64url', 'abc12345x']],
];

for (const [branch, expected] of branchCases) {
  test(`branch "${branch}" gives [${expected}]`, () => {
    assert.deepEqual(listTaskIdCandidates({ branch }), expected);
  });
}

/** @type {Array<[string, string[]]>} */
const titleCases = [
  ['#abc12345x Add login page', ['abc12345x']],
  ['CU-abc12345x Add login page', ['abc12345x']],
  ['cu-abc12345x lower-case prefix', ['abc12345x']],
  ['Add login page (#abc12345x)', ['abc12345x']],
  // written out on purpose, so an id made only of digits is taken at its word
  ['CU-868912345 Fix login', ['868912345']],
  // an 8-digit hex colour has the same form; it is offered and clickup turns it down
  ['Change accent to #1a2b3c4d', ['1a2b3c4d']],
  ['Fixes #123', []],
  ['#abc12345xy one character too long', []],
  ['Add login page', []],
  ['', []],
];

for (const [title, expected] of titleCases) {
  test(`title "${title}" gives [${expected}]`, () => {
    assert.deepEqual(listTaskIdCandidates({ title }), expected);
  });
}

test('candidates come from the branch first, then the title', () => {
  const candidates = listTaskIdCandidates({ branch: 'branch01a/work', title: 'Follow-up to #title001a' });

  assert.deepEqual(candidates, ['branch01a', 'title001a']);
});

test('an id named in both places is listed once', () => {
  const candidates = listTaskIdCandidates({ branch: 'abc12345x/add-login', title: '#abc12345x Add login page' });

  assert.deepEqual(candidates, ['abc12345x']);
});

test('the list is capped so one pull request cannot cause a flood of lookups', () => {
  const title = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((letter) => `#task0000${letter}`).join(' ');

  assert.equal(listTaskIdCandidates({ title }).length, 5);
});

test('missing fields give no candidates', () => {
  assert.deepEqual(listTaskIdCandidates({}), []);
  assert.deepEqual(listTaskIdCandidates({ branch: undefined, title: undefined }), []);
});

test('id shape needs 8-9 lowercase alphanumerics with a letter and a digit', () => {
  assert.equal(isTaskIdShape('abc12345x'), true);
  assert.equal(isTaskIdShape('abc1234x'), true);
  assert.equal(isTaskIdShape('portfolio'), false);
  assert.equal(isTaskIdShape('20261006'), false);
  assert.equal(isTaskIdShape('ABC12345X'), false);
  assert.equal(isTaskIdShape('abc1234'), false);
  assert.equal(isTaskIdShape('abc12345xy'), false);
  assert.equal(isTaskIdShape('abc1;rm2x'), false);
});

test('task url points at the clickup task page', () => {
  assert.equal(taskUrl('abc12345x'), 'https://app.clickup.com/t/abc12345x');
});
