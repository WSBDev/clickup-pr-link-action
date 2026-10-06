# ClickUp PR Link Action

Adds the ClickUp task link to a pull request description and keeps the task status in step with the pull request.

## Features

- Finds the ClickUp task for a pull request from its title or branch name
- Automatically prepends task title and link to PR description
- Moves the task to **in review** when the pull request opens and to **complete** when it merges
- Idempotent - won't duplicate links, and leaves a task alone when it already has the right status
- A pull request with no task ID passes untouched
- A status change that is due but cannot be made fails the check, so a dead API key is visible

## Usage

### Add Workflow to Repositories

Create `.github/workflows/clickup-pr-link.yml` in each repository. The same file is in [`examples/clickup-pr-link.yml`](examples/clickup-pr-link.yml).

```yaml
name: Add ClickUp Link to PR

on:
  pull_request:
    types: [opened, reopened, ready_for_review, synchronize, closed]

jobs:
  add-clickup-link:
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
      contents: read

    steps:
      - name: Add ClickUp task link to PR
        uses: WSBDev/clickup-pr-link-action@v2
        with:
          clickup_api_key: ${{ secrets.CLICKUP_API_KEY }}
          github_token: ${{ secrets.GITHUB_TOKEN }}
```

The `closed` type is required: without it the workflow never runs when a pull request merges, and the task never reaches the merged status.

Keep the trigger as `pull_request`. Do not use `pull_request_target`: it hands secrets to pull requests from forks, and a fork's title would then choose which task gets moved.

The runner needs Node 20 or newer on its `PATH`. GitHub-hosted runners have it. The action is tested on github.com only.

### Upgrading from v1

`v1` only added the link. `v2` also changes task statuses and can fail the check, so it is a separate tag and nothing changes for a repository until its workflow file is edited:

1. Change `@v1` to `@v2`.
2. Add `closed` to the `types` list.
3. The `actions/checkout` step is no longer needed and can be removed.

What else differs from `v1`:

- The ClickUp account behind `CLICKUP_API_KEY` must have edit access to the tasks. Under `v1` read access was enough.
- The outputs `clickup_id` and `task_url` are filled only once ClickUp confirms the task. Under `v1` they came from the branch name alone. They are empty for pull requests from forks and from Dependabot, and while ClickUp cannot be reached.
- The heading written into the pull request description is `## ClickUp Task`, without the emoji.

## Task Status Sync

After a pull request is opened, reopened, marked ready for review or closed, the action reads the pull request's current state from GitHub and sets the task status to match it:

| Pull request is | Task status |
|-----------------|-------------|
| Open and not a draft | `review_status` (default `in review`) |
| An open draft | No change until it is marked ready |
| Merged | `merged_status` (default `complete`) |
| Closed without merging | No change |

New commits and edits to the title or description never change the status, so a status set by hand survives a push.

Two rules keep the result right when runs start late, finish out of order or are re-run by hand:

- **The pull request's state now decides, not the event that started the run.** A merge event is taken at its word, since a merge cannot be undone. For every other event the state is read from GitHub, so an old "opened" run that executes after the merge aims for the merged status.
- **A task only ever moves forward** in the order of its list's statuses. A task that is already further along than the target is left where it is. So a completed task is never put back in review, and a task someone moved on after the merge is not dragged back by a re-run. The task is read again right before the write.

ClickUp has no conditional write, so two runs writing within the same instant can still cross. That takes a merge landing between one run's last read and its write.

Things to know:

- Merging into any branch counts as merged, not only into the default branch.
- A new pull request for a task that is already complete leaves it complete. Move the task back by hand if the work has reopened; the next pull request event then moves it forward again.
- The order used is the list's own status order in ClickUp. If "in review" sits after "complete" in a list, the merge will not move the task.
- The task ID has to be findable when the pull request is opened or marked ready. An ID added to the title later takes effect at the next of those events, or at merge. Re-running an old job does not see a title edited since.

Status names are matched without regard to case. To use different names, or to switch one change off, set the inputs:

```yaml
        with:
          clickup_api_key: ${{ secrets.CLICKUP_API_KEY }}
          github_token: ${{ secrets.GITHUB_TOKEN }}
          review_status: 'ready for testing'
          merged_status: ''   # empty string: merging changes nothing
```

### What a failed check means

The check fails only when a status change was due and could not be made.

| Log line | Meaning | Fix |
|----------|---------|-----|
| `Token invalid` (`OAUTH_025`) | The API key was revoked or regenerated | Put a current key in the `CLICKUP_API_KEY` secret |
| `clickup_api_key is empty` | The secret is not available to this repository | Grant the repository access to the organization secret |
| `The task's list has no status named ...` | The task's list has no status with that name | Add the status to the list, or set `review_status` / `merged_status` |
| `request got no answer` | Network failure or timeout after three attempts | Re-run the job |
| `Could not confirm with GitHub that the pull request is still open` | GitHub could not be read, so "in review" was not applied on the word of the event alone | Re-run the job |

These leave the check green:

- **No visible task.** None of the IDs found is a task the key can see. A warning is raised.
- **Nothing owed.** On a push, a draft, or a pull request closed without merging, the same problems are warnings.
- **No secrets by design.** GitHub gives no secrets to pull requests from other repositories or from Dependabot. The task is not looked up.

Calls to ClickUp and GitHub are retried twice on a rate limit, a server error or a network failure. After a rate limit the wait lasts until the limit resets, up to one minute.

## Task ID

The action collects every candidate ID, then asks ClickUp which one is a real task. The first one ClickUp knows is used. Candidates are tried in this order:

1. **Branch name.** Any segment of 8-9 lowercase letters and digits that has at least one letter and one digit:
   - `86bap82xd/fix-auth`
   - `feature/86bap82xd-fix-auth`
   - `CU-86bap82xd_fix-auth_jane-doe`
2. **Pull request title.** `#86bap82xd` or `CU-86bap82xd`.

The branch goes first because a branch is cut for one task, while a title may mention another ("Follow-up to #86bap82xd"). The title covers branches that carry no task ID.

In a branch name, plain words (`portfolio`) and dates (`20261006`) are never candidates. A word that merely has the shape of an ID, such as `base64url` in a branch name or a hex colour after `#` in a title, is a candidate, but ClickUp does not know it, so the next candidate is used. At most five candidates are looked up.

The description is not searched. Descriptions routinely mention other tasks (related work, the tasks in a release), and the action changes the status of whichever task it settles on.

## Example Output

When a PR is created from a branch containing a ClickUp ID, the action will prepend:

```markdown
## ClickUp Task

**[Implement user authentication](https://app.clickup.com/t/86bap82xd)**

---

[Original PR description follows...]
```

The section is added once. It is skipped when the description already links to the task.

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `clickup_api_key` | ClickUp API key for reading the task and setting its status | Yes | - |
| `github_token` | GitHub token for reading the PR state and updating the PR description | Yes | `${{ github.token }}` |
| `branch_name` | Branch name to look for a ClickUp ID in | No | `${{ github.head_ref }}` |
| `review_status` | Status set when a PR is opened, reopened or marked ready. Empty string turns it off | No | `in review` |
| `merged_status` | Status set when a PR is merged. Empty string turns it off | No | `complete` |

## Outputs

| Output | Description |
|--------|-------------|
| `clickup_id` | ClickUp task ID the PR was matched to; empty when there is none |
| `task_url` | Full URL to the ClickUp task |

## Permissions

The workflow requires the following permissions:
- `pull-requests: write` - To update PR descriptions
- `contents: read` - To access repository information

## Troubleshooting

### No ClickUp ID found
- Ensure the title or branch name contains a task ID in one of the forms listed under [Task ID](#task-id)
- Check the action logs for the line `No ClickUp task ID in the title or branch name`

### Task not found
- The log line `None of these is a ClickUp task the API key can see` lists the IDs that were tried
- Verify the ClickUp API key has access to the workspace/space containing the task
- Ensure the API key is correctly stored in GitHub secrets (this is currently Lex's PAT - check if she rotated it)

### PR description not updated
- Verify the `GITHUB_TOKEN` has `pull-requests: write` permission
- Check if the link already exists (action is idempotent)

### Task status not updated
- Check that the workflow lists `closed` in its `pull_request` types; without it a merge is never seen
- A draft pull request moves its task only once it is marked ready for review
- See [What a failed check means](#what-a-failed-check-means)

## Development

The action is a composite action. Its logic lives in `src/` as plain Node modules with no dependencies and no build step.

| File | Purpose |
|------|---------|
| `src/task-id.mjs` | Lists the candidate task IDs in a title and branch name |
| `src/resolve-task.mjs` | Asks ClickUp which candidate is a real task |
| `src/status-target.mjs` | Maps a pull request's state to the status its task should have |
| `src/sync-status.mjs` | Moves one task forward to its target status, never backward |
| `src/clickup-client.mjs` | Reads a task and its list's statuses, and sets a status, through the ClickUp API |
| `src/github-client.mjs` | Reads a pull request's current state through the GitHub API |
| `src/http.mjs` | Sends one JSON request with retries, and keeps secrets out of error text |
| `src/commands.mjs` | The command `action.yml` runs: resolve the task, publish it, sync its status |
| `src/main.mjs` | Entry point: wires the command to the workflow environment |

The step that edits the pull request description is still shell, in `action.yml`.

### Tests

Requires Node 20 or newer.

```bash
npm test
```

Tests never call ClickUp or GitHub and never wait on a real timer. They run against canned replies from `test-support/`.

### Publishing Updates

1. Make the change with its tests and confirm `npm test` passes
2. Merge to `main`
3. Create a new release with semantic versioning
4. Move the `v2` tag to the release so every repository on `@v2` picks it up

## License

MIT License - see LICENSE file for details

## Author

Lex Dyer
