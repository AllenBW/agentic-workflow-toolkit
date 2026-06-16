'use strict';
const fs = require('node:fs');
const path = require('node:path');

// File-based control channel between `shift watch` (writer) and the engine
// (reader: the Stop hook + the headless runner). Files live in .shift/:
//   STOP   — kill switch (already honored by the hook); finalize after current bin.
//   PAUSE  — the headless runner idles while this exists; cleared to resume.
//   SKIP   — contains a bin id; the hook marks that bin 'skipped' and moves on.
// Everything is best-effort and absence-means-off, so a missing dir never throws.

function p(dir, name) { return path.join(dir, name); }
function exists(file) { try { return fs.existsSync(file); } catch { return false; } }
function touch(dir, name) {
  try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(p(dir, name), ''); } catch { /* best-effort */ }
}
function remove(dir, name) { try { fs.unlinkSync(p(dir, name)); } catch { /* already gone */ } }

function requestStop(dir) { touch(dir, 'STOP'); }
function isStopRequested(dir) { return exists(p(dir, 'STOP')); }

function setPause(dir, on) { if (on) touch(dir, 'PAUSE'); else remove(dir, 'PAUSE'); }
function isPaused(dir) { return exists(p(dir, 'PAUSE')); }

function requestSkip(dir, binId) {
  try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(p(dir, 'SKIP'), String(binId || '')); }
  catch { /* best-effort */ }
}
function readSkip(dir) {
  try {
    const v = fs.readFileSync(p(dir, 'SKIP'), 'utf8').trim();
    return v || null;
  } catch { return null; }
}
function clearSkip(dir) { remove(dir, 'SKIP'); }

module.exports = {
  requestStop, isStopRequested,
  setPause, isPaused,
  requestSkip, readSkip, clearSkip
};
