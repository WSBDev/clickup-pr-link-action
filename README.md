# ClickUp PR Link Action

Adds the ClickUp task link to a pull request description and keeps the task status in step with the pull request.

## Features

- Finds the ClickUp task ID in the branch name, the pull request title or the description
- Fetches task details from ClickUp API
- Automatically prepends task title and link to PR description
- Moves the task to **in review** when the pull request opens and to **complete** when it merges
- Idempotent - won't duplicate links, and leaves a task alone when it already has the right status
- A pull request with no task ID passes untouched
- A status change that is due but cannot be made fails the check, so a dead API key is visible

## Usage

### Add Workflow to Repositories

Create `.github/workflows/clickup-pr-link.yml` in each repository:

```yaml
name: Add ClickUp Link to PR

on:
  pull_request:
    types: [opened, reopened, ready_for_review, synchronize, closed]

concurrency:
  group: ${{ github.workflow }}-${{ github.event.pull_request.number }}
  cancel-in-progress: false

jobs:
  add-clickup-link:
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
      contents: read

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Add ClickUp task link to PR
        uses: WSBDev/clickup-pr-link-action@v1
        with:
          clickup_api_key: ${{ secrets.CLICKUP_API_KEY }}
          github_token: ${{ secrets.GITHUB_TOKEN }}
```

Two parts of this file matter for the status sync:

- The `closed` type. Without it the workflow never runs when a pull request merges.
- The `concurrency` block. It runs one event at a time per pull request, in order. Without it, a pull request merged seconds after it was opened can end with its task back in review, because the slower "opened" run finishes last.

The runner needs Node 20 or newer on its `PATH`. GitHub-hosted runners have it.

## Task Status Sync

| Pull request event | Task status |
|--------------------|-------------|
| Opened, reopened or marked ready for review | `review_status` (default `in review`) |
| Opened or reopened as a draft | No change until it is marked ready |
| Merged | `merged_status` (default `complete`) |
| Closed without merging | No change |
| New commits pushed, title or description edited | No change |

Status names are matched without regard to case. To use different names, or to switch one transition off, set the inputs:

```yaml
        with:
          clickup_api_key: ${{ secrets.CLICKUP_API_KEY }}
          github_token: ${{ secrets.GITHUB_TOKEN }}
          review_status: 'ready for testing'
          merged_status: ''   # empty string: merging changes nothing
```

The ClickUp account behind `CLICKUP_API_KEY` needs edit access to the tasks. Reading them is not enough.

### What a failed check means

| Log line | Meaning | Fix |
|----------|---------|-----|
| `Token invalid` (`OAUTH_025`) | The API key was revoked or regenerated | Put a current key in the `CLICKUP_API_KEY` secret |
| `clickup_api_key is empty` | The secret is not available to this repository | Grant the repository access to the organization secret |
| A status error from ClickUp | The task's list has no status with that name | Add the status to the list, or set `review_status` / `merged_status` |

A task that does not exist, or that the key cannot see, raises a warning and leaves the check green. This keeps a branch segment that only looks like an ID from blocking a pull request.

GitHub gives no secrets to pull requests from forks or from Dependabot. On those runs the status step is skipped and the check stays green.

## Task ID

The ID is taken from the first place that has one:

1. **Pull request title.** `#86bap82xd` or `CU-86bap82xd`.
2. **Branch name.** Any segment of 8-9 lowercase letters and digits that has at least one letter and one digit:
   - `86bap82xd/fix-auth`
   - `feature/86bap82xd-fix-auth`
   - `CU-86bap82xd_fix-auth_jane-doe`
3. **Pull request description.** `CU-86bap82xd` or a link such as `https://app.clickup.com/t/86bap82xd`.

Plain words (`portfolio`) and dates (`20261006`) are never read as IDs.

A branch segment is matched by shape alone, so a word such as `base64url` in a branch name also passes. Put `#id` or `CU-id` in the title when the branch contains a word like that: the title is checked first.

## Example Output

When a PR is created from a branch containing a ClickUp ID, the action will prepend:

```markdown
## 🎯 ClickUp Task

**[Implement user authentication](https://app.clickup.com/t/86bap82xd)**

---

[Original PR description follows...]
```

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `clickup_api_key` | ClickUp API key for reading task details and setting the task status | Yes | - |
| `github_token` | GitHub token for updating PR description | Yes | `${{ github.token }}` |
| `branch_name` | Branch name to extract ClickUp ID from | No | `${{ github.head_ref }}` |
| `review_status` | Status set when a PR is opened, reopened or marked ready. Empty string turns it off | No | `in review` |
| `merged_status` | Status set when a PR is merged. Empty string turns it off | No | `complete` |

## Outputs

| Output | Description |
|--------|-------------|
| `clickup_id` | Extracted ClickUp task ID |
| `task_url` | Full URL to the ClickUp task |

## Permissions

The workflow requires the following permissions:
- `pull-requests: write` - To update PR descriptions
- `contents: read` - To access repository information

## Troubleshooting

### No ClickUp ID found
- Ensure the branch name, title or description contains a task ID in one of the forms listed under [Task ID](#task-id)
- Check the action logs for the line `No ClickUp task ID in the branch name, title or description`

### Failed to fetch task details
- Verify the ClickUp API key has access to the workspace/space containing the task
- Check that the task ID is valid and exists in ClickUp
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
| `src/task-id.mjs` | Finds the task ID in a branch name, title or description |
| `src/status-target.mjs` | Maps a pull request event to the status the task should take |
| `src/clickup-client.mjs` | Reads a task and sets its status through the ClickUp API |
| `src/sync-status.mjs` | Brings one task to its target status |
| `src/commands.mjs` | The two commands `action.yml` runs: `extract` and `sync-status` |
| `src/main.mjs` | Entry point: picks the command and wires it to the workflow environment |

### Tests

Requires Node 20 or newer.

```bash
npm test
```

Tests never call ClickUp. They run against canned replies from `test-support/fake-fetch.mjs`.

### Publishing Updates

1. Make the change with its tests and confirm `npm test` passes
2. Merge to `main`
3. Create a new release with semantic versioning
4. Move the `v1` tag to the release so every repository on `@v1` picks it up

## License

MIT License - see LICENSE file for details

## Author

Lex Dyer
