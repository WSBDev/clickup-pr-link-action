// @ts-check

/** one clickup task id: 8-9 lowercase alphanumerics */
const ID = '[a-z0-9]{8,9}';

/** a whole token that is exactly one id long */
const ID_ONLY = new RegExp(`^${ID}$`);

/** rejects a match that runs on into more letters or digits, so a longer token never yields an id */
const ID_END = '(?![A-Za-z0-9])';

/** "#id" or "CU-id", the two forms clickup itself recognises in a pull request title */
const TITLE_REFERENCE = new RegExp(`(?:#|\\b[Cc][Uu]-)(${ID})${ID_END}`, 'g');

/** most ids ever offered for one pull request; bounds the lookups one pull request can cause */
const MAX_CANDIDATES = 5;

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
 * collects the ids written as "#id" or "CU-id" in a pull request title.
 *
 * @param {string} title - pull request title
 * @returns {string[]} the referenced ids, in the order they appear
 * @remarks an explicit reference is taken at its word, so an id made only of digits counts here
 * although it would not in a branch name.
 */
function findTitleReferences(title) {
  const found = [];
  for (const match of title.matchAll(TITLE_REFERENCE)) {
    found.push(match[1]);
  }
  return found;
}

/**
 * lists the clickup task ids a pull request may be about, most likely first.
 *
 * @param {{branch?: string, title?: string}} source - pull request fields; either may be missing
 * @returns {string[]} up to five distinct candidate ids
 * @remarks shape alone cannot tell a task id from a word such as "base64url" or a hex colour, so
 * this only proposes; the caller asks clickup which candidate is a real task. id-shaped segments of
 * the branch come first: a branch is cut for one task, while a title may mention another ("Follow-up
 * to #id"). "#id" and "CU-id" in the title follow, for branches that carry no task id. the
 * description is deliberately not searched: it routinely names other tasks (related work, the
 * tasks in a release), and this action writes to whichever task it settles on.
 * @example
 * listTaskIdCandidates({ branch: 'abc12345x/add-login', title: 'Add login page' }); // ['abc12345x']
 */
export function listTaskIdCandidates({ branch = '', title = '' }) {
  const ordered = [...branch.split(/[^A-Za-z0-9]+/).filter(isTaskIdShape), ...findTitleReferences(title)];
  return [...new Set(ordered)].slice(0, MAX_CANDIDATES);
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
