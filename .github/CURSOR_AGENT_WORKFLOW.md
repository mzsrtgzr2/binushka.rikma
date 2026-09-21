# Cursor Agent issue workflow

This repository can accept plain-language GitHub Issues and let Cursor prepare a pull request.

## Setup

Add these repository secrets in GitHub Actions:

- `CURSOR_API_KEY` - Cursor API key or service account key used by the Cursor CLI.
- `PAT_GITHUB` - Fine-grained GitHub token that can read/write repository contents, issues, and pull requests.

Optional repository variable:

- `CURSOR_MODEL` - Cursor model name to use in the workflows. Defaults to `auto`. Do not
  set this to `gpt-5`; this Cursor CLI account does not expose that model id.
- `CURSOR_AGENT_ALLOWED_USERS` - comma- or whitespace-separated GitHub usernames allowed to
  create Cursor tasks, request PR changes, or approve merges. If this is not set, only the
  repository owner is allowed.

For example:

```text
mzsrtgzr2,sisters-github-username
```

Repository settings:

- Enable GitHub Actions for the repository.
- Enable auto-merge if you want `/approve` to queue a squash merge while checks are still running.
- Keep Vercel connected to the repository. Vercel will create PR previews automatically from pushed branches.

## Request flow

1. Open a new issue using the **Ask Cursor to make a site change** issue form.
2. The issue gets the `cursor-task` label.
3. `.github/workflows/cursor-agent-issue.yml` verifies that the issue author is listed in
   `CURSOR_AGENT_ALLOWED_USERS`.
4. The workflow runs Cursor on a new branch named `cursor/issue-<number>`.
5. If Cursor changes files, the workflow commits, pushes, and opens a pull request.
6. The workflow comments on the original issue and tells the requester to keep the
   conversation there.
7. When Vercel posts its PR preview comment, the feedback workflow copies the preview link
   back to the original issue.

## Feedback flow

Comment on the original issue with plain-language feedback, for example:

```text
The button looks good on desktop, but please make it full width on mobile.
```

`.github/workflows/cursor-agent-feedback.yml` finds the matching Cursor PR branch, runs Cursor
with that issue comment as the follow-up request, commits any changes, and pushes the branch
so Vercel rebuilds the preview. The workflow comments back on the issue immediately when
feedback is accepted so reviewers can see that Cursor started working.

Authorized user comments are limited to GitHub usernames listed in `CURSOR_AGENT_ALLOWED_USERS`.
Vercel bot preview comments are copied back to the issue. Other bot comments are ignored to avoid workflow loops. Cursor's own status replies
("received this feedback", "pushed an update", etc.) are also ignored, because
`PAT_GITHUB` posts them as the repository owner rather than as a Bot account.

## Approval flow

When the Vercel preview looks good, comment on the original issue:

```text
/approve
```

The feedback workflow will run:

```bash
gh pr merge --squash --auto --delete-branch
```

If auto-merge is enabled and GitHub allows the PR to merge, GitHub will merge it in the background once checks pass.
