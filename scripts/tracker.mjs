#!/usr/bin/env node
// Google Drive and Sheets side of the /work-from-everywhere workflow, done through the gws CLI.
//
//   node tracker.mjs <command> --data <plugin data dir> --session <session id> [options]
//
//   check                                   Show the Google account gws is signed in to
//   ensure --module M                       Create the Drive folder, spreadsheet and module tab if missing
//   start  --module M --title T --description D --context C [--status "To Do"]
//                                           Add a task row (status defaults to In Progress)
//   status --status S [--remark R]          Change the status; the remark is appended with a timestamp
//   branch [--repo DIR] [--allow-dirty]     Switch the project's git repository to a new task branch
//   pr     [--repo DIR] [--message M] [--summary S]
//                                           Commit the task's changes, push the branch, open a GitHub
//                                           pull request and put its link in the sheet
//   done   --proof-dir DIR [--remark R] [--title T] [--replace]
//                                           Upload proof, share the folder, mark the task Complete,
//                                           and add the proof link to the task's pull request
//   show                                    List the tasks this session has touched
//
// status, branch, pr and done act on this session's open task unless --module and --task are given.
// Every command prints one JSON object and exits 0 on success, 1 on failure. When the Google
// sign-in has expired, the JSON also has "code": "auth".

import fs from 'node:fs';
import path from 'node:path';
import { runGws } from './lib/gws.mjs';
import { branchExists, changes, currentBranch, gh, ghProblem, git, repoRoot, slug, tryGit } from './lib/git.mjs';

const FOLDER_NAME = 'Agent Tasks';
const SPREADSHEET_NAME = 'Ai Tasks';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const SHEET_MIME = 'application/vnd.google-apps.spreadsheet';
const STATUSES = ['To Do', 'In Progress', 'Pending', 'Complete', 'Blocked'];
const SIGN_IN_AGAIN = 'The Google sign-in has expired or is missing (many company accounts must sign in again every 16 hours). '
  + 'Sign the user in again as the "Google sign-in" section of the work-from-everywhere skill describes, then run this command again.';
// The pull request's proof line until the task is delivered.
const PROOF_PENDING = '**Proof:** added when the task is delivered.';

// The sheet template: header color, a lighter tint for the column body, width in pixels.
const COLUMNS = [
  { name: 'Task No', header: '#37474F', tint: '#ECEFF1', width: 80 },
  { name: 'Description', header: '#1565C0', tint: '#E3F2FD', width: 360, wrap: true },
  { name: 'Status', header: '#6A1B9A', tint: '#F3E5F5', width: 130 },
  { name: 'Context Source', header: '#00838F', tint: '#E0F7FA', width: 240, wrap: true },
  { name: 'Assign datetime', header: '#2E7D32', tint: '#E8F5E9', width: 150, datetime: true },
  { name: 'Complete Datetime', header: '#558B2F', tint: '#F1F8E9', width: 150, datetime: true },
  { name: 'Proof Link', header: '#EF6C00', tint: '#FFF3E0', width: 280 },
  { name: 'PR Link', header: '#283593', tint: '#E8EAF6', width: 280 },
  { name: 'Remark', header: '#AD1457', tint: '#FCE4EC', width: 320, wrap: true },
  { name: 'Session', header: '#4E342E', tint: '#EFEBE9', width: 290 },
];
const COLUMN_LETTER = Object.fromEntries(COLUMNS.map((c, i) => [c.name, String.fromCharCode(65 + i)]));
const STATUS_INDEX = COLUMNS.findIndex((c) => c.name === 'Status');

// Status cell colors: [background, text].
const STATUS_COLORS = {
  'To Do': ['#E0E0E0', '#424242'],
  'In Progress': ['#BBDEFB', '#0D47A1'],
  Pending: ['#FFE082', '#5D4037'],
  Complete: ['#C8E6C9', '#1B5E20'],
  Blocked: ['#FFCDD2', '#B71C1C'],
};

// ---------- gws ----------

const gws = (...args) => gwsIn(undefined, ...args);

// gws only uploads files inside its working directory, so uploads run from the file's folder.
function gwsIn(cwd, ...args) {
  const r = runGws(args, { cwd });
  if (r.missing) throw new Error('gws is not installed. Run the task-setup skill.');
  if (r.status === 2) {
    const error = new Error(SIGN_IN_AGAIN);
    error.code = 'auth';
    throw error;
  }
  if (r.status !== 0 || r.json?.error) {
    const detail = r.json?.error?.message || r.stderr || r.text || `exit code ${r.status}`;
    throw new Error(`gws ${args.slice(0, 3).join(' ')} failed: ${detail}`);
  }
  return r.json ?? { raw: r.text };
}

const params = (p) => ['--params', JSON.stringify(p)];
const body = (b) => ['--json', JSON.stringify(b)];

// ---------- Drive ----------

const quote = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const folderUrl = (id) => `https://drive.google.com/drive/folders/${id}?usp=sharing`;
const sheetUrl = (id) => `https://docs.google.com/spreadsheets/d/${id}/edit`;

function findFolder(name, parentId) {
  const { files = [] } = gws('drive', 'files', 'list', ...params({
    q: `name = '${quote(name)}' and mimeType = '${FOLDER_MIME}' and '${parentId}' in parents and trashed = false`,
    fields: 'files(id)',
    orderBy: 'createdTime',
    pageSize: 10,
  }));
  return files[0]?.id;
}

function createFolder(name, parentId) {
  return gws('drive', 'files', 'create', ...params({ fields: 'id' }),
    ...body({ name, mimeType: FOLDER_MIME, parents: [parentId] })).id;
}

const ensureFolder = (name, parentId) => findFolder(name, parentId) || createFolder(name, parentId);

function exists(fileId) {
  if (!fileId) return false;
  try {
    return !gws('drive', 'files', 'get', ...params({ fileId, fields: 'id,trashed' })).trashed;
  } catch {
    return false;
  }
}

// The Agent Tasks folder and the Ai Tasks spreadsheet. Their IDs are cached in the plugin's data
// folder so a same-named file someone shares with the user is never picked up by mistake.
function workspace(ctx) {
  const cacheFile = path.join(ctx.data, 'drive.json');
  const cache = readJson(cacheFile, {});
  const folderId = exists(cache.folderId) ? cache.folderId : ensureFolder(FOLDER_NAME, 'root');
  let spreadsheetId = exists(cache.spreadsheetId) ? cache.spreadsheetId : null;
  if (!spreadsheetId) {
    const { files = [] } = gws('drive', 'files', 'list', ...params({
      q: `name = '${quote(SPREADSHEET_NAME)}' and mimeType = '${SHEET_MIME}' and 'me' in owners and trashed = false`,
      fields: 'files(id,parents)',
      orderBy: 'createdTime',
      pageSize: 10,
    }));
    spreadsheetId = (files.find((f) => f.parents?.includes(folderId)) || files[0])?.id;
    spreadsheetId ??= gws('drive', 'files', 'create', ...params({ fields: 'id' }),
      ...body({ name: SPREADSHEET_NAME, mimeType: SHEET_MIME, parents: [folderId] })).id;
  }
  writeJson(cacheFile, { folderId, spreadsheetId });
  return { folderId, spreadsheetId };
}

// Uploads a proof folder, mirroring subfolders. Files starting with _ or . stay local.
function upload(dir, folderId, replace, prefix = '') {
  const { files: children = [] } = gws('drive', 'files', 'list', ...params({
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'files(id,name,mimeType)',
    pageSize: 1000,
  }));
  const existing = new Map(children.map((f) => [f.name, f]));
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (/^[._]/.test(entry.name)) continue;
    const full = path.join(dir, entry.name);
    const old = existing.get(entry.name);
    if (entry.isDirectory()) {
      const sub = old?.mimeType === FOLDER_MIME ? old.id : createFolder(entry.name, folderId);
      results.push(...upload(full, sub, replace, `${prefix}${entry.name}/`));
    } else if (old && !replace) {
      results.push({ file: prefix + entry.name, action: 'skipped' });
    } else if (old) {
      gwsIn(dir, 'drive', 'files', 'update', ...params({ fileId: old.id, fields: 'id' }), '--upload', entry.name);
      results.push({ file: prefix + entry.name, action: 'replaced' });
    } else {
      gwsIn(dir, 'drive', '+upload', entry.name, '--parent', folderId);
      results.push({ file: prefix + entry.name, action: 'uploaded' });
    }
  }
  return results;
}

// "Anyone with the link" can view. Workspace admins can block public links; then fall back to
// everyone in the user's company domain.
function share(fileId) {
  const grant = (who) => gws('drive', 'permissions', 'create', ...params({ fileId, fields: 'id' }),
    ...body({ role: 'reader', allowFileDiscovery: false, ...who }));
  try {
    grant({ type: 'anyone' });
    return { scope: 'anyone' };
  } catch (error) {
    const { user } = gws('drive', 'about', 'get', ...params({ fields: 'user(emailAddress)' }));
    const domain = user.emailAddress.split('@')[1];
    if (!domain || /^(gmail|googlemail)\.com$/i.test(domain)) throw error;
    grant({ type: 'domain', domain });
    return { scope: 'domain', domain, reason: error.message };
  }
}

// ---------- Sheets ----------

const a1 = (tab, range) => `'${tab.replace(/'/g, "''")}'!${range}`;
// Keep Sheets from reading text that starts with = + - @ as a formula.
const text = (v) => (/^[=+\-@]/.test(v) ? `'${v}` : v);

function hex(color) {
  const n = parseInt(color.slice(1), 16);
  return { red: (n >> 16) / 255, green: ((n >> 8) & 255) / 255, blue: (n & 255) / 255 };
}

// Everything below the header row in one column, however many rows the tab grows to.
const columnBody = (sheetId, column) => ({ sheetId, startRowIndex: 1, startColumnIndex: column, endColumnIndex: column + 1 });

// Column i's header cell, body format and width.
function columnRequests(sheetId, i) {
  const c = COLUMNS[i];
  const format = { backgroundColor: hex(c.tint), verticalAlignment: 'TOP', wrapStrategy: c.wrap ? 'WRAP' : 'CLIP' };
  if (c.datetime) format.numberFormat = { type: 'DATE_TIME', pattern: 'yyyy-mm-dd hh:mm' };
  return [
    {
      updateCells: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: i, endColumnIndex: i + 1 },
        rows: [{
          values: [{
            userEnteredValue: { stringValue: c.name },
            userEnteredFormat: {
              backgroundColor: hex(c.header),
              horizontalAlignment: 'CENTER',
              verticalAlignment: 'MIDDLE',
              textFormat: { bold: true, foregroundColor: hex('#FFFFFF') },
            },
          }],
        }],
        fields: 'userEnteredValue,userEnteredFormat',
      },
    },
    { repeatCell: { range: columnBody(sheetId, i), cell: { userEnteredFormat: format }, fields: `userEnteredFormat(${Object.keys(format).join(',')})` } },
    { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 }, properties: { pixelSize: c.width }, fields: 'pixelSize' } },
  ];
}

function templateRequests(sheetId) {
  const requests = [
    { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } },
    { updateDimensionProperties: { range: { sheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 34 }, fields: 'pixelSize' } },
  ];
  COLUMNS.forEach((c, i) => requests.push(...columnRequests(sheetId, i)));
  requests.push({
    setDataValidation: {
      range: columnBody(sheetId, STATUS_INDEX),
      rule: { condition: { type: 'ONE_OF_LIST', values: STATUSES.map((s) => ({ userEnteredValue: s })) }, strict: true, showCustomUi: true },
    },
  });
  STATUSES.forEach((status, index) => {
    const [background, foreground] = STATUS_COLORS[status];
    requests.push({
      addConditionalFormatRule: {
        index,
        rule: {
          ranges: [columnBody(sheetId, STATUS_INDEX)],
          booleanRule: {
            condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: status }] },
            format: { backgroundColor: hex(background), textFormat: { bold: true, foregroundColor: hex(foreground) } },
          },
        },
      },
    });
  });
  return requests;
}

// Finds the module's tab, creating it from the template if needed. A brand-new spreadsheet's
// empty default tab becomes the first module tab. A tab made by an older version of the plugin
// gets the columns added since then, in their place.
function ensureTab(spreadsheetId, tab) {
  const { sheets } = gws('sheets', 'spreadsheets', 'get', ...params({ spreadsheetId, fields: 'sheets(properties(sheetId,title))' }));
  const tabs = sheets.map((s) => s.properties);
  const found = tabs.find((t) => t.title === tab);
  if (found) {
    addMissingColumns(spreadsheetId, found);
    return;
  }
  const requests = [];
  let sheetId;
  const lone = tabs.length === 1 ? tabs[0] : null;
  const loneIsEmpty = lone && !gws('sheets', 'spreadsheets', 'values', 'get', ...params({ spreadsheetId, range: a1(lone.title, 'A1:Z20') })).values;
  if (loneIsEmpty) {
    sheetId = lone.sheetId;
    requests.push(
      { updateSheetProperties: { properties: { sheetId, title: tab }, fields: 'title' } },
      { updateSpreadsheetProperties: { properties: { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }, fields: 'timeZone' } },
    );
  } else {
    const taken = new Set(tabs.map((t) => t.sheetId));
    do sheetId = 1 + Math.floor(Math.random() * 2_000_000_000); while (taken.has(sheetId));
    requests.push({ addSheet: { properties: { sheetId, title: tab } } });
  }
  requests.push(...templateRequests(sheetId));
  gws('sheets', 'spreadsheets', 'batchUpdate', ...params({ spreadsheetId }), ...body({ requests }));
}

function addMissingColumns(spreadsheetId, { sheetId, title }) {
  const { values = [] } = gws('sheets', 'spreadsheets', 'values', 'get', ...params({ spreadsheetId, range: a1(title, '1:1') }));
  const header = values[0] || [];
  if (!header.length || COLUMNS.every((c) => header.includes(c.name))) return;
  const requests = [];
  COLUMNS.forEach((c, i) => {
    if (header.includes(c.name)) return;
    // Inserting a column moves the ones to its right, with their data, along by one.
    requests.push({ insertDimension: { range: { sheetId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 }, inheritFromBefore: false } });
    requests.push(...columnRequests(sheetId, i));
    header.splice(i, 0, c.name);
  });
  gws('sheets', 'spreadsheets', 'batchUpdate', ...params({ spreadsheetId }), ...body({ requests }));
}

function taskNumbers(spreadsheetId, tab) {
  const { values = [] } = gws('sheets', 'spreadsheets', 'values', 'get', ...params({ spreadsheetId, range: a1(tab, 'A2:A') }));
  return values.map((row) => Number(row[0]));
}

// The workspace and the task's row, after making sure its tab has every column.
function openRow(ctx, task) {
  const ws = workspace(ctx);
  ensureTab(ws.spreadsheetId, task.module);
  return { ws, row: rowOf(ws.spreadsheetId, task.module, task.taskNo) };
}

function rowOf(spreadsheetId, tab, taskNo) {
  const index = taskNumbers(spreadsheetId, tab).indexOf(Number(taskNo));
  if (index < 0) throw new Error(`Task ${taskNo} isn't in the "${tab}" tab`);
  return index + 2;
}

function readCell(spreadsheetId, tab, row, column) {
  const { values = [] } = gws('sheets', 'spreadsheets', 'values', 'get', ...params({ spreadsheetId, range: a1(tab, `${COLUMN_LETTER[column]}${row}`) }));
  return values[0]?.[0] ?? '';
}

function writeCells(spreadsheetId, tab, row, cells) {
  const data = Object.entries(cells).map(([column, value]) => ({ range: a1(tab, `${COLUMN_LETTER[column]}${row}`), values: [[value]] }));
  gws('sheets', 'spreadsheets', 'values', 'batchUpdate', ...params({ spreadsheetId }), ...body({ valueInputOption: 'USER_ENTERED', data }));
}

// Remarks accumulate, one timestamped line per update.
function withRemark(spreadsheetId, tab, row, status, remark) {
  const old = readCell(spreadsheetId, tab, row, 'Remark');
  const line = `[${now().slice(0, 16)}] ${status}: ${remark}`;
  return text(old ? `${old}\n${line}` : line);
}

// ---------- session state ----------

const sessionFile = (ctx) => path.join(ctx.data, 'sessions', `${ctx.session.replace(/[^\w-]/g, '') || 'no-session'}.json`);

function remember(ctx, task) {
  const file = sessionFile(ctx);
  const state = readJson(file, { tasks: [] });
  const i = state.tasks.findIndex((t) => t.module === task.module && t.taskNo === task.taskNo);
  const merged = { ...state.tasks[i], ...task, updatedAt: new Date().toISOString() };
  if (i >= 0) state.tasks[i] = merged;
  else state.tasks.push(merged);
  writeJson(file, state);
}

function currentTask(ctx, opts) {
  const { tasks } = readJson(sessionFile(ctx), { tasks: [] });
  if (opts.module && opts.task) {
    const taskNo = Number(opts.task);
    return tasks.find((t) => t.module === opts.module && t.taskNo === taskNo) || { module: opts.module, taskNo };
  }
  const open = tasks.filter((t) => t.status !== 'Complete').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const task = open.find((t) => t.status === 'In Progress') || open[0];
  if (!task) throw new Error('This session has no open task. Pass --module and --task.');
  return task;
}

// ---------- commands ----------

function check() {
  const { user } = gws('drive', 'about', 'get', ...params({ fields: 'user(emailAddress,displayName)' }));
  return { ok: true, account: user.emailAddress, name: user.displayName };
}

function ensure(ctx, opts) {
  required(opts, 'module');
  const ws = workspace(ctx);
  ensureTab(ws.spreadsheetId, opts.module);
  return { ok: true, module: opts.module, folderUrl: folderUrl(ws.folderId), spreadsheetUrl: sheetUrl(ws.spreadsheetId) };
}

function start(ctx, opts) {
  required(opts, 'module', 'title', 'description', 'context');
  const status = opts.status || 'In Progress';
  if (!['To Do', 'In Progress'].includes(status)) throw new Error('A new task starts as "To Do" or "In Progress"');
  const ws = workspace(ctx);
  ensureTab(ws.spreadsheetId, opts.module);
  const taskNo = Math.max(0, ...taskNumbers(ws.spreadsheetId, opts.module).filter(Number.isFinite)) + 1;
  const cells = {
    'Task No': taskNo,
    Description: text(opts.description),
    Status: status,
    'Context Source': text(opts.context),
    'Assign datetime': now(),
    Session: `'${ctx.session}`,
  };
  const row = COLUMNS.map((c) => cells[c.name] ?? '');
  const lastColumn = COLUMN_LETTER[COLUMNS.at(-1).name];
  gws('sheets', 'spreadsheets', 'values', 'append',
    ...params({ spreadsheetId: ws.spreadsheetId, range: a1(opts.module, `A:${lastColumn}`), valueInputOption: 'USER_ENTERED', insertDataOption: 'OVERWRITE' }),
    ...body({ values: [row] }));
  remember(ctx, { module: opts.module, taskNo, title: opts.title, status });
  return { ok: true, taskNo, module: opts.module, title: opts.title, status, spreadsheetUrl: sheetUrl(ws.spreadsheetId) };
}

function status(ctx, opts) {
  required(opts, 'status');
  if (!STATUSES.includes(opts.status)) throw new Error(`Status must be one of: ${STATUSES.join(', ')}`);
  if (opts.status === 'Complete') throw new Error('Complete needs proof: use the done command');
  const task = currentTask(ctx, opts);
  const { ws, row } = openRow(ctx, task);
  const cells = { Status: opts.status };
  if (typeof opts.remark === 'string' && opts.remark) cells.Remark = withRemark(ws.spreadsheetId, task.module, row, opts.status, opts.remark);
  writeCells(ws.spreadsheetId, task.module, row, cells);
  remember(ctx, { ...task, status: opts.status });
  return { ok: true, taskNo: task.taskNo, module: task.module, status: opts.status, spreadsheetUrl: sheetUrl(ws.spreadsheetId) };
}

function done(ctx, opts) {
  required(opts, 'proof-dir');
  const dir = path.resolve(opts['proof-dir']);
  if (!fs.existsSync(dir)) throw new Error(`Proof folder not found: ${dir}`);
  const task = currentTask(ctx, opts);
  const title = (typeof opts.title === 'string' && opts.title) || task.title;
  if (!title) throw new Error('Pass --title; it names the Drive folder');
  const { ws, row } = openRow(ctx, task);

  const moduleFolder = ensureFolder(task.module, ws.folderId);
  const name = `${String(task.taskNo).padStart(3, '0')} - ${title.replace(/\s+/g, ' ').trim()}`.slice(0, 120);
  const taskFolder = ensureFolder(name, moduleFolder);
  const files = upload(dir, taskFolder, opts.replace === true);
  if (!files.length) throw new Error(`No proof files to upload in ${dir}`);
  const sharing = share(taskFolder);

  let remark = (typeof opts.remark === 'string' && opts.remark) || 'Delivered';
  if (sharing.scope === 'domain') remark += ` (Public links are blocked for this account, so the proof is shared with ${sharing.domain} only.)`;
  const proofLink = folderUrl(taskFolder);
  writeCells(ws.spreadsheetId, task.module, row, {
    Status: 'Complete',
    'Complete Datetime': now(),
    'Proof Link': proofLink,
    Remark: withRemark(ws.spreadsheetId, task.module, row, 'Complete', remark),
  });
  remember(ctx, { ...task, title, status: 'Complete', proofLink });
  const prNote = task.prUrl ? addProofToPr(task.prUrl, proofLink) : undefined;
  return {
    ok: true,
    taskNo: task.taskNo,
    module: task.module,
    status: 'Complete',
    proofLink,
    ...(task.prUrl && { prUrl: task.prUrl }),
    ...(prNote && { prNote }),
    sharing: sharing.scope,
    ...(sharing.reason && { sharingNote: sharing.reason }),
    uploaded: files,
    spreadsheetUrl: sheetUrl(ws.spreadsheetId),
  };
}

// ---------- git ----------

const repoOf = (opts) => repoRoot(typeof opts.repo === 'string' ? opts.repo : process.cwd());
const branchName = (task) => `task/${slug(task.module, 20)}-${String(task.taskNo).padStart(3, '0')}-${slug(task.title || 'task')}`;

function branch(ctx, opts) {
  const task = currentTask(ctx, opts);
  const root = repoOf(opts);
  if (!root) return { ok: true, skipped: 'The project is not a git repository, so the task gets no branch or pull request' };
  const current = currentBranch(root);
  const name = task.branch || branchName(task);
  if (current === name) return { ok: true, branch: name, base: task.base, switched: false };
  if (!current) return { ok: true, skipped: 'The repository is not on a branch (detached HEAD), so the task gets no branch or pull request' };
  const dirty = changes(root);
  if (dirty.length && opts['allow-dirty'] !== true) {
    return {
      ok: false,
      code: 'dirty',
      error: `The repository has ${dirty.length} uncommitted change(s) on ${current}. A task branch would carry them into the task's pull request.`,
      files: dirty.slice(0, 20),
    };
  }
  git(root, 'switch', '--quiet', ...(branchExists(root, name) ? [name] : ['-c', name]));
  const base = task.base || current;
  remember(ctx, { ...task, branch: name, base });
  return { ok: true, branch: name, base, switched: true, carried: dirty.length };
}

function pr(ctx, opts) {
  const task = currentTask(ctx, opts);
  if (!task.branch) return { ok: true, skipped: 'This task has no branch, so there is no pull request to open' };
  const root = repoOf(opts);
  if (!root) throw new Error('The project is not a git repository. Pass --repo with its folder');
  const current = currentBranch(root);
  if (current !== task.branch) throw new Error(`The repository is on ${current || 'a detached HEAD'}, not the task branch ${task.branch}. Switch back to it first`);

  let committed = null;
  if (changes(root).length) {
    git(root, 'add', '--all');
    git(root, 'commit', '--quiet', '-m', (typeof opts.message === 'string' && opts.message) || task.title || task.branch);
    committed = git(root, 'rev-parse', '--short', 'HEAD');
  }
  const ahead = Number(tryGit(root, 'rev-list', '--count', `${task.base}..HEAD`) || 0);
  if (!ahead) return { ok: true, branch: task.branch, skipped: `The branch has no commits beyond ${task.base}, so there is no pull request` };
  if (!tryGit(root, 'remote', 'get-url', 'origin')) {
    return { ok: true, branch: task.branch, committed, pushed: false, skipped: 'The repository has no "origin" remote, so the branch stays on this computer' };
  }
  git(root, 'push', '--quiet', '--set-upstream', 'origin', task.branch);
  const problem = ghProblem(root);
  if (problem) return { ok: true, branch: task.branch, committed, pushed: true, skipped: `${problem}. The branch is pushed, but no pull request was opened` };

  const { ws, row } = openRow(ctx, task);
  let prUrl = existingPr(root, task.branch);
  const created = !prUrl;
  if (created) {
    const summary = (typeof opts.summary === 'string' && opts.summary) || readCell(ws.spreadsheetId, task.module, row, 'Description');
    const prBody = [
      summary,
      '',
      `**Task:** ${task.module} #${task.taskNo} in the [Ai Tasks sheet](${sheetUrl(ws.spreadsheetId)})`,
      task.proofLink ? `**Proof:** ${task.proofLink}` : PROOF_PENDING,
    ].join('\n');
    const out = gh(root, ['pr', 'create', '--base', task.base, '--head', task.branch, '--title', task.title || task.branch, '--body', prBody]);
    prUrl = out.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('https://')).pop();
    if (!prUrl) throw new Error(`gh pr create didn't print the pull request's link: ${out}`);
  }
  writeCells(ws.spreadsheetId, task.module, row, { 'PR Link': prUrl });
  remember(ctx, { ...task, prUrl });
  return { ok: true, branch: task.branch, base: task.base, committed, pushed: true, prUrl, created };
}

function existingPr(root, head) {
  try {
    return JSON.parse(gh(root, ['pr', 'list', '--head', head, '--state', 'open', '--json', 'url', '--limit', '1']) || '[]')[0]?.url || null;
  } catch {
    return null;
  }
}

// Puts the proof link in the pull request's description. A failure is reported rather than thrown,
// because by then the task is already delivered.
function addProofToPr(prUrl, proofLink) {
  try {
    const { body: old = '' } = JSON.parse(gh(undefined, ['pr', 'view', prUrl, '--json', 'body']));
    const line = `**Proof:** ${proofLink}`;
    if (old.includes(line)) return undefined;
    const updated = /^\*\*Proof:\*\*.*$/m.test(old) ? old.replace(/^\*\*Proof:\*\*.*$/m, line) : `${old}\n\n${line}`;
    gh(undefined, ['pr', 'edit', prUrl, '--body', updated]);
    return undefined;
  } catch (error) {
    return `The proof link couldn't be added to the pull request: ${error.message}`;
  }
}

function show(ctx) {
  const { tasks } = readJson(sessionFile(ctx), { tasks: [] });
  const { spreadsheetId } = readJson(path.join(ctx.data, 'drive.json'), {});
  return { ok: true, session: ctx.session, tasks, spreadsheetUrl: spreadsheetId ? sheetUrl(spreadsheetId) : null };
}

// ---------- helpers ----------

function now() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function required(opts, ...names) {
  const missing = names.filter((n) => typeof opts[n] !== 'string' || !opts[n]);
  if (missing.length) throw new Error(`Missing ${missing.map((n) => `--${n}`).join(', ')}`);
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

const commands = { check, ensure, start, status, branch, pr, done, show };
try {
  const { command, opts } = parseArgs(process.argv.slice(2));
  if (!commands[command]) throw new Error(`Unknown command "${command}". Use one of: ${Object.keys(commands).join(', ')}`);
  const data = typeof opts.data === 'string' ? opts.data : process.env.CLAUDE_PLUGIN_DATA;
  if (!data) throw new Error('Pass --data with the plugin data folder');
  const session = typeof opts.session === 'string' ? opts.session : process.env.CLAUDE_CODE_SESSION_ID || '';
  console.log(JSON.stringify(commands[command]({ data, session }, opts), null, 2));
} catch (error) {
  console.log(JSON.stringify({ ok: false, ...(error.code === 'auth' && { code: 'auth' }), error: error.message }, null, 2));
  process.exitCode = 1;
}
