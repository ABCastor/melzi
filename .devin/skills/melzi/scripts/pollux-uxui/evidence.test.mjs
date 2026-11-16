import test from 'node:test';
import assert from 'node:assert/strict';

import { flawId, validateFlaw } from './evidence.mjs';

function validFlaw() {
  const actionLog = [
    { step: 0, op: 'navigate', ref: 'home' },
    { step: 1, op: 'click', ref: 'submit', note: 'Submit the form' },
  ];

  return {
    schemaVersion: '0.1',
    runId: 'run-1',
    flawId: flawId(actionLog, 'Submission succeeds'),
    defectType: 'silent-failure',
    severity: 'high',
    title: 'Submit does nothing',
    assertion: 'Submission succeeds',
    actionLog,
    observed: {
      screenshot: 'shot.png',
      bbox: { x: 1, y: 2, w: 3, h: 4 },
      consoleErrors: [],
      pageErrors: [],
      network: [{ method: 'POST', url: '/submit', status: 500 }],
    },
    runStateId: 'state-1',
    verifier: {
      verdict: 'confirmed',
      rationale: 'Replay failed identically',
      decisiveEvidence: 'POST returned 500',
      independence: {
        coldContext: true,
        ownSession: true,
        replayedFromReset: true,
      },
    },
    reproStatus: 'reproduced',
    createdBy: 'explorer',
  };
}

test('validateFlaw accepts a valid Contract 1 record', () => {
  assert.deepEqual(validateFlaw(validFlaw()), { valid: true, errors: [] });
});

test('validateFlaw rejects every missing required field with a clear path', () => {
  const paths = [
    'schemaVersion',
    'runId',
    'flawId',
    'defectType',
    'severity',
    'title',
    'assertion',
    'actionLog',
    'observed',
    'observed.screenshot',
    'observed.bbox',
    'observed.bbox.x',
    'observed.bbox.y',
    'observed.bbox.w',
    'observed.bbox.h',
    'observed.consoleErrors',
    'observed.pageErrors',
    'observed.network',
    'runStateId',
    'reproStatus',
    'createdBy',
  ];

  for (const path of paths) {
    const flaw = validFlaw();
    const parts = path.split('.');
    const key = parts.pop();
    const parent = parts.reduce((value, part) => value[part], flaw);
    delete parent[key];
    const result = validateFlaw(flaw);
    assert.equal(result.valid, false, path);
    assert.ok(result.errors.some((error) => error.includes(`${path} is required`)), path);
  }
});

test('verifier is optional at creation but validated when present', () => {
  const withoutVerifier = validFlaw();
  delete withoutVerifier.verifier;
  assert.deepEqual(validateFlaw(withoutVerifier), { valid: true, errors: [] });

  const badVerifier = validFlaw();
  delete badVerifier.verifier.verdict;
  const result = validateFlaw(badVerifier);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('verifier.verdict is required')));
});

test('validateFlaw rejects every bad enum', () => {
  const cases = [
    ['defectType', 'imaginary'],
    ['severity', 'urgent'],
    ['verifier.verdict', 'maybe'],
    ['reproStatus', 'unknown'],
  ];

  for (const [path, value] of cases) {
    const flaw = validFlaw();
    if (path.includes('.')) flaw.verifier.verdict = value;
    else flaw[path] = value;
    const result = validateFlaw(flaw);
    assert.equal(result.valid, false, path);
    assert.ok(result.errors.some((error) => error.includes(path)), path);
  }
});

test('validateFlaw rejects malformed action-log items', () => {
  const flaw = validFlaw();
  flaw.actionLog[0] = { step: 'zero', op: 'tap', ref: 42, value: 1, note: false };
  const result = validateFlaw(flaw);

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('actionLog[0].step')));
  assert.ok(result.errors.some((error) => error.includes('actionLog[0].op')));
  assert.ok(result.errors.some((error) => error.includes('actionLog[0].ref')));
  assert.ok(result.errors.some((error) => error.includes('actionLog[0].value')));
  assert.ok(result.errors.some((error) => error.includes('actionLog[0].note')));
});

test('validateFlaw requires action and network item fields', () => {
  const cases = [
    ['actionLog[0].step', (flaw) => delete flaw.actionLog[0].step],
    ['actionLog[0].op', (flaw) => delete flaw.actionLog[0].op],
    ['actionLog[0].ref', (flaw) => delete flaw.actionLog[0].ref],
    ['observed.network[0].method', (flaw) => delete flaw.observed.network[0].method],
    ['observed.network[0].url', (flaw) => delete flaw.observed.network[0].url],
    ['observed.network[0].status', (flaw) => delete flaw.observed.network[0].status],
  ];

  for (const [path, remove] of cases) {
    const flaw = validFlaw();
    remove(flaw);
    const result = validateFlaw(flaw);
    assert.equal(result.valid, false, path);
    assert.ok(result.errors.includes(`${path} is required`), path);
  }
});

test('flawId is stable, canonical, and action-order-sensitive', () => {
  const first = { step: 0, op: 'click', ref: 'a' };
  const sameDifferentKeyOrder = { ref: 'a', op: 'click', step: 0 };
  const second = { step: 1, op: 'click', ref: 'b' };

  assert.equal(flawId([first, second], 'fails'), flawId([sameDifferentKeyOrder, second], 'fails'));
  assert.notEqual(flawId([first, second], 'fails'), flawId([second, first], 'fails'));
  assert.match(flawId([first], 'fails'), /^[a-f0-9]{16}$/);
});
