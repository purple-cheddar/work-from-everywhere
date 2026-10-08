#!/usr/bin/env node
// Reads the context for a /work-from-everywhere task from a Google Drive link, through gws.
//
//   node context.mjs fetch --data <plugin data dir> --link <Drive, Docs, Sheets or Slides link>
//
// Saves a readable copy of the file, or of each file in a folder, under <data>/context/<id>/:
// Google Docs as Markdown, Sheets as one CSV per tab, Slides as plain text, Drawings as PNG, and
// other files (PDF, Office, images, text) as they are. Prints JSON listing the local copies.
// Exits 0 on success and 1 on failure. On failure, "code" is "auth" when the Google sign-in
// expired, "no-access" when the signed-in account can't open the link, and "bad-link" when the
// link isn't a Google Drive link.

import fs from 'node:fs';
import path from 'node:path';
import { runGws, runGwsAsync } from './lib/gws.mjs';
import { parseDriveLink } from './lib/drive-links.mjs';

const MAX_FILES = 25; // per folder link, counting one level of subfolders
const MAX_BYTES = 25 * 1024 * 1024; // bigger files are listed but not downloaded
const MAX_ROWS = 1000; // per spreadsheet tab
const PARALLEL = 4; // files fetched at once from a folder
const GOOGLE = 'application/vnd.google-apps.';
const FOLDER = `${GOOGLE}folder`;

// Export formats to try, in order, for Google's own file types.
const EXPORTS = {
  [`${GOOGLE}document`]: [['text/markdown', '.md'], ['text/plain', '.txt']],
  [`${GOOGLE}presentation`]: [['text/plain', '.txt']],
  [`${GOOGLE}drawing`]: [['image/png', '.png']],
};
const KINDS = {
  [`${GOOGLE}document`]: 'Google Docs',
  [`${GOOGLE}spreadsheet`]: 'Google Sheets',
  [`${GOOGLE}presentation`]: 'Google Slides',
  [`${GOOGLE}drawing`]: 'Google Drawings',
  [`${GOOGLE}form`]: 'Google Forms',
  [FOLDER]: 'folder',
};
const kind = (mimeType) => KINDS[mimeType] || mimeType;

class FetchError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

const params = (p) => ['--params', JSON.stringify(p)];

function check(r) {
  if (r.missing) throw new FetchError('gws is not installed. Run the task-setup skill.', 'setup');
  if (r.status === 2) {
    throw new FetchError('The Google sign-in has expired or is missing (many company accounts must sign in again every 16 hours). '
      + 'Sign the user in again as the "Google sign-in" section of the work-from-everywhere skill describes, then run this command again.', 'auth');
  }
  if (r.status !== 0 || r.json?.error) {
    const error = r.json?.error || {};
    throw new FetchError(error.message || r.stderr || r.text || `exit code ${r.status}`, error.code === 404 ? 'no-access' : undefined);
  }
  return r.json ?? {};
}

// gws writes -o files relative to its working directory, so downloads run from the target folder.
const gws = (args, cwd) => check(runGws(args, { cwd }));
const gwsAsync = async (args, cwd) => check(await runGwsAsync(args, { cwd }));

function describe(fileId) {
  return gws(['drive', 'files', 'get', ...params({
    fileId,
    fields: 'id,name,mimeType,size,modifiedTime,webViewLink,shortcutDetails',
    supportsAllDrives: true,
  })]);
}

async function fetchLink(ctx, link) {
  const id = parseDriveLink(link);
  if (!id) throw new FetchError(`Not a Google Drive, Docs, Sheets or Slides link: ${link}`, 'bad-link');
  let item;
  try {
    item = describe(id);
  } catch (error) {
    if (error.code !== 'no-access') throw error;
    const { user } = gws(['drive', 'about', 'get', ...params({ fields: 'user(emailAddress)' })]);
    throw new FetchError(`The signed-in Google account (${user.emailAddress}) can't open this link. `
      + `Ask the file's owner to share it with ${user.emailAddress}, or use a link that account can open.`, 'no-access');
  }
  if (item.mimeType === `${GOOGLE}shortcut`) item = describe(item.shortcutDetails.targetId);

  const dir = path.join(ctx.data, 'context', item.id);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const result = {
    ok: true,
    source: { name: item.name, type: kind(item.mimeType), modified: item.modifiedTime, url: item.webViewLink },
    dir: slashes(dir),
    files: [],
    skipped: [],
  };
  const entries = [];
  if (item.mimeType === FOLDER) collect(item, dir, '', entries, result);
  else entries.push({ file: item, dir, prefix: '' });
  await inParallel(entries, PARALLEL, (entry) => saveFile(entry, result));
  result.files.sort((a, b) => a.name.localeCompare(b.name));
  if (!result.files.length && !result.skipped.length) result.note = 'The folder is empty.';
  return result;
}

// Lists a folder and one level of subfolders, recreating the subfolders locally.
function collect(folder, dir, prefix, entries, result) {
  const { files = [] } = gws(['drive', 'files', 'list', ...params({
    q: `'${folder.id}' in parents and trashed = false`,
    fields: 'files(id,name,mimeType,size,modifiedTime)',
    orderBy: 'folder,name',
    pageSize: 200,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  })]);
  for (const file of files) {
    if (file.mimeType === FOLDER) {
      if (prefix) {
        result.skipped.push({ name: `${prefix}${file.name}/`, reason: 'Folders more than one level deep are not read' });
        continue;
      }
      const sub = path.join(dir, reserve(dir, safe(file.name)));
      fs.mkdirSync(sub, { recursive: true });
      collect(file, sub, `${path.basename(sub)}/`, entries, result);
    } else if (entries.length >= MAX_FILES) {
      result.skipped.push({ name: prefix + file.name, reason: `Only the first ${MAX_FILES} files are read. Point at a smaller folder or a single file` });
    } else {
      entries.push({ file, dir, prefix });
    }
  }
}

async function saveFile({ file, dir, prefix }, result) {
  try {
    if (file.mimeType === `${GOOGLE}spreadsheet`) return await saveSheet(file, dir, prefix, result);
    const exports = EXPORTS[file.mimeType];
    if (exports) {
      let lastError;
      for (const [mimeType, extension] of exports) {
        const name = reserve(dir, safe(file.name) + extension);
        try {
          await gwsAsync(['drive', 'files', 'export', ...params({ fileId: file.id, mimeType }), '-o', name], dir);
          return saved(result, prefix, dir, name, kind(file.mimeType));
        } catch (error) {
          if (error.code === 'auth') throw error;
          lastError = error;
        }
      }
      throw lastError;
    }
    if (file.mimeType.startsWith(GOOGLE)) {
      return result.skipped.push({ name: prefix + file.name, reason: `${kind(file.mimeType)} files can't be read this way` });
    }
    if (Number(file.size) > MAX_BYTES) {
      return result.skipped.push({ name: prefix + file.name, reason: `Larger than ${MAX_BYTES / 1024 / 1024} MB` });
    }
    const name = reserve(dir, safe(file.name));
    await gwsAsync(['drive', 'files', 'get', ...params({ fileId: file.id, alt: 'media', supportsAllDrives: true }), '-o', name], dir);
    return saved(result, prefix, dir, name, file.mimeType);
  } catch (error) {
    if (error.code === 'auth') throw error;
    result.skipped.push({ name: prefix + file.name, reason: firstLine(error.message) });
  }
}

// One CSV per tab, from the Sheets API, because a Drive export only covers the first tab.
async function saveSheet(file, dir, prefix, result) {
  const { sheets = [] } = await gwsAsync(['sheets', 'spreadsheets', 'get', ...params({ spreadsheetId: file.id, fields: 'sheets(properties(title))' })]);
  for (const { properties: { title } } of sheets) {
    const name = reserve(dir, `${safe(file.name)} - ${safe(title)}.csv`);
    const { values = [] } = await gwsAsync(['sheets', 'spreadsheets', 'values', 'get', ...params({ spreadsheetId: file.id, range: `'${title.replace(/'/g, "''")}'` })]);
    fs.writeFileSync(path.join(dir, name), values.slice(0, MAX_ROWS).map(csvRow).join('\n'));
    saved(result, prefix, dir, name, 'Google Sheets tab', values.length > MAX_ROWS ? `First ${MAX_ROWS} of ${values.length} rows` : undefined);
  }
}

function saved(result, prefix, dir, name, type, note) {
  const file = path.join(dir, name);
  result.files.push({ name: prefix + name, type, path: slashes(file), bytes: fs.statSync(file).size, ...(note && { note }) });
}

// ---------- helpers ----------

async function inParallel(items, limit, worker) {
  let next = 0;
  const lane = async () => {
    while (next < items.length) await worker(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
}

// Claims a file name in a folder, adding " (2)", " (3)"… when the name is taken. Names are
// claimed before any download starts writing, so parallel downloads never overwrite each other.
const claimed = new Set();
function reserve(dir, name) {
  const { name: stem, ext } = path.parse(name);
  let candidate = name;
  for (let n = 2; claimed.has(path.join(dir, candidate).toLowerCase()); n++) candidate = `${stem} (${n})${ext}`;
  claimed.add(path.join(dir, candidate).toLowerCase());
  return candidate;
}

// Drive names are untrusted: no path separators, nothing Windows can't store.
function safe(name) {
  const cleaned = String(name || 'untitled').replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/[. ]+$/, '').trim();
  return cleaned.slice(0, 150) || 'untitled';
}

const slashes = (p) => p.replace(/\\/g, '/');
const firstLine = (s) => String(s).split('\n').find((l) => l.trim()) || 'failed';
const csvRow = (row) => row.map((cell) => (/[",\r\n]/.test(cell) ? `"${String(cell).replace(/"/g, '""')}"` : cell)).join(',');

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

try {
  const { command, opts } = parseArgs(process.argv.slice(2));
  if (command !== 'fetch') throw new Error(`Unknown command "${command}". Use: fetch`);
  const data = typeof opts.data === 'string' ? opts.data : process.env.CLAUDE_PLUGIN_DATA;
  if (!data) throw new Error('Pass --data with the plugin data folder');
  if (typeof opts.link !== 'string' || !opts.link) throw new Error('Pass --link with a Google Drive link');
  console.log(JSON.stringify(await fetchLink({ data }, opts.link), null, 2));
} catch (error) {
  console.log(JSON.stringify({ ok: false, ...(error.code && { code: error.code }), error: error.message }, null, 2));
  process.exitCode = 1;
}
