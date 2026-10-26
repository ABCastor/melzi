import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { checkpoint, createRun, recordFlaw, recordVerdict } from './controller.mjs';
import { buildReport, renderMarkdown } from './reporter.mjs';

const runState = { baseUrl: 'https://example.test/', viewport: { width: 1280, height: 800 } };

function flaw(overrides = {}) {
  return {
    schemaVersion: '0.1',
    runId: 'run-1',
    flawId: 'flaw-1',
    title: 'Save silently fails',
    assertion: 'Clicking Save should persist the record',
    runStateId: 'rs-1',
    defectType: 'silent-failure',
    severity: 'high',
    actionLog: [
      { step: 0, op: 'navigate', ref: 'url', value: 'https://example.test/' },
      { step: 1, op: 'click', ref: 'e17', selector: '#save' },
    ],
    observed: {
      screenshot: 'shots/1.png',
      bbox: { x: 10, y: 20, w: 100, h: 40 },
      consoleErrors: [],
      pageErrors: [],
      network: [{ method: 'POST', url: 'https://example.test/api/save', status: 501 }],
    },
    reproStatus: 'reproduced',
    createdBy: 'explorer',
    ...overrides,
  };
}

const independent = { coldContext: true, ownSession: true, replayedFromReset: true };

function verdict(v, overrides = {}) {
  return {
    verdict: v,
    rationale: 'Independent replay reproduced the failure',
    decisiveEvidence: 'POST /api/save returned 501',
    independence: independent,
    ...overrides,
  };
}

function seed(patch = {}) {
  const runDir = mkdtempSync(join(tmpdir(), 'pollux-report-'));
  createRun({ runDir, runState, budget: { stepsUsed: 4, stepsMax: 200 } });
  checkpoint(runDir, {
    coverage: { nodeCount: 3, edgeCount: 4, newNodesInLastK: 0, plateau: true },
    stop: { stop: true, reason: 'stalled' },
    phase: 'report',
    ...patch,
  });
  return runDir;
}

test('a confirmed flaw is reported with its replayable action log', () => {
  const runDir = seed();
  recordFlaw(runDir, flaw());
  recordVerdict(runDir, 'flaw-1', verdict('confirmed'));

  const report = buildReport(runDir);
  assert.equal(report.confirmed.length, 1);
  assert.equal(report.confirmed[0].flaw.title, 'Save silently fails');
  assert.equal(report.counts.confirmed, 1);

  const md = renderMarkdown(report);
  assert.match(md, /Save silently fails/);
  // The action log IS the repro script, and it must replay from the DURABLE
  // selector: a snapshot ref like e17 is not stable across sessions (canary E0).
  assert.match(md, /#save/);
  assert.match(md, /POST \/api\/save returned 501/);

  rmSync(runDir, { recursive: true, force: true });
});

// The whole point of the independent Verifier. selfloop is single-agent by
// design, so it reports what its explorer believed; an active independent oracle
// runs ~91% precision against ~29% for a passive judge. Shipping a rejected flaw
// as a finding would throw that away and make the report worth less than nothing.
test('REGRESSION: a rejected flaw never reaches the findings', () => {
  const runDir = seed();
  recordFlaw(runDir, flaw({ flawId: 'flaw-1', title: 'Real bug' }));
  recordFlaw(runDir, flaw({ flawId: 'flaw-2', title: 'Explorer was wrong' }));
  recordVerdict(runDir, 'flaw-1', verdict('confirmed'));
  recordVerdict(runDir, 'flaw-2', verdict('rejected', {
    rationale: 'The control works; the Explorer misread its own click',
    decisiveEvidence: 'POST /api/save returned 200 on independent replay',
  }));

  const report = buildReport(runDir);
  assert.deepEqual(report.confirmed.map((c) => c.flaw.title), ['Real bug']);
  assert.equal(report.counts.rejected, 1);

  const md = renderMarkdown(report);
  assert.doesNotMatch(md, /Explorer was wrong/);

  rmSync(runDir, { recursive: true, force: true });
});

// An unjudged flaw is an Explorer's opinion, not a finding. It must never be
// silently promoted just because nothing contradicted it.
test('REGRESSION: an unverified flaw is not a finding', () => {
  const runDir = seed();
  recordFlaw(runDir, flaw({ flawId: 'flaw-1', title: 'Never judged' }));

  const report = buildReport(runDir);
  assert.equal(report.confirmed.length, 0);
  assert.equal(report.unverified.length, 1);
  assert.equal(report.counts.unverified, 1);

  const md = renderMarkdown(report);
  // It is disclosed, not hidden, and explicitly not a finding.
  assert.match(md, /Never judged/);
  assert.match(md, /not findings/i);

  rmSync(runDir, { recursive: true, force: true });
});

test('inconclusive verdicts are disclosed separately, not counted as confirmed', () => {
  const runDir = seed();
  recordFlaw(runDir, flaw({ flawId: 'flaw-1', title: 'Could not reproduce cleanly' }));
  recordVerdict(runDir, 'flaw-1', verdict('inconclusive', {
    rationale: 'Reproduced once in three attempts',
    decisiveEvidence: 'Intermittent 501',
  }));

  const report = buildReport(runDir);
  assert.equal(report.counts.confirmed, 0);
  assert.equal(report.counts.inconclusive, 1);
  assert.match(renderMarkdown(report), /Could not reproduce cleanly/);

  rmSync(runDir, { recursive: true, force: true });
});

// recordVerdict() refuses a verdict that does not attest full independence: the
// schema pins all three keys to `const: true`, so independence is an admission
// requirement, not a property to report on. But the reporter reads verdicts.jsonl
// from DISK and loadVerdicts does not re-validate, so a file written by an older
// version, another tool, or a hand edit can still carry one. At that trust
// boundary the reporter must not launder it into a clean finding: a confirmation
// without independence is exactly the passive-judge failure the twin-loop exists
// to prevent (~91% precision against ~29%). Written directly, bypassing the
// writer, because the writer correctly makes this unreachable.
test('REGRESSION: a non-independent verdict on disk is not a confirmation', () => {
  const runDir = seed();
  recordFlaw(runDir, flaw({ title: 'Laundered claim' }));
  writeFileSync(join(runDir, 'verdicts.jsonl'), `${JSON.stringify({
    flawId: 'flaw-1',
    verifier: verdict('confirmed', {
      independence: { coldContext: false, ownSession: true, replayedFromReset: true },
    }),
  })}\n`);

  const report = buildReport(runDir);
  assert.equal(report.counts.confirmed, 0);
  assert.equal(report.counts.invalid, 1);
  assert.match(report.invalid[0].errors.join(' '), /coldContext/);

  const md = renderMarkdown(report);
  assert.match(md, /Laundered claim/);   // disclosed
  assert.match(md, /not findings/i);     // but never as a finding

  rmSync(runDir, { recursive: true, force: true });
});

test('a malformed verdict line does not crash the report', () => {
  const runDir = seed();
  recordFlaw(runDir, flaw({ title: 'Half-written verdict' }));
  writeFileSync(join(runDir, 'verdicts.jsonl'), `${JSON.stringify({
    flawId: 'flaw-1', verifier: { verdict: 'confirmed' },
  })}\n`);

  const report = buildReport(runDir);
  assert.equal(report.counts.confirmed, 0);
  assert.equal(report.counts.invalid, 1);

  rmSync(runDir, { recursive: true, force: true });
});

// Neither stop reason proves coverage, and the report must say so for BOTH.
test('a budget stop reports coverage as unproven', () => {
  const runDir = seed({
    coverage: { nodeCount: 3, edgeCount: 4, newNodesInLastK: 2, plateau: false },
    stop: { stop: true, reason: 'budget' },
  });

  const report = buildReport(runDir);
  const md = renderMarkdown(report);
  assert.match(md, /unproven/i);
  assert.match(md, /ran out of room/i);

  rmSync(runDir, { recursive: true, force: true });
});

// The regression that D1 exists to prevent. This stop used to render as "the
// reachable surface was exhausted" on as few as 3 edges.
test('REGRESSION: a stalled stop claims no exhaustion and no coverage', () => {
  const runDir = seed({
    coverage: { nodeCount: 2, edgeCount: 3, newNodesInLastK: 0, plateau: true },
    stop: { stop: true, reason: 'stalled' },
  });

  const report = buildReport(runDir);
  assert.equal('coverageProven' in report, false, 'the coverage claim field must be gone');

  const md = renderMarkdown(report);
  assert.match(md, /unproven/i);
  // The exact claim this ADR retired. Note the report DOES carry the sentence
  // "never write that the app was fully explored", so absence-of-substring is the
  // wrong shape of assertion for that phrase: guard the claim, not the warning.
  assert.doesNotMatch(md, /exhaust/i, 'a stalled stop must never claim exhaustion');

  rmSync(runDir, { recursive: true, force: true });
});

test('the newest verdict for a flaw wins', () => {
  const runDir = seed();
  recordFlaw(runDir, flaw());
  recordVerdict(runDir, 'flaw-1', verdict('inconclusive'));
  recordVerdict(runDir, 'flaw-1', verdict('confirmed'));

  const report = buildReport(runDir);
  assert.equal(report.counts.confirmed, 1);
  assert.equal(report.counts.inconclusive, 0);

  rmSync(runDir, { recursive: true, force: true });
});

test('findings are ordered by severity, worst first', () => {
  const runDir = seed();
  for (const [id, severity] of [['a', 'low'], ['b', 'critical'], ['c', 'medium']]) {
    recordFlaw(runDir, flaw({ flawId: id, title: id, severity }));
    recordVerdict(runDir, id, verdict('confirmed'));
  }

  const report = buildReport(runDir);
  assert.deepEqual(report.confirmed.map((c) => c.flaw.severity), ['critical', 'medium', 'low']);

  rmSync(runDir, { recursive: true, force: true });
});

// A ref-only element step genuinely cannot replay in a new session (E0 canary),
// and saying so is the point. But `navigate` carries its URL in `value` and has
// no element to select, so warning about it would cry wolf and devalue the real
// warning.
test('navigate is not mislabelled unreplayable, but a ref-only click still is', () => {
  const runDir = seed();
  recordFlaw(runDir, flaw({
    actionLog: [
      { step: 0, op: 'navigate', ref: 'url', value: 'https://example.test/' },
      { step: 1, op: 'click', ref: 'e17' },
    ],
  }));
  recordVerdict(runDir, 'flaw-1', verdict('confirmed'));

  const md = renderMarkdown(buildReport(runDir));
  assert.match(md, /0\. navigate with `https:\/\/example\.test\/`/);
  assert.doesNotMatch(md, /navigate.*NOT replayable/);
  assert.match(md, /1\. click `e17` \(snapshot ref only, NOT replayable/);

  rmSync(runDir, { recursive: true, force: true });
});

test('an empty run reports honestly instead of implying a clean bill of health', () => {
  const runDir = seed();
  const md = renderMarkdown(buildReport(runDir));
  assert.match(md, /No confirmed/i);
  // "found nothing" and "there is nothing to find" are different claims.
  assert.doesNotMatch(md, /no bugs|bug-free|clean bill/i);

  rmSync(runDir, { recursive: true, force: true });
});
