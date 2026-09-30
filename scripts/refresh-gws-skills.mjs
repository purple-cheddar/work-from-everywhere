#!/usr/bin/env node
// Maintainer tool: refreshes the bundled gws skills and keeps them out of the / menu.
//
//   node scripts/refresh-gws-skills.mjs              Regenerate the gws-* skills with the installed gws,
//                                                   replace skills/gws-*, and hide them from the / menu
//   node scripts/refresh-gws-skills.mjs --hide-only  Only hide the current skills/gws-* from the / menu
//
// A hidden skill has `user-invocable: false`: Claude still uses it when a request involves Gmail,
// Calendar, Drive and so on, but it doesn't appear when someone types /. `gws generate-skills` also
// writes persona-* and recipe-* skills; the plugin leaves those out on purpose.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runGws } from './lib/gws.mjs';

const SKILLS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills');
const isGws = (name) => name.startsWith('gws-');

// Adds `user-invocable: false` as the last frontmatter key. Returns false if it's already set.
function hide(file) {
  const text = fs.readFileSync(file, 'utf8');
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/);
  if (!match) throw new Error(`No frontmatter in ${file}`);
  if (/^user-invocable:/m.test(match[1])) return false;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  fs.writeFileSync(file, text.replace(match[0], `---${eol}${match[1]}${eol}user-invocable: false${eol}---${match[2]}`));
  return true;
}

function regenerate() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gws-skills-'));
  try {
    // gws generate-skills always writes skills/ and docs/ into its working directory.
    const r = runGws(['generate-skills'], { cwd: tmp });
    if (r.missing) throw new Error('gws is not installed');
    if (r.status !== 0) throw new Error(`gws generate-skills failed: ${r.stderr || r.text}`);
    const generated = path.join(tmp, 'skills');
    const fresh = fs.readdirSync(generated).filter(isGws);
    if (!fresh.length) throw new Error('gws generate-skills produced no gws-* skills');
    for (const name of fs.readdirSync(SKILLS).filter(isGws)) fs.rmSync(path.join(SKILLS, name), { recursive: true, force: true });
    for (const name of fresh) fs.cpSync(path.join(generated, name), path.join(SKILLS, name), { recursive: true });
    return fresh.length;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

try {
  const hideOnly = process.argv.includes('--hide-only');
  const regenerated = hideOnly ? 0 : regenerate();
  const names = fs.readdirSync(SKILLS).filter(isGws);
  const hidden = names.filter((name) => hide(path.join(SKILLS, name, 'SKILL.md'))).length;
  console.log(`${hideOnly ? '' : `Regenerated ${regenerated} gws skills. `}Hid ${hidden} of ${names.length} gws skills from the / menu (the rest already were).`);
} catch (error) {
  console.error(`refresh-gws-skills: ${error.message}`);
  process.exitCode = 1;
}
