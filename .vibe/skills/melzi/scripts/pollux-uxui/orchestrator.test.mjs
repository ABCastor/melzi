import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { aggregateObserved, completeFlaw, orchestrateExploration } from './orchestrator.mjs';
import { validateFlaw } from './evidence.mjs';
import { buildObservations, parseStream } from './runner.mjs';

const streamText = readFileSync(
  new URL('./fixtures/canary/explorer-stream.jsonl', import.meta.url),
  'utf8',
);

const runState = {
  id: 'rs-e2',
  appVersion: 'fixture@sanitized',
  baseUrl: 'http://localhost:8798/fixture-sanitized.html',
  auth: { identity: 'anon', method: 'none', note: 'public fixture' },
  seededData: 'sanitized spike fixture',
  storage: 'reset-to-empty',
  featureFlags: {},
  viewport: { w: 1280, h: 800 },
  locale: 'en-US',
  timezone: 'UTC',
  fixedClock: null,
  listenersAttachedBeforeNav: true,
  resetProcedure: 'navigate baseUrl + clear storage',
  teardown: 'close page',
};

const candidates = [
  {
    defectType: 'silent-failure',
    severity: 'high',
    title: 'Save reports success on a failed request',
    assertion: 'Save must not show success when POST /api/save fails',
    actionLog: [
      { op: 'navigate', url: 'http://localhost:8798/fixture-sanitized.html' },
      { op: 'click', selector: '#save' },
    ],
    evidence: 'POST /api/save returned 501 while a Saved! toast showed',
  },
  {
    // sloppy candidate: unknown enum values + selector-only log -> code coerces to a valid record
    defectType: 'totally-made-up',
    severity: 'urgent',
    title: 'Uncaught error on load',
    assertion: 'The page must load with no uncaught exceptions',
    actionLog: [{ op: 'navigate', selector: 'body' }],
    evidence: 'window.__polluxPageErrors had a ReferenceError',
  },
];

test('completeFlaw coerces a candidate into a schema-valid Contract-1 flaw', () => {
  const observed = aggregateObserved(buildObservations(parseStream(streamText)).observations);
  const flaw = completeFlaw({ candidate: candidates[0], runId: 'run-1', runStateId: runState.id, observed });

  assert.deepEqual(validateFlaw(flaw), { valid: true, errors: [] });
  assert.equal(flaw.defectType, 'silent-failure');
  assert.equal(flaw.actionLog[0].step, 0);
  assert.equal(flaw.actionLog[1].ref, '#save'); // selector fills ref when no snapshot ref is given
  assert.equal(flaw.actionLog[1].selector, '#save'); // ...and is ALSO kept as its own durable field
  assert.ok(flaw.observed.network.some((n) => n.status === 501));
});

test('completeFlaw keeps a snapshot ref and a durable selector as distinct fields', () => {
  const flaw = completeFlaw({
    candidate: {
      defectType: 'dead-control',
      severity: 'low',
      title: 'Button does nothing',
      assertion: 'clicking must do something',
      actionLog: [{ op: 'click', ref: 'e17', selector: '#save' }],
    },
    runId: 'run-2',
    runStateId: runState.id,
    observed: aggregateObserved([]),
  });

  assert.deepEqual(validateFlaw(flaw), { valid: true, errors: [] });
  assert.equal(flaw.actionLog[0].ref, 'e17'); // the snapshot ref is NOT overwritten
  assert.equal(flaw.actionLog[0].selector, '#save'); // the durable selector is preserved alongside it
});

test('unknown enum values are coerced to valid defaults, not left invalid', () => {
  const observed = aggregateObserved([]);
  const flaw = completeFlaw({ candidate: candidates[1], runId: 'run-1', runStateId: runState.id, observed });
  assert.deepEqual(validateFlaw(flaw), { valid: true, errors: [] });
  assert.equal(flaw.defectType, 'other'); // 'totally-made-up' -> other
  assert.equal(flaw.severity, 'medium'); // 'urgent' -> medium
});

test('orchestrateExploration records valid flaws, computes coverage, and persists the run', () => {
  const runDir = mkdtempSync(join(tmpdir(), 'pollux-e2-'));
  const result = orchestrateExploration({ streamText, candidateFlaws: candidates, runState, runDir });

  assert.match(result.runId, /[0-9a-f-]{36}/);
  assert.ok(result.coverage.nodeCount >= 1);
  assert.equal(result.recorded.length, 2);
  assert.ok(result.recorded.every((r) => r.ok));

  const flaws = readFileSync(join(runDir, 'flaws.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(flaws.length, 2);
  assert.ok(flaws.every((f) => validateFlaw(f).valid));

  const run = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8'));
  assert.equal(run.phase, 'explore');
  assert.ok(run.coverage);
});
