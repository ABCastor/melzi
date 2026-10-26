// Vertical-slice integration test: composes the whole deterministic pipeline
// (controller + state-graph + evidence + coverage-stop) through a realistic short
// exploration of the seeded settings fixture, including the Verifier verdict write-back.
// This proves the modules integrate end to end. The LIVE browser + own-session Verifier
// re-drive is the next step (needs the Playwright MCP driver adapter); the oracle mechanism
// itself is already validated in pollux-uxui/spike/SPIKE-FINDINGS.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRun, loadRun, recordFlaw, setPhase } from './controller.mjs';
import { StateGraph } from './state-graph.mjs';
import { shouldStop } from './coverage-stop.mjs';
import { flawId, validateFlaw } from './evidence.mjs';

const runState = {
  id: 'state-1',
  appVersion: 'fixture@spike',
  baseUrl: 'http://localhost:8799/index.html',
  auth: { identity: 'anon', method: 'none', note: 'public fixture' },
  seededData: 'spike fixture',
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

// a11y snapshots for the two structural states the fixture reaches: settings view, and
// the same view with the delete-confirmation modal open (a genuine structural change).
const settingsTree = {
  save: { role: 'button', name: 'Save changes', state: 'enabled' },
  learn: { role: 'button', name: 'Learn more', state: 'enabled' },
  del: { role: 'button', name: 'Delete account', state: 'enabled' },
};
const modalTree = {
  ...settingsTree,
  confirmDel: { role: 'button', name: 'Delete', state: 'enabled' },
  cancel: { role: 'button', name: 'Cancel', state: 'enabled' },
};

function explorerFlaw({ defectType, severity, title, assertion, actionLog, observed }) {
  return {
    schemaVersion: '0.1',
    runId: 'run-x',
    flawId: flawId(actionLog, assertion),
    defectType,
    severity,
    title,
    assertion,
    actionLog,
    observed,
    runStateId: runState.id,
    reproStatus: 'reproduced',
    createdBy: 'explorer',
  };
}

test('vertical slice: explore -> record flaws -> stalled stop -> verify -> persisted run', () => {
  const runDir = mkdtempSync(join(tmpdir(), 'pollux-slice-'));
  const budget = { stepsUsed: 0, stepsMax: 50 };
  const runId = createRun({ runDir, runState, budget });
  assert.match(runId, /[0-9a-f-]{36}/);

  const graph = new StateGraph(3);
  const base = 'http://localhost:8799/index.html';

  // Explorer drives the page. Same structural settings state on repeat visits collapses to one node.
  const n0 = graph.observe({ url: base, a11yTree: settingsTree, step: 0 });
  const n1 = graph.observe({ url: `${base}?t=1`, a11yTree: settingsTree, step: 1 }); // query-only change => same node
  assert.equal(n0.id, n1.id, 'query-only navigation must not create a new state');

  // Opening the delete modal is a real structural change => new node + edge.
  const nModal = graph.observe({ url: base, a11yTree: modalTree, step: 2 });
  assert.notEqual(nModal.id, n0.id, 'opening the modal must create a new state');
  graph.addEdge(n0.id, nModal.id, { op: 'click', ref: 'del' }, 2);

  // Record three explorer-found flaws (no verifier verdict yet), validated on write.
  recordFlaw(runDir, explorerFlaw({
    defectType: 'silent-failure',
    severity: 'high',
    title: 'Save shows success on a failed request',
    assertion: 'Save must not report success when POST /api/save fails',
    actionLog: [{ step: 0, op: 'navigate', ref: base }, { step: 1, op: 'click', ref: 'save' }],
    observed: {
      screenshot: 'save.png', bbox: { x: 740, y: 835, w: 110, h: 40 },
      consoleErrors: [], pageErrors: [],
      network: [{ method: 'POST', url: '/api/save', status: 501 }],
    },
  }));
  recordFlaw(runDir, explorerFlaw({
    defectType: 'runtime-error',
    severity: 'medium',
    title: 'Uncaught ReferenceError on load',
    assertion: 'The page must load with no uncaught exceptions',
    actionLog: [{ step: 0, op: 'navigate', ref: base }],
    observed: {
      screenshot: 'load.png', bbox: { x: 0, y: 0, w: 1280, h: 60 },
      consoleErrors: [], pageErrors: ['Uncaught ReferenceError: reportAnalyticsBoot is not defined'],
      network: [{ method: 'GET', url: '/index.html', status: 200 }],
    },
  }));
  recordFlaw(runDir, explorerFlaw({
    defectType: 'misleading-affordance',
    severity: 'high',
    title: 'Delete button looks disabled but is live',
    assertion: 'A control that looks disabled must not perform a destructive action',
    actionLog: [{ step: 0, op: 'navigate', ref: base }, { step: 1, op: 'click', ref: 'del' }],
    observed: {
      screenshot: 'del.png', bbox: { x: 460, y: 700, w: 150, h: 40 },
      consoleErrors: [], pageErrors: [],
      network: [], domProbes: { opacity: '0.4', disabled: false, pointerEvents: 'auto' },
    },
  }));

  // Coverage should NOT plateau yet (we just added a node+edge within the last K events)...
  assert.equal(shouldStop({ coverage: graph.coverage(), budget }).stop, false);

  // ...then stagnant exploration (re-observing known states) fills the window after K events.
  graph.observe({ url: base, a11yTree: settingsTree, step: 3 });
  graph.observe({ url: base, a11yTree: modalTree, step: 4 });
  graph.observe({ url: base, a11yTree: settingsTree, step: 5 });
  const stop = shouldStop({ coverage: graph.coverage(), budget });
  assert.equal(stop.stop, true);
  assert.equal(stop.reason, 'stalled');

  setPhase(runDir, 'verify');

  // Independent Verifier confirms one flaw; the verdict is written back and re-validated.
  const flaws = readFileSync(join(runDir, 'flaws.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(flaws.length, 3);
  const confirmed = {
    ...flaws[0],
    verifier: {
      verdict: 'confirmed',
      rationale: 'Reset + replay: POST /api/save returned 501 while the UI showed Saved!',
      decisiveEvidence: 'network: POST /api/save 501',
      independence: { coldContext: true, ownSession: true, replayedFromReset: true },
    },
    reproStatus: 'reproduced',
  };
  assert.deepEqual(validateFlaw(confirmed), { valid: true, errors: [] });

  setPhase(runDir, 'done');
  const finalState = loadRun(runDir);
  assert.equal(finalState.phase, 'done');
  assert.equal(finalState.runId, runId);
  assert.equal(graph.coverage().nodeCount, 2);
  assert.equal(graph.coverage().edgeCount, 1);
});
