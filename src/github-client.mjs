// @ts-check
import { isRecord, redact, requestJson } from './http.mjs';

const DEFAULT_API_URL = 'https://api.github.com';

/** "owner/name", the only form a repository may take in a request path */
const REPOSITORY = /^[\w.-]+\/[\w.-]+$/;

/**
 * @typedef {object} GitHubClient
 * @property {(repository: string, number: number) => Promise<import('./status-target.mjs').PullRequestState>} getPullRequest - reads
 * the current state of one pull request
 */

/**
 * creates a minimal github api client for reading a pull request's current state.
 *
 * @param {object} options - client settings
 * @param {string} options.token - github token with read access to pull requests
 * @param {typeof fetch} [options.fetchImpl] - fetch implementation; tests pass a stand-in
 * @param {string} [options.apiUrl] - api root without a trailing slash; differs on github enterprise
 * @param {import('./http.mjs').Sleep} [options.sleep] - waits between retries; tests pass a stand-in
 * @returns {GitHubClient} the client
 * @remarks every failure message has the token stripped out, so messages are safe to print in a
 * workflow log.
 * @example
 * const github = createGitHubClient({ token: process.env.GITHUB_TOKEN ?? '' });
 * const state = await github.getPullRequest('acme/widgets', 7);
 */
export function createGitHubClient({ token, fetchImpl = fetch, apiUrl = DEFAULT_API_URL, sleep }) {
  /**
   * reads the current state of one pull request.
   *
   * @param {string} repository - repository as "owner/name"
   * @param {number} number - pull request number
   * @returns {Promise<import('./status-target.mjs').PullRequestState>} whether it is open, merged, a draft
   * @throws {Error} when the repository or number is malformed, github refuses the call, no answer
   * arrives, or the reply is not a pull request
   */
  async function getPullRequest(repository, number) {
    if (!REPOSITORY.test(repository)) {
      throw new Error(`"${repository}" is not a repository name of the form owner/name`);
    }
    if (!Number.isInteger(number) || number <= 0) {
      throw new Error(`"${number}" is not a pull request number`);
    }

    const reply = await requestJson({
      fetchImpl,
      url: `${apiUrl}/repos/${repository}/pulls/${number}`,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'clickup-pr-link-action',
      },
      secret: token,
      service: 'GitHub',
      sleep,
    });

    const { data } = reply;
    if (!reply.ok) {
      const detail = isRecord(data) && typeof data.message === 'string' ? data.message : 'no error detail in the reply';
      throw new Error(redact(`GitHub answered HTTP ${reply.status}: ${detail}`, token));
    }
    if (
      !isRecord(data) ||
      typeof data.state !== 'string' ||
      typeof data.merged !== 'boolean' ||
      typeof data.draft !== 'boolean'
    ) {
      throw new Error('GitHub returned a pull request without a state, merged or draft field');
    }
    return { open: data.state === 'open', merged: data.merged, draft: data.draft };
  }

  return { getPullRequest };
}
