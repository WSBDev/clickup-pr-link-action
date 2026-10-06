// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  extractTaskId,
  findTaskIdInBody,
  findTaskIdInBranch,
  findTaskIdInTitle,
  isTaskIdShape,
  taskUrl,
} from '../src/task-id.mjs';

/** @type {Array<[string, string | null]>} */
const branchCases = [
  ['abc12345x/add-login', 'abc12345x'],
  ['feature/abc12345x-add-login', 'abc12345x'],
  ['CU-abc12345x_Auto-generated-naming_Jane-doe', 'abc12345x'],
  ['fix/abc1234x/login', 'abc1234x'],
  // an earlier long word must not hide the id that follows it
  ['bugfix/customer-abc12345x', 'abc12345x'],
  ['feature/checkout-page-pagination', null],
  ['feature/portfolio-page-redesign', null],
  ['release/20261006', null],
  ['staging', null],
  ['', null],
  // a bare segment cannot be told apart from a word that merely has the shape of an id
  ['fix/base64url-padding', 'base64url'],
];

for (const [branch, expected] of branchCases) {
  test(`branch "${branch}" gives ${expected}`, () => {
    assert.equal(findTaskIdInBranch(branch), expected);
  });
}

/** @type {Array<[string, string | null]>} */
const titleCases = [
  ['#abc12345x Add login page', 'abc12345x'],
  ['CU-abc12345x Add login page', 'abc12345x'],
  ['cu-abc12345x lower-case prefix', 'abc12345x'],
  ['Add login page (#abc12345x)', 'abc12345x'],
  ['Fix #12345678 regression', null],
  ['#abc12345xy one character too long', null],
  ['Add login page', null],
  ['', null],
];

for (const [title, expected] of titleCases) {
  test(`title "${title}" gives ${expected}`, () => {
    assert.equal(findTaskIdInTitle(title), expected);
  });
}

/** @type {Array<[string, string | null]>} */
const bodyCases = [
  ['Adds the login page.\n\nCU-abc12345x', 'abc12345x'],
  ['See https://app.clickup.com/t/abc12345x for context', 'abc12345x'],
  ['**[Task](https://app.clickup.com/t/9000000001/abc12345x)**', 'abc12345x'],
  // a bare hash is too loose for free text: hex colours and issue refs live here
  ['background: #ff00aa80;', null],
  ['Closes #12', null],
  ['', null],
];

for (const [body, expected] of bodyCases) {
  test(`body ${JSON.stringify(body)} gives ${expected}`, () => {
    assert.equal(findTaskIdInBody(body), expected);
  });
}

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

test('extract prefers an explicit title reference, then the branch, then the body', () => {
  const title = '#title001a from the title';
  const body = 'CU-body0001a';

  assert.equal(extractTaskId({ branch: 'branch01a/work', title, body }), 'title001a');
  assert.equal(extractTaskId({ branch: 'branch01a/work', title: 'Add login page', body }), 'branch01a');
  assert.equal(extractTaskId({ branch: 'staging', title: 'Prod deployment', body }), 'body0001a');
});

test('an explicit title reference wins over an id-shaped word in the branch', () => {
  const source = { branch: 'fix/base64url-padding', title: '#abc12345x Fix padding', body: '' };

  assert.equal(extractTaskId(source), 'abc12345x');
});

test('extract tolerates missing fields', () => {
  assert.equal(extractTaskId({ branch: undefined, title: undefined, body: undefined }), null);
  assert.equal(extractTaskId({ branch: 'staging', title: 'Prod deployment', body: '' }), null);
});

test('task url points at the clickup task page', () => {
  assert.equal(taskUrl('abc12345x'), 'https://app.clickup.com/t/abc12345x');
});
