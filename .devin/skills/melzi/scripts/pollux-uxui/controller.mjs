import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { validateFlaw } from './evidence.mjs';
import { StateGraph } from './state-graph.mjs';
import { validateVerdict } from './verifier-bundle.mjs';

const PHASES = new Set(['explore', 'verify', 'report', 'done']);
const DEFAULT_PLATEAU_K = 5;

function runPath(runDir) {
  return join(runDir, 'run.json');
}

function graphPath(runDir) {
  return join(runDir, 'state-graph.json');
}

function stopConfigPath(runDir) {
  return join(runDir, 'stop-config.json');
}

function persistTo(target, state) {
  const temporary = `${target}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`);
  renameSync(temporary, target);
}

function persist(runDir, state) {
  persistTo(runPath(runDir), state);
}

/**
 * Persist the exploration graph beside the rest of the run state.
 *
 * The controller owns everything that must outlive a single helper invocation.
 * The graph belongs here for the same reason the flaws log does: the live
 * Explorer is an LLM, so every call is a fresh process. An in-memory graph
 * restarts the plateau counter at zero on every step, which is why plateau never
 * fired live (the E2/E5 gap) while the in-process unit test passed.
 */
export function saveGraph(runDir, graph) {
  mkdirSync(runDir, { recursive: true });
  persistTo(graphPath(runDir), graph.toJSON());
}

/**
 * Load the run's graph, or start one at `k` if this is the first step.
 * A stored graph keeps its own K: re-tuning mid-run would silently redefine what
 * "plateau" means partway through, making the coverage claim unfalsifiable.
 */
export function loadGraph(runDir, k = DEFAULT_PLATEAU_K) {
  const path = graphPath(runDir);
  if (!existsSync(path)) return new StateGraph(k);
  return StateGraph.fromJSON(JSON.parse(readFileSync(path, 'utf8')));
}

/**
 * The OTHER half of the stop contract: the step budget.
 *
 * It is persisted for exactly the reason K is. K rides inside the graph, so passing
 * `--plateau-k` once is enough and a later default cannot redefine plateau mid-run.
 * `--steps-max` had no such home: it was re-read from argv on every invocation and
 * defaulted to Infinity, while explore.md told the Explorer to pass it "on the first
 * step only". Follow the doc and every step after the first silently ran with an
 * INFINITE budget, so `shouldStop`'s budget branch could never fire -- the exact
 * mirror of the bug cc5b4e3b fixed, where the run could only ever stop on budget.
 * Found by the first live real-app run (2026-07-16).
 *
 * A vanished stop condition is the failure this repo keeps re-learning: no error,
 * exit 0, wrong. So the budget is written once and the stored value wins after that.
 * `stepsMax: null` means unlimited and is stored explicitly -- callers MUST map it to
 * Infinity before comparing, because `n >= null` coerces to `n >= 0` and would stop
 * the run instantly.
 */
export function loadStopConfig(runDir) {
  const path = stopConfigPath(runDir);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function saveStopConfig(runDir, config) {
  mkdirSync(runDir, { recursive: true });
  persistTo(stopConfigPath(runDir), config);
  return config;
}

export function createRun({ runDir, runState, budget }) {
  const runId = randomUUID();
  mkdirSync(runDir, { recursive: true });
  persist(runDir, { runId, runState, budget, phase: 'explore' });
  return runId;
}

export function loadRun(runDir) {
  return JSON.parse(readFileSync(runPath(runDir), 'utf8'));
}

export function recordFlaw(runDir, flaw) {
  const result = validateFlaw(flaw);
  if (!result.valid) throw new TypeError(`Invalid flaw: ${result.errors.join('; ')}`);
  appendFileSync(join(runDir, 'flaws.jsonl'), `${JSON.stringify(flaw)}\n`);
}

// The independent Verifier's verdict is written as an APPEND-ONLY verification event keyed by flawId,
// NOT merged into the Explorer's flaws.jsonl and NOT hidden inside the launcher (Sol). A reader joins
// flaws.jsonl and verdicts.jsonl by flawId. The verifier block must satisfy the Contract-1 shape.
export function recordVerdict(runDir, flawId, verifier) {
  if (typeof flawId !== 'string' || flawId.length === 0) {
    throw new TypeError('flawId must be a non-empty string');
  }
  const result = validateVerdict(verifier);
  if (!result.valid) throw new TypeError(`Invalid verdict: ${result.errors.join('; ')}`);
  const event = { flawId, verifier };
  appendFileSync(join(runDir, 'verdicts.jsonl'), `${JSON.stringify(event)}\n`);
  return event;
}

export function loadVerdicts(runDir) {
  const path = join(runDir, 'verdicts.jsonl');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

export function setPhase(runDir, phase) {
  if (!PHASES.has(phase)) throw new TypeError(`Invalid phase: ${phase}`);
  return checkpoint(runDir, { phase });
}

export function checkpoint(runDir, patch) {
  const state = { ...loadRun(runDir), ...patch };
  persist(runDir, state);
  return state;
}
