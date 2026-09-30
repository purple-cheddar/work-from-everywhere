#!/usr/bin/env node
// PreToolUse hook for the PowerShell tool.
//
// The gws skills are written for a POSIX shell, and Windows PowerShell 5.1
// strips the inner quotes from JSON arguments: --params '{"pageSize": 5}'
// reaches gws as {pageSize: 5} and fails. Blocking gws here (exit code 2)
// makes Claude re-run the command with the Bash tool (Git Bash) instead.

// gws in command position: at the start of a line or after ; | & ( { =
const GWS_COMMAND = /(^|[;|&({=])\s*(&\s*)?["']?gws(\.(cmd|ps1|exe))?["']?(?=\s|$|[;|)}])/im;

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => (input += chunk));
process.stdin.on('end', () => {
  let command = '';
  try {
    command = JSON.parse(input).tool_input?.command ?? '';
  } catch {
    process.exit(0); // unreadable input: never block
  }

  if (GWS_COMMAND.test(command)) {
    process.stderr.write(
      'Blocked by the work-from-everywhere plugin: run gws with the Bash tool (Git Bash), not PowerShell. ' +
        'The gws skills use POSIX shell syntax, and Windows PowerShell 5.1 strips the inner quotes from ' +
        `JSON arguments like --params '{"pageSize": 5}'. Re-run the same command with the Bash tool.`
    );
    process.exit(2);
  }
  process.exit(0);
});
