import test from 'node:test';
import assert from 'node:assert/strict';

import { StateGraph, stateKey } from './state-graph.mjs';

const tree = {
  a: { role: 'heading', name: 'Home', state: {} },
  b: { role: 'button', name: 'Save', state: { disabled: false } },
};

test('stateKey ignores URL query/hash volatility and reference ordering', () => {
  const reordered = { z: tree.b, y: tree.a };

  assert.equal(
    stateKey({ url: 'https://example.test/app?nonce=1#top', a11yTree: tree }),
    stateKey({ url: 'https://example.test/app?nonce=2#bottom', a11yTree: reordered }),
  );
});

test('StateGraph collapses transient/dynamic changes but forks on a new control', () => {
  const graph = new StateGraph();
  const first = graph.observe({ url: 'https://example.test/?x=1', a11yTree: tree, step: 0 });
  const same = graph.observe({ url: 'https://example.test/?x=2', a11yTree: tree, step: 1 });
  // a transient toast (role=alert) is NOT a new state — it must collapse into the same node,
  // while remaining available to defect detection in the observation stream.
  const withToast = graph.observe({
    url: 'https://example.test/',
    a11yTree: { ...tree, c: { role: 'alert', name: 'Saved', state: {} } },
    step: 2,
  });
  // a genuinely new interactive control IS a new state.
  const withControl = graph.observe({
    url: 'https://example.test/',
    a11yTree: { ...tree, e: { role: 'button', name: 'Confirm', state: {} } },
    step: 3,
  });

  assert.equal(first.id, same.id);
  assert.equal(first.id, withToast.id, 'a transient alert must not create a new state');
  assert.notEqual(first.id, withControl.id, 'a new control must create a new state');
  assert.equal(graph.coverage().nodeCount, 2);
});

test('stateKey normalizes dynamic values within otherwise-stable nodes', () => {
  // the SAME nodes with a changed counter value and a changed field label suffix are one state:
  // dynamic numeric content is normalized out of identity names.
  const page = (counterLabel) => ({
    heading: { role: 'heading', name: 'Usage', state: {} },
    counter: { role: 'spinbutton', name: counterLabel, state: {} },
    save: { role: 'button', name: 'Save', state: { disabled: false } },
  });
  assert.equal(
    stateKey({ url: 'https://x.test/', a11yTree: page('Count 3') }),
    stateKey({ url: 'https://x.test/', a11yTree: page('Count 42') }),
  );
  // but a control whose disabled flag differs is NOT the same (a structural semantic change).
  assert.notEqual(
    stateKey({ url: 'https://x.test/', a11yTree: page('Count 3') }),
    stateKey({
      url: 'https://x.test/',
      a11yTree: { heading: { role: 'heading', name: 'Usage', state: {} }, counter: { role: 'spinbutton', name: 'Count 3', state: {} }, save: { role: 'button', name: 'Save', state: { disabled: true } } },
    }),
  );
});

test('plateau flips after K stagnant events and resets on a new node', () => {
  const graph = new StateGraph(3);
  const observation = { url: 'https://example.test/', a11yTree: tree };
  graph.observe({ ...observation, step: 0 });

  for (let step = 1; step <= 2; step += 1) {
    graph.observe({ ...observation, step });
  }
  assert.equal(graph.coverage().plateau, false);

  graph.observe({ ...observation, step: 3 });
  assert.deepEqual(graph.coverage(), {
    nodeCount: 1,
    edgeCount: 0,
    newNodesInLastK: 0,
    plateau: true,
  });

  graph.observe({
    url: 'https://example.test/changed',
    a11yTree: tree,
    step: 4,
  });
  assert.equal(graph.coverage().plateau, false);
});

test('edges are unique and novelty drops after an action is tried', () => {
  const graph = new StateGraph(2);
  const from = graph.observe({ url: 'https://example.test/', a11yTree: tree, step: 0 });
  const to = graph.observe({ url: 'https://example.test/next', a11yTree: tree, step: 1 });
  const action = { op: 'click', ref: 'next' };

  assert.equal(graph.novelty(from.id, action), 1);
  graph.addEdge(from.id, to.id, action, 2);
  assert.equal(graph.novelty(from.id, action), 0);
  graph.addEdge(from.id, to.id, action, 3);
  assert.equal(graph.coverage().edgeCount, 1);
  assert.deepEqual(from.actionsTaken, [action]);
});

// ─── Persistence across a process boundary ──────────────────────────────────
//
// The Explorer is an LLM: every helper invocation is a FRESH node process, so an
// in-memory graph dies between steps and the plateau counter can never reach K.
// That, not Explorer "cadence", is why plateau never fired live (the E2/E5 gap):
// the existing plateau test above passes only because it holds one live object.
// A graph that cannot round-trip is a graph the live loop cannot use.

test('StateGraph round-trips through JSON with nodes, edges, events and K intact', () => {
  const graph = new StateGraph(3);
  const a = graph.observe({ url: 'https://example.test/', a11yTree: tree, step: 0 });
  const b = graph.observe({
    url: 'https://example.test/next',
    a11yTree: { ...tree, c: { role: 'link', name: 'Next', state: {} } },
    step: 1,
  });
  graph.addEdge(a.id, b.id, { op: 'click', ref: 'e1' }, 1);

  const revived = StateGraph.fromJSON(JSON.parse(JSON.stringify(graph.toJSON())));

  assert.equal(revived.k, graph.k);
  assert.deepEqual(revived.coverage(), graph.coverage());
  assert.deepEqual([...revived.nodes.keys()].sort(), [...graph.nodes.keys()].sort());
  assert.deepEqual([...revived.edges.keys()].sort(), [...graph.edges.keys()].sort());
  // actionsTaken must survive, or novelty() would re-offer an action already tried.
  assert.equal(revived.novelty(a.id, { op: 'click', ref: 'e1' }), 0);
  assert.equal(revived.novelty(a.id, { op: 'click', ref: 'e2' }), 1);
});

test('plateau accumulates to K across process boundaries, not just in one live object', () => {
  const observation = { url: 'https://example.test/', a11yTree: tree };
  // Step 0 in "process 0"; every later step reloads from disk-shaped JSON, exactly
  // as a fresh helper invocation would.
  let wire = JSON.parse(JSON.stringify(new StateGraph(3).toJSON()));

  const stepOnce = (step) => {
    const graph = StateGraph.fromJSON(wire);      // fresh process
    graph.observe({ ...observation, step });
    wire = JSON.parse(JSON.stringify(graph.toJSON())); // persist
    return graph.coverage();
  };

  stepOnce(0);
  assert.equal(stepOnce(1).plateau, false);
  assert.equal(stepOnce(2).plateau, false);
  // The 3 most recent events are now all stagnant: plateau fires even though no
  // single process ever saw more than one step.
  assert.equal(stepOnce(3).plateau, true);
});
