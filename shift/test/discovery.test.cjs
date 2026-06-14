'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { discoverBins, hashText } = require('../lib/discovery.cjs');

function tmpRepo() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'shift-disc-'));
  fs.mkdirSync(path.join(d, 'queue'), { recursive: true });
  fs.mkdirSync(path.join(d, 'plans'), { recursive: true });
  fs.writeFileSync(path.join(d, 'queue', '02-b.md'), 'second');
  fs.writeFileSync(path.join(d, 'queue', '01-a.md'), 'first');
  fs.writeFileSync(path.join(d, 'queue', 'notes.txt'), 'ignored');
  fs.writeFileSync(path.join(d, 'plans', 'p1.md'), 'plan one');
  return d;
}

test('discovers .md files, ordered by source then filename', () => {
  const cwd = tmpRepo();
  const bins = discoverBins([{ path: 'queue', kind: 'briefs' }, { path: 'plans', kind: 'plans' }], cwd);
  assert.deepEqual(bins.map(b => b.id), ['queue/01-a.md', 'queue/02-b.md', 'plans/p1.md']);
  assert.equal(bins[0].kind, 'briefs');
  assert.equal(bins[2].kind, 'plans');
  assert.equal(bins[0].text, 'first');
});

test('hash is stable for same content, differs for different content', () => {
  assert.equal(hashText('x'), hashText('x'));
  assert.notEqual(hashText('x'), hashText('y'));
});

test('missing source folder yields no bins (no throw)', () => {
  const cwd = tmpRepo();
  assert.deepEqual(discoverBins([{ path: 'does-not-exist', kind: 'briefs' }], cwd), []);
});
