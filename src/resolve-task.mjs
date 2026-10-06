// @ts-check

/**
 * finds which of the candidate ids is a real clickup task.
 *
 * @param {string[]} candidates - candidate task ids, most likely first
 * @param {import('./clickup-client.mjs').ClickUpClient} client - clickup api client
 * @returns {Promise<import('./clickup-client.mjs').ClickUpTask | null>} the first candidate clickup
 * knows and the key can see, or null when there is none
 * @throws {Error} when the api key is rejected or a lookup fails; the search stops there
 * @remarks candidates are looked up one at a time and the search ends at the first hit, so the
 * usual pull request costs a single request.
 * @example
 * const task = await resolveTask(['1a2b3c4d', 'abc12345x'], client); // the task 'abc12345x'
 */
export async function resolveTask(candidates, client) {
  for (const taskId of candidates) {
    const task = await client.getTask(taskId);
    if (task !== null) {
      return task;
    }
  }
  return null;
}
