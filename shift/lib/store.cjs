'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

// Where shift keeps the engine's AUTHORITATIVE mutable state — state.json, timeline,
// usage cache, work-record history. It lives OUTSIDE the working repo, keyed by the
// repo's canonical path, because an autonomous agent rewrites/deletes files it finds
// under .shift/ (observed: it marked bins done in state.json itself, usurping the engine
// and erasing per-bin boundaries). A Stop hook is NOT sandboxed (verified it can write
// ~/.local/state), so the hook owns this dir while the agent — which only operates inside
// the repo — can't reach it.
//
// .shift/ in the repo keeps only what the user or agent legitimately touches: config.json
// (user-edited), summary.md (user-read), log.md / blocked.jsonl (agent-appended), and the
// control signals (STOP/PAUSE/SKIP, written by `shift watch`).
//
// Two rules keep the hook (writer) and watch/history (readers) on the same path:
//   1. realpathSync — macOS /tmp is a symlink to /private/tmp; the hook payload cwd is
//      already canonical, so readers must canonicalize too.
//   2. hash the FULL canonical path (a prefix slice collides for sibling temp dirs).
// SHIFT_STATE_DIR overrides the base (tests; also a valid explicit override).

function base() {
  return process.env.SHIFT_STATE_DIR
    || path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'), 'shift');
}
function canonical(cwd) {
  try { return fs.realpathSync(path.resolve(cwd)); } catch { return path.resolve(cwd); }
}

// engineDir(cwd) -> the out-of-repo state directory for the repo rooted at cwd.
function engineDir(cwd) {
  const dir = path.join(base(), crypto.createHash('sha256').update(canonical(cwd)).digest('hex').slice(0, 16));
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* best-effort */ }
  return dir;
}

module.exports = { engineDir };
