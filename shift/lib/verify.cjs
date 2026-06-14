'use strict';
const cp = require('node:child_process');

// Run a per-bin verification command in `cwd`. `exec` is injectable for tests.
// Returns { ok: boolean, output: string }. A null/empty command is a pass.
function runVerify(command, cwd, exec) {
  if (!command) return { ok: true, output: '' };
  return (exec || defaultExec)(command, cwd);
}

function defaultExec(command, cwd) {
  // shell:true is intentional — `command` is the user's own config value (e.g.
  // "npm test && npm run build") and is passed as a whole, not interpolated into
  // a larger string. It is never built from untrusted input.
  const r = cp.spawnSync(command, {
    cwd, shell: true, encoding: 'utf8',
    timeout: 10 * 60 * 1000,
    maxBuffer: 10 * 1024 * 1024
  });
  return { ok: r.status === 0, output: `${r.stdout || ''}${r.stderr || ''}` };
}

module.exports = { runVerify };
