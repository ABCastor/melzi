import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeActionLog, parse, serialize } from './replay.mjs';

test('a well-formed action log serializes and parses losslessly', () => {
  const log = [
    { step: 0, op: 'navigate', ref: 'home' },
    { step: 1, op: 'type', ref: 'email', value: 'a@example.test', note: 'Enter email' },
  ];

  assert.deepEqual(parse(serialize(log)), log);
});

test('malformed action steps throw with their index', () => {
  assert.throws(
    () => normalizeActionLog([{ step: 0, op: 'tap', ref: 'save' }]),
    /actionLog\[0\]\.op/,
  );
  assert.throws(() => parse('{'), SyntaxError);
});

test('a durable selector round-trips and a non-string selector throws', () => {
  const log = [{ step: 0, op: 'click', ref: 'e17', selector: '#save' }];
  assert.deepEqual(parse(serialize(log)), log);
  assert.throws(
    () => normalizeActionLog([{ step: 0, op: 'click', ref: 'e17', selector: 42 }]),
    /actionLog\[0\]\.selector/,
  );
});

test('valid step indices are reindexed sequentially without mutating input', () => {
  const log = [
    { step: 8, op: 'click', ref: 'first' },
    { step: 3, op: 'wait', ref: 'result', value: '500' },
  ];

  const normalized = normalizeActionLog(log);
  assert.deepEqual(normalized.map(({ step }) => step), [0, 1]);
  assert.deepEqual(log.map(({ step }) => step), [8, 3]);
});
