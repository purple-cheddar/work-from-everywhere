# Testing work-from-everywhere

An end-to-end check of the plugin, run as a real tracked task: `/work-from-everywhere Give a test with this work from everywhere plugin`. Run it after each release, on Windows and in a desktop-app worktree session at least, since that's where most bugs have shown up.

## Checklist

| # | Step | How | Expect |
|---|---|---|---|
| 1 | Full setup check | `setup.mjs check` (runs by itself on the first run after a `SETUP_VERSION` bump) | Every check `ok`, then `setupSaved: true` |
| 2 | Google sign-in on this computer | `signin.mjs start`, approve the link, `signin.mjs finish` | `ok`, with the signed-in `account` |
| 3 | Google sign-in from a phone | As 2, but approve on the phone and paste back the `localhost` address | `ok` from `finish --url '<address>'` |
| 4 | MP4 encoder | `capture.mjs install --mp4` | `mp4: true`, and the `mp4` setup check passes |
| 5 | Project config | `task-setup` step 3 | `.claude/work-from-everywhere.json` saved in the session's working directory |
| 6 | Sheet, folder, tab | `tracker.mjs ensure --module '<module>'` | `spreadsheetUrl` and `folderUrl` open |
| 7 | Task row | `tracker.mjs start` | A new row with status In Progress, and its `taskNo` |
| 8 | Task branch | `tracker.mjs branch`, from the session's working directory | `branch: task/<module>-<NNN>-<title>`. `base` is a branch GitHub has, such as `main`, even in a worktree |
| 9 | Context link | `context.mjs fetch --link` with a Drive link, then with another kind of link | Readable copies under `files`; `code: bad-link` for the other link |
| 10 | Proof | `task-proof` | Screenshots on 7 devices plus 2 MP4 videos for a UI task, or logs and log images otherwise |
| 11 | Pull request | `tracker.mjs pr` | Commit, push, a ready-for-review PR against `base`, and its link in the PR Link column |
| 12 | Delivery | `tracker.mjs done` | Proof in `Agent Tasks/<module>/<NNN> - <title>`, shared as "Anyone with the link", row Complete, and the proof link added to the PR description |
| 13 | Rerun of `pr` | Run `tracker.mjs pr` again after a new change | New commits pushed, and the same PR reused (`created: false`) |
| 14 | Push notifications | Start a task with Remote Control connected, then walk away | Notifications on the phone for Pending, Blocked, sign-in and delivered |

## Latest run: 2026-10-09

Windows 11, Claude desktop app (Code tab) in a worktree session, installed plugin 0.7.0, with this repository's 0.7.1 scripts for the steps the fix touches. Task: Plugin Test #2.

| # | Result | Notes |
|---|---|---|
| 1 | Pass, after fixes | `SETUP_VERSION` 2 forced the full check. `google-sign-in` (expired) and `mp4` (not installed) failed, and passed after 2 and 4 |
| 2 | Pass | Signed in as the work account |
| 3 | Not tested | Still needs a real phone approval |
| 4 | Pass | ffmpeg build installed into the plugin's data folder |
| 5 | **Bug, fixed in 0.7.1** | The skill wrote the config to `${CLAUDE_PROJECT_DIR}`, which is the main checkout, and the desktop app blocks a worktree session from writing its `.claude/` folder. The config now goes in the session's working directory |
| 6 | Pass | |
| 7 | Pass | Task 2 |
| 8 | **Bug, fixed in 0.7.1** | `--repo "${CLAUDE_PROJECT_DIR}"` pointed at the main checkout, not the worktree, and the base became the worktree's local `claude/...` branch, which `gh pr create` can't use. Now the skills use the working directory, and `prBase()` falls back to the remote's default branch: `base: main` |
| 9 | Partly tested | `bad-link` checked. Drive links were tested in 0.4.0 |
| 10 | Pass | Logs-only proof, since the plugin has no web UI. Screenshots and videos weren't exercised |
| 11 | See the PR | First real test of `gh pr create` |
| 12 | See the PR | First real test of adding the proof link to the PR description |
| 13 | See the PR | This file's results were pushed with a second `pr` |
| 14 | Not tested | The desktop session was in front of the user, so notifications were skipped as redundant |

`prBase()` checks (7 of 7 passed): a local-only branch falls back to `main`, a branch GitHub has is kept, a repository with no `origin` keeps its branch, and the default branch is found through `git ls-remote` when `origin/HEAD` was never fetched.
