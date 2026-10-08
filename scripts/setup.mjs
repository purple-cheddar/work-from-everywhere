#!/usr/bin/env node
// Prerequisite checks for the work-from-everywhere plugin.
//
//   node setup.mjs preflight --data <plugin data dir>
//       Runs at the start of every /work-from-everywhere task, so it stays fast. Until this machine
//       has passed the full check it only reports that setup is needed. After that it checks just
//       the Google sign-in, which many company accounts must renew every 16 hours.
//   node setup.mjs check --data <plugin data dir>
//       Checks everything: Node.js, npm, Git Bash (Windows), gws, the Google sign-in and its access
//       to Drive and Sheets, Playwright, its browsers and the MP4 encoder. When everything passes it records this
//       machine's setup in <data>/setup.json, so later preflights go straight to the sign-in check.
//
// Always exits 0 and prints JSON. The entry skill runs preflight before Claude reads the skill,
// and a command that failed there would cancel the skill instead of letting Claude help.

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runGws } from './lib/gws.mjs';

// Bump when the plugin gains a requirement, so machines set up earlier run the full check again.
const SETUP_VERSION = 2; // 2: the MP4 encoder
const MIN_NODE = 18;
const TESTED_GWS = '0.22.5';
const SCRIPTS = path.dirname(fileURLToPath(import.meta.url)).replace(/\\/g, '/');
const SIGN_IN_GUIDE = `${path.posix.dirname(SCRIPTS)}/skills/task-setup/google-sign-in.md`;
const SIGN_IN = 'Sign the user in as the "Google sign-in" section of the work-from-everywhere skill describes (it works from a phone too)';

const pass = (id, detail) => ({ id, ok: true, detail });
const fail = (id, detail, who, fix) => ({ id, ok: false, detail, who, fix });
const skip = (id, detail) => ({ id, ok: false, skipped: true, detail });
const params = (p) => ['--params', JSON.stringify(p)];

// ---------- tools ----------

function nodeFix() {
  const hint = { win32: ' (or run: winget install OpenJS.NodeJS.LTS)', darwin: ' (or run: brew install node)' }[process.platform] || '';
  return `Install the Node.js LTS from https://nodejs.org${hint}, then restart Claude.`;
}

function checkNode() {
  const version = process.versions.node;
  if (Number(version.split('.')[0]) >= MIN_NODE) return pass('node', `Node.js ${version}`);
  return fail('node', `Node.js ${version} is older than ${MIN_NODE}`, 'user', nodeFix());
}

function checkNpm() {
  // npm is a .cmd shim on Windows, so it needs a shell; the command is fixed text.
  const r = spawnSync('npm --version', { shell: true, encoding: 'utf8' });
  const version = (r.stdout || '').trim().split(/\r?\n/).pop();
  if (r.status === 0 && version) return pass('npm', `npm ${version}`);
  return fail('npm', 'npm not found', 'user', `npm comes with Node.js. ${nodeFix()}`);
}

function checkGitBash() {
  if (process.platform !== 'win32') return null;
  const places = [
    process.env.CLAUDE_CODE_GIT_BASH_PATH,
    'C:/Program Files/Git/bin/bash.exe',
    'C:/Program Files (x86)/Git/bin/bash.exe',
    path.join(os.homedir(), 'AppData/Local/Programs/Git/bin/bash.exe'),
  ];
  if (process.env.MSYSTEM || places.some((p) => p && fs.existsSync(p))) return pass('git-bash', 'Git Bash found');
  return fail('git-bash', 'Git Bash not found', 'user', 'Install Git for Windows from https://git-scm.com/download/win (it includes Git Bash), then restart Claude.');
}

function checkGws() {
  const r = runGws(['--version']);
  if (r.missing) return fail('gws', 'gws is not installed', 'claude', "With the user's OK, run: npm install -g @googleworkspace/cli");
  const version = (r.text.match(/\d+\.\d+\.\d+/) || [])[0];
  if (!version) return fail('gws', `gws didn't report its version: ${r.stderr || r.text}`, 'claude', "With the user's OK, reinstall it: npm install -g @googleworkspace/cli");
  const check = pass('gws', `gws ${version}`);
  if (older(version, TESTED_GWS)) check.warning = `Older than ${TESTED_GWS}, the version this plugin is tested with. Suggest: npm install -g @googleworkspace/cli@latest`;
  return check;
}

function older(a, b) {
  const [x, y] = [a, b].map((v) => v.split('.').map(Number));
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i];
  return false;
}

// ---------- Google ----------

function signInExpired() {
  return fail('google-sign-in', 'The Google sign-in has expired or is missing', 'user',
    `${SIGN_IN}. Many company accounts must sign in again every 16 hours. Details: step 2 of ${SIGN_IN_GUIDE}`);
}

// A cheap authenticated call. gws exits 2 when the sign-in is missing, expired or revoked.
function driveSignIn() {
  const r = runGws(['drive', 'about', 'get', ...params({ fields: 'user(emailAddress)' })]);
  if (r.missing) return { missing: true };
  if (r.status === 0) return pass('google-sign-in', r.json?.user?.emailAddress || 'signed in');
  if (r.status === 2) return signInExpired();
  return apiProblem(r, 'Google Drive API');
}

// Explains a failed sign-in: no OAuth client at all, never signed in, or expired. `gws auth status`
// is slow (it lists the project's APIs), so it only runs when something is already wrong.
function explainSignIn() {
  const s = runGws(['auth', 'status']).json || {};
  const hasClient = s.client_config_exists || s.token_env_var || (s.credential_source && s.credential_source !== 'none');
  if (!hasClient) {
    return fail('google-oauth-client', 'gws has no OAuth client (client_secret.json) yet', 'user', `Walk the user through ${SIGN_IN_GUIDE}, starting at step 1.`);
  }
  if (!s.has_refresh_token) {
    return fail('google-sign-in', 'Not signed in to Google yet', 'user', `${SIGN_IN}. Details: step 2 of ${SIGN_IN_GUIDE}`);
  }
  return signInExpired();
}

// Reading a spreadsheet that doesn't exist answers 404 only when the sign-in has the Sheets scope
// and the Sheets API is enabled for the gws project.
function sheetsAccess() {
  const r = runGws(['sheets', 'spreadsheets', 'get', ...params({ spreadsheetId: 'work-from-everywhere-setup-check', fields: 'spreadsheetId' })]);
  if (r.status === 0 || r.json?.error?.code === 404) return pass('google-sheets', 'Sheets API reachable');
  if (r.status === 2) return signInExpired();
  return apiProblem(r, 'Google Sheets API');
}

function apiProblem(r, api) {
  const error = r.json?.error || {};
  const message = error.message || r.stderr || r.text || `exit code ${r.status}`;
  if (error.code === 403 && /scope/i.test(message)) {
    return fail('google-scopes', `The sign-in doesn't allow the ${api}: ${message}`, 'user',
      `${SIGN_IN}, and ask the user to allow Drive and Sheets access on the consent screen.`);
  }
  if (error.code === 403 && /has not been used|is disabled|SERVICE_DISABLED|accessNotConfigured/i.test(message)) {
    return fail('google-apis', `The ${api} isn't enabled for the gws Google Cloud project`, 'user',
      `Enable the ${api} in that project (the link in this error opens it), wait a minute, then check again: ${message}`);
  }
  return fail('google-connection', `Couldn't reach Google: ${message}`, 'user', 'Check the internet connection, then check again.');
}

function checkGoogle(gwsReady) {
  if (!gwsReady) return [skip('google-sign-in', 'Checked once gws is installed')];
  const signIn = driveSignIn();
  if (signIn.missing) return [skip('google-sign-in', 'Checked once gws is installed')];
  if (signIn.ok) return [signIn, sheetsAccess()];
  return [signIn.id === 'google-sign-in' ? explainSignIn() : signIn];
}

// ---------- Playwright ----------

async function checkBrowsers(data) {
  let pw;
  try {
    pw = createRequire(path.join(data, 'index.js'))('playwright-core');
  } catch {
    return [
      fail('playwright', 'Playwright is not installed', 'claude',
        `With the user's OK (it downloads the playwright-core 1.62.1 npm package, about 13 MB), run: node "${SCRIPTS}/capture.mjs" install --data "${data}"`),
      skip('browsers', 'Checked once Playwright is installed'),
    ];
  }
  const { version } = JSON.parse(fs.readFileSync(path.join(data, 'node_modules', 'playwright-core', 'package.json'), 'utf8'));
  const checks = [pass('playwright', `playwright-core ${version}`)];
  const browserFix = (e) => (/missing dependencies/i.test(e.message)
    ? { who: 'user', fix: `Ask the user to install the browsers' system libraries: sudo node "${data}/node_modules/playwright-core/cli.js" install-deps chromium webkit` }
    : { who: 'claude', fix: `With the user's OK (Chromium, WebKit and ffmpeg, a few hundred MB), run: node "${SCRIPTS}/capture.mjs" install --data "${data}" --browsers` });

  // Open each browser once and take a screenshot, the way a real capture would.
  for (const engine of ['chromium', 'webkit']) {
    try {
      const browser = await pw[engine].launch();
      try {
        const page = await browser.newPage();
        await page.setContent('<p>setup check</p>');
        await page.screenshot();
      } finally {
        await browser.close();
      }
      checks.push(pass(engine, `${engine} works`));
    } catch (e) {
      const { who, fix } = browserFix(e);
      checks.push(fail(engine, firstLine(e), who, fix));
    }
  }

  // Video recording needs Playwright's ffmpeg.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wfe-setup-'));
  try {
    const browser = await pw.chromium.launch();
    try {
      const context = await browser.newContext({ recordVideo: { dir: tmp } });
      const page = await context.newPage();
      await page.setContent('<p>setup check</p>');
      await page.waitForTimeout(300);
      await context.close();
    } finally {
      await browser.close();
    }
    if (fs.readdirSync(tmp).some((f) => f.endsWith('.webm'))) {
      checks.push(pass('video', 'video recording works'));
    } else {
      const { who, fix } = browserFix(new Error('no video'));
      checks.push(fail('video', 'No video was recorded', who, fix));
    }
  } catch (e) {
    const { who, fix } = browserFix(e);
    checks.push(fail('video', firstLine(e), who, fix));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  checks.push(checkMp4(data));
  return checks;
}

// Playwright's own ffmpeg only writes WebM, which many iPhones won't play. The ffmpeg-static package
// brings an ffmpeg that writes MP4 (H.264), and capture.mjs converts each video with it.
function checkMp4(data) {
  const fix = `With the user's OK (it downloads an ffmpeg build of about 80 MB), run: node "${SCRIPTS}/capture.mjs" install --data "${data}" --mp4`;
  let ffmpeg;
  try {
    ffmpeg = createRequire(path.join(data, 'index.js'))('ffmpeg-static');
  } catch {
    return fail('mp4', "The MP4 encoder isn't installed, so videos would be WebM, which many iPhones won't play", 'claude', fix);
  }
  const r = ffmpeg && fs.existsSync(ffmpeg) ? spawnSync(ffmpeg, ['-hide_banner', '-encoders'], { encoding: 'utf8' }) : null;
  if (r?.status === 0 && /libx264/.test(r.stdout)) return pass('mp4', 'MP4 (H.264) encoder works');
  return fail('mp4', "The MP4 encoder is installed but doesn't run", 'claude', fix);
}

// ---------- commands ----------

const setupFile = (data) => path.join(data, 'setup.json');

function preflight(ctx) {
  const saved = readJson(setupFile(ctx.data));
  if (saved?.setupVersion !== SETUP_VERSION) {
    const message = saved
      ? "The plugin's requirements changed since this machine was set up."
      : "This machine hasn't been set up for the plugin yet.";
    return { ok: false, mode: 'setup-needed', message: `${message} Run the task-setup skill.` };
  }
  const signIn = driveSignIn();
  if (signIn.missing) {
    fs.rmSync(setupFile(ctx.data), { force: true });
    return { ok: false, mode: 'setup-needed', message: 'gws is no longer installed. Run the task-setup skill.' };
  }
  if (signIn.ok) return { ok: true, mode: 'sign-in', account: signIn.detail };
  return { ok: false, mode: 'sign-in', checks: [signIn] };
}

async function check(ctx) {
  const checks = [checkNode(), checkNpm(), checkGitBash(), checkGws()].filter(Boolean);
  checks.push(...checkGoogle(checks.find((c) => c.id === 'gws').ok));
  checks.push(...(await checkBrowsers(ctx.data)));
  const ok = checks.every((c) => c.ok);
  if (ok) {
    const detail = (id) => checks.find((c) => c.id === id)?.detail;
    writeJson(setupFile(ctx.data), {
      setupVersion: SETUP_VERSION,
      completedAt: new Date().toISOString(),
      platform: `${process.platform}-${process.arch}`,
      node: detail('node'),
      gws: detail('gws'),
      playwright: detail('playwright'),
      account: detail('google-sign-in'),
    });
  } else {
    fs.rmSync(setupFile(ctx.data), { force: true });
  }
  return { ok, mode: 'full', setupSaved: ok, checks };
}

// ---------- helpers ----------

const firstLine = (e) => String(e?.message || e).split('\n').find((l) => l.trim()) || 'failed';

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const opts = {};
  for (let i = 0; i < rest.length; i++) {
    if (!rest[i].startsWith('--')) throw new Error(`Unexpected argument: ${rest[i]}`);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith('--')) opts[rest[i].slice(2)] = true;
    else opts[rest[i].slice(2)] = rest[++i];
  }
  return { command, opts };
}

const commands = { preflight, check };
try {
  const { command, opts } = parseArgs(process.argv.slice(2));
  if (!commands[command]) throw new Error(`Unknown command "${command}". Use one of: ${Object.keys(commands).join(', ')}`);
  const data = typeof opts.data === 'string' ? opts.data : process.env.CLAUDE_PLUGIN_DATA;
  if (!data) throw new Error('Pass --data with the plugin data folder');
  console.log(JSON.stringify(await commands[command]({ data }, opts), null, 2));
} catch (error) {
  console.log(JSON.stringify({ ok: false, mode: 'error', error: error.message }, null, 2));
}
