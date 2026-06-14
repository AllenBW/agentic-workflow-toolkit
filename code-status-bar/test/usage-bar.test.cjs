'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const cp = require('node:child_process');
const path = require('node:path');

const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'usage-bar.cjs');
const ESC = '\x1b';
const YELLOW = `${ESC}[38;2;252;233;79m`;
const GREEN = `${ESC}[38;2;138;226;52m`;
const RED = `${ESC}[38;2;239;41;41m`;

function run(args, payload) {
  return cp.execFileSync('node', [SCRIPT, ...args], {
    input: payload === undefined ? '' : JSON.stringify(payload),
    encoding: 'utf8'
  });
}

function rl(over) {
  const now = Math.floor(Date.now() / 1000);
  return {
    rate_limits: Object.assign({
      five_hour: { used_percentage: 72, resets_at: now + 7200 },
      seven_day: { used_percentage: 41, resets_at: now + 432000 },
      seven_day_opus: { used_percentage: 88, resets_at: now + 432000 }
    }, over || {})
  };
}

test('session at 72% renders bold yellow with label and percent', () => {
  const out = run(['session'], rl());
  assert.ok(out.includes(YELLOW), 'expected yellow');
  assert.ok(out.includes('Session: '), 'expected label');
  assert.ok(out.includes('72.0%'), 'expected percent');
  assert.ok(out.startsWith(`${ESC}[1m`), 'expected bold prefix');
});

test('weekly at 41% is green, opus at 88% is red', () => {
  assert.ok(run(['weekly'], rl()).includes(GREEN));
  assert.ok(run(['opus'], rl()).includes(RED));
});

test('multiple limits are joined with a separator', () => {
  const out = run(['weekly', 'opus'], rl());
  assert.ok(out.includes('Weekly: '));
  assert.ok(out.includes('Weekly Opus: '));
  assert.ok(out.includes(' | '));
});

test('absent data renders nothing so the widget collapses', () => {
  assert.equal(run(['session'], {}), '');
  assert.equal(run(['session']), '');
  assert.equal(run(['session'], rl({ five_hour: undefined })), '');
});

test('non-numeric percentage renders nothing', () => {
  assert.equal(run(['session'], rl({ five_hour: { used_percentage: 'oops', resets_at: 0 } })), '');
});

test('thresholds: 50 -> yellow, just under -> green; 85 -> red, just under -> yellow', () => {
  const at = (p) => run(['session'], rl({
    five_hour: { used_percentage: p, resets_at: Math.floor(Date.now() / 1000) + 1 }
  }));
  assert.ok(at(50).includes(YELLOW), '50 should be yellow');
  assert.ok(at(49.9).includes(GREEN), '49.9 should be green');
  assert.ok(at(85).includes(RED), '85 should be red');
  assert.ok(at(84.9).includes(YELLOW), '84.9 should be yellow');
});

test('unknown limit name renders nothing', () => {
  assert.equal(run(['bogus'], rl()), '');
});
