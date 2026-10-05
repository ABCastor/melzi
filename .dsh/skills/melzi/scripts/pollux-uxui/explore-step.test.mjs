import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('./explore-step.mjs', import.meta.url));

const tree = {
  a: { role: 'heading', name: 'Home', state: {} },
  b: { role: 'button', name: 'Save', state: { disabled: false } },
};

function runStep(runDir, args) {
  // A REAL separate process per step. This is the whole point: the live Explorer
  // gets a fresh node process every invocation, so anything the plateau counter
  // needs must survive on disk. An in-process test cannot prove that.
  const out = execFileSync(process.execPath, [CLI, ...args], {
    cwd: runDir,
    encoding: 'utf8',
  });
  return JSON.parse(out);
}

function observeArgs(runDir, { url, a11yTree, step, k }) {
  const treePath = join(runDir, `tree-${step}.json`);
  writeFileSync(treePath, JSON.stringify(a11yTree));
  return [
    'observe',
    '--run-dir', runDir,
    '--url', url,
    '--a11y-file', treePath,
    '--step', String(step),
    ...(k ? ['--plateau-k', String(k)] : []),
  ];
}

test('explore-step reports coverage and stop after each observation', () => {
  const runDir = mkdtempSync(join(tmpdir(), 'pollux-step-'));

  const first = runStep(runDir, observeArgs(runDir, {
    url: 'https://example.test/', a11yTree: tree, step: 0, k: 3,
  }));

  assert.equal(first.coverage.nodeCount, 1);
  assert.equal(first.coverage.plateau, false);
  assert.equal(first.stop.stop, false);
  assert.equal(typeof first.nodeId, 'string');

  rmSync(runDir, { recursive: true, force: true });
});

// The regression this whole change exists for. Before the graph was persisted,
// every step started from an empty graph, so `plateau` was false forever and the
// loop could only ever stop on budget -- the E2/E5 gap. Each step below is a
// genuinely separate OS process.
test('REGRESSION: plateau fires across real process boundaries at K', () => {
  const runDir = mkdtempSync(join(tmpdir(), 'pollux-step-plateau-'));
  const same = { url: 'https://example.test/', a11yTree: tree };

  runStep(runDir, observeArgs(runDir, { ...same, step: 0, k: 3 }));
  assert.equal(runStep(runDir, observeArgs(runDir, { ...same, step: 1 })).coverage.plateau, false);
  assert.equal(runStep(runDir, observeArgs(runDir, { ...same, step: 2 })).coverage.plateau, false);

  const fired = runStep(runDir, observeArgs(runDir, { ...same, step: 3 }));
  assert.equal(fired.coverage.plateau, true);
  assert.equal(fired.stop.stop, true);
  // The stagnation window survives across processes (what this test guards), and
  // the reason it publishes is `stalled`, never a coverage claim. Note these steps
  // take ZERO actions, so this run is also the idle floor case: see the dedicated
  // assertion in coverage-stop.test.mjs.
  assert.equal(fired.stop.reason, 'stalled');

  rmSync(runDir, { recursive: true, force: true });
});

test('a new state resets the plateau counter across processes', () => {
  const runDir = mkdtempSync(join(tmpdir(), 'pollux-step-reset-'));
  const same = { url: 'https://example.test/', a11yTree: tree };

  runStep(runDir, observeArgs(runDir, { ...same, step: 0, k: 3 }));
  runStep(runDir, observeArgs(runDir, { ...same, step: 1 }));
  runStep(runDir, observeArgs(runDir, { ...same, step: 2 }));

  // A genuinely new state lands before K is reached.
  const novel = runStep(runDir, observeArgs(runDir, {
    url: 'https://example.test/next',
    a11yTree: { ...tree, c: { role: 'link', name: 'Next', state: {} } },
    step: 3,
  }));
  assert.equal(novel.coverage.nodeCount, 2);
  assert.equal(novel.coverage.plateau, false);

  rmSync(runDir, { recursive: true, force: true });
});

test('explore-step records an edge and marks the action as tried', () => {
  const runDir = mkdtempSync(join(tmpdir(), 'pollux-step-edge-'));

  const from = runStep(runDir, observeArgs(runDir, {
    url: 'https://example.test/', a11yTree: tree, step: 0, k: 3,
  }));
  const to = runStep(runDir, observeArgs(runDir, {
    url: 'https://example.test/next',
    a11yTree: { ...tree, c: { role: 'link', name: 'Next', state: {} } },
    step: 1,
  }));

  const edged = runStep(runDir, [
    'edge',
    '--run-dir', runDir,
    '--from', from.nodeId,
    '--to', to.nodeId,
    '--op', 'click',
    '--ref', 'e1',
    '--step', '1',
  ]);
  assert.equal(edged.coverage.edgeCount, 1);

  // novelty must now report the action as tried, or the Explorer would loop on it.
  const checked = runStep(runDir, [
    'novelty', '--run-dir', runDir, '--node', from.nodeId, '--op', 'click', '--ref', 'e1',
  ]);
  assert.equal(checked.novelty, 0);

  rmSync(runDir, { recursive: true, force: true });
});

test('explore-step honours a step budget as a stop reason', () => {
  const runDir = mkdtempSync(join(tmpdir(), 'pollux-step-budget-'));

  const out = runStep(runDir, [
    ...observeArgs(runDir, { url: 'https://example.test/', a11yTree: tree, step: 0, k: 3 }),
    '--steps-max', '1',
  ]);
  assert.equal(out.stop.stop, true);
  assert.equal(out.stop.reason, 'budget');

  rmSync(runDir, { recursive: true, force: true });
});

test('explore-step fails loudly on an unreadable a11y file rather than silently empty', () => {
  const runDir = mkdtempSync(join(tmpdir(), 'pollux-step-bad-'));

  assert.throws(() => runStep(runDir, [
    'observe', '--run-dir', runDir,
    '--url', 'https://example.test/',
    '--a11y-file', join(runDir, 'missing.json'),
    '--step', '0',
  ]));

  rmSync(runDir, { recursive: true, force: true });
});

// Found by the first live real-app run (2026-07-16), not by any in-process test.
// `--steps-max` was re-read from argv on every invocation with an Infinity default,
// while explore.md instructs the Explorer to pass it "on the first step only". Every
// step after the first therefore ran with an infinite budget and the budget branch of
// shouldStop could never fire -- the mirror of the bug cc5b4e3b fixed, where the run
// could only ever stop ON budget. Both are the same shape: a stop condition that
// silently vanishes between processes. These drive real processes for that reason.
test('the step budget survives between processes when passed once, as explore.md says', () => {
  const runDir = mkdtempSync(join(tmpdir(), 'pollux-budget-'));

  // Only the first step carries --steps-max, exactly as explore.md instructs.
  const first = runStep(runDir, observeArgs(runDir, {
    url: 'https://example.test/', a11yTree: tree, step: 0, k: 3,
  }).concat(['--steps-max', '2']));
  assert.equal(first.budget.stepsMax, 2, 'the budget must be honoured on the step that sets it');
  assert.equal(first.stop.stop, false);

  // A later step passes NO --steps-max. Before the fix this silently became Infinity.
  const second = runStep(runDir, observeArgs(runDir, {
    url: 'https://example.test/other', a11yTree: tree, step: 1,
  }));
  assert.equal(second.budget.stepsMax, 2, 'the stored budget must survive a step that omits it');
  assert.deepEqual(second.stop, { stop: true, reason: 'budget' }, 'budget must fire at stepsMax');
});

test('a stored budget wins over a later --steps-max, as a stored K does', () => {
  const runDir = mkdtempSync(join(tmpdir(), 'pollux-budget-fixed-'));

  runStep(runDir, observeArgs(runDir, {
    url: 'https://example.test/', a11yTree: tree, step: 0, k: 3,
  }).concat(['--steps-max', '2']));

  // Re-tuning mid-run would redefine the stop condition partway through and make the
  // coverage claim unfalsifiable, which is the same reason the graph pins its own K.
  const raised = runStep(runDir, observeArgs(runDir, {
    url: 'https://example.test/other', a11yTree: tree, step: 1,
  }).concat(['--steps-max', '99']));
  assert.equal(raised.budget.stepsMax, 2, 'a later --steps-max must not redefine the budget mid-run');
  assert.equal(raised.stop.reason, 'budget');
});

test('an unset budget means unlimited, and must never coerce into an instant stop', () => {
  const runDir = mkdtempSync(join(tmpdir(), 'pollux-budget-none-'));

  // `stepsMax: null` is stored explicitly for "unlimited". If it reached shouldStop as
  // null, `1 >= null` coerces to `1 >= 0` and the run would stop on its very first step.
  const only = runStep(runDir, observeArgs(runDir, {
    url: 'https://example.test/', a11yTree: tree, step: 0, k: 3,
  }));
  assert.equal(only.stop.stop, false, 'no --steps-max must not stop the run instantly');
  assert.equal(only.stop.reason, null);
});
