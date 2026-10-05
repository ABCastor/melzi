// The stopping rule. FORK-ONLY.
//
// These checks guard a commitment device, not a recommendation. A silent budget
// increase, a crisp bar from three votes, or another pair after a winner all turn
// the feature into the opposite of what it promises.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  configureStoppingRule,
  readTasteSession,
  recordStoppingCandidates,
  saveDerivedStoppingBar,
  lockStoppingBar,
  appendCandidate,
  appendComparison,
  mergeAttributes,
  setVector,
} from '../skill/scripts/melzi/taste-store.mjs';
import {
  deriveStoppingBar,
  candidateClearsStoppingBar,
} from '../skill/scripts/melzi/taste-model.mjs';
import { dealPayload } from '../skill/scripts/melzi/taste-session.mjs';

function withHome(fn) {
  const home = mkdtempSync(join(tmpdir(), 'melzi-stopping-rule-'));
  try { return fn(home); } finally { rmSync(home, { recursive: true, force: true }); }
}

const candidates = [{ id: 'calm' }, { id: 'busy' }, { id: 'new-airy' }];
const attributes = [{ id: 'space', label: 'generous whitespace' }];
const vectors = { calm: { space: 1 }, busy: { space: 0 }, 'new-airy': { space: 1 } };
const comparisons = [
  { a: 'calm', b: 'busy', outcome: 'a' },
  { a: 'calm', b: 'busy', outcome: 'a' },
  { a: 'calm', b: 'busy', outcome: 'a' },
];

test('the stopping budget is persisted, refuses a silent raise, and records an explicit one', () => withHome((home) => {
  const first = configureStoppingRule({
    session: 'commitment', candidateCap: 9, intuition: { timerSeconds: 0, cap: 8 }, now: '2026-07-29T10:00:00.000Z',
  }, { home });
  assert.equal(first.ok, true);
  assert.equal(first.session.stopping.candidateCap, 9);

  const silent = configureStoppingRule({
    session: 'commitment', candidateCap: 12, intuition: { timerSeconds: 0, cap: 8 }, now: '2026-07-29T10:01:00.000Z',
  }, { home });
  assert.equal(silent.ok, false);
  assert.match(silent.message, /explicit/i);
  assert.equal(readTasteSession('commitment', { home }).stopping.candidateCap, 9);

  const raised = configureStoppingRule({
    session: 'commitment', candidateCap: 12, intuition: { timerSeconds: 0, cap: 8 }, explicitBudgetChange: true, now: '2026-07-29T10:02:00.000Z',
  }, { home });
  assert.equal(raised.ok, true);
  assert.deepEqual(raised.session.stopping.budgetChanges, [{ from: 9, to: 12, at: '2026-07-29T10:02:00.000Z' }]);
}));

test('calibration tracks first displays, then locks exactly one adjustment beside its derived bar', () => withHome((home) => {
  configureStoppingRule({ session: 'calibration', candidateCap: 6, intuition: { timerSeconds: 3, cap: 8 } }, { home });
  const progress = recordStoppingCandidates('calibration', ['calm', 'busy'], { home });
  assert.equal(progress.stopping.phase, 'bar-review');
  assert.equal(progress.stopping.calibrationCandidateCap, 2, 'the first third is rounded up to one displayable pair');
  assert.deepEqual(progress.stopping.seenCandidateIds, ['calm', 'busy']);

  const derived = { value: 0.45, method: 'best calibration lower bound', spread: [], evidence: 'Built from 1 comparison. That is very little.' };
  saveDerivedStoppingBar('calibration', derived, { home });
  const locked = lockStoppingBar('calibration', 0.2, { home, now: '2026-07-29T11:00:00.000Z' });
  assert.equal(locked.ok, true);
  assert.equal(locked.session.stopping.phase, 'selection');
  assert.equal(locked.session.stopping.derivedBar.value, 0.45);
  assert.equal(locked.session.stopping.adjustedBar.value, 0.2);

  const twice = lockStoppingBar('calibration', 0.1, { home });
  assert.equal(twice.ok, false);
  assert.match(twice.message, /already fixed/i);
}));

test('the bar uses the best calibration lower bound and exposes the thin spread instead of a crisp winner', () => {
  const bar = deriveStoppingBar({ candidates: candidates.slice(0, 2), comparisons, attributes, vectors });
  assert.equal(bar.method, 'best calibration lower bound');
  assert.equal(bar.value, bar.spread[0].lowerBound, 'the leader is ordered by its conservative bound, not its noisiest point score');
  assert.equal(bar.spread.length, 2);
  assert.match(bar.evidence, /3 comparisons.*very little/i);

  const newCandidate = bar.candidateScores.find((row) => row.id === 'calm');
  assert.equal(candidateClearsStoppingBar(newCandidate, bar.value), true);
});

test('a calibration set with no shared attributes refuses a precise-looking threshold', () => {
  const bar = deriveStoppingBar({ candidates: candidates.slice(0, 2), comparisons, attributes: [], vectors: {} });
  assert.equal(bar.value, null);
  assert.match(bar.evidence, /cannot separate/i);
});

test('calibration records a vote but sends no profile or leader, then exposes only the bar review', () => withHome((home) => {
  for (const id of ['calm', 'busy', 'new-airy']) appendCandidate({ id }, { home });
  mergeAttributes([{ id: 'space', label: 'generous whitespace' }], { home });
  setVector('calm', { space: 1 }, { home });
  setVector('busy', { space: 0 }, { home });
  setVector('new-airy', { space: 1 }, { home });
  configureStoppingRule({ session: 'surface', candidateCap: 6, intuition: { timerSeconds: 0, cap: 8 } }, { home });

  const calibration = dealPayload({ home, intuition: { session: 'surface', timerSeconds: 0, cap: 8, stopping: { session: 'surface' } } });
  assert.equal(calibration.stoppingRule.phase, 'calibration');
  assert.equal(calibration.profile, null, 'calibration cannot imply a standing');
  assert.equal(calibration.stoppingRule.calibrationComparisonsRemaining, 1);
  appendComparison({ a: calibration.a.id, b: calibration.b.id, outcome: 'a' }, { home });

  const review = dealPayload({ home, intuition: { session: 'surface', timerSeconds: 0, cap: 8, stopping: { session: 'surface' } } });
  assert.equal(review.barReview, true);
  assert.equal(review.a, undefined, 'no next pair appears before the bar is fixed');
  assert.match(review.stoppingRule.derivedBar.evidence, /very little/i);
}));
