---
name: task-setup
description: Check and set up everything the work-from-everywhere plugin needs on this machine (Node.js, the gws CLI and its Google sign-in, Playwright and its browsers), walking the user through each missing piece, then save the project's module name and app URL. Use on the first /work-from-everywhere run on a machine, when its setup check fails, or when the user asks to set up the plugin or change the project config.
allowed-tools:
  - Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/setup.mjs" *)
  - Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/tracker.mjs" *)
---

# Set up the plugin

Run each command with the Bash tool, on its own and with the quoting shown.

## 1. Check this machine

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/setup.mjs" check --data "${CLAUDE_PLUGIN_DATA}"
```

The first run can take a minute, because it signs in to Google and opens each browser once. It prints every check with `ok`. A failed check also has `who` and `fix`, and `skipped` checks wait on an earlier one.

If the command can't run because `node` is missing or older than 18, start with the Node.js row in the table below, then run the check again.

Skip to step 3 when you came here only because the project config is missing and the setup check at the start of the task passed.

## 2. Fix what failed, one step at a time

Take the failed checks in the order listed. For each one:

1. Tell the user in a sentence what's missing and why the plugin needs it.
2. Give the fix as numbered steps with exact commands, based on the check's `fix`:
   - `who` is `user`: the user does it, because it needs their browser, their Google account or an installer. Ask them to tell you when it's done.
   - `who` is `claude`: offer to do it, say what it downloads, and run it once the user agrees.
3. Run the check again before moving on, since fixing one step can unblock skipped ones.

| Check | What it is | Fix |
|---|---|---|
| `node` | Node.js 18 or later, which runs the plugin's scripts and hooks | The user installs the LTS from https://nodejs.org (Windows: `winget install OpenJS.NodeJS.LTS`; macOS: `brew install node`), then restarts Claude |
| `npm` | Node's package manager, used to install gws and Playwright | Comes with Node.js. Reinstall Node.js |
| `git-bash` | Windows only. The shell the plugin's commands run in | The user installs Git for Windows from https://git-scm.com/download/win, then restarts Claude |
| `gws` | The Google Workspace CLI | With the user's OK: `npm install -g @googleworkspace/cli` |
| `google-oauth-client`, `google-sign-in`, `google-scopes`, `google-apis`, `google-sheets` | Access to the user's Google Drive and Sheets | Read `${CLAUDE_SKILL_DIR}/google-sign-in.md` and walk the user through the step the `fix` names |
| `google-connection` | Google couldn't be reached | Ask the user to check their internet connection |
| `playwright` | The browser automation library for screenshots | The `fix` command, with the user's OK (about 13 MB) |
| `chromium`, `webkit`, `video` | The browsers and the video encoder Playwright drives | The `fix` command, with the user's OK (a few hundred MB). On Linux, a missing-dependencies fix is a `sudo` command the user runs |

A check with a `warning` still passes; mention the warning once.

When every check passes, the output shows `setupSaved: true`: the machine is recorded as set up in the plugin's data folder. From then on, `/work-from-everywhere` only checks the Google sign-in on each run. Run this skill again at any time to recheck everything.

## 3. Project config

Create or update `${CLAUDE_PROJECT_DIR}/.claude/work-from-everywhere.json`:

```json
{
  "module": "Checkout",
  "baseUrl": "http://localhost:3000",
  "startCommand": "npm run dev",
  "login": []
}
```

- `module` (required) names the task's Drive folder and sheet tab. Suggest one from the repository or folder name, and confirm it with the user.
- `baseUrl` and `startCommand` say where the app runs and how to start it, for UI screenshots. Suggest values from package.json scripts, the framework config or `.claude/launch.json`. Leave them out for a project without a UI.
- `login` (optional) holds steps that sign in to the app before screenshots, in the step format of the `task-proof` skill. Use only test accounts from the project's own seed or fixture files, and write secrets as `${ENV_VAR}` references, which are read from the environment, rather than putting them in the file.

Skip this step when the config already exists and the user didn't ask to change it.

## 4. Create the Drive folder, spreadsheet and module tab

This lets the user see them now. Share the `spreadsheetUrl` from the output.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/tracker.mjs" ensure --data "${CLAUDE_PLUGIN_DATA}" --module '<module>'
```
