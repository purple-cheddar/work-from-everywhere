#!/usr/bin/env node
// Stop hook for the /work-from-everywhere workflow.
//
// If a task this session started is still In Progress, or queued as To Do, when Claude is about
// to stop, block the stop once (exit code 2) and tell Claude to update it, so the Ai Tasks sheet
// never shows stale work. The task list is the session file tracker.mjs keeps in the plugin's
// data folder.

import fs from 'node:fs';
import path from 'node:path';

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => (input += chunk));
process.stdin.on('end', () => {
  let event;
  try {
    event = JSON.parse(input);
  } catch {
    process.exit(0); // unreadable input: never block
  }
  // stop_hook_active means this stop was already blocked once: let Claude stop instead of looping.
  const data = process.env.CLAUDE_PLUGIN_DATA;
  if (event.stop_hook_active || !event.session_id || !data) process.exit(0);

  let tasks;
  try {
    const file = path.join(data, 'sessions', `${String(event.session_id).replace(/[^\w-]/g, '')}.json`);
    tasks = JSON.parse(fs.readFileSync(file, 'utf8')).tasks || [];
  } catch {
    process.exit(0); // this session hasn't tracked any task
  }

  const active = tasks.filter((t) => t.status === 'In Progress');
  const queued = tasks.filter((t) => t.status === 'To Do');
  if (!active.length && !queued.length) process.exit(0);

  const name = (t) => `#${t.taskNo} "${t.title}" (${t.module})`;
  const lines = [];
  if (active.length) {
    lines.push(
      `${active.map(name).join(', ')} is still In Progress in the Ai Tasks sheet. Before you stop, update it:`,
      '- Finished: run the task-proof skill, then the task-done skill.',
      '- Waiting on the user: run the task-status skill with Pending, and put what you need in the remark.',
      "- Can't continue: run the task-status skill with Blocked, and put what happened in the remark.",
    );
  }
  if (queued.length) {
    lines.push(`Queued as To Do: ${queued.map(name).join(', ')}. Set the next one to In Progress with the task-status skill and work on it.`);
  }
  process.stderr.write(lines.join('\n'));
  process.exit(2);
});
