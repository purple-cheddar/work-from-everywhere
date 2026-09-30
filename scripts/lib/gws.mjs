// Runs the gws CLI without a shell, so JSON arguments reach it exactly as written.
//
// gws exit codes: 0 success, 1 API error, 2 sign-in missing, expired or invalid,
// 3 bad arguments, 4 couldn't fetch the API schema, 5 internal error.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// On Windows npm installs gws as .cmd/.ps1 shims, which can't start without a shell, and a shell
// would re-parse the JSON arguments. Run the package's run.js with node instead, or gws.exe when
// gws was installed from a GitHub release.
function findGws() {
  if (process.platform !== 'win32') return ['gws'];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    const runJs = path.join(dir, 'node_modules', '@googleworkspace', 'cli', 'run.js');
    if (fs.existsSync(runJs)) return [process.execPath, runJs];
    const exe = path.join(dir, 'gws.exe');
    if (fs.existsSync(exe)) return [exe];
  }
  return null;
}

let command;

// Returns { status, json, text, stderr }, or { missing: true } when gws isn't installed.
export function runGws(args, { cwd } = {}) {
  if (command === undefined) command = findGws();
  if (!command) return { missing: true };
  const [cmd, ...pre] = command;
  const r = spawnSync(cmd, [...pre, ...args], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) return r.error.code === 'ENOENT' ? { missing: true } : { status: -1, json: null, text: '', stderr: r.error.message };
  const text = (r.stdout || '').trim();
  let json = null;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    // not JSON; callers fall back to text
  }
  const stderr = (r.stderr || '').replace(/^Using keyring backend.*$/gm, '').trim();
  return { status: r.status, json, text, stderr };
}
