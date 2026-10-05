import { createHash } from 'node:crypto';
import { posix } from 'node:path';

export const OPS = new Set(['navigate', 'click', 'type', 'select', 'key', 'hover', 'wait']);

function deepFreeze(value) {
  Object.freeze(value);
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object' && !Object.isFrozen(child)) deepFreeze(child);
  }
  return value;
}

export const VERIFIER_VERDICT_SCHEMA = deepFreeze({
  type: 'object',
  required: ['verdict', 'rationale', 'decisiveEvidence', 'independence'],
  additionalProperties: false,
  properties: {
    verdict: { enum: ['confirmed', 'rejected', 'inconclusive'] },
    rationale: { type: 'string', minLength: 1 },
    decisiveEvidence: { type: 'string', minLength: 1 },
    independence: {
      type: 'object',
      required: ['coldContext', 'ownSession', 'replayedFromReset'],
      additionalProperties: false,
      properties: {
        coldContext: { const: true },
        ownSession: { const: true },
        replayedFromReset: { const: true },
      },
    },
  },
});

const VERDICTS = new Set(['confirmed', 'rejected', 'inconclusive']);
const VOLATILE_REF = /^(e|ref[-_]?)\d+$/i;
const SECRET_KEY = /^(password|secret|token|apikey|api[-_]?key|privatekey|private[-_]?key|credential|credentials|authorization|bearer)$/i;

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function required(obj, key, path, errors) {
  if (!obj || !Object.hasOwn(obj, key) || obj[key] === undefined) {
    errors.push(`${path} is required`);
    return undefined;
  }
  return obj[key];
}

export function validateVerdict(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { valid: false, errors: ['verifier must be an object'] };
  }

  const errors = [];
  const verdict = required(obj, 'verdict', 'verifier.verdict', errors);
  if (verdict !== undefined && !VERDICTS.has(verdict)) {
    errors.push(`verifier.verdict must be one of: ${[...VERDICTS].join(', ')}`);
  }

  for (const key of ['rationale', 'decisiveEvidence']) {
    const value = required(obj, key, `verifier.${key}`, errors);
    if (value !== undefined && (typeof value !== 'string' || value.length === 0)) {
      errors.push(`verifier.${key} must be a non-empty string`);
    }
  }

  const independence = required(obj, 'independence', 'verifier.independence', errors);
  if (independence !== undefined && (
    !independence || typeof independence !== 'object' || Array.isArray(independence)
  )) {
    errors.push('verifier.independence must be an object');
  } else if (independence) {
    for (const key of ['coldContext', 'ownSession', 'replayedFromReset']) {
      const value = required(independence, key, `verifier.independence.${key}`, errors);
      if (value !== undefined && value !== true) {
        errors.push(`verifier.independence.${key} must be true`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

export function sanitizeActionLog(actionLog) {
  if (!Array.isArray(actionLog)) throw new TypeError('actionLog must be an array');

  return actionLog.map((action, index) => {
    const path = `actionLog[${index}]`;
    if (!action || typeof action !== 'object' || Array.isArray(action)) {
      throw new TypeError(`${path} must be an object`);
    }
    if (!OPS.has(action.op)) throw new TypeError(`${path}.op is invalid`);

    const ref = String(action.ref);
    const hasSelector = Object.hasOwn(action, 'selector')
      && typeof action.selector === 'string'
      && action.selector.length > 0;
    if (!hasSelector && VOLATILE_REF.test(ref)) {
      throw new TypeError(`${path} has volatile ref "${ref}" without a durable selector`);
    }

    return {
      step: index,
      op: action.op,
      ref,
      ...(Object.hasOwn(action, 'value') ? { value: String(action.value) } : {}),
      ...(hasSelector ? { selector: action.selector } : {}),
    };
  });
}

function assertNoSecrets(capsule) {
  const seen = new WeakSet();

  function walk(value, path) {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);

    for (const [key, child] of Object.entries(value)) {
      const childPath = path ? `${path}.${key}` : key;
      const containsLiteral = (
        (typeof child === 'string' && child.length > 0)
        || typeof child === 'number'
      );
      if (SECRET_KEY.test(key) && containsLiteral) {
        throw new Error(`capsule.${childPath} must not contain a literal secret`);
      }
      walk(child, childPath);
    }
  }

  walk(capsule, '');
}

function validateSourceEntries(entries) {
  if (entries === undefined) return [];
  if (!Array.isArray(entries)) {
    throw new TypeError('sanitizedSourceEntries must be an array');
  }

  const seenPaths = new Set();
  return entries.map((entry, index) => {
    const field = `sanitizedSourceEntries[${index}]`;
    if (!isPlainObject(entry)) throw new TypeError(`${field} must be a plain object`);
    if (typeof entry.path !== 'string' || entry.path.length === 0) {
      throw new TypeError(`${field}.path must be a non-empty string`);
    }
    if (entry.path.startsWith('/')) throw new Error(`${field}.path must be relative`);
    if (entry.path.includes('\\')) throw new Error(`${field}.path must not contain backslashes`);
    if (entry.path.split('/').includes('..')) {
      throw new Error(`${field}.path must not contain a .. segment`);
    }
    if (posix.normalize(entry.path) !== entry.path) {
      throw new Error(`${field}.path must be POSIX-normalized`);
    }
    if (typeof entry.content !== 'string') {
      throw new TypeError(`${field}.content must be a string`);
    }

    const normalizedCase = entry.path.toLowerCase();
    if (seenPaths.has(normalizedCase)) {
      throw new Error(`${field}.path duplicates another source path case-insensitively`);
    }
    seenPaths.add(normalizedCase);
    return { path: entry.path, content: entry.content };
  });
}

function validateAttestation(attestation) {
  if (!isPlainObject(attestation)) {
    throw new TypeError('sanitizationAttestation must be a plain object when source entries are present');
  }
  for (const key of ['policyVersion', 'inputDigest', 'outputDigest']) {
    if (typeof attestation[key] !== 'string' || attestation[key].length === 0) {
      throw new TypeError(`sanitizationAttestation.${key} must be a non-empty string`);
    }
  }
}

function bundleFile(path, content) {
  return {
    path,
    content,
    sha256: createHash('sha256').update(content).digest('hex'),
    mode: 0o444,
  };
}

export function buildBundleManifest({
  flawId,
  capsule,
  actionLog,
  assertion,
  sanitizedSourceEntries,
  sanitizationAttestation,
  budget,
  verdictSchema = VERIFIER_VERDICT_SCHEMA,
}) {
  if (typeof flawId !== 'string' || flawId.length === 0) {
    throw new TypeError('flawId must be a non-empty string');
  }
  if (typeof assertion !== 'string' || assertion.length === 0) {
    throw new TypeError('assertion must be a non-empty string');
  }
  if (!isPlainObject(capsule)) throw new TypeError('capsule must be a plain object');
  assertNoSecrets(capsule);
  if (!isPlainObject(budget)) throw new TypeError('budget must be a plain object');
  if (!Number.isFinite(budget.stepsMax)) {
    throw new TypeError('budget.stepsMax must be a finite number');
  }
  if (!isPlainObject(verdictSchema)) {
    throw new TypeError('verdictSchema must be a plain object');
  }

  const sourceEntries = validateSourceEntries(sanitizedSourceEntries);
  if (sourceEntries.length > 0) validateAttestation(sanitizationAttestation);

  const files = [
    bundleFile('input/flaw.json', JSON.stringify({ flawId, budget }, null, 2)),
    bundleFile('input/capsule.json', JSON.stringify(capsule, null, 2)),
    bundleFile('input/action-log.json', JSON.stringify(sanitizeActionLog(actionLog), null, 2)),
    bundleFile('input/assertion.txt', assertion),
    bundleFile('input/verdict.schema.json', JSON.stringify(verdictSchema, null, 2)),
  ];

  if (sourceEntries.length > 0) {
    files.push(bundleFile(
      'input/attestation.json',
      JSON.stringify(sanitizationAttestation, null, 2),
    ));
    for (const entry of sourceEntries) {
      files.push(bundleFile(`input/source/${entry.path}`, entry.content));
    }
  }

  const allowedPaths = [...new Set(files.map(({ path }) => path))].sort();
  return { files, allowedPaths };
}
