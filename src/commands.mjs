// @ts-check
import { ClickUpApiError, createClickUpClient } from './clickup-client.mjs';
import { createGitHubClient } from './github-client.mjs';
import { resolveTask } from './resolve-task.mjs';
import { isStatusEvent, statusForPullRequest } from './status-target.mjs';
import { syncTaskStatus } from './sync-status.mjs';
import { listTaskIdCandidates, taskUrl } from './task-id.mjs';

/**
 * @typedef {object} CommandIo
 * @property {Record<string, string | undefined>} env - environment variables the step was given
 * @property {typeof fetch} fetchImpl - fetch implementation used for api calls
 * @property {(name: string, value: string) => void} setOutput - records one step output
 * @property {(line: string) => void} log - prints one line to the workflow log
 * @property {import('./http.mjs').Sleep} [sleep] - waits between retries; tests pass a stand-in
 */

/**
 * what the run owes the task.
 *
 * @typedef {object} StatusDecision
 * @property {string | null} targetStatus - status the task should get; null when nothing is to change
 * @property {string | null} problem - set when a change may be owed but could not be confirmed
 */

/**
 * prints one line to the workflow log, as a plain line or as an annotation.
 *
 * @param {CommandIo} io - command io bundle
 * @param {'info' | 'warning' | 'error'} level - info prints plainly; the others raise an annotation
 * @param {string} message - text to print
 * @returns {void}
 * @remarks text that came from an api must not be able to issue a workflow command of its own. the
 * runner reads "::name::" at the start of a line and the older "##[name]" anywhere in one, so the
 * latter is broken up and line breaks never survive. an annotation is percent-encoded the way the
 * actions toolkit does, which the runner decodes again; a plain line is not decoded, so there line
 * breaks are flattened instead.
 */
function emit(io, level, message) {
  const safe = message.replaceAll('##[', '# #[');
  if (level === 'info') {
    io.log(safe.replace(/[\r\n]+/g, ' '));
    return;
  }
  const escaped = safe.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
  io.log(`::${level}::${escaped}`);
}

/**
 * reports a problem at the weight the run calls for.
 *
 * @param {CommandIo} io - command io bundle
 * @param {boolean} isFatal - true when the run owes a status change it now cannot make
 * @param {string} message - what went wrong
 * @returns {number} the exit code: 1 with an error when fatal, 0 with a warning otherwise
 */
function reportProblem(io, isFatal, message) {
  emit(io, isFatal ? 'error' : 'warning', message);
  return isFatal ? 1 : 0;
}

/**
 * says why a clickup call failed, adding what to check when the answer points at the api key.
 *
 * @param {unknown} error - what the call threw
 * @returns {string} the failure text; a refusal of the key gets a hint about the secret, and
 * anything else (rate limit, outage, network, a missing status) speaks for itself
 */
function describeFailure(error) {
  const reason = error instanceof Error ? error.message : 'unknown error';
  if (error instanceof ClickUpApiError && (error.status === 401 || error.status === 403)) {
    return `${reason}. Check that the CLICKUP_API_KEY secret is valid and that its account can edit this task.`;
  }
  return reason;
}

/**
 * publishes the resolved task, or the lack of one, as step outputs for the link step.
 *
 * @param {CommandIo} io - command io bundle
 * @param {import('./clickup-client.mjs').ClickUpTask | null} task - the task, or null when none was resolved
 * @returns {void}
 * @remarks the title is collapsed to one line, because a step output cannot span lines. a later
 * value for the same output replaces an earlier one.
 */
function publishTask(io, task) {
  io.setOutput('clickup_id', task?.id ?? '');
  io.setOutput('task_url', task ? taskUrl(task.id) : '');
  io.setOutput('task_title', task ? task.name.replace(/\s+/g, ' ').trim() : '');
}

/**
 * works out which status the event that started the run asks for, from the event alone.
 *
 * @param {Record<string, string | undefined>} env - reads EVENT_ACTION, PR_MERGED and PR_DRAFT
 * @param {import('./status-target.mjs').StatusNames} statuses - status names configured for this workflow
 * @returns {string | null} the status the event asks for; null for an event that changes nothing
 * @remarks this is the event's own account, frozen when it fired. it is good enough to weigh a
 * problem (error or warning) and to honour a merge, but not to put a task in review.
 */
function statusFromEvent(env, statuses) {
  const action = env.EVENT_ACTION ?? '';
  if (!isStatusEvent(action)) {
    return null;
  }
  return statusForPullRequest(
    { open: action !== 'closed', merged: env.PR_MERGED === 'true', draft: env.PR_DRAFT === 'true' },
    statuses,
  );
}

/**
 * reads the pull request's current state from github.
 *
 * @param {CommandIo} io - reads GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_API_URL and PR_NUMBER
 * @returns {Promise<import('./status-target.mjs').PullRequestState>} the live state
 * @throws {Error} when the token, repository or number is missing, or github cannot be read
 */
async function readLivePullRequest(io) {
  const { env } = io;
  const token = env.GITHUB_TOKEN ?? '';
  if (token === '') {
    throw new Error('no GitHub token was given');
  }

  const github = createGitHubClient({
    token,
    fetchImpl: io.fetchImpl,
    apiUrl: env.GITHUB_API_URL || undefined,
    sleep: io.sleep,
  });
  return github.getPullRequest(env.GITHUB_REPOSITORY ?? '', Number(env.PR_NUMBER));
}

/**
 * decides what the run owes the task.
 *
 * @param {CommandIo} io - reads EVENT_ACTION and PR_MERGED, plus what readLivePullRequest reads
 * @param {string | null} eventStatus - the status the event asks for, by the event's own account
 * @param {import('./status-target.mjs').StatusNames} statuses - status names configured for this workflow
 * @returns {Promise<StatusDecision>} the status to set, nothing, or a problem
 * @remarks a merge event is taken at its word, because a merge cannot be undone. any other event
 * describes the pull request as it was when the event fired, and a run can start late or be
 * re-run by hand days later, so for those the state is read live from github. when it cannot be
 * read, an event that says "open" is not acted on unconfirmed.
 */
async function decideStatus(io, eventStatus, statuses) {
  const { env } = io;
  if (!isStatusEvent(env.EVENT_ACTION ?? '')) {
    return { targetStatus: null, problem: null };
  }
  if (env.PR_MERGED === 'true') {
    return { targetStatus: eventStatus, problem: null };
  }

  try {
    return { targetStatus: statusForPullRequest(await readLivePullRequest(io), statuses), problem: null };
  } catch (error) {
    if (eventStatus === null) {
      return { targetStatus: null, problem: null };
    }
    const reason = error instanceof Error ? error.message : 'unknown error';
    return {
      targetStatus: null,
      problem: `Could not confirm with GitHub that the pull request is still open (${reason}). Task status not changed. Re-run this job.`,
    };
  }
}

/**
 * finds the pull request's clickup task, publishes it for the link step, and brings its status in
 * line with the pull request.
 *
 * @param {CommandIo} io - reads BRANCH_NAME, PR_TITLE, CLICKUP_API_KEY, SECRETS_WITHHELD,
 * REVIEW_STATUS and MERGED_STATUS, plus what statusFromEvent and decideStatus read; writes the
 * outputs clickup_id, task_url and task_title
 * @returns {Promise<number>} 0 when the task is in step or nothing was owed; 1 when a status change
 * was owed and could not be made, so the check on the pull request goes red instead of failing silently
 * @remarks a problem finding the task is an error only on a run whose event asks for a status
 * change; on a push, a draft or a pull request closed without merging it is a warning. a missing
 * api key is not a problem at all on runs github denies secrets to by design (SECRETS_WITHHELD is
 * "true"). the pull request is read from github only once a task is found, and right before the
 * write.
 * @example
 * process.exitCode = await runSync({ env: process.env, fetchImpl: fetch, setOutput, log: console.log });
 */
export async function runSync(io) {
  const { env } = io;
  publishTask(io, null);

  const candidates = listTaskIdCandidates({ branch: env.BRANCH_NAME, title: env.PR_TITLE });
  if (candidates.length === 0) {
    emit(io, 'info', 'No ClickUp task ID in the title or branch name');
    return 0;
  }
  const named = candidates.join(', ');
  const statuses = { review: env.REVIEW_STATUS ?? '', merged: env.MERGED_STATUS ?? '' };
  const eventStatus = statusFromEvent(env, statuses);
  const eventOwesChange = eventStatus !== null;

  // a secret pasted with a stray space or newline is the same key; as a header value it would be refused
  const apiKey = (env.CLICKUP_API_KEY ?? '').trim();
  if (apiKey === '') {
    if (env.SECRETS_WITHHELD === 'true') {
      emit(io, 'info', `ClickUp task not looked up (${named}): pull requests from other repositories and from Dependabot are not given secrets`);
      return 0;
    }
    return reportProblem(io, eventOwesChange, `Cannot look up the ClickUp task (${named}): clickup_api_key is empty. Set the CLICKUP_API_KEY secret and pass it to the action.`);
  }

  const clickup = createClickUpClient({ apiKey, fetchImpl: io.fetchImpl, sleep: io.sleep });

  let task;
  try {
    task = await resolveTask(candidates, clickup);
  } catch (error) {
    return reportProblem(io, eventOwesChange, `Could not look up the ClickUp task (${named}): ${describeFailure(error)}`);
  }
  if (task === null) {
    emit(io, 'warning', `None of these is a ClickUp task the API key can see: ${named}. Nothing was changed.`);
    return 0;
  }
  publishTask(io, task);

  const decision = await decideStatus(io, eventStatus, statuses);
  if (decision.problem !== null) {
    emit(io, 'error', decision.problem);
    return 1;
  }
  if (decision.targetStatus === null) {
    emit(io, 'info', `ClickUp task ${task.id} left as "${task.status}": this event, or the pull request's state, calls for no status change`);
    return 0;
  }

  let result;
  try {
    result = await syncTaskStatus({ task, targetStatus: decision.targetStatus, client: clickup });
  } catch (error) {
    emit(io, 'error', `Could not move ClickUp task ${task.id} to "${decision.targetStatus}": ${describeFailure(error)}`);
    return 1;
  }

  switch (result.outcome) {
    case 'updated':
      emit(io, 'info', `Moved ClickUp task ${task.id} from "${result.from}" to "${result.to}"`);
      break;
    case 'unchanged':
      emit(io, 'info', `ClickUp task ${task.id} is already "${result.from}"`);
      break;
    case 'kept':
      emit(io, 'info', `ClickUp task ${task.id} left as "${result.from}": it is already further along than "${result.to}"`);
      break;
    default: {
      /** @type {never} */
      const unhandled = result.outcome;
      throw new Error(`unhandled sync outcome: ${unhandled}`);
    }
  }
  return 0;
}
