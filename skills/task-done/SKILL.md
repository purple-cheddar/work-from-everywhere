---
name: task-done
description: Deliver a finished /work-from-everywhere task. Uploads its proof to the "Agent Tasks" Google Drive folder, shares it as "Anyone with the link", and marks the task Complete in the "Ai Tasks" sheet with the proof link. Use after task-proof, and when the user asks to deliver a tracked task or upload its proof again.
user-invocable: false
allowed-tools:
  - Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/tracker.mjs" *)
---

# Deliver the task

Run this with the Bash tool, on its own and with the quoting shown:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/tracker.mjs" done --data "${CLAUDE_PLUGIN_DATA}" --session "${CLAUDE_SESSION_ID}" --proof-dir '<PROOF_DIR>' --remark '<one line on what was delivered>'
```

Write a single quote inside a value as `'\''`. Don't start a value with `/`, because Git Bash turns it into a Windows path.

It does four things:

1. Finds or creates `Agent Tasks / <module> / <NNN> - <title>` in Google Drive.
2. Uploads everything in PROOF_DIR. Subfolders become Drive subfolders, and files already in Drive are skipped. After retaking proof, add `--replace` to overwrite them.
3. Shares the task folder as "Anyone with the link", view only. If the Google Workspace admin blocks public links, it shares with the user's company domain instead and says so in the remark.
4. Sets the row to Complete, with the Complete Datetime, Proof Link and remark.

It delivers the session's current task. For a different task, add `--module '<module>' --task <number>`.

Then give the user the `proofLink` from the output. If `sharing` is `domain`, tell them public links were blocked and that only people in their company can open it.

If the output has `"code": "auth"`, the Google sign-in expired. Ask the user to run `gws auth login -s drive,sheets` in a terminal, then run the same command again; files that already uploaded are skipped.
