// @ts-check
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const mainPath = fileURLToPath(new URL('../src/main.mjs', import.meta.url));

/** an opened pull request that names a task but has no api key: a problem that needs no network */
const problemEnv = {
  BRANCH_NAME: 'abc12345x/add-login',
  PR_TITLE: 'Add login page',
  EVENT_ACTION: 'opened',
  PR_MERGED: 'false',
  PR_DRAFT: 'false',
  REVIEW_STATUS: 'in review',
  MERGED_STATUS: 'complete',
  CLICKUP_API_KEY: '',
};

/**
 * runs the action's entry point as its own process, the way the workflow step does.
 *
 * @param {Record<string, string>} env - variables laid over this process's environment
 * @returns {Promise<{code: number, stdout: string}>} the exit code and everything printed
 */
async function runMain(env) {
  const options = { env: { ...process.env, GITHUB_OUTPUT: '', FAIL_ON_PROBLEM: '', ...env } };
  try {
    const { stdout } = await run(process.execPath, [mainPath], options);
    return { code: 0, stdout };
  } catch (error) {
    const failure = /** @type {{code?: number, stdout?: string}} */ (error);
    return { code: failure.code ?? -1, stdout: failure.stdout ?? '' };
  }
}

test('a problem is printed as a warning and the process still exits 0', async () => {
  const { code, stdout } = await runMain(problemEnv);

  assert.equal(code, 0);
  assert.match(stdout, /^::warning::/m);
});

test('in strict mode the same problem makes the process exit 1', async () => {
  const { code, stdout } = await runMain({ ...problemEnv, FAIL_ON_PROBLEM: 'true' });

  assert.equal(code, 1);
  assert.match(stdout, /^::warning::/m);
});

test('in strict mode a run with nothing wrong still exits 0', async () => {
  const { code } = await runMain({ ...problemEnv, BRANCH_NAME: 'staging', FAIL_ON_PROBLEM: 'true' });

  assert.equal(code, 0);
});
