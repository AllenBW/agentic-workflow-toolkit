'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function hashText(text) {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 12);
}

function listMarkdown(dirAbs) {
  let entries;
  try { entries = fs.readdirSync(dirAbs, { withFileTypes: true }); }
  catch { return []; }
  return entries.filter(e => e.isFile() && e.name.endsWith('.md')).map(e => e.name).sort();
}

// sources: [{ path, kind }]. cwd: repo root. Returns ordered bins (source then filename).
function discoverBins(sources, cwd) {
  const bins = [];
  for (const source of sources) {
    const dirAbs = path.resolve(cwd, source.path);
    for (const name of listMarkdown(dirAbs)) {
      const text = fs.readFileSync(path.join(dirAbs, name), 'utf8');
      bins.push({
        id: path.posix.join(source.path, name),
        hash: hashText(text),
        kind: source.kind || 'briefs',
        text
      });
    }
  }
  return bins;
}

module.exports = { discoverBins, hashText };
