// @ts-check
import { appendFileSync } from 'node:fs';

import { runSync } from './commands.mjs';

/**
 * records one step output for later steps of the action to read.
 *
 * @param {string} name - output name
 * @param {string} value - output value; must be a single line
 * @returns {void}
 * @throws {Error} when the value spans lines, which would let it define further outputs
 * @remarks outside a workflow run there is no GITHUB_OUTPUT file and the output is dropped.
 */
function setOutput(name, value) {
  if (/[\r\n]/.test(value)) {
    throw new Error(`output "${name}" must be a single line`);
  }
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
  }
}

const hadProblem = await runSync({ env: process.env, fetchImpl: fetch, setOutput, log: console.log });

// strict mode exists for this action's own self-test: with every problem downgraded to a warning,
// a broken release would otherwise pass its own check and reach every repository unnoticed
if (hadProblem && process.env.FAIL_ON_PROBLEM === 'true') {
  process.exitCode = 1;
}
