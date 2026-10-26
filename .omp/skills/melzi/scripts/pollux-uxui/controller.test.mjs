import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { checkpoint, createRun, loadGraph, loadRun, loadVerdicts, recordFlaw, recordVerdict, saveGraph, setPhase } from './controller.mjs';
import { StateGraph } from './state-graph.mjs';
import { flawId } from './evidence.mjs';

const validVerifier = {
  verdict: 'confirmed',
  rationale: 'Independent replay reproduced the failure',
  decisiveEvidence: 'POST /api/save returned 501',
  independence: { coldContext: true, ownSession: true, replayedFromReset: true },
};

function validFlaw(runId) {
  const actionLog = [{ step: 0, op: 'click', ref: 'save' }];
  return {
    schemaVersion: '0.1',
    runId,
    flawId: flawId(actionLog, 'Save persists the form'),
    defectType: 'silent-failure',
    severity: 'high',
    title: 'Save does nothing',
    assertion: 'Save persists the form',
    actionLog,
    observed: {
      screenshot: 'shot.png',
      bbox: { x: 0, y: 0, w: 10, h: 10 },
      consoleErrors: [],
      pageErrors: [],
      network: [],
    },
    runStateId: 'capsule-1',
    verifier: {
      verdict: 'confirmed',
      rationale: 'Independent replay failed',
      decisiveEvidence: 'No save request occurred',
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

test('run checkpoints and flaws survive reload while invalid flaws are rejected', (t) => {
  const runDir = mkdtempSync(join(tmpdir(), 'pollux-uxui-'));
  t.after(() => rmSync(runDir, { recursive: true, force: true }));
  const runState = { id: 'capsule-1', baseUrl: 'https://example.test/' };
  const budget = { stepsUsed: 0, stepsMax: 20 };

  const runId = createRun({ runDir, runState, budget });
  assert.deepEqual(loadRun(runDir), { runId, runState, budget, phase: 'explore' });

  recordFlaw(runDir, validFlaw(runId));
  assert.throws(() => recordFlaw(runDir, { runId }), /Invalid flaw/);
  assert.equal(readFileSync(join(runDir, 'flaws.jsonl'), 'utf8').trim().split('\n').length, 1);

  checkpoint(runDir, { budget: { stepsUsed: 5, stepsMax: 20 } });
  setPhase(runDir, 'verify');
  assert.deepEqual(loadRun(runDir), {
    runId,
    runState,
    budget: { stepsUsed: 5, stepsMax: 20 },
    phase: 'verify',
  });
  assert.throws(() => setPhase(runDir, 'invalid'), /Invalid phase/);
});

test('verdicts are appended as independent verification events and rejected when malformed', (t) => {
  const runDir = mkdtempSync(join(tmpdir(), 'pollux-uxui-'));
  t.after(() => rmSync(runDir, { recursive: true, force: true }));

  assert.deepEqual(loadVerdicts(runDir), []); // none yet, no file

  const event = recordVerdict(runDir, 'flaw-abc', validVerifier);
  assert.deepEqual(event, { flawId: 'flaw-abc', verifier: validVerifier });
  recordVerdict(runDir, 'flaw-def', { ...validVerifier, verdict: 'rejected' });

  const verdicts = loadVerdicts(runDir);
  assert.equal(verdicts.length, 2); // append-only, both events kept
  assert.deepEqual(verdicts.map((v) => v.flawId), ['flaw-abc', 'flaw-def']);

  assert.throws(() => recordVerdict(runDir, '', validVerifier), /flawId/);
  assert.throws(
    () => recordVerdict(runDir, 'flaw-x', { ...validVerifier, independence: { coldContext: false, ownSession: true, replayedFromReset: true } }),
    /Invalid verdict/,
  );
});

// ─── State-graph persistence ────────────────────────────────────────────────
//
// The controller already owns everything else that must outlive a single helper
// invocation (runId, phase, budget, flaws, verdicts, checkpoints). The graph was
// the one piece it did NOT persist, so the live Explorer -- an LLM whose every
// call is a fresh process -- could never carry the plateau counter forward.

test('saveGraph/loadGraph round-trip the graph through the run dir', () => {
  const runDir = mkdtempSync(join(tmpdir(), 'pollux-graph-'));
  const tree = { a: { role: 'button', name: 'Save', state: {} } };

  const graph = new StateGraph(3);
  graph.observe({ url: 'https://example.test/', a11yTree: tree, step: 0 });
  saveGraph(runDir, graph);

  const revived = loadGraph(runDir);
  assert.equal(revived.k, 3);
  assert.deepEqual(revived.coverage(), graph.coverage());

  rmSync(runDir, { recursive: true, force: true });
});

test('loadGraph starts a fresh graph at the requested K when none is stored', () => {
  const runDir = mkdtempSync(join(tmpdir(), 'pollux-graph-new-'));

  const graph = loadGraph(runDir, 4);
  assert.equal(graph.k, 4);
  assert.deepEqual(graph.coverage(), {
    nodeCount: 0, edgeCount: 0, newNodesInLastK: 0, plateau: false,
  });

  rmSync(runDir, { recursive: true, force: true });
});

test('a stored graph keeps its own K, ignoring a later default', () => {
  const runDir = mkdtempSync(join(tmpdir(), 'pollux-graph-k-'));
  saveGraph(runDir, new StateGraph(7));
  // A caller passing the usual default must not silently re-tune a live run.
  assert.equal(loadGraph(runDir, 5).k, 7);

  rmSync(runDir, { recursive: true, force: true });
});
