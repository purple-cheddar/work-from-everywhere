---
name: task-setup
description: Check and set up everything the work-from-everywhere plugin needs on this machine (Node.js, the gws CLI and its Google sign-in, Playwright, its browsers and the MP4 encoder), walking the user through each missing piece, then save the project's module name, app URL and pull request setting. Use on the first /work-from-everywhere run on a machine, when its setup check fails, or when the user asks to set up or recheck the plugin, or to change the project's module name, app URL or pull request setting.
user-invocable: false
allowed-tools:
  - Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/setup.mjs" *)
  - Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/tracker.mjs" *)
  - Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/signin.mjs" *)
---

# Set up the plugin

Run each command with the Bash tool, on its own and with the quoting shown.

If Claude Code refuses a command before it runs (a permission denial, or auto mode saying it can't determine its safety or that its classifier gave no verdict), retry once at most. Then stop, show the user the command, and offer these options: switch out of auto mode (Shift+Tab in the CLI, or the mode selector in the desktop app) and approve it; update Claude Code (`claude update`) and start a new session when the message mentions no verdict; or run it themselves (in the CLI, type `!` followed by it) and share the output.

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
| `mp4` | An ffmpeg build that turns the WebM videos Playwright records into MP4, which iPhones play | The `fix` command, with the user's OK (about 80 MB) |

A check with a `warning` still passes; mention the warning once.

When every check passes, the output shows `setupSaved: true`: the machine is recorded as set up in the plugin's data folder. From then on, `/work-from-everywhere` only checks the Google sign-in on each run. Run this skill again at any time to recheck everything.

## 3. Project config

Create or update `.claude/work-from-everywhere.json` in the session's working directory. In a desktop-app worktree session that's the worktree's copy, because the app doesn't let a worktree session write the main checkout's `.claude/` folder. It's then committed with the task's pull request, and every checkout has it once that's merged.

```json
{
  "module": "Checkout",
  "baseUrl": "http://localhost:3000",
  "startCommand": "npm run dev",
  "login": [],
  "pullRequests": true
}
```

- `module` (required) names the task's Drive folder and sheet tab. Suggest one from the repository or folder name, and confirm it with the user.
- `baseUrl` and `startCommand` say where the app runs and how to start it, for UI screenshots. Suggest values from package.json scripts, the framework config or `.claude/launch.json`. Leave them out for a project without a UI.
- `pullRequests` (optional, default `true`): each task gets its own git branch, and delivering it opens a GitHub pull request, ready for review. Set it to `false` for a project that isn't on GitHub or where tasks shouldn't open pull requests. Opening pull requests needs the GitHub CLI signed in (`gh auth status`); if it isn't, tell the user to install it from https://cli.github.com and run `gh auth login`.
- `login` (optional) holds steps that sign in to the app before screenshots, in the step format of the `task-proof` skill. Use only test accounts from the project's own seed or fixture files, and write secrets as `${ENV_VAR}` references, which are read from the environment, rather than putting them in the file.

Skip this step when the config already exists and the user didn't ask to change it.

## 4. Create the Drive folder, spreadsheet and module tab

This lets the user see them now. Share the `spreadsheetUrl` from the output.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/tracker.mjs" ensure --data "${CLAUDE_PLUGIN_DATA}" --module '<module>'
```
