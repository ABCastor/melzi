import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldStop } from './coverage-stop.mjs';
import { StateGraph } from './state-graph.mjs';

test('stops as STALLED, never as exhausted, on a stagnation window', () => {
  assert.deepEqual(
    shouldStop({
      coverage: { plateau: true },
      budget: { stepsUsed: 1, stepsMax: 10 },
    }),
    { stop: true, reason: 'stalled' },
  );
});

test('stops when any budget dimension is exhausted', () => {
  assert.deepEqual(
    shouldStop({
      coverage: { plateau: false },
      budget: { stepsUsed: 10, stepsMax: 10 },
    }),
    { stop: true, reason: 'budget' },
  );
  assert.deepEqual(
    shouldStop({
      coverage: { plateau: false },
      budget: { stepsUsed: 1, stepsMax: 10, tokensUsed: 100, tokensMax: 100 },
    }),
    { stop: true, reason: 'budget' },
  );
});

// Precedence is a truth claim, not a formality. The stagnation window used to be
// checked FIRST, so a run that had simply run out of room reported a
// coverage-flavoured reason instead of the hard resource fact, flattering the run
// at exactly the moment it was weakest.
test('REGRESSION: budget beats stalled when both fire, never the reverse', () => {
  assert.deepEqual(
    shouldStop({
      coverage: { plateau: true },
      budget: { stepsUsed: 10, stepsMax: 10 },
    }),
    { stop: true, reason: 'budget' },
  );
  assert.deepEqual(
    shouldStop({
      coverage: { plateau: true },
      budget: { stepsUsed: 1, stepsMax: 10, tokensUsed: 100, tokensMax: 100 },
    }),
    { stop: true, reason: 'budget' },
  );
});

// THE FLOOR CASE, and the whole reason the exhaustion claim was retired. An
// Explorer that does nothing buys the stop reason outright: observe one unchanged
// page K+1 times, take ZERO actions, and the run stops with 1 node, 0 edges, and
// every control on the page still untried. Whatever that stop means, it cannot
// mean "the app was exhausted", which is exactly what `plateau` used to claim.
// Reproduced from the live code, not from a hand-built coverage object.
test('an IDLE observer buys `stalled` with 1 node, 0 edges, and nothing tried', () => {
  const K = 3;
  const graph = new StateGraph(K);
  const url = 'https://example.test/';
  const a11yTree = {
    a: { role: 'heading', name: 'Settings', state: {} },
    b: { role: 'button', name: 'Save', state: { disabled: false } },
    c: { role: 'button', name: 'Cancel', state: { disabled: false } },
  };

  // Observe the same unchanged page K+1 times. No addEdge, so no action is taken.
  let node;
  for (let step = 0; step <= K; step += 1) node = graph.observe({ url, a11yTree, step });

  const coverage = graph.coverage();
  assert.equal(coverage.nodeCount, 1, 'one page observed repeatedly is one state');
  assert.equal(coverage.edgeCount, 0, 'zero actions taken means zero transitions');
  assert.equal(coverage.plateau, true, 'the stagnation window fires on pure idleness');

  // The graph still reports every control as never tried, which is the proof that
  // the stop says nothing about what remained available.
  assert.equal(graph.novelty(node.id, { op: 'click', ref: 'b' }), 1);
  assert.equal(graph.novelty(node.id, { op: 'click', ref: 'c' }), 1);

  // Budget deliberately far from exhausted, so `stalled` is the reason under test.
  assert.deepEqual(
    shouldStop({ coverage, budget: { stepsUsed: 4, stepsMax: 100 } }),
    { stop: true, reason: 'stalled' },
    'an idle run reports stalled, and stalled must never be read as exhausted',
  );
});

test('continues while coverage and budget remain', () => {
  assert.deepEqual(
    shouldStop({
      coverage: { plateau: false },
      budget: { stepsUsed: 1, stepsMax: 10, tokensUsed: 10, tokensMax: 100 },
    }),
    { stop: false, reason: null },
  );
});
