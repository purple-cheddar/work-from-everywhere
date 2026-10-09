// git and GitHub CLI (gh) helpers for task branches and pull requests. Both run without a shell, so
// titles and bodies reach them exactly as written.

import { spawnSync } from 'node:child_process';

function run(cmd, args, cwd, input) {
  const r = spawnSync(cmd, args, { cwd, input, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (r.error) return { missing: r.error.code === 'ENOENT', status: -1, out: '', err: r.error.message };
  return { status: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

export function git(cwd, ...args) {
  const r = run('git', args, cwd);
  if (r.missing) throw new Error('git is not installed');
  if (r.status !== 0) throw new Error(`git ${args[0]} failed: ${r.err || r.out || `exit code ${r.status}`}`);
  return r.out;
}

// Like git(), but returns null instead of throwing.
export function tryGit(cwd, ...args) {
  const r = run('git', args, cwd);
  return r.status === 0 ? r.out : null;
}

export function gh(cwd, args, input) {
  const r = run('gh', args, cwd, input);
  if (r.missing) throw new Error('The GitHub CLI (gh) is not installed');
  if (r.status !== 0) throw new Error(`gh ${args.slice(0, 2).join(' ')} failed: ${r.err || r.out || `exit code ${r.status}`}`);
  return r.out;
}

// Why gh can't open a pull request for this repository, or null when it can.
export function ghProblem(cwd) {
  const version = run('gh', ['--version'], cwd);
  if (version.missing) return 'The GitHub CLI (gh) is not installed. Install it from https://cli.github.com and run `gh auth login`';
  if (run('gh', ['auth', 'status'], cwd).status !== 0) return 'The GitHub CLI is not signed in. Run `gh auth login`';
  const remote = tryGit(cwd, 'remote', 'get-url', 'origin');
  if (!remote) return 'The repository has no "origin" remote';
  if (!/github\.com[:/]/i.test(remote)) return `The "origin" remote isn't on GitHub (${remote})`;
  return null;
}

export const repoRoot = (cwd) => tryGit(cwd, 'rev-parse', '--show-toplevel');

// Uncommitted files, as `git status --porcelain` lines.
export function changes(cwd) {
  const out = git(cwd, 'status', '--porcelain', '--untracked-files=all');
  return out ? out.split('\n') : [];
}

export const currentBranch = (cwd) => tryGit(cwd, 'symbolic-ref', '--quiet', '--short', 'HEAD');

export const branchExists = (cwd, name) => tryGit(cwd, 'rev-parse', '--verify', '--quiet', `refs/heads/${name}`) !== null;

// The branch "origin" opens on (usually main), from the local origin/HEAD or else by asking the remote.
export function remoteDefaultBranch(cwd) {
  const local = tryGit(cwd, 'symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD');
  if (local) return local.replace(/^origin\//, '');
  const head = tryGit(cwd, 'ls-remote', '--symref', 'origin', 'HEAD');
  return head?.match(/^ref: refs\/heads\/(\S+)\s+HEAD/m)?.[1] || null;
}

// The branch a pull request can merge into: `name` when "origin" has it, otherwise the remote's default
// branch. A desktop-app worktree starts on a local-only branch such as claude/<name>, which GitHub
// can't use as a base. Without an "origin" remote, `name` is kept.
export function prBase(cwd, name) {
  if (!tryGit(cwd, 'remote', 'get-url', 'origin')) return name;
  if (tryGit(cwd, 'ls-remote', '--exit-code', '--heads', 'origin', `refs/heads/${name}`) !== null) return name;
  return remoteDefaultBranch(cwd) || name;
}

export function slug(text, max = 40) {
  return String(text).toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').replace(/[\s_-]+/g, '-')
    .replace(/^-|-$/g, '').slice(0, max).replace(/-$/, '') || 'task';
}
