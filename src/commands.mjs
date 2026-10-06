// @ts-check
import { ClickUpApiError, createClickUpClient } from './clickup-client.mjs';
import { resolveTargetStatus } from './status-target.mjs';
import { syncTaskStatus } from './sync-status.mjs';
import { extractTaskId, isTaskIdShape, taskUrl } from './task-id.mjs';

/**
 * @typedef {object} CommandIo
 * @property {Record<string, string | undefined>} env - environment variables the step was given
 * @property {typeof fetch} fetchImpl - fetch implementation used for clickup calls
 * @property {(name: string, value: string) => void} setOutput - records one step output
 * @property {(line: string) => void} log - prints one line to the workflow log
 */

/**
 * prints one line to the workflow log, as a plain line or as an annotation.
 *
 * @param {CommandIo} io - command io bundle
 * @param {'info' | 'warning' | 'error'} level - info prints plainly; the others raise an annotation
 * @param {string} message - text to print
 * @returns {void}
 * @remarks "%", carriage returns and newlines are percent-encoded the way the actions toolkit does,
 * so text that came from clickup cannot start a workflow command of its own on a new line.
 */
function emit(io, level, message) {
  const escaped = message.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
  io.log(level === 'info' ? escaped : `::${level}::${escaped}`);
}

/**
 * finds the clickup task id for the pull request and publishes it as step outputs.
 *
 * @param {CommandIo} io - reads BRANCH_NAME, PR_TITLE and PR_BODY; writes clickup_id and task_url
 * @returns {Promise<number>} always 0; a pull request with no task id is not an error
 * @example
 * process.exitCode = await runExtract({ env: process.env, fetchImpl: fetch, setOutput, log: console.log });
 */
export async function runExtract(io) {
  const taskId = extractTaskId({
    branch: io.env.BRANCH_NAME,
    title: io.env.PR_TITLE,
    body: io.env.PR_BODY,
  });

  io.setOutput('clickup_id', taskId ?? '');
  io.setOutput('task_url', taskId ? taskUrl(taskId) : '');
  emit(io, 'info', taskId ? `Found ClickUp task ${taskId}` : 'No ClickUp task ID in the branch name, title or description');
  return 0;
}

/**
 * moves the pull request's clickup task to the status that matches the pull request event.
 *
 * @param {CommandIo} io - reads CLICKUP_ID, CLICKUP_API_KEY, EVENT_ACTION, PR_MERGED, PR_DRAFT,
 * REVIEW_STATUS, MERGED_STATUS and SECRETS_WITHHELD
 * @returns {Promise<number>} 0 when the task is in step or nothing was due; 1 when a due change
 * could not be made, so the check on the pull request goes red instead of failing silently
 * @remarks a missing api key is an error, except on runs github denies secrets to by design
 * (SECRETS_WITHHELD is "true"): those pass, so an outside contributor is not shown a red check.
 * @example
 * process.exitCode = await runSyncStatus({ env: process.env, fetchImpl: fetch, setOutput, log: console.log });
 */
export async function runSyncStatus(io) {
  const { env } = io;
  const taskId = env.CLICKUP_ID ?? '';
  if (!isTaskIdShape(taskId)) {
    emit(io, 'error', 'CLICKUP_ID is not a ClickUp task ID; pass the clickup_id output of the extract step.');
    return 1;
  }

  const action = env.EVENT_ACTION ?? '';
  const targetStatus = resolveTargetStatus(
    { action, merged: env.PR_MERGED === 'true', draft: env.PR_DRAFT === 'true' },
    { review: env.REVIEW_STATUS ?? '', merged: env.MERGED_STATUS ?? '' },
  );

  const apiKey = env.CLICKUP_API_KEY ?? '';
  if (targetStatus !== null && apiKey === '') {
    if (env.SECRETS_WITHHELD === 'true') {
      emit(io, 'info', `ClickUp task ${taskId} not moved: fork and Dependabot pull requests are not given secrets`);
      return 0;
    }
    emit(io, 'error', `Cannot move ClickUp task ${taskId} to "${targetStatus}": clickup_api_key is empty. Set the CLICKUP_API_KEY secret and pass it to the action.`);
    return 1;
  }

  /** @type {import('./sync-status.mjs').SyncResult} */
  let result;
  try {
    const client = createClickUpClient({ apiKey, fetchImpl: io.fetchImpl });
    result = await syncTaskStatus({ taskId, targetStatus, client });
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown error';
    // only a refusal from clickup points at the key or the status name; a network failure does not
    const hint =
      error instanceof ClickUpApiError
        ? ". Check that the CLICKUP_API_KEY secret is valid and that the task's list has this status."
        : '';
    emit(io, 'error', `Could not move ClickUp task ${taskId} to "${targetStatus}": ${reason}${hint}`);
    return 1;
  }

  switch (result.outcome) {
    case 'updated':
      emit(io, 'info', `Moved ClickUp task ${taskId} from "${result.from}" to "${result.to}"`);
      break;
    case 'unchanged':
      emit(io, 'info', `ClickUp task ${taskId} is already "${result.from}"`);
      break;
    case 'no_target':
      emit(io, 'info', `Pull request event "${action}" does not change the task status`);
      break;
    case 'task_unavailable':
      emit(io, 'warning', `ClickUp task ${taskId} was not found, or the API key cannot see it. Status left as it is.`);
      break;
    default: {
      /** @type {never} */
      const unhandled = result.outcome;
      throw new Error(`unhandled sync outcome: ${unhandled}`);
    }
  }
  return 0;
}
