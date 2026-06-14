'use strict';
const fs = require('node:fs');
const path = require('node:path');

function cachePath(dir) { return path.join(dir, 'usage.json'); }

function num(v) { return (typeof v === 'number' && Number.isFinite(v)) ? v : null; }

// Cache the rate-limit data from a hook payload so the headless runner can read
// the reset time and current usage between spawns. Returns the weekly % (or null).
// Absent/partial rate_limits degrade to null and write nothing.
function writeUsageCache(dir, rateLimits, nowSec) {
  if (!rateLimits || typeof rateLimits !== 'object') return null;
  const fh = rateLimits.five_hour || {};
  const sd = rateLimits.seven_day || {};
  const cache = {
    weeklyPercent: num(sd.used_percentage),
    sessionUsedPercent: num(fh.used_percentage),
    sessionResetAt: num(fh.resets_at),
    weeklyResetAt: num(sd.resets_at),
    capturedAt: typeof nowSec === 'number' ? nowSec : null
  };
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(cachePath(dir), JSON.stringify(cache, null, 2));
  } catch { /* best-effort */ }
  return cache.weeklyPercent;
}

function readUsageCache(dir) {
  try { return JSON.parse(fs.readFileSync(cachePath(dir), 'utf8')); }
  catch { return null; }
}

module.exports = { writeUsageCache, readUsageCache };
