# work-from-everywhere

A Claude Code plugin for tracked tasks with proof. Run `/work-from-everywhere <task>` and Claude:

1. gets the task's context. If the task includes a Google Drive link, Claude reads it; if it has no link, Claude asks whether you have context: choose **No context**, or give a Google Drive link (a Doc, Sheet, Slides file, PDF or folder) and Claude reads it through `gws`,
2. logs the task as a row in the **Ai Tasks** Google Sheet, in a tab named after the project's module, with the context link as its Context Source, and switches the project's git repository to a branch for the task,
3. does the work, keeping the row's Status up to date (In Progress, Pending, Blocked), and sends a push notification to your phone when it needs you,
4. captures proof: full-page screenshots at seven device sizes plus a desktop and a mobile MP4 video that scroll through the page the task is about, for UI changes, or test and command output for everything else,
5. commits the work, pushes the branch and opens a GitHub pull request, ready for review,
6. uploads the proof to **Agent Tasks / &lt;module&gt; / &lt;NNN&gt; - &lt;title&gt;** in Google Drive, shares that folder as "Anyone with the link", marks the row Complete with the proof and pull request links, and tells your phone it's done.

It also bundles the 44 [`gws`](https://github.com/googleworkspace/cli) Google Workspace skills.

## Working from your phone

Leave this computer on with a Claude Code session open, and connect to it from the Claude app on your phone with Remote Control. Then:

| You want to | On your phone |
|---|---|
| Start a task | Send `/work-from-everywhere <task>` in the session |
| Know when Claude needs you | A push notification arrives when a task goes Pending or Blocked, needs a Google sign-in, or is delivered |
| Renew the Google sign-in | Tap the link Claude sends and approve. The page you land on won't load, because it points at the computer (`localhost`); copy its address and paste it to Claude |
| Review the work | Open the pull request in the GitHub app, with the proof link in its description, and the MP4 videos in Google Drive |
| Ship it | Merge the pull request in the GitHub app. Claude never merges |

Push notifications only reach your phone while Remote Control is connected.

## Install

In Claude Code, add this repository as a plugin marketplace, then install the plugin:

```text
/plugin marketplace add purple-cheddar/work-from-everywhere
/plugin install work-from-everywhere@work-from-everywhere
```

From a terminal, the same thing is:

```bash
claude plugin marketplace add purple-cheddar/work-from-everywhere
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
| Google sign-in | An OAuth client (`client_secret.json`) and a sign-in with Drive and Sheets access | You set up the OAuth client once, with [google-sign-in.md](skills/task-setup/google-sign-in.md). Claude handles each sign-in, which you approve in a browser, on the computer or your phone |
| Playwright | `playwright-core` 1.62.1, about 13 MB | Claude installs it into the plugin's data folder, after asking |
| Browsers | Chromium, WebKit and the ffmpeg video encoder | Claude downloads them after asking, unless they're already on the machine |
| MP4 encoder | `ffmpeg-static` 5.3.0, an ffmpeg build of about 80 MB that turns the WebM recordings into MP4, which iPhones play | Claude installs it into the plugin's data folder, after asking |

Once everything passes, the machine is recorded as set up (`setup.json` in the plugin's data folder), and later runs skip these checks.

Pull requests also need the [GitHub CLI](https://cli.github.com) signed in (`gh auth login`). Without it, Claude still pushes the task branch and tells you why no pull request was opened.

**The Google sign-in is still checked on every run.** Many company Google accounts must sign in again every 16 hours. When yours has expired, Claude sends you a sign-in link. Approve it on the computer, or on your phone, then paste back the address of the page that fails to load. You can also sign in yourself from a terminal on the computer with `gws auth login -s drive,sheets`.

To recheck everything at any time, ask Claude to "recheck the work-from-everywhere setup".

### For the team: one OAuth client

Every machine needs a `client_secret.json` before `gws auth login` works. The simplest way for a team: one person creates an **Internal** OAuth client (a Desktop app) in a Google Cloud project in the company's Google Workspace, then shares the file privately. Each teammate saves it to `~/.config/gws/client_secret.json` and signs in. See [google-sign-in.md](skills/task-setup/google-sign-in.md). Never commit the file: `.gitignore` blocks it.

## Command and skills

`/work-from-everywhere <task>` is the only command the plugin adds to the `/` menu. It checks setup, then gets the context, logs, does, proves and delivers the task. Only you can start it.

The plugin's other skills are hidden from the `/` menu with `user-invocable: false`. Claude uses them on its own during a task, and you can ask for them in plain words:

| Skill | What it does | For example, ask |
|---|---|---|
| `task-setup` | Checks and sets up the machine, and writes the project config | "Recheck the plugin setup", "Change this project's module to Checkout" |
| `task-status` | Sets To Do, In Progress, Pending or Blocked, with a remark | "Mark task 3 as blocked: the API key expired" |
| `task-proof` | Captures screenshots, video or logs | "Retake the proof for task 3" |
| `task-done` | Commits the work, pushes the branch and opens a pull request, then uploads the proof, shares it and marks the task Complete | "Open the pull request for task 3", "Upload task 3's proof again" |
| `gws-*` | The 44 Google Workspace skills (Gmail, Calendar, Drive, Docs, Sheets, Chat, Tasks, …) | "Summarize my unread email", "What's on my calendar today?" |

## The Ai Tasks sheet

Each module has its own tab with these columns: Task No, Description, Status, Context Source, Assign datetime, Complete Datetime, Proof Link, PR Link, Remark, Session.

- Each column has its own header color and a lighter tint below it, and the header row stays frozen.
- Status is a dropdown with a color per value.
- A tab made by an earlier version of the plugin gets the PR Link column added, with the existing rows moved along, the next time Claude updates one of its tasks.
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

Tracking needs `.claude/work-from-everywhere.json` in the project. In a desktop-app worktree session, Claude reads the worktree's copy first, then the main checkout's. The first `/work-from-everywhere` in a project runs `task-setup`, which asks you for these values:

```json
{
  "module": "Checkout",
  "baseUrl": "http://localhost:3000",
  "startCommand": "npm run dev",
  "login": [],
  "pullRequests": true
}
```

- `module` (required) names the Drive folder and the sheet tab.
- `baseUrl` and `startCommand` say where the app runs, for UI screenshots.
- `pullRequests` (optional, default `true`): each task gets a `task/<module>-<NNN>-<title>` branch, made from the branch you were on, and delivering it opens a pull request against that branch. When GitHub doesn't have that branch, such as the local `claude/...` branch of a desktop-app worktree session, the pull request goes against the repository's default branch (usually `main`). If the repository has uncommitted changes when a task starts, Claude asks whether to bring them into the task's branch or do the task without one. Set it to `false` to work on the current branch with no pull requests.
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
- `context/<file id>/`: readable copies of each context document Claude was given
- `proof/<module>/<task no>/`: the local copy of each task's proof
- `signin/`: the Google sign-in that is waiting for approval, and its log
- `node_modules/`: Playwright and the MP4 encoder (`ffmpeg-static`)

Uninstalling the plugin deletes this folder.

## Files

| Path | What it is |
|---|---|
| `.claude-plugin/plugin.json` | Plugin manifest |
| `.claude-plugin/marketplace.json` | Makes this repository a marketplace that lists the plugin |
| `skills/work-from-everywhere`, `skills/task-*` | The workflow skills |
| `skills/task-setup/google-sign-in.md` | Step-by-step Google sign-in guide |
| `skills/gws-*` | 44 Google Workspace skills generated by `gws generate-skills` from gws v0.22.5 ([googleworkspace/cli](https://github.com/googleworkspace/cli), Apache License 2.0). The upstream persona and recipe skills are left out, and these are hidden from the `/` menu |
| `scripts/refresh-gws-skills.mjs` | Maintainer tool: regenerates the `gws-*` skills and hides them from the `/` menu |
| `scripts/setup.mjs` | The setup check and the per-run sign-in check |
| `scripts/tracker.mjs` | Drive and Sheets work, through `gws`, plus the task branch and pull request, through `git` and `gh` |
| `scripts/signin.mjs` | The Google sign-in that works from a phone: starts `gws auth login` in the background and hands it the address the phone pastes back |
| `scripts/context.mjs` | Reads a task's context from a Google Drive link: Docs as Markdown, Sheets as CSV per tab, Slides as text, other files as they are, and up to 25 files from a folder |
| `scripts/lib/drive-links.mjs` | Pulls the file or folder ID out of any Google Drive, Docs, Sheets or Slides link |
| `scripts/capture.mjs` | Screenshots, video and log images, through Playwright, with videos converted to MP4 |
| `scripts/stop-guard.mjs` | The Stop hook |
| `scripts/block-gws-in-powershell.js` | The PowerShell hook |
| `scripts/lib/gws.mjs` | Runs `gws` without a shell, so JSON arguments arrive intact |
| `scripts/lib/git.mjs` | Runs `git` and `gh` without a shell, for task branches and pull requests |
| `hooks/hooks.json` | Registers both hooks |
| `TESTING.md` | End-to-end test checklist, with the latest run's results |

## Troubleshooting

| What you see | Why | Fix |
|---|---|---|
| Every command is refused with "The server-side auto mode classifier gave no verdict" | Auto mode's safety check didn't answer, so Claude Code refuses anything it would review, including plain `ls`. Claude Code versions before 2.1.280 refuse every such action right away | Update Claude Code (`claude update`) and start a new session. Or switch out of auto mode (Shift+Tab in the CLI, or the mode selector in the desktop app) and approve commands yourself. From 2.1.281, starting Claude Code with `CLAUDE_CODE_AUTO_MODE_SERVER=0` also works |
| "The Google sign-in has expired or is missing" | Many company accounts must sign in again every 16 hours | Approve the sign-in link Claude sends. On a phone, paste back the address of the page that fails to load. Or run `gws auth login -s drive,sheets` on the computer |
| The pasted sign-in address is refused as "from an earlier sign-in" | A newer sign-in replaced it | Use the newest link Claude sent |
| The task was delivered without a pull request | The reason is in Claude's message: no `origin` remote, a remote that isn't GitHub, or `gh` missing or signed out | Fix the reason (for example `gh auth login`), then ask Claude to "open the pull request for task N" |
| Videos are `.webm` and won't play on an iPhone | The MP4 encoder isn't installed | Ask Claude to "recheck the work-from-everywhere setup", then "retake the proof for task N" |
| No push notification arrives | Notifications reach the phone only while Remote Control is connected, and Claude skips them when you're already looking at the session | Connect the session with Remote Control from the Claude app |
| A worktree session can't save the project config, or `gh pr create` fails with a base branch GitHub doesn't have | Fixed in 0.7.1. Earlier versions used the main checkout instead of the worktree, and made the worktree's local `claude/...` branch the pull request's base | Update the plugin |
| The first run says setup is needed after an update or reinstall | Each installed copy keeps its own data folder | Let the setup run once. It remembers the machine afterwards |

## Maintaining

- **Releasing:** bump `version` in `.claude-plugin/plugin.json`, because installed copies stay on their version until it changes. Before pushing, validate both manifests: `claude plugin validate --strict .claude-plugin/plugin.json` and `claude plugin validate --strict .` (the marketplace). Run `claude plugin tag` if you want a release tag.
- **New requirement:** raise `SETUP_VERSION` in `scripts/setup.mjs`, so every machine runs the full setup check again.
- **Refreshing the gws skills** after upgrading `gws`: run `node scripts/refresh-gws-skills.mjs` from the plugin root. It runs `gws generate-skills` in a scratch folder, replaces `skills/gws-*`, and hides the new skills from the `/` menu. Add `--hide-only` to re-apply the hiding without regenerating. Don't run `gws generate-skills` in the plugin root yourself: it always writes `skills/` and `docs/` into the current folder, and it ignores `--help`.
- **New skills** that only Claude should use need `user-invocable: false` in their frontmatter, so the `/` menu keeps showing only `/work-from-everywhere`.
