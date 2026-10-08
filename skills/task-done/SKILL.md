---
name: task-done
description: Deliver a finished /work-from-everywhere task. Commits the work to the task's branch, pushes it and opens a GitHub pull request, uploads its proof to the "Agent Tasks" Google Drive folder, shares it as "Anyone with the link", and marks the task Complete in the "Ai Tasks" sheet with the proof and pull request links. Use after task-proof, and when the user asks to deliver a tracked task, open its pull request or upload its proof again.
user-invocable: false
allowed-tools:
  - Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/tracker.mjs" *)
---

# Deliver the task

Run each command with the Bash tool, on its own and with the quoting shown. Write a single quote inside a value as `'\''`. Don't start a value with `/`, because Git Bash turns it into a Windows path.

Both commands act on the session's current task. For a different task, add `--module '<module>' --task <number>`.

## 1. Open the pull request

Skip this step when the task has no branch (the project config has `"pullRequests": false`, or the branch step was skipped).

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/tracker.mjs" pr --data "${CLAUDE_PLUGIN_DATA}" --session "${CLAUDE_SESSION_ID}" --repo "${CLAUDE_PROJECT_DIR}" --message '<commit message>' --summary '<pull request description>'
```

- `--message`: the commit message for the task's uncommitted changes. A short subject line, then a blank line and the details, in the repository's usual style, with any attribution lines your instructions ask for.
- `--summary`: the start of the pull request's description. What changed and why, and how it was checked, in a few lines or bullets. The command adds the task's sheet link and a proof line below it.

It commits every uncommitted change in the repository to the task branch, pushes the branch to `origin`, opens a pull request that's ready for review against the branch the task started from, and puts its link in the task's PR Link column. Running it again pushes new commits and reuses the open pull request.

- `prUrl`: the pull request.
- `skipped`: no pull request was opened, and the reason says why (no changes, no `origin` remote, the remote isn't GitHub, or `gh` is missing or signed out). Tell the user the reason in one line, and go on to step 2. When the fix is the user's, such as `gh auth login`, mention it.
- A failed commit (for example a pre-commit hook) or push: fix the cause if it's in the task's code and run the command again, otherwise set the task Blocked with the error.

## 2. Upload the proof and mark the task Complete

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/tracker.mjs" done --data "${CLAUDE_PLUGIN_DATA}" --session "${CLAUDE_SESSION_ID}" --proof-dir '<PROOF_DIR>' --remark '<one line on what was delivered>'
```

It does five things:

1. Finds or creates `Agent Tasks / <module> / <NNN> - <title>` in Google Drive.
2. Uploads everything in PROOF_DIR. Subfolders become Drive subfolders, and files already in Drive are skipped. After retaking proof, add `--replace` to overwrite them.
3. Shares the task folder as "Anyone with the link", view only. If the Google Workspace admin blocks public links, it shares with the user's company domain instead and says so in the remark.
4. Sets the row to Complete, with the Complete Datetime, Proof Link and remark.
5. Puts the proof link in the pull request's description, when the task has one. A `prNote` in the output means that failed; mention it.

Then give the user the `prUrl` and the `proofLink` from the output, each on its own line. If `sharing` is `domain`, tell them public links were blocked and that only people in their company can open it.

If the output has `"code": "auth"`, the Google sign-in expired. Sign the user in as the "Google sign-in" section of the work-from-everywhere skill describes, then run the same command again; files that already uploaded are skipped.
