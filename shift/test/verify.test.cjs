'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const { runVerify } = require('../lib/verify.cjs');

test('a null/empty command is a pass', () => {
  assert.deepEqual(runVerify(null, '.'), { ok: true, output: '' });
  assert.deepEqual(runVerify('', '.'), { ok: true, output: '' });
});

test('uses the injected exec and returns its result', () => {
  const fake = (cmd, cwd) => ({ ok: false, output: `ran ${cmd} in ${cwd}` });
  const r = runVerify('npm test', '/repo', fake);
  assert.equal(r.ok, false);
  assert.match(r.output, /ran npm test in \/repo/);
});

test('default exec: zero exit passes, non-zero fails, output captured', () => {
  assert.equal(runVerify('true', os.tmpdir()).ok, true);
  assert.equal(runVerify('false', os.tmpdir()).ok, false);
  const r = runVerify('echo hi', os.tmpdir());
  assert.equal(r.ok, true);
  assert.match(r.output, /hi/);
});
