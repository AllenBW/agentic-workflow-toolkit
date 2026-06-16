'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { renderBrief } = require('../lib/brief.cjs');

const bin = { id: 'queue/01.md', text: 'Do the thing.' };

test('includes the bin text, id, and definition of done', () => {
  const out = renderBrief(bin, { definitionOfDone: 'tests pass', git: {} });
  assert.match(out, /Do the thing\./);
  assert.match(out, /queue\/01\.md/);
  assert.match(out, /tests pass/);
});

test('forbids push and outward actions by default', () => {
  const out = renderBrief(bin, { git: { allowPush: false, allowOutwardActions: false } });
  assert.match(out, /Do NOT/);
  assert.match(out, /push to any remote/);
});

test('omits the forbid-guard when everything is allowed', () => {
  const out = renderBrief(bin, { git: { allowPush: true, allowOutwardActions: true } });
  assert.doesNotMatch(out, /Do NOT push/);
});

test('always explains decision logging, the Needs-you convention, and blocker flagging', () => {
  const out = renderBrief(bin, { git: {} });
  assert.match(out, /\.shift\/log\.md/);
  assert.match(out, /Needs you:/);
  assert.match(out, /blocked\.jsonl/);
});

test('guards .shift/ bookkeeping: append-only, never edit config.json (so the hook owns the run record)', () => {
  const out = renderBrief(bin, { git: {} });
  // state.json now lives out-of-repo (engineDir, store.cjs) and is beyond the agent's reach,
  // so the prompt no longer names it; it guards the repo-side surface the agent CAN touch.
  assert.match(out, /Never edit.*config\.json/i);
  assert.doesNotMatch(out, /state\.json/);
  assert.match(out, /append/i);
});
