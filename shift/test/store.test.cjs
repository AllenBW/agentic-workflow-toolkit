'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'shift-store-'));
process.env.SHIFT_STATE_DIR = BASE;
const { engineDir } = require('../lib/store.cjs');

function repo() { return fs.mkdtempSync(path.join(os.tmpdir(), 'shift-storerepo-')); }

test('engineDir basename is the 16-hex sha256 of the realpath, under the state base', () => {
  const c = repo();
  const d = engineDir(c);
  assert.equal(path.dirname(d), BASE);
  const expected = crypto.createHash('sha256').update(fs.realpathSync(c)).digest('hex').slice(0, 16);
  assert.equal(path.basename(d), expected);
  assert.match(path.basename(d), /^[0-9a-f]{16}$/);
});

test('engineDir is idempotent and lives outside the repo', () => {
  const c = repo();
  assert.equal(engineDir(c), engineDir(c));
  assert.ok(!engineDir(c).startsWith(path.resolve(c)), 'not inside the working repo');
});

test('sibling repos sharing a basename get distinct engine dirs (full-path hash, no prefix collision)', () => {
  const parentA = fs.mkdtempSync(path.join(os.tmpdir(), 'shift-collide-aaaa-'));
  const parentB = fs.mkdtempSync(path.join(os.tmpdir(), 'shift-collide-bbbb-'));
  fs.mkdirSync(path.join(parentA, 'repo')); fs.mkdirSync(path.join(parentB, 'repo'));
  assert.notEqual(engineDir(path.join(parentA, 'repo')), engineDir(path.join(parentB, 'repo')));
});

test('base resolution: SHIFT_STATE_DIR wins; else XDG_STATE_HOME/shift; (homedir/.local/state/shift is the documented default)', () => {
  const c = repo();
  // SHIFT_STATE_DIR (set above) takes precedence
  assert.ok(engineDir(c).startsWith(BASE));
  // when SHIFT_STATE_DIR is unset, XDG_STATE_HOME is used
  const savedShift = process.env.SHIFT_STATE_DIR;
  const savedXdg = process.env.XDG_STATE_HOME;
  const xdg = fs.mkdtempSync(path.join(os.tmpdir(), 'shift-xdg-'));
  try {
    delete process.env.SHIFT_STATE_DIR;
    process.env.XDG_STATE_HOME = xdg;
    assert.ok(engineDir(c).startsWith(path.join(xdg, 'shift') + path.sep), 'XDG_STATE_HOME/shift base');
  } finally {
    process.env.SHIFT_STATE_DIR = savedShift;
    if (savedXdg === undefined) delete process.env.XDG_STATE_HOME; else process.env.XDG_STATE_HOME = savedXdg;
  }
});
