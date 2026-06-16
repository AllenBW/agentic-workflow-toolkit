'use strict';
const fs = require('node:fs');

// Token accounting from a Claude Code transcript JSONL. Each assistant message line
// carries message.usage { input_tokens, output_tokens, cache_read_input_tokens,
// cache_creation_input_tokens } and a top-level ISO `timestamp` — so we can attribute
// tokens to a bin by summing the usage of messages within that bin's [start, end) window.

// sumUsage(lines, fromMs, toMs) — pure. fromMs/toMs are epoch ms or null (open bound).
function sumUsage(lines, fromMs, toMs) {
  const acc = { output: 0, input: 0, cacheRead: 0, cacheCreate: 0, total: 0, messages: 0 };
  for (const line of lines) {
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (!o || o.type !== 'assistant' || !o.message || !o.message.usage) continue;
    const t = Date.parse(o.timestamp);
    if (!Number.isFinite(t)) continue;
    if (fromMs != null && t < fromMs) continue;
    if (toMs != null && t >= toMs) continue;
    const u = o.message.usage;
    const out = u.output_tokens || 0;
    const inp = u.input_tokens || 0;
    const cr = u.cache_read_input_tokens || 0;
    const cc = u.cache_creation_input_tokens || 0;
    acc.output += out; acc.input += inp; acc.cacheRead += cr; acc.cacheCreate += cc;
    acc.total += out + inp + cr + cc; acc.messages += 1;
  }
  return acc;
}

function readLines(file) {
  try { return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean); }
  catch { return []; }
}

// Convenience over a file path within an ISO window (either bound optional).
function sumTokens(file, fromIso, toIso) {
  return sumUsage(readLines(file), fromIso ? Date.parse(fromIso) : null, toIso ? Date.parse(toIso) : null);
}

module.exports = { sumUsage, sumTokens, readLines };
