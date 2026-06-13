#!/usr/bin/env node
/*
 * usage-bar.cjs — threshold-colored usage bars for the Code Status Bar (colored variant).
 *
 * Invoked by ccstatusline `custom-command` widgets with `preserveColors: true`.
 * Receives Claude Code's full status payload as JSON on stdin and prints a single
 * ANSI-colored bar for the requested limit(s). Color is driven by how close you are
 * to the limit: green (healthy) -> yellow (caution) -> red (near the wall).
 *
 * Usage:  node usage-bar.cjs <limit> [<limit> ...]
 *   limits: session | weekly | opus   (multiple are joined with a separator)
 *
 * No dependencies beyond Node (which ccstatusline already runs on). Prints nothing
 * when the matching rate-limit data is absent, so the widget cleanly collapses.
 */
'use strict';

const fs = require('fs');

const WIDTH = 16;
const FIVE_HOUR_MS = 5 * 60 * 60 * 1000;
const SEVEN_DAY_MS = 7 * 24 * 60 * 60 * 1000;

// Thresholds: green < 50%, yellow 50–85%, red >= 85%. Tweak here to taste.
const YELLOW_AT = 50;
const RED_AT = 85;
const COLORS = {
    green: [138, 226, 52],
    yellow: [252, 233, 79],
    red: [239, 41, 41]
};
const SEP_COLOR = [91, 96, 104]; // dim gray, matches the bar's | separators

function readStdin() {
    try {
        return fs.readFileSync(0, 'utf8');
    } catch (_e) {
        return '';
    }
}

function colorOf(pct) {
    if (pct >= RED_AT) return COLORS.red;
    if (pct >= YELLOW_AT) return COLORS.yellow;
    return COLORS.green;
}

function fg(rgb) {
    return `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m`;
}

function renderOne(node, label, windowMs) {
    if (!node) return null;
    const rawPct = node.used_percentage;
    if (rawPct === undefined || rawPct === null) return null;

    const pct = Math.max(0, Math.min(100, Number(rawPct)));
    if (Number.isNaN(pct)) return null;

    const filled = Math.round((pct / 100) * WIDTH);

    // Pace cursor: where we are through the reset window, in time.
    let cursor = -1;
    const resetAt = node.resets_at;
    if (typeof resetAt === 'number' && Number.isFinite(resetAt)) {
        const nowSec = Date.now() / 1000;
        const startSec = resetAt - windowMs / 1000;
        const elapsed = (nowSec - startSec) / (windowMs / 1000);
        const e = Math.max(0, Math.min(1, elapsed));
        cursor = Math.min(Math.floor(e * WIDTH), WIDTH - 1);
    }

    let bar = '';
    for (let i = 0; i < WIDTH; i++) {
        bar += i === cursor ? '│' : i < filled ? '█' : '░';
    }

    const open = fg(colorOf(pct));
    return `\x1b[1m${open}${label}[${bar}] ${pct.toFixed(1)}%\x1b[0m`;
}

function main() {
    const args = process.argv.slice(2);
    if (args.length === 0) return;

    let data;
    try {
        data = JSON.parse(readStdin() || '{}');
    } catch (_e) {
        return; // bad/empty input -> render nothing
    }
    const rl = (data && data.rate_limits) || {};

    const SPEC = {
        session: { node: rl.five_hour, label: 'Session: ', windowMs: FIVE_HOUR_MS },
        weekly: { node: rl.seven_day, label: 'Weekly: ', windowMs: SEVEN_DAY_MS },
        opus: { node: rl.seven_day_opus, label: 'Weekly Opus: ', windowMs: SEVEN_DAY_MS }
    };

    const parts = [];
    for (const key of args) {
        const spec = SPEC[key];
        if (!spec) continue;
        const out = renderOne(spec.node, spec.label, spec.windowMs);
        if (out) parts.push(out);
    }

    if (parts.length === 0) return;
    const sep = `${fg(SEP_COLOR)} | \x1b[0m`;
    process.stdout.write(parts.join(sep));
}

main();
