---
name: task-status
description: Change a tracked task's status in the "Ai Tasks" Google Sheet to To Do, In Progress, Pending or Blocked, with a remark. Use during a /work-from-everywhere task when you start it, need the user (Pending), or can't continue (Blocked).
argument-hint: <To Do|In Progress|Pending|Blocked> [remark]
allowed-tools:
  - Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/tracker.mjs" *)
---

# Change a task's status

$ARGUMENTS

| Status | Use when |
|---|---|
| To Do | The task is logged but not started |
| In Progress | You're working on it |
| Pending | You need the user to do or answer something before you can continue. The remark says what you need |
| Blocked | Something happened that stops the task. The remark says what happened |

Complete is set only by the `task-done` skill, because it needs proof.

Run this with the Bash tool, on its own and with the quoting shown:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/tracker.mjs" status --data "${CLAUDE_PLUGIN_DATA}" --session "${CLAUDE_SESSION_ID}" --status '<status>' --remark '<remark>'
```

- Leave out `--remark` when there's nothing to add, for example when going back to In Progress. Each remark is added to the Remark cell on a new timestamped line, and earlier remarks stay.
- This updates the session's current task. For a different task, add `--module '<module>' --task <number>`.
- Write a single quote inside a value as `'\''`. Don't start a value with `/`, because Git Bash turns it into a Windows path.
- If the output has `"code": "auth"`, the Google sign-in expired. Ask the user to run `gws auth login -s drive,sheets` in a terminal, then run the command again.
