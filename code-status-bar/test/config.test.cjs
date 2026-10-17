'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const CONFIGS = ['settings.json', 'settings.colored.json'];
const WRAPPER = path.join(ROOT, 'scripts', 'statusline.sh');

function load(name) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, name), 'utf8'));
}

for (const name of CONFIGS) {
  test(`${name}: context bar leads line 1 so truncation never hides it`, () => {
    // ccstatusline truncates overflowing lines from the right. When the context
    // bar sat after cwd/branch it was the first thing cut in narrow panes.
    const line1 = load(name).lines[0];
    assert.strictEqual(line1[0].type, 'context-bar');
    const flex = line1.findIndex((w) => w.type === 'flex-separator');
    const cwd = line1.findIndex((w) => w.type === 'current-working-dir');
    assert.ok(flex > 0 && cwd > flex, 'workspace/git fields belong after the flex separator');
  });

  test(`${name}: uses ccstatusline's v4 schema (no deprecated hide flags)`, () => {
    const cfg = load(name);
    assert.strictEqual(cfg.version, 4);
    for (const w of cfg.lines.flat()) {
      const meta = w.metadata || {};
      assert.ok(!('hideZero' in meta) && !('hideNoGit' in meta), `${w.id} uses a v3 hide flag`);
    }
  });
}

test('statusline.sh renders through the pinned engine and passes the payload on stdin', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'csb-'));
  const engine = path.join(home, '.config/ccstatusline/engine/node_modules/ccstatusline/dist');
  fs.mkdirSync(engine, { recursive: true });
  fs.writeFileSync(path.join(engine, 'ccstatusline.js'),
    "process.stdout.write('ENGINE:' + require('fs').readFileSync(0, 'utf8'))");
  const out = cp.execFileSync('sh', [WRAPPER], {
    input: '{"x":1}',
    encoding: 'utf8',
    env: { ...process.env, HOME: home, CCSTATUSLINE_CONFIG_DIR: '' }
  });
  assert.strictEqual(out, 'ENGINE:{"x":1}');
});
