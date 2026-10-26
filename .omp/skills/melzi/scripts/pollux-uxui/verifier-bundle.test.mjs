import test from 'node:test';
import assert from 'node:assert/strict';

import {
  VERIFIER_VERDICT_SCHEMA,
  buildBundleManifest,
  sanitizeActionLog,
  validateVerdict,
} from './verifier-bundle.mjs';

const capsule = {
  id: 'capsule-1',
  baseUrl: 'https://example.test/',
  auth: { identity: 'user', method: 'session', note: 'see 1Password' },
};

function buildBundle(overrides = {}) {
  return buildBundleManifest({
    flawId: 'flaw-1',
    capsule,
    actionLog: [{ step: 4, op: 'click', ref: '#save-btn', selector: '#save' }],
    assertion: 'Save persists the form',
    budget: { stepsMax: 20 },
    ...overrides,
  });
}

function fileContent(bundle, path) {
  return bundle.files.find((file) => file.path === path).content;
}

test('buildBundleManifest returns an immutable allowlisted file manifest', () => {
  const bundle = buildBundle({
    sanitizedSourceEntries: [{ path: 'components/Save.tsx', content: 'export function Save() {}' }],
    sanitizationAttestation: {
      policyVersion: '1',
      inputDigest: 'input-sha256',
      outputDigest: 'output-sha256',
    },
  });
  const expectedPaths = [
    'input/action-log.json',
    'input/assertion.txt',
    'input/attestation.json',
    'input/capsule.json',
    'input/flaw.json',
    'input/source/components/Save.tsx',
    'input/verdict.schema.json',
  ];

  assert.deepEqual(bundle.allowedPaths, expectedPaths);
  assert.deepEqual([...bundle.files.map(({ path }) => path)].sort(), expectedPaths);
  assert.ok(bundle.files.every(({ mode }) => mode === 0o444));
  assert.ok(bundle.files.every(({ sha256 }) => /^[a-f0-9]{64}$/.test(sha256)));
});

test('sanitizeActionLog strips Explorer notes and all non-allowlisted fields', () => {
  const sanitized = sanitizeActionLog([{
    step: 12,
    op: 'click',
    ref: 'e17',
    selector: '#save',
    note: 'diagnosis',
    severity: 'high',
  }]);

  assert.deepEqual(sanitized, [{ step: 0, op: 'click', ref: 'e17', selector: '#save' }]);
  assert.equal(Object.hasOwn(sanitized[0], 'note'), false);
});

test('sanitizeActionLog requires a durable cross-session locator', () => {
  assert.throws(
    () => sanitizeActionLog([{ op: 'click', ref: 'e17' }]),
    /actionLog\[0\].*volatile ref/,
  );
  assert.deepEqual(
    sanitizeActionLog([{ op: 'click', ref: 'e17', selector: '#save' }]),
    [{ step: 0, op: 'click', ref: 'e17', selector: '#save' }],
  );
  assert.deepEqual(
    sanitizeActionLog([{ op: 'click', ref: '#save-btn' }]),
    [{ step: 0, op: 'click', ref: '#save-btn' }],
  );
});

test('capsules may reference credential sources but may not contain literal secrets', () => {
  assert.doesNotThrow(() => buildBundle());
  assert.throws(
    () => buildBundle({ capsule: { auth: { password: 'p' } } }),
    /capsule\.auth\.password/,
  );
  assert.throws(
    () => buildBundle({ capsule: { token: 'abc' } }),
    /capsule\.token/,
  );
});

test('source paths reject traversal, absolutes, backslashes, and case-insensitive duplicates', () => {
  const attestation = {
    policyVersion: '1',
    inputDigest: 'input-sha256',
    outputDigest: 'output-sha256',
  };
  const invalidEntries = [
    [{ path: '../x', content: '' }],
    [{ path: '/etc/x', content: '' }],
    [{ path: 'a\\b', content: '' }],
    [{ path: 'A.tsx', content: '' }, { path: 'a.tsx', content: '' }],
  ];

  for (const sanitizedSourceEntries of invalidEntries) {
    assert.throws(() => buildBundle({ sanitizedSourceEntries, sanitizationAttestation: attestation }));
  }

  const bundle = buildBundle({
    sanitizedSourceEntries: [{ path: 'components/Save.tsx', content: 'sanitized' }],
    sanitizationAttestation: attestation,
  });
  assert.equal(fileContent(bundle, 'input/source/components/Save.tsx'), 'sanitized');
});

test('source entries require a complete sanitization attestation', () => {
  const sanitizedSourceEntries = [{ path: 'components/Save.tsx', content: 'sanitized' }];

  assert.throws(
    () => buildBundle({ sanitizedSourceEntries }),
    /sanitizationAttestation/,
  );
  assert.doesNotThrow(() => buildBundle({
    sanitizedSourceEntries,
    sanitizationAttestation: {
      policyVersion: '1',
      inputDigest: 'input-sha256',
      outputDigest: 'output-sha256',
    },
  }));
});

test('verdictSchema defaults to the frozen Contract-1 schema', () => {
  const bundle = buildBundle();

  assert.equal(Object.isFrozen(VERIFIER_VERDICT_SCHEMA), true);
  assert.deepEqual(
    JSON.parse(fileContent(bundle, 'input/verdict.schema.json')),
    VERIFIER_VERDICT_SCHEMA,
  );
});

test('validateVerdict accepts a well-formed confirmed verdict', () => {
  assert.deepEqual(validateVerdict({
    verdict: 'confirmed',
    rationale: 'The independent replay reproduced the failure',
    decisiveEvidence: 'The save request returned 500',
    independence: {
      coldContext: true,
      ownSession: true,
      replayedFromReset: true,
    },
  }), { valid: true, errors: [] });
});

test('validateVerdict rejects invalid verdicts, independence, and rationale', () => {
  const valid = {
    verdict: 'confirmed',
    rationale: 'Replay reproduced the failure',
    decisiveEvidence: 'The request returned 500',
    independence: {
      coldContext: true,
      ownSession: true,
      replayedFromReset: true,
    },
  };

  const badVerdict = validateVerdict({ ...valid, verdict: 'maybe' });
  assert.equal(badVerdict.valid, false);
  assert.ok(badVerdict.errors.some((error) => error.includes('verifier.verdict')));

  const badIndependence = validateVerdict({
    ...valid,
    independence: { ...valid.independence, coldContext: false },
  });
  assert.equal(badIndependence.valid, false);
  assert.ok(badIndependence.errors.some((error) => error.includes('coldContext')));

  const missingRationale = { ...valid };
  delete missingRationale.rationale;
  const noRationale = validateVerdict(missingRationale);
  assert.equal(noRationale.valid, false);
  assert.ok(noRationale.errors.includes('verifier.rationale is required'));
});
