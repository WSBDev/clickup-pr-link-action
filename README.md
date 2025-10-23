# ClickUp PR Link Action

Automatically add ClickUp task links and titles to your pull request descriptions.

## Features

- Extracts ClickUp task IDs from branch names (supports any position in the name)
- Fetches task details from ClickUp API
- Automatically prepends task title and link to PR description
- Idempotent - won't duplicate links if already present
- Gracefully handles missing ClickUp IDs or API failures

## Usage

### 1. Add Workflow to Repositories

Create `.github/workflows/clickup-pr-link.yml` in each repository:

```yaml
name: Add ClickUp Link to PR

on:
  pull_request:
    types: [opened, reopened]

jobs:
  add-clickup-link:
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
      contents: read

    steps:
      - name: Add ClickUp task link to PR
        uses: WSBDev/clickup-pr-link-action@v1
        with:
          clickup_api_key: ${{ secrets.CLICKUP_API_KEY }}
          github_token: ${{ secrets.GITHUB_TOKEN }}
```

## Branch Naming

The action automatically detects ClickUp task IDs in branch names. ClickUp IDs are typically 8-9 character alphanumeric strings.

Supported formats:
- `feature-86bap82xd`
- `86bap82xd-fix-auth`
- `fix/86bap82xd/login`
- `bugfix/auth/86bap82xd`

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
| `clickup_api_key` | ClickUp API key for fetching task details | Yes | - |
| `github_token` | GitHub token for updating PR description | Yes | `${{ github.token }}` |
| `branch_name` | Branch name to extract ClickUp ID from | No | `${{ github.head_ref }}` |

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
- Ensure your branch name contains a valid ClickUp task ID (8-9 alphanumeric characters)
- Check the action logs for the detected branch name

### Failed to fetch task details
- Verify the ClickUp API key has access to the workspace/space containing the task
- Check that the task ID is valid and exists in ClickUp
- Ensure the API key is correctly stored in GitHub secrets (this is currently Lex's PAT - check if she rotated it)

### PR description not updated
- Verify the `GITHUB_TOKEN` has `pull-requests: write` permission
- Check if the link already exists (action is idempotent)

## Development

### Local Testing

To test the extraction logic locally:

```bash
# test clickup id extraction
BRANCH="feature-86bap82xd"
echo "$BRANCH" | grep -oE '[a-z0-9]{8,9}' | head -n 1
```

### Publishing Updates

1. Make changes to `action.yml`
2. Commit and push changes
3. Create a new release with semantic versioning
4. Update the `@v1` tag to point to the latest release

## License

MIT License - see LICENSE file for details

## Author

Lex Dyer
