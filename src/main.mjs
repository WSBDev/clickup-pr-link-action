// @ts-check
import { appendFileSync } from 'node:fs';

import { runExtract, runSyncStatus } from './commands.mjs';

/** @type {Map<string, (io: import('./commands.mjs').CommandIo) => Promise<number>>} */
const commands = new Map([
  ['extract', runExtract],
  ['sync-status', runSyncStatus],
]);

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

const name = process.argv[2] ?? '';
const command = commands.get(name);

if (command) {
  process.exitCode = await command({ env: process.env, fetchImpl: fetch, setOutput, log: console.log });
} else {
  console.error(`Unknown command "${name}". Expected one of: ${[...commands.keys()].join(', ')}`);
  process.exitCode = 2;
}
