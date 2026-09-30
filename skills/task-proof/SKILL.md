---
name: task-proof
description: Capture proof that a /work-from-everywhere task works. For UI changes, full-page screenshots at seven device sizes plus one desktop video; for other tasks, test or command output saved as text and images. Use when a tracked task is finished, before task-done, and when the user asks to capture or retake a task's proof.
user-invocable: false
allowed-tools:
  - Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/capture.mjs" check *)
  - Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/capture.mjs" shots *)
  - Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/capture.mjs" text *)
---

# Capture proof

Save the proof for task `<task-no>` of `<module>` in this folder, called PROOF_DIR below:

`${CLAUDE_PLUGIN_DATA}/proof/<module>/<task-no>`

Check that Playwright is ready, and run the `task-setup` skill if `ready` isn't true:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/capture.mjs" check --data "${CLAUDE_PLUGIN_DATA}"
```

Run capture commands with the Bash tool, each on its own and with the quoting shown. Don't start a value with `/`, because Git Bash turns it into a Windows path.

## UI tasks

1. Make sure the app is running at the project config's `baseUrl`. If it isn't, start it in the background with the config's `startCommand` and wait until the URL responds.
2. Capture every page the task changed, plus one video that walks through the change:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/capture.mjs" shots --data "${CLAUDE_PLUGIN_DATA}" --spec-json '<spec>'
   ```

   The spec is JSON, for example:

   ```json
   {
     "out": "<PROOF_DIR>",
     "baseUrl": "http://localhost:3000",
     "pages": [
       { "name": "Cart", "path": "/cart" },
       { "name": "Cart - coupon form", "path": "/cart", "steps": [{ "click": "text=Add coupon" }] }
     ],
     "video": {
       "name": "Apply a coupon",
       "steps": [
         { "goto": "/cart" }, { "wait": 800 },
         { "click": "text=Add coupon" }, { "fill": ["#coupon", "SAVE10"] },
         { "click": "role=button[name='Apply']" }, { "wait": 1500 }
       ]
     }
   }
   ```

   - `pages`: each page the task changed. `path` is relative to `baseUrl`, and the optional `steps` run before the screenshot.
   - `video`: one recording at desktop size (1280×720) that shows the change working. Add short `wait`s so a viewer can follow along.
   - `login`: copy it from the project config when it has one. It runs before every capture.
   - Each step is an object with one key: `goto`, `click`, `fill` [selector, value], `press` [selector, key] or just a key, `hover`, `select` [selector, value], `check`, `waitFor`, `wait` (milliseconds) or `scroll` (pixels). Selectors are Playwright selectors: CSS, `text=…` or `role=…`.
   - Default devices: iPhone SE (3rd gen), iPhone 15 Pro and Pixel 7 (phones); iPad Mini and iPad Pro 11 (tablets); Laptop 1366×768 and Desktop 1920×1080. Apple devices render in WebKit, the rest in Chromium. A `devices` list in the spec replaces them.
   - Inside the single-quoted spec, avoid single quotes, or write each one as `'\''`.
3. Open the smallest phone and the desktop screenshot of each page with the Read tool. If one shows an error, a blank page or a login screen instead of the change, fix the cause and capture again.

## Tasks without a UI

1. Run the commands that prove the task works, such as tests, a CLI run or an API call, and save each output to `<PROOF_DIR>/Logs/<name>.txt`.
2. Turn each log into an image:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/capture.mjs" text --data "${CLAUDE_PLUGIN_DATA}" --in '<PROOF_DIR>/Logs/<name>.txt' --out '<PROOF_DIR>/Logs/<name>.png' --title '<what this shows>'
   ```

Files whose names start with `_`, like the `_spec.json` the capture saves, aren't uploaded.
