import { createHash } from 'node:crypto';

const DEFECT_TYPES = new Set([
  'dead-control',
  'silent-failure',
  'validation-gap',
  'broken-resource',
  'wrong-state',
  'layout-overflow',
  'runtime-error',
  'misleading-affordance',
  'other',
]);
const SEVERITIES = new Set(['critical', 'high', 'medium', 'low']);
const VERDICTS = new Set(['confirmed', 'rejected', 'inconclusive']);
const REPRO_STATUSES = new Set(['reproduced', 'not-reproduced', 'flaky']);
const OPS = new Set(['navigate', 'click', 'type', 'select', 'key', 'hover', 'wait']);

function required(obj, key, path, errors) {
  if (!obj || !Object.hasOwn(obj, key) || obj[key] === undefined) {
    errors.push(`${path} is required`);
    return undefined;
  }
  return obj[key];
}

function expectType(value, type, path, errors) {
  if (value !== undefined && typeof value !== type) errors.push(`${path} must be a ${type}`);
}

function expectArray(value, path, errors) {
  if (value !== undefined && !Array.isArray(value)) errors.push(`${path} must be an array`);
}

function expectEnum(value, values, path, errors) {
  if (value !== undefined && !values.has(value)) {
    errors.push(`${path} must be one of: ${[...values].join(', ')}`);
  }
}

function validateAction(action, path, errors) {
  if (!action || typeof action !== 'object' || Array.isArray(action)) {
    errors.push(`${path} must be an object`);
    return;
  }

  const step = required(action, 'step', `${path}.step`, errors);
  if (step !== undefined && (!Number.isInteger(step) || step < 0)) {
    errors.push(`${path}.step must be a non-negative integer`);
  }
  const op = required(action, 'op', `${path}.op`, errors);
  expectEnum(op, OPS, `${path}.op`, errors);
  const ref = required(action, 'ref', `${path}.ref`, errors);
  expectType(ref, 'string', `${path}.ref`, errors);
  if (Object.hasOwn(action, 'value') && typeof action.value !== 'string') {
    errors.push(`${path}.value must be a string`);
  }
  if (Object.hasOwn(action, 'selector') && typeof action.selector !== 'string') {
    errors.push(`${path}.selector must be a string`);
  }
  if (Object.hasOwn(action, 'note') && typeof action.note !== 'string') {
    errors.push(`${path}.note must be a string`);
  }
}

export function validateFlaw(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { valid: false, errors: ['flaw must be an object'] };
  }

  const errors = [];
  const schemaVersion = required(obj, 'schemaVersion', 'schemaVersion', errors);
  if (schemaVersion !== undefined && schemaVersion !== '0.1') {
    errors.push('schemaVersion must be 0.1');
  }

  for (const path of ['runId', 'flawId', 'title', 'assertion', 'runStateId']) {
    expectType(required(obj, path, path, errors), 'string', path, errors);
  }

  const defectType = required(obj, 'defectType', 'defectType', errors);
  expectEnum(defectType, DEFECT_TYPES, 'defectType', errors);
  const severity = required(obj, 'severity', 'severity', errors);
  expectEnum(severity, SEVERITIES, 'severity', errors);

  const actionLog = required(obj, 'actionLog', 'actionLog', errors);
  expectArray(actionLog, 'actionLog', errors);
  if (Array.isArray(actionLog)) {
    actionLog.forEach((action, index) => validateAction(action, `actionLog[${index}]`, errors));
  }

  const observed = required(obj, 'observed', 'observed', errors);
  if (observed !== undefined && (!observed || typeof observed !== 'object' || Array.isArray(observed))) {
    errors.push('observed must be an object');
  } else if (observed) {
    expectType(required(observed, 'screenshot', 'observed.screenshot', errors), 'string', 'observed.screenshot', errors);
    const bbox = required(observed, 'bbox', 'observed.bbox', errors);
    if (bbox !== undefined && (!bbox || typeof bbox !== 'object' || Array.isArray(bbox))) {
      errors.push('observed.bbox must be an object');
    } else if (bbox) {
      for (const key of ['x', 'y', 'w', 'h']) {
        const value = required(bbox, key, `observed.bbox.${key}`, errors);
        if (value !== undefined && !Number.isFinite(value)) {
          errors.push(`observed.bbox.${key} must be a number`);
        }
      }
    }

    for (const key of ['consoleErrors', 'pageErrors']) {
      const value = required(observed, key, `observed.${key}`, errors);
      expectArray(value, `observed.${key}`, errors);
      if (Array.isArray(value) && value.some((item) => typeof item !== 'string')) {
        errors.push(`observed.${key} must contain only strings`);
      }
    }

    const network = required(observed, 'network', 'observed.network', errors);
    expectArray(network, 'observed.network', errors);
    if (Array.isArray(network)) {
      network.forEach((entry, index) => {
        const path = `observed.network[${index}]`;
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          errors.push(`${path} must be an object`);
          return;
        }
        expectType(required(entry, 'method', `${path}.method`, errors), 'string', `${path}.method`, errors);
        expectType(required(entry, 'url', `${path}.url`, errors), 'string', `${path}.url`, errors);
        const status = required(entry, 'status', `${path}.status`, errors);
        if (status !== undefined && !Number.isFinite(status)) errors.push(`${path}.status must be a number`);
      });
    }
    if (Object.hasOwn(observed, 'domProbes') && (
      !observed.domProbes || typeof observed.domProbes !== 'object' || Array.isArray(observed.domProbes)
    )) {
      errors.push('observed.domProbes must be an object');
    }
  }

  // verifier is OPTIONAL: the Explorer creates a flaw pre-verification (createdBy: explorer);
  // the independent Verifier fills this in later. Validate its shape only when present.
  if (Object.hasOwn(obj, 'verifier') && obj.verifier !== undefined) {
    const verifier = obj.verifier;
    if (!verifier || typeof verifier !== 'object' || Array.isArray(verifier)) {
      errors.push('verifier must be an object');
    } else {
      const verdict = required(verifier, 'verdict', 'verifier.verdict', errors);
      expectEnum(verdict, VERDICTS, 'verifier.verdict', errors);
      for (const key of ['rationale', 'decisiveEvidence']) {
        expectType(required(verifier, key, `verifier.${key}`, errors), 'string', `verifier.${key}`, errors);
      }
      const independence = required(verifier, 'independence', 'verifier.independence', errors);
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
    }
  }

  const reproStatus = required(obj, 'reproStatus', 'reproStatus', errors);
  expectEnum(reproStatus, REPRO_STATUSES, 'reproStatus', errors);
  const createdBy = required(obj, 'createdBy', 'createdBy', errors);
  if (createdBy !== undefined && createdBy !== 'explorer') errors.push('createdBy must be explorer');

  return { valid: errors.length === 0, errors };
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

export function flawId(actionLog, assertion) {
  const input = JSON.stringify(canonical({ actionLog, assertion }));
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}
