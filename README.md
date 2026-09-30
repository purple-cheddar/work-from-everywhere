# work-from-everywhere

A Claude Code plugin for tracked tasks with proof. Run `/work-from-everywhere <task>` and Claude:

1. logs the task as a row in the **Ai Tasks** Google Sheet, in a tab named after the project's module,
2. does the work, keeping the row's Status up to date (In Progress, Pending, Blocked),
3. captures proof: full-page screenshots at seven device sizes plus one video for UI changes, or test and command output for everything else,
4. uploads the proof to **Agent Tasks / &lt;module&gt; / &lt;NNN&gt; - &lt;title&gt;** in Google Drive, shares that folder as "Anyone with the link", and marks the row Complete with the link.

It also bundles the 44 [`gws`](https://github.com/googleworkspace/cli) Google Workspace skills.

## Install

In Claude Code, add this repository as a plugin marketplace, then install the plugin:

```text
/plugin marketplace add <github-owner>/work-from-everywhere
/plugin install work-from-everywhere@work-from-everywhere
```

From a terminal, the same thing is:

```bash
claude plugin marketplace add <github-owner>/work-from-everywhere
claude plugin install work-from-everywhere@work-from-everywhere
```

For a private repository, your git credentials need access to it (for example, sign in with `gh auth login`).

To update later, run `claude plugin marketplace update work-from-everywhere`, then `claude plugin update work-from-everywhere@work-from-everywhere`, and restart Claude.

## First run: setup check

The first `/work-from-everywhere` on a machine checks everything the plugin needs, and Claude walks you through anything missing, one step at a time:

| Check | What it needs | Who fixes it |
|---|---|---|
| Node.js | Version 18 or later, which runs the plugin's scripts | You install it from https://nodejs.org |
| Git Bash | Windows only: Git for Windows | You install it from https://git-scm.com/download/win |
| gws | The Google Workspace CLI | Claude installs it with npm, after asking |
| Google sign-in | An OAuth client (`client_secret.json`) and a `gws auth login` with Drive and Sheets access | You. Claude guides you through [google-sign-in.md](skills/task-setup/google-sign-in.md) |
| Playwright | `playwright-core` 1.62.1, about 13 MB | Claude installs it into the plugin's data folder, after asking |
| Browsers | Chromium, WebKit and the ffmpeg video encoder | Claude downloads them after asking, unless they're already on the machine |

Once everything passes, the machine is recorded as set up (`setup.json` in the plugin's data folder), and later runs skip these checks.

**The Google sign-in is still checked on every run.** Many company Google accounts must sign in again every 16 hours. When yours has expired, Claude asks you to run this in a terminal before it starts the task:

```bash
gws auth login -s drive,sheets
```

Run `/work-from-everywhere:task-setup` at any time to recheck everything.

### For the team: one OAuth client

Every machine needs a `client_secret.json` before `gws auth login` works. The simplest way for a team: one person creates an **Internal** OAuth client (a Desktop app) in a Google Cloud project in the company's Google Workspace, then shares the file privately. Each teammate saves it to `~/.config/gws/client_secret.json` and signs in. See [google-sign-in.md](skills/task-setup/google-sign-in.md). Never commit the file: `.gitignore` blocks it.

## Skills

| Command | What it does |
|---|---|
| `/work-from-everywhere <task>` | The entry point: checks setup, then logs, does, proves and delivers the task. Only you can start it |
| `/work-from-everywhere:task-setup` | Checks and sets up the machine, and writes the project config |
| `/work-from-everywhere:task-status <status> [remark]` | Sets To Do, In Progress, Pending or Blocked. Claude uses it on its own during a task |
| `/work-from-everywhere:task-proof` | Captures screenshots, video or logs |
| `/work-from-everywhere:task-done` | Uploads the proof, shares it and marks the task Complete |
| `/work-from-everywhere:gws-*` | The Google Workspace skills (Gmail, Calendar, Drive, Docs, Sheets, Chat, Tasks, …) |

The `task-*` skills also work without the prefix (`/task-status`) when no other command has the same name.

## The Ai Tasks sheet

Each module has its own tab with these columns: Task No, Description, Status, Context Source, Assign datetime, Complete Datetime, Proof Link, Remark, Session.

- Each column has its own header color and a lighter tint below it, and the header row stays frozen.
- Status is a dropdown with a color per value.
- Remarks build up as timestamped lines, so a task's history stays visible.
- Session is the Claude Code session ID. `claude --resume <id>` reopens that conversation.
- Times use the computer's timezone.

| Status | Meaning |
|---|---|
| To Do | Logged, not started |
| In Progress | Being worked on |
| Pending | Waiting for you to do or answer something (the remark says what) |
| Complete | Delivered, with proof |
| Blocked | Can't continue (the remark says what happened) |

## Project config

Tracking needs `.claude/work-from-everywhere.json` in the project. The first `/work-from-everywhere` in a project runs `task-setup`, which asks you for these values:

```json
{
  "module": "Checkout",
  "baseUrl": "http://localhost:3000",
  "startCommand": "npm run dev",
  "login": []
}
```

- `module` (required) names the Drive folder and the sheet tab.
- `baseUrl` and `startCommand` say where the app runs, for UI screenshots.
- `login` (optional) holds sign-in steps for the app. `${ENV_VAR}` in a step value is read from the environment.

## Hooks

| Hook | Why |
|---|---|
| `PreToolUse` on PowerShell | Blocks `gws` in the PowerShell tool so Claude runs it in Git Bash. Windows PowerShell 5.1 strips the inner quotes from JSON arguments, so `--params '{"pageSize": 5}'` fails there |
| `Stop` | If a tracked task is still In Progress, or queued as To Do, when Claude is about to stop, it blocks the stop once and asks Claude to update the task: deliver it, set Pending with what it needs from you, or set Blocked with what happened |

Both hooks run with `node`. If a hook can't read its input, it lets Claude carry on rather than blocking.

## Where things are stored

The plugin's data folder (`~/.claude/plugins/data/<plugin id>/`) holds:

- `setup.json`: the record that this machine passed the setup check
- `drive.json`: the IDs of the Agent Tasks folder and the Ai Tasks spreadsheet, so a same-named file someone shares with you is never used by mistake
- `sessions/<session id>.json`: the tasks each session is tracking, which the Stop hook reads
- `proof/<module>/<task no>/`: the local copy of each task's proof
- `node_modules/`: Playwright

Uninstalling the plugin deletes this folder.

## Files

| Path | What it is |
|---|---|
| `.claude-plugin/plugin.json` | Plugin manifest |
| `.claude-plugin/marketplace.json` | Makes this repository a marketplace that lists the plugin |
| `skills/work-from-everywhere`, `skills/task-*` | The workflow skills |
| `skills/task-setup/google-sign-in.md` | Step-by-step Google sign-in guide |
| `skills/gws-*` | 44 Google Workspace skills generated by `gws generate-skills` from gws v0.22.5 ([googleworkspace/cli](https://github.com/googleworkspace/cli), Apache License 2.0). The upstream persona and recipe skills are left out |
| `scripts/setup.mjs` | The setup check and the per-run sign-in check |
| `scripts/tracker.mjs` | Drive and Sheets work, through `gws` |
| `scripts/capture.mjs` | Screenshots, video and log images, through Playwright |
| `scripts/stop-guard.mjs` | The Stop hook |
| `scripts/block-gws-in-powershell.js` | The PowerShell hook |
| `scripts/lib/gws.mjs` | Runs `gws` without a shell, so JSON arguments arrive intact |
| `hooks/hooks.json` | Registers both hooks |

## Maintaining

- **Releasing:** bump `version` in `.claude-plugin/plugin.json`, because installed copies stay on their version until it changes. Before pushing, validate both manifests: `claude plugin validate --strict .claude-plugin/plugin.json` and `claude plugin validate --strict .` (the marketplace). Run `claude plugin tag` if you want a release tag.
- **New requirement:** raise `SETUP_VERSION` in `scripts/setup.mjs`, so every machine runs the full setup check again.
- **Refreshing the gws skills** after upgrading `gws`: `gws generate-skills` always writes `skills/` and `docs/` into the current directory, and it ignores `--help`. Run it in a scratch folder, never in the plugin root. In Git Bash:

  ```bash
  PLUGIN="/path/to/work-from-everywhere"
  cd "$(mktemp -d)" && gws generate-skills
  rm -rf "$PLUGIN"/skills/gws-* && cp -r skills/gws-* "$PLUGIN/skills/"
  ```
