// @ts-check

/** one clickup task id: 8-9 lowercase alphanumerics */
const ID = '[a-z0-9]{8,9}';

/** a whole token that is exactly one id long */
const ID_ONLY = new RegExp(`^${ID}$`);

/** rejects a match that runs on into more letters or digits, so a longer token never yields an id */
const ID_END = '(?![A-Za-z0-9])';

/** "#id" or "CU-id", the two forms clickup itself recognises in a pull request title */
const TITLE_REFERENCE = new RegExp(`(?:#|\\b[Cc][Uu]-)(${ID})${ID_END}`, 'g');

/** "CU-id" or a task link; a bare "#id" is left out because hex colours and issue refs share that form */
const BODY_REFERENCE = new RegExp(`(?:\\b[Cc][Uu]-|app\\.clickup\\.com/t/(?:\\d+/)?)(${ID})${ID_END}`, 'g');

/**
 * checks that a token has the shape of a clickup task id.
 *
 * @param {string} token - candidate text with no surrounding delimiters
 * @returns {boolean} true for 8-9 lowercase alphanumerics holding at least one letter and one digit
 * @remarks requiring both a letter and a digit keeps plain words ("portfolio") and dates ("20261006")
 * from being mistaken for ids.
 * @example
 * isTaskIdShape('abc12345x'); // true
 * isTaskIdShape('portfolio'); // false
 */
export function isTaskIdShape(token) {
  return ID_ONLY.test(token) && /[a-z]/.test(token) && /[0-9]/.test(token);
}

/**
 * returns the first id-shaped capture of a reference pattern in free text.
 *
 * @param {string} text - text to scan
 * @param {RegExp} pattern - global pattern whose first capture group is the candidate id
 * @returns {string | null} the first capture that passes the id shape check, or null
 */
function findFirstReference(text, pattern) {
  for (const match of text.matchAll(pattern)) {
    if (isTaskIdShape(match[1])) {
      return match[1];
    }
  }
  return null;
}

/**
 * finds a clickup task id in a branch name.
 *
 * @param {string} branch - branch name, e.g. "abc12345x/add-login"
 * @returns {string | null} the first id-shaped segment, or null when there is none
 * @remarks the branch is split on every non-alphanumeric character, so the id may sit anywhere and
 * an earlier long word cannot hide it. a word that merely has the shape of an id ("base64url") is
 * indistinguishable here and is returned too.
 * @example
 * findTaskIdInBranch('feature/abc12345x-add-login'); // 'abc12345x'
 */
export function findTaskIdInBranch(branch) {
  return branch.split(/[^A-Za-z0-9]+/).find(isTaskIdShape) ?? null;
}

/**
 * finds a clickup task id written as "#id" or "CU-id" in a pull request title.
 *
 * @param {string} title - pull request title
 * @returns {string | null} the first referenced id, or null when there is none
 * @example
 * findTaskIdInTitle('#abc12345x Add login page'); // 'abc12345x'
 */
export function findTaskIdInTitle(title) {
  return findFirstReference(title, TITLE_REFERENCE);
}

/**
 * finds a clickup task id written as "CU-id" or as a task link in a pull request description.
 *
 * @param {string} body - pull request description
 * @returns {string | null} the first referenced id, or null when there is none
 * @example
 * findTaskIdInBody('See https://app.clickup.com/t/abc12345x'); // 'abc12345x'
 */
export function findTaskIdInBody(body) {
  return findFirstReference(body, BODY_REFERENCE);
}

/**
 * picks the clickup task id for a pull request.
 *
 * @param {{branch?: string, title?: string, body?: string}} source - pull request fields; any may be missing
 * @returns {string | null} the id from the title, else the branch, else the description, else null
 * @remarks the title goes first because "#id" and "CU-id" are written on purpose, while a branch
 * segment is only a guess by shape. the description goes last because it often links other tasks.
 * @example
 * extractTaskId({ branch: 'abc12345x/add-login', title: 'Add login page', body: '' }); // 'abc12345x'
 */
export function extractTaskId({ branch, title, body }) {
  return (
    findTaskIdInTitle(title ?? '') ?? findTaskIdInBranch(branch ?? '') ?? findTaskIdInBody(body ?? '')
  );
}

/**
 * builds the web address of a clickup task.
 *
 * @param {string} taskId - clickup task id
 * @returns {string} the task page url
 * @example
 * taskUrl('abc12345x'); // 'https://app.clickup.com/t/abc12345x'
 */
export function taskUrl(taskId) {
  return `https://app.clickup.com/t/${taskId}`;
}
