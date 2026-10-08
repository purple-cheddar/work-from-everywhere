#!/usr/bin/env node
// Google sign-in for gws that works from a phone.
//
//   node signin.mjs start  --data <plugin data dir> [--services drive,sheets]
//       Starts `gws auth login` in the background and prints the sign-in link. gws waits for
//       Google to send the browser back to http://localhost:<port> on this computer.
//   node signin.mjs finish --data <plugin data dir> [--url <address>]
//       Completes the sign-in. Approved in a browser on this computer, the sign-in finishes by
//       itself and --url isn't needed. Approved on a phone, the phone can't reach this computer's
//       localhost, so its page fails to load: --url takes the address that page shows (or just its
//       code), and this script delivers it to the waiting gws.
//
// Prints one JSON object. Exits 0 on success, 1 on failure.

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { gwsCommand, runGws } from './lib/gws.mjs';

const DEFAULT_SERVICES = 'drive,sheets';
const URL_WAIT = 15000; // for gws to print the sign-in link
const FINISH_WAIT = 30000; // for gws to save the sign-in once it has the code

const stateFile = (ctx) => path.join(ctx.data, 'signin', 'login.json');
const logFile = (ctx) => path.join(ctx.data, 'signin', 'login.log');

async function start(ctx, opts) {
  const command = gwsCommand();
  if (!command) throw new Error('gws is not installed. Run the task-setup skill.');
  stopEarlier(ctx);
  const services = typeof opts.services === 'string' ? opts.services : DEFAULT_SERVICES;
  fs.mkdirSync(path.dirname(logFile(ctx)), { recursive: true });
  const log = fs.openSync(logFile(ctx), 'w');
  const [cmd, ...pre] = command;
  // Detached, so the login keeps waiting after this script and Claude's command end.
  const child = spawn(cmd, [...pre, 'auth', 'login', '-s', services], { detached: true, stdio: ['ignore', log, log], windowsHide: true });
  child.unref();
  fs.closeSync(log);

  const deadline = Date.now() + URL_WAIT;
  let url;
  while (!url && Date.now() < deadline) {
    await sleep(300);
    url = (fs.readFileSync(logFile(ctx), 'utf8').match(/https:\/\/accounts\.google\.com\/\S+/) || [])[0];
    if (!url && !alive(child.pid)) break;
  }
  if (!url) {
    stop(child.pid);
    throw new Error(`gws didn't print a sign-in link: ${tail(ctx) || 'no output'}`);
  }
  const port = Number(new URL(new URL(url).searchParams.get('redirect_uri') || 'http://localhost').port);
  fs.writeFileSync(stateFile(ctx), JSON.stringify({ pid: child.pid, port, services, startedAt: new Date().toISOString() }, null, 2));
  return { ok: true, url, port, services };
}

async function finish(ctx, opts) {
  const state = readJson(stateFile(ctx));
  if (!state) throw new Error('No sign-in was started. Run the start command first.');
  const pasted = typeof opts.url === 'string' ? opts.url.trim() : '';

  if (pasted && alive(state.pid)) {
    const query = callbackQuery(pasted, state.port);
    if (query.error) return { ok: false, code: 'denied', error: `Google didn't grant access: ${query.error}. Start the sign-in again.` };
    await deliver(state.port, query.search);
  }
  const deadline = Date.now() + (pasted ? FINISH_WAIT : 2000);
  while (alive(state.pid) && Date.now() < deadline) await sleep(500);
  if (alive(state.pid)) {
    return {
      ok: false,
      code: 'waiting',
      error: pasted
        ? `gws is still waiting after the code was delivered: ${tail(ctx) || 'no output'}`
        : 'The sign-in isn\'t finished yet. Approve it in the browser; on a phone, paste the address of the page that failed to load.',
    };
  }

  fs.rmSync(stateFile(ctx), { force: true });
  const r = runGws(['drive', 'about', 'get', '--params', JSON.stringify({ fields: 'user(emailAddress)' })]);
  if (r.status === 0) return { ok: true, account: r.json?.user?.emailAddress || 'signed in' };
  return { ok: false, code: 'failed', error: `The sign-in didn't complete: ${tail(ctx) || r.stderr || r.text}. Start it again.` };
}

// Turns what the user pasted (the full address, the address without http://, or just the code) into
// the query string gws expects on its localhost callback.
function callbackQuery(pasted, port) {
  let text = pasted.replace(/^["'<\s]+|["'>\s]+$/g, '');
  if (/^(localhost|127\.0\.0\.1)[:/]/i.test(text)) text = `http://${text}`;
  if (/^https?:\/\//i.test(text)) {
    const url = new URL(text);
    if (!/^(localhost|127\.0\.0\.1)$/i.test(url.hostname)) throw new Error(`That address isn't the localhost page Google sends the browser back to: ${url.hostname}`);
    if (url.port && Number(url.port) !== port) throw new Error('That address belongs to an earlier sign-in. Use the newest sign-in link, or start again.');
    if (url.searchParams.get('error')) return { error: url.searchParams.get('error') };
    if (!url.searchParams.get('code')) throw new Error('That address has no sign-in code. Copy the whole address from the address bar.');
    return { search: url.search };
  }
  if (/^code=/.test(text) || text.includes('&code=')) return { search: `?${text.replace(/^\?/, '')}` };
  if (/^[\w./-]{20,}$/.test(text)) return { search: `?code=${encodeURIComponent(decodeURIComponent(text))}` };
  throw new Error('That doesn\'t look like the sign-in address or code. Copy the whole address from the address bar of the page that failed to load.');
}

// gws listens on localhost; depending on the system that's IPv4 or IPv6.
async function deliver(port, search) {
  let lastError;
  for (const host of ['127.0.0.1', '[::1]']) {
    try {
      await fetch(`http://${host}:${port}/${search}`, { signal: AbortSignal.timeout(10000) });
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`Couldn't reach the waiting sign-in on port ${port}: ${lastError?.cause?.message || lastError?.message}. Start the sign-in again.`);
}

function stopEarlier(ctx) {
  const state = readJson(stateFile(ctx));
  if (state?.pid && alive(state.pid)) stop(state.pid);
  fs.rmSync(stateFile(ctx), { force: true });
}

// Stops the login and anything it started (the npm launcher runs the real gws as a child).
function stop(pid) {
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(-pid);
  } catch {
    // already gone
  }
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function tail(ctx) {
  try {
    return fs.readFileSync(logFile(ctx), 'utf8').replace(/^Using keyring backend.*$/gm, '').trim().split('\n').slice(-3).join(' ').slice(0, 500);
  } catch {
    return '';
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
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

const commands = { start, finish };
try {
  const { command, opts } = parseArgs(process.argv.slice(2));
  if (!commands[command]) throw new Error(`Unknown command "${command}". Use one of: ${Object.keys(commands).join(', ')}`);
  const data = typeof opts.data === 'string' ? opts.data : process.env.CLAUDE_PLUGIN_DATA;
  if (!data) throw new Error('Pass --data with the plugin data folder');
  const result = await commands[command]({ data }, opts);
  console.log(JSON.stringify(result, null, 2));
  if (result.ok === false) process.exitCode = 1;
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exitCode = 1;
}
