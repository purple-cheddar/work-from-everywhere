#!/usr/bin/env node
// Proof capture for the /work-from-everywhere workflow, using Playwright.
//
//   node capture.mjs check   --data <plugin data dir>
//   node capture.mjs install --data <plugin data dir> [--browsers]
//   node capture.mjs shots   --data <plugin data dir> (--spec-json '<json>' | --spec <file>)
//   node capture.mjs text    --data <plugin data dir> --in <log.txt> --out <image.png> [--title <title>]
//
// Playwright is installed in the plugin's data folder, pinned to the version whose browsers are
// already in the local Playwright cache, so no browser download is needed.
//
// A "shots" spec:
//   {
//     "out": "<proof folder>",
//     "baseUrl": "http://localhost:3000",
//     "login": [ steps ],                                        optional, runs before every capture
//     "pages": [ { "name": "Cart", "path": "/cart", "steps": [ steps ] } ],
//     "video": { "name": "Apply a coupon", "steps": [ steps ] },  optional, recorded at 1280x720
//     "devices": [ "iPhone SE", ... ]                            optional, replaces the defaults
//   }
// A step is an object with one key: goto, click, fill [selector, value], press [selector, key] or a
// key, hover, select [selector, value], check, waitFor, wait (ms), scroll (pixels).

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PLAYWRIGHT = 'playwright-core@1.62.1';

// Mainstream sizes, smallest first. Named presets come from Playwright's device list and carry the
// real viewport, pixel ratio, user agent and engine (WebKit for Apple devices).
const DEFAULT_DEVICES = [
  'iPhone SE (3rd gen)',
  'iPhone 15 Pro',
  'Pixel 7',
  'iPad Mini',
  'iPad Pro 11',
  { name: 'Laptop', viewport: { width: 1366, height: 768 } },
  { name: 'Desktop', viewport: { width: 1920, height: 1080 } },
];
const VIDEO_SIZE = { width: 1280, height: 720 };
const MAX_LOG_LINES = 400;

function playwright(data) {
  try {
    return createRequire(path.join(data, 'index.js'))('playwright-core');
  } catch {
    throw new Error(`Playwright isn't installed in ${data}. Run the task-setup skill.`);
  }
}

function check(ctx) {
  let pw;
  try {
    pw = playwright(ctx.data);
  } catch {
    return { ok: true, ready: false, playwright: null };
  }
  const { version } = JSON.parse(fs.readFileSync(path.join(ctx.data, 'node_modules', 'playwright-core', 'package.json'), 'utf8'));
  const browsers = { chromium: fs.existsSync(pw.chromium.executablePath()), webkit: fs.existsSync(pw.webkit.executablePath()) };
  return { ok: true, ready: browsers.chromium && browsers.webkit, playwright: version, browsers };
}

function install(ctx, opts) {
  fs.mkdirSync(ctx.data, { recursive: true });
  // npm is a .cmd shim on Windows, so it needs a shell; every argument here is fixed or quoted.
  const npm = spawnSync(`npm install --prefix "${ctx.data}" ${PLAYWRIGHT} --no-audit --no-fund --loglevel=error`, { shell: true, encoding: 'utf8' });
  if (npm.status !== 0) throw new Error(`npm install failed: ${(npm.stderr || npm.stdout).trim().slice(-800)}`);
  if (opts.browsers) {
    const cli = path.join(ctx.data, 'node_modules', 'playwright-core', 'cli.js');
    const r = spawnSync(process.execPath, [cli, 'install', 'chromium', 'webkit', 'ffmpeg'], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`Browser download failed: ${(r.stderr || r.stdout).trim().slice(-800)}`);
  }
  return check(ctx);
}

async function shots(ctx, opts) {
  const spec = typeof opts['spec-json'] === 'string'
    ? JSON.parse(opts['spec-json'])
    : JSON.parse(fs.readFileSync(required(opts, 'spec'), 'utf8'));
  if (!spec.out) throw new Error('The spec needs "out", the proof folder');
  if (!spec.pages?.length && !spec.video) throw new Error('The spec needs "pages", "video" or both');
  const out = path.resolve(spec.out);
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, '_spec.json'), JSON.stringify(spec, null, 2));

  const pw = playwright(ctx.data);
  const devices = (spec.devices || DEFAULT_DEVICES).map((d, i) => device(pw, d, i));
  const result = { ok: true, out, screenshots: [], video: null, errors: [] };

  if (spec.pages?.length) {
    const dir = path.join(out, 'Screenshots');
    fs.mkdirSync(dir, { recursive: true });
    for (const engine of new Set(devices.map((d) => d.engine))) {
      const browser = await pw[engine].launch();
      try {
        for (const d of devices.filter((x) => x.engine === engine)) {
          const context = await browser.newContext(d.options);
          context.setDefaultTimeout(15000);
          const page = await context.newPage();
          try {
            await run(page, spec.login, spec.baseUrl);
            for (const p of spec.pages) {
              const file = path.join(dir, `${safe(p.name)} - ${String(d.index + 1).padStart(2, '0')} ${d.name}.png`);
              try {
                await run(page, [{ goto: p.path ?? p.url }, ...(p.steps || [])], spec.baseUrl);
                await settle(page);
                await page.screenshot({ path: file, fullPage: p.fullPage !== false });
                result.screenshots.push(path.relative(out, file));
              } catch (e) {
                result.errors.push(`${p.name} on ${d.name}: ${firstLine(e)}`);
              }
            }
          } catch (e) {
            result.errors.push(`Login on ${d.name}: ${firstLine(e)}`);
          } finally {
            await context.close();
          }
        }
      } finally {
        await browser.close();
      }
    }
  }

  if (spec.video) {
    const dir = path.join(out, 'Video');
    fs.mkdirSync(dir, { recursive: true });
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wfe-video-'));
    const browser = await pw.chromium.launch();
    try {
      const context = await browser.newContext({ viewport: VIDEO_SIZE, recordVideo: { dir: tmp, size: VIDEO_SIZE } });
      context.setDefaultTimeout(15000);
      const page = await context.newPage();
      try {
        await run(page, spec.login, spec.baseUrl);
        await run(page, spec.video.steps || [], spec.baseUrl);
        await page.waitForTimeout(1000);
      } catch (e) {
        result.errors.push(`Video: ${firstLine(e)}`);
      }
      await context.close();
      const file = path.join(dir, `${safe(spec.video.name || 'Walkthrough')}.webm`);
      await page.video().saveAs(file);
      result.video = path.relative(out, file);
    } finally {
      await browser.close();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  result.ok = result.errors.length === 0;
  return result;
}

// Renders a text log as a terminal-style image, for tasks without a UI.
async function text(ctx, opts) {
  const input = required(opts, 'in');
  const output = path.resolve(required(opts, 'out'));
  let lines = fs.readFileSync(input, 'utf8').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').split(/\r?\n/);
  if (lines.length > MAX_LOG_LINES) {
    const half = MAX_LOG_LINES / 2;
    lines = [...lines.slice(0, half), `… ${lines.length - MAX_LOG_LINES} lines omitted …`, ...lines.slice(-half)];
  }
  const title = typeof opts.title === 'string' ? opts.title : path.basename(input);
  const html = `<!doctype html><meta charset="utf-8"><style>
    body { margin: 0; background: #1e1e1e; color: #d4d4d4; font: 13px/1.5 Consolas, "Cascadia Mono", Menlo, monospace; }
    header { background: #2d2d2d; color: #fff; padding: 10px 16px; font: 600 14px system-ui, sans-serif; border-bottom: 1px solid #444; }
    pre { margin: 0; padding: 16px; white-space: pre-wrap; word-break: break-word; }
  </style><header>${escapeHtml(title)}</header><pre>${escapeHtml(lines.join('\n'))}</pre>`;
  const browser = await playwright(ctx.data).chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 400 } });
    await page.setContent(html);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    await page.screenshot({ path: output, fullPage: true });
  } finally {
    await browser.close();
  }
  return { ok: true, image: output };
}

function device(pw, d, index) {
  if (typeof d === 'string') {
    const preset = pw.devices[d];
    if (!preset) {
      const known = Object.keys(pw.devices).filter((n) => !n.includes('landscape'));
      throw new Error(`Unknown device "${d}". Known devices: ${known.join(', ')}`);
    }
    const { defaultBrowserType, ...options } = preset;
    return { index, name: d, engine: defaultBrowserType, options };
  }
  const options = { viewport: d.viewport, deviceScaleFactor: d.deviceScaleFactor || 1, isMobile: !!d.isMobile, hasTouch: !!d.hasTouch };
  return { index, name: d.name, engine: d.engine || 'chromium', options };
}

async function run(page, steps = [], baseUrl) {
  for (const step of steps) {
    const [action, value] = Object.entries(step)[0] || [];
    const [a, b] = Array.isArray(value) ? value : [value];
    switch (action) {
      case 'goto': await page.goto(baseUrl ? new URL(a, baseUrl).href : a, { waitUntil: 'load' }); break;
      case 'click': await page.click(a); break;
      case 'fill': await page.fill(a, expand(b)); break;
      case 'press': await (b === undefined ? page.keyboard.press(a) : page.press(a, b)); break;
      case 'hover': await page.hover(a); break;
      case 'select': await page.selectOption(a, expand(b)); break;
      case 'check': await page.check(a); break;
      case 'waitFor': await page.waitForSelector(a); break;
      case 'wait': await page.waitForTimeout(Number(a)); break;
      case 'scroll': await page.mouse.wheel(0, Number(a)); break;
      default: throw new Error(`Unknown step ${JSON.stringify(step)}`);
    }
  }
}

async function settle(page) {
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  await page.waitForTimeout(300);
}

// ${NAME} in a step value reads an environment variable, so login steps needn't hold passwords.
const expand = (v) => String(v).replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] ?? '');
const safe = (name) => String(name || 'Page').replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').trim();
const firstLine = (e) => String(e?.message || e).split('\n')[0];
const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function required(opts, name) {
  if (typeof opts[name] !== 'string' || !opts[name]) throw new Error(`Missing --${name}`);
  return opts[name];
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

const commands = { check, install, shots, text };
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
