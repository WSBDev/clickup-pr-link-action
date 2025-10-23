# Setup Guide

Complete step-by-step guide to deploy this action across your GitHub organization.

## Phase 1: Prepare ClickUp API Access

### Step 1: Create Service Account in ClickUp

1. Create a new user in your ClickUp workspace:
   - Email: `github-bot@yourdomain.com` (or similar)
   - Name: "GitHub Integration Bot"

2. Assign appropriate permissions:
   - Add to relevant spaces/folders
   - Grant **View** and **Read** permissions (minimum required)

3. Log in as the service account user

4. Generate API key:
   - Navigate to https://app.clickup.com/settings/apps
   - Click **Generate** under API Token
   - Copy the API key (starts with `pk_`)

### Step 2: Store API Key in GitHub Organization

1. Navigate to your GitHub organization settings:
   ```
   https://github.com/organizations/YOUR_ORG/settings/secrets/actions
   ```

2. Click **New organization secret**

3. Configure the secret:
   - **Name:** `CLICKUP_API_KEY`
   - **Secret:** Paste your ClickUp API key
   - **Repository access:** Select "All repositories" or choose specific repos

4. Click **Add secret**

## Phase 2: Publish the GitHub Action

### Step 1: Create GitHub Repository

You can use the provided repository or create a new one:

```bash
cd clickup-pr-link-action

# initialize git repository
git init
git add .
git commit -m "Initial commit: ClickUp PR Link action"

# create github repository (replace YOUR_ORG with your organization name)
gh repo create YOUR_ORG/clickup-pr-link-action --public --source=. --remote=origin --push
```

**Note:** You can use `--private` instead of `--public` if you prefer a private action.

### Step 2: Create Release

1. Navigate to the repository on GitHub
2. Click **Releases** → **Create a new release**
3. Configure the release:
   - **Tag:** `v1.0.0`
   - **Release title:** `v1.0.0 - Initial Release`
   - **Description:** "Initial release of ClickUp PR Link action"
4. Click **Publish release**

5. Create the `v1` tag to point to this release:
   ```bash
   git tag v1 v1.0.0
   git push origin v1
   ```

This allows repositories to use `@v1` and automatically get patch updates.

## Phase 3: Deploy to Repositories

### Option A: Manual Deployment (Recommended for Testing)

Test with one repository first:

1. Choose a test repository
2. Create `.github/workflows/clickup-pr-link.yml`:

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
        uses: YOUR_ORG/clickup-pr-link-action@v1
        with:
          clickup_api_key: ${{ secrets.CLICKUP_API_KEY }}
          github_token: ${{ secrets.GITHUB_TOKEN }}
```

3. Commit and push the workflow file
4. Test by creating a PR from a branch with a ClickUp ID

### Option B: Organization-Wide Deployment

Once tested, roll out to all repositories:

#### Using GitHub CLI (Recommended)

```bash
# list all repos in your organization
gh repo list YOUR_ORG --limit 1000 --json name -q '.[].name' > repos.txt

# for each repo, create the workflow file
while read repo; do
  echo "Adding workflow to $repo"

  # clone repo
  gh repo clone YOUR_ORG/$repo temp-repo
  cd temp-repo

  # create workflow directory and file
  mkdir -p .github/workflows
  cp ../clickup-pr-link-action/.github/workflows/example.yml .github/workflows/clickup-pr-link.yml

  # update YOUR_ORG placeholder
  sed -i 's/YOUR_ORG/YOUR_ACTUAL_ORG_NAME/g' .github/workflows/clickup-pr-link.yml

  # commit and push
  git add .github/workflows/clickup-pr-link.yml
  git commit -m "Add ClickUp PR link automation"
  git push

  cd ..
  rm -rf temp-repo
done < repos.txt
```

#### Using a Script

Create `deploy-to-all-repos.sh`:

```bash
#!/bin/bash

ORG="YOUR_ORG"
WORKFLOW_FILE="clickup-pr-link.yml"

# get all repos
repos=$(gh repo list $ORG --limit 1000 --json name -q '.[].name')

for repo in $repos; do
  echo "Processing $ORG/$repo"

  # clone repo
  git clone "https://github.com/$ORG/$repo.git" temp-repo
  cd temp-repo

  # create workflow
  mkdir -p .github/workflows
  cat > .github/workflows/$WORKFLOW_FILE <<EOF
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
        uses: $ORG/clickup-pr-link-action@v1
        with:
          clickup_api_key: \${{ secrets.CLICKUP_API_KEY }}
          github_token: \${{ secrets.GITHUB_TOKEN }}
EOF

  # commit and push
  git add .github/workflows/$WORKFLOW_FILE
  git commit -m "Add ClickUp PR link automation"
  git push

  cd ..
  rm -rf temp-repo

  echo "✓ Added workflow to $repo"
done
```

Make executable and run:
```bash
chmod +x deploy-to-all-repos.sh
./deploy-to-all-repos.sh
```

## Phase 4: Test and Verify

### Test the Action

1. Choose a repository with the workflow installed
2. Create a branch with a ClickUp ID:
   ```bash
   git checkout -b feature-86bap82xd
   ```
3. Make a change and push
4. Create a pull request
5. Verify the PR description includes the ClickUp link

### Expected Behavior

When the action runs successfully:
- ✓ Extracts ClickUp ID from branch name
- ✓ Fetches task details from ClickUp API
- ✓ Prepends task title and link to PR description

### Troubleshooting

If the action fails, check:
1. GitHub Actions logs for error messages
2. ClickUp API key is correctly stored in organization secrets
3. Service account has access to the ClickUp task
4. Branch name contains a valid ClickUp task ID

## Phase 5: Maintenance

### Updating the Action

When making improvements:

1. Make changes to `action.yml`
2. Commit and push changes
3. Create a new release (e.g., `v1.1.0`)
4. Update the `v1` tag:
   ```bash
   git tag -f v1 v1.1.0
   git push origin v1 --force
   ```

All repositories using `@v1` will automatically use the updated version.

### Monitoring

Monitor action usage across your organization:
- GitHub Insights → Actions
- Check for failed workflows
- Review action logs for common issues

## Security Considerations

- ✓ Use a dedicated service account for API access
- ✓ Grant minimum required permissions in ClickUp
- ✓ Store API keys as organization secrets, never commit them
- ✓ Regularly rotate API keys (recommended: every 90 days)
- ✓ Monitor API key usage in ClickUp settings
- ✓ Review which repositories have access to the `CLICKUP_API_KEY` secret

## Support

For issues or questions:
- Check the troubleshooting section in README.md
- Review GitHub Actions logs
- Open an issue in the action repository
