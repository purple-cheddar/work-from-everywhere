---
name: work-from-everywhere
description: Run a task end to end with tracking. Logs it in the "Ai Tasks" Google Sheet, does the work, captures screenshot and video proof, files the proof in the "Agent Tasks" Google Drive folder, and marks the task Complete. Use when the user runs /work-from-everywhere followed by a task.
argument-hint: <task to do>
disable-model-invocation: true
shell: bash
allowed-tools:
  - Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/setup.mjs" *)
  - Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/tracker.mjs" *)
  - Bash(echo *)
---

# Tracked task

**Task:** $ARGUMENTS

Do this task while keeping its row in the **Ai Tasks** Google Sheet up to date, then deliver proof. These instructions apply for the whole task, including later turns.

- Session ID: `${CLAUDE_SESSION_ID}`
- Project config: `${CLAUDE_PROJECT_DIR}/.claude/work-from-everywhere.json`. Read it for `module` and `baseUrl`. If it doesn't exist, run the `task-setup` skill first.
- Run tracker commands with the **Bash tool**, each on its own and with the quoting shown, so they run without a permission prompt. Put values in single quotes, and write a single quote inside a value as `'\''`. Don't start a value with `/`, because Git Bash turns it into a Windows path: write `Cart page (/cart)`, not `/cart page`. Each command prints JSON: check `ok`, and if it's false show the `error` to the user.

## 0. Setup check

This check ran when the user started the task:

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/setup.mjs" preflight --data "${CLAUDE_PLUGIN_DATA}" || echo '{"ok":false,"mode":"node-missing","message":"Node.js could not run the setup check. The plugin needs Node.js 18 or later."}'`

- `ok` is true: go on to step 1.
- `mode` is `setup-needed`, `node-missing` or `error`: run the `task-setup` skill to walk the user through setup, then continue with step 1.
- The `google-sign-in` check failed: tell the user their Google sign-in has expired or is missing (many company accounts must sign in again every 16 hours). Ask them to run `gws auth login -s drive,sheets` in a terminal and tell you when it's done. Then check again, and continue once `ok` is true:

  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/scripts/setup.mjs" preflight --data "${CLAUDE_PLUGIN_DATA}"
  ```

- The `google-connection` check failed: Google couldn't be reached. Tell the user, and ask whether to try again or do the task without tracking.
- Any other check failed: run the `task-setup` skill.

## 1. Log the task

1. Write a **title** of under 60 characters (it also names the task's Drive folder) and a **description** of one to three sentences saying what will be delivered.
2. Work out the **context source**: the link the task came from (ticket, issue, doc or email) if it mentions one, otherwise `Chat: <one-line summary of the request>`.
3. Add the row:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/tracker.mjs" start --data "${CLAUDE_PLUGIN_DATA}" --session "${CLAUDE_SESSION_ID}" --module '<module>' --title '<title>' --description '<description>' --context '<context source>'
   ```

   If another task from this session is still In Progress, add `--status 'To Do'` and finish that task first. Then set this one to In Progress with the `task-status` skill and start it.
4. Tell the user the task number and the `spreadsheetUrl`, in one line.

## 2. Do the work

Work on the task as usual. Keep the status honest with the `task-status` skill:

- **Pending**: you need the user to do or answer something before you can continue. Put what you need in the remark, then ask the user. When they reply, set the task back to **In Progress**.
- **Blocked**: something happened that stops the task. Put what happened in the remark.

## 3. Deliver

When the work is finished and you've checked that it works:

1. Run the `task-proof` skill to capture screenshots and video, or logs for a task without a UI.
2. Run the `task-done` skill to upload the proof, share it and mark the task Complete.
3. End with a short summary: what changed, the Proof Link and the sheet link.

## Rules

- The user approved these Google Workspace writes for this workflow: finding or creating the Agent Tasks folder, the Ai Tasks spreadsheet and the module tab; creating task folders and uploading proof; sharing each task folder as "Anyone with the link"; and updating the task's row. Don't ask before these, even though the gws skills say to confirm every write. Never delete Drive files or sheet rows.
- If a tracker command returns `"code": "auth"`, the Google sign-in expired partway through the task. Ask the user to run `gws auth login -s drive,sheets` in a terminal, wait until they say it's done, then run the same command again.
- If you lose track of the task number, for example after the conversation is compacted, list this session's tasks:

  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/scripts/tracker.mjs" show --data "${CLAUDE_PLUGIN_DATA}" --session "${CLAUDE_SESSION_ID}"
  ```
