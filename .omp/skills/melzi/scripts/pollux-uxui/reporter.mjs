#!/usr/bin/env node
/**
 * reporter.mjs — turns a finished run into the artifact a human acts on.
 *
 * WHY THIS EXISTS
 * ---------------
 * explore.md's opening line promised a tool that "reports replayable failures
 * with OBSERVED evidence", and nothing emitted a report. The reporting was
 * whatever the agent happened to type into chat: not durable, not diffable, and
 * shaped by the same model that did the exploring.
 *
 * WHAT IT REFUSES TO DO
 * ---------------------
 * Only a Verifier-CONFIRMED flaw is a finding. The Explorer's own belief is not
 * evidence: it is both the actor and, without a twin, its own judge, which is the
 * oracle problem this engine exists to avoid (an active independent oracle runs
 * ~91% precision against ~29% for a passive judge). So:
 *
 *   confirmed    -> a finding
 *   rejected     -> excluded entirely (the twin says the Explorer was wrong)
 *   inconclusive -> disclosed in its own section, never counted as a finding
 *   no verdict   -> disclosed as NOT a finding (an unjudged flaw is an opinion)
 *
 * Verdicts are re-validated here, at the disk boundary. recordVerdict() already
 * refuses anything that does not attest full independence (the schema pins all
 * three keys to `const: true`, making independence an admission requirement, not
 * a caveat). But this reads verdicts.jsonl, and loadVerdicts does not re-check,
 * so a file from an older version, another tool, or a hand edit can still carry a
 * confirmation without independence. Such a record is not a verdict, and is
 * routed to `invalid` rather than laundered into a finding.
 *
 * The action log is the repro, rendered from the durable `selector`. A snapshot
 * `ref` (e17) does not survive a new session (proven in the E0 canary), so a step
 * carrying only a ref is not replayable and is marked as such rather than
 * printed as though it were.
 *
 * NO stop reason proves coverage, so the report never claims one does. `stalled`
 * says the last K recorded events discovered nothing new; `budget` says we ran out
 * of room. Neither is a statement about the app. The old `coverageProven` field
 * rendered `stalled`'s predecessor as "the reachable surface was exhausted", which
 * the graph cannot support: it records the actions the Explorer TOOK and never the
 * actions AVAILABLE, so it cannot tell "nothing left to try" from "stopped trying".
 * The field is gone rather than reworded, because it was a computed claim, not a
 * sentence. Nodes and edges are DISCOVERY statistics, not a coverage fraction; a
 * fraction needs the denominator D2 will build.
 * ADR: pollux-uxui/adr-retire-the-exhaustion-claim.md
 *
 * Usage:
 *   node reporter.mjs --run-dir D [--format md|json]
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadRun, loadVerdicts } from './controller.mjs';
import { validateVerdict } from './verifier-bundle.mjs';

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low'];

function loadFlaws(runDir) {
  const path = join(runDir, 'flaws.jsonl');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

/** Newest verdict wins: a re-judged flaw supersedes the earlier call. */
function latestVerdicts(runDir) {
  const byFlaw = new Map();
  for (const { flawId, verifier } of loadVerdicts(runDir)) byFlaw.set(flawId, verifier);
  return byFlaw;
}

function bySeverity(a, b) {
  return SEVERITY_ORDER.indexOf(a.flaw.severity) - SEVERITY_ORDER.indexOf(b.flaw.severity);
}

export function buildReport(runDir) {
  const run = loadRun(runDir);
  const verdicts = latestVerdicts(runDir);

  const confirmed = [];
  const inconclusive = [];
  const unverified = [];
  const invalid = [];
  let rejected = 0;

  for (const flaw of loadFlaws(runDir)) {
    const verifier = verdicts.get(flaw.flawId);
    if (!verifier) { unverified.push({ flaw }); continue; }

    // Trust boundary: this came off disk, so re-check it rather than assume the
    // writer validated it. A record that fails the schema is not a verdict.
    const result = validateVerdict(verifier);
    if (!result.valid) { invalid.push({ flaw, verifier, errors: result.errors }); continue; }

    if (verifier.verdict === 'rejected') { rejected += 1; continue; }
    const entry = { flaw, verifier };
    (verifier.verdict === 'confirmed' ? confirmed : inconclusive).push(entry);
  }

  confirmed.sort(bySeverity);
  inconclusive.sort(bySeverity);

  const stop = run.stop ?? { stop: false, reason: null };
  return {
    runId: run.runId,
    runState: run.runState,
    coverage: run.coverage ?? null,
    stop,
    // `coverageProven` used to live here as `stop.reason === 'plateau'`. It is gone:
    // no P1 stop reason proves coverage, so there is no honest boolean to compute.
    confirmed,
    inconclusive,
    unverified,
    invalid,
    counts: {
      confirmed: confirmed.length,
      inconclusive: inconclusive.length,
      unverified: unverified.length,
      invalid: invalid.length,
      rejected,
    },
  };
}

function renderAction(action) {
  const value = action.value === undefined ? '' : ` with \`${action.value}\``;
  // `navigate` targets a URL carried in `value`, not an element, so it has no
  // selector and needs none. Warning about it would cry wolf and devalue the
  // warning that matters: a ref-only element step really is unreplayable.
  if (action.op === 'navigate') return `${action.step}. navigate${value}`;

  const target = action.selector
    ? `\`${action.selector}\``
    : `\`${action.ref}\` (snapshot ref only, NOT replayable in a new session)`;
  return `${action.step}. ${action.op} ${target}${value}`;
}

function renderFinding({ flaw, verifier }) {
  const lines = [
    `### ${flaw.title}`,
    '',
    `**${flaw.severity}** · ${flaw.defectType} · flaw \`${flaw.flawId}\``,
    '',
    `**Should happen:** ${flaw.assertion}`,
    `**Decisive evidence:** ${verifier.decisiveEvidence}`,
    `**Verifier:** ${verifier.rationale}`,
    '',
    '**Repro:**',
    '',
    ...flaw.actionLog.map(renderAction),
  ];

  const shot = flaw.observed?.screenshot;
  if (shot) lines.push('', `Screenshot: \`${shot}\``);
  return lines.join('\n');
}

function renderCoverage(report) {
  const c = report.coverage;
  if (!c) return 'Coverage was not recorded for this run.';
  const where = `${c.nodeCount} states, ${c.edgeCount} transitions`;
  const why = report.stop.reason === 'stalled'
    ? 'the last recorded events discovered nothing new. That is a statement about '
      + 'this run\'s recent activity, NOT about the app: the graph records the actions '
      + 'taken and never the actions available, so it cannot tell "nothing left to try" '
      + 'from "stopped trying".'
    : report.stop.reason === 'budget'
      ? 'the run ran out of room.'
      : 'the run ended without a recorded stop reason.';
  return `Discovered ${where}, and stopped on **${report.stop.reason ?? 'nothing'}**: ${why}\n\n`
    + 'These are DISCOVERY statistics, not coverage. **Coverage is unproven**, and no '
    + 'stop reason in this engine proves it: a coverage fraction needs a denominator '
    + '(attempted over discovered eligible action cases) that is not computed yet. '
    + 'Do not present this as a percentage, and never write that the app was fully explored.';
}

export function renderMarkdown(report) {
  const { counts } = report;
  const out = [
    `# Exploration report · run \`${report.runId}\``,
    '',
    renderCoverage(report),
    '',
    `Confirmed ${counts.confirmed} · inconclusive ${counts.inconclusive} · `
      + `unverified ${counts.unverified} · invalid ${counts.invalid} · `
      + `rejected by the Verifier ${counts.rejected}`,
    '',
    '## Confirmed findings',
    '',
  ];

  if (counts.confirmed === 0) {
    // "We found nothing" is not "there is nothing to find". Never imply the latter.
    out.push('No confirmed findings. This run surfaced nothing the independent Verifier');
    out.push('would stand behind. That is not a statement that the app is defect-free.');
  } else {
    out.push(report.confirmed.map(renderFinding).join('\n\n'));
  }

  if (counts.inconclusive > 0) {
    out.push('', '## Inconclusive', '',
      'The Verifier could not settle these. They are NOT findings.', '');
    out.push(report.inconclusive.map(
      ({ flaw, verifier }) => `- **${flaw.title}** (${flaw.severity}): ${verifier.rationale}`,
    ).join('\n'));
  }

  if (counts.unverified > 0) {
    out.push('', '## Unverified candidates', '',
      'The Explorer raised these and no Verifier judged them. They are NOT findings,',
      'and are listed only so nothing is silently dropped.', '');
    out.push(report.unverified.map(
      ({ flaw }) => `- **${flaw.title}** (${flaw.severity}, ${flaw.defectType})`,
    ).join('\n'));
  }

  if (counts.invalid > 0) {
    out.push('', '## Rejected records', '',
      'These carried a verdict that does not meet the schema, most often a',
      'confirmation that failed to attest independence. They are NOT findings: an',
      'unverifiable confirmation is the passive-judge failure this engine avoids.', '');
    out.push(report.invalid.map(
      ({ flaw, errors }) => `- **${flaw.title}**: ${errors.join('; ')}`,
    ).join('\n'));
  }

  return `${out.join('\n')}\n`;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    const next = argv[i + 1];
    args[argv[i].slice(2)] = next && !next.startsWith('--') ? next : true;
    if (next && !next.startsWith('--')) i += 1;
  }
  return args;
}

// Only run as a CLI, never on import (the tests import buildReport directly).
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (typeof args['run-dir'] !== 'string') throw new TypeError('--run-dir is required');
    const report = buildReport(args['run-dir']);
    console.log(args.format === 'json' ? JSON.stringify(report, null, 2) : renderMarkdown(report));
  } catch (err) {
    console.error(`reporter: ${err.message}`);
    process.exit(1);
  }
}
