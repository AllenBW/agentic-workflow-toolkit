'use strict';

// Render the unattended instruction + bin text fed back to the agent on `block`.
function renderBrief(bin, config) {
  const dod = (config && config.definitionOfDone) || 'Complete the task and commit your work.';
  const git = (config && config.git) || {};
  const forbidden = [];
  if (!git.allowPush) forbidden.push('push to any remote');
  if (!git.allowOutwardActions) forbidden.push('publish, send to external services, or delete files outside the working tree');
  const guard = forbidden.length
    ? `Do NOT ${forbidden.join(', or ')}; if the work needs one, treat it as a "Needs you" item (below) and continue with the rest.`
    : '';
  // Opt-in (config.allowSelfQueue): invite the agent to grow its own backlog. New .md files
  // in a source folder are discovered on the next cycle regardless; this just tells the agent
  // it MAY do so. Bounded by maxIterations + branch isolation + your end-of-run review.
  const selfQueue = (config && config.allowSelfQueue)
    ? 'If finishing this bin surfaces genuine follow-up work, you MAY queue it: write a new brief to a source folder as `queue/NN-<slug>.md` (NN after the current files) — shift will pick it up as a new bin. Use this sparingly for real follow-ups, not to defer the current bin.'
    : '';
  return [
    'You are running unattended under `shift`. Complete the brief below end-to-end using your best judgment.',
    'Do NOT ask questions — if you would normally ask, decide and APPEND the decision as a line to .shift/log.md.',
    `Definition of done: ${dod}`,
    'When finished, commit your work on the current branch.',
    selfQueue,
    '`.shift/` is shift\'s own run bookkeeping. The ONLY writes you may make under it are APPENDING a line to .shift/log.md or .shift/blocked.jsonl. Never edit, overwrite, or "tidy" .shift/config.json or .shift/summary.md, and never rewrite .shift/log.md — shift maintains those itself (run progress, per-bin runtime + tokens), and changing them corrupts the run record. (Authoritative engine state — run progress, usage, timeline, history — lives outside the repo and is maintained by shift; you do not need to touch it.)',
    'Flag anything that needs the human (a deferred decision, an action you could not take) by appending a line to .shift/log.md as: "Needs you: <detail>" — these surface in the run summary.',
    'If a true blocker stops you from finishing this bin, append one line to .shift/blocked.jsonl: {"id":"<bin id>","note":"<reason>"} then stop.',
    guard,
    '',
    `--- BIN: ${bin.id} ---`,
    bin.text
  ].filter(Boolean).join('\n');
}

module.exports = { renderBrief };
