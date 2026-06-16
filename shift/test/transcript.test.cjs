'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { sumUsage } = require('../lib/transcript.cjs');

// Build a transcript line like Claude Code writes (assistant message with usage).
function asst(tsIso, usage) {
  return JSON.stringify({ type: 'assistant', timestamp: tsIso, message: { role: 'assistant', usage } });
}
const U = (output, input = 0, cacheRead = 0, cacheCreate = 0) =>
  ({ output_tokens: output, input_tokens: input, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: cacheCreate });

const lines = [
  JSON.stringify({ type: 'user', timestamp: '2026-06-16T00:00:00Z', message: {} }),     // ignored (not assistant)
  asst('2026-06-16T00:01:00Z', U(100, 2000, 5000, 300)),                                  // in window A
  asst('2026-06-16T00:02:00Z', U(50, 1000, 6000, 0)),                                     // in window A
  asst('2026-06-16T00:10:00Z', U(999, 1, 1, 1)),                                          // window B
  '{ not json',                                                                            // malformed → skipped
  JSON.stringify({ type: 'assistant', timestamp: '2026-06-16T00:12:00Z', message: {} })   // assistant w/o usage → skipped
];

test('sums output/input/cache for assistant messages, ignores non-assistant + malformed', () => {
  const all = sumUsage(lines, null, null);
  assert.equal(all.output, 100 + 50 + 999);
  assert.equal(all.input, 2000 + 1000 + 1);
  assert.equal(all.cacheRead, 5000 + 6000 + 1);
  assert.equal(all.messages, 3);
  assert.equal(all.total, all.output + all.input + all.cacheRead + all.cacheCreate);
});

test('windows by [from, to): includes from, excludes to', () => {
  const from = Date.parse('2026-06-16T00:00:30Z');
  const to = Date.parse('2026-06-16T00:09:00Z');
  const win = sumUsage(lines, from, to);
  assert.equal(win.output, 150);   // only the two window-A messages
  assert.equal(win.messages, 2);
});

test('empty / no-match window yields zeros, never throws', () => {
  const z = sumUsage([], 0, 1);
  assert.equal(z.output, 0);
  assert.equal(z.total, 0);
  assert.equal(z.messages, 0);
});
