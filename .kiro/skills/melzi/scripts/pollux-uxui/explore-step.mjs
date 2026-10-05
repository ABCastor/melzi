#!/usr/bin/env node
/**
 * explore-step.mjs — the live per-step interface to the exploration graph.
 *
 * WHY THIS EXISTS
 * ---------------
 * `shouldStop()` and the K-stagnant-step plateau were correct from day one, and
 * the unit tests proved it. They still never fired on a real run (the E2/E5 gap).
 *
 * The reason was structural, not a tuning problem. `StateGraph` is an in-memory
 * class, and the Explorer is an LLM: every helper invocation is a FRESH node
 * process. So the graph died between steps, the plateau counter restarted at zero
 * every time, and `plateau` could never become true no matter how long the run
 * went. The loop could only ever stop on budget, leaving the coverage claim
 * untested. `buildObservations()` rebuilt the graph post-hoc from the finished
 * stream, which is why plateau appeared only in the closing report -- long after
 * it could steer anything.
 *
 * explore.md used to close that gap with prose ("do NOT stop at the last new
 * state; the stop signal is shouldStop()"). An instruction file is text, not
 * execution: it asked the Explorer to carry a counter it had no way to hold.
 *
 * This command gives it one. Each step loads the run's persisted graph, records
 * the observation, saves it, and prints the CURRENT coverage and stop decision.
 * Plateau becomes a live control signal instead of a post-mortem note.
 *
 * Usage (from the Explorer's loop, once per step):
 *   node explore-step.mjs observe --run-dir D --url U --a11y-file F --step N
 *                                 [--plateau-k K] [--steps-max N]
 *   node explore-step.mjs edge    --run-dir D --from ID --to ID --op click --ref e1 --step N
 *   node explore-step.mjs novelty --run-dir D --node ID --op click --ref e1
 *   node explore-step.mjs coverage --run-dir D
 *
 * Prints one JSON object on stdout. Exits non-zero on bad input: a step that
 * silently no-ops would corrupt the coverage claim, which is the one thing the
 * engine is supposed to be honest about.
 */
import { readFileSync } from 'node:fs';

import { loadGraph, loadStopConfig, saveGraph, saveStopConfig } from './controller.mjs';
import { shouldStop } from './coverage-stop.mjs';

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) { args._.push(token); continue; }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) { args[key] = true; continue; }
    args[key] = next;
    i += 1;
  }
  return args;
}

function required(args, name) {
  const value = args[name];
  if (typeof value !== 'string' || value === '') {
    throw new TypeError(`--${name} is required`);
  }
  return value;
}

function integer(args, name, fallback) {
  if (args[name] === undefined) return fallback;
  const value = Number(args[name]);
  if (!Number.isInteger(value)) throw new TypeError(`--${name} must be an integer`);
  return value;
}

function action(args) {
  return {
    op: required(args, 'op'),
    ref: required(args, 'ref'),
    ...(args.value !== undefined ? { value: String(args.value) } : {}),
  };
}

// The step budget is written on the first step and the stored value wins after that,
// exactly like the graph's K. It used to be re-read from argv every invocation with an
// Infinity default, so following explore.md ("pass --steps-max on the first step only")
// silently gave every later step an infinite budget and killed the budget stop outright.
// See loadStopConfig in controller.mjs.
function stopConfig(runDir, args) {
  const stored = loadStopConfig(runDir);
  if (stored) return stored;
  return saveStopConfig(runDir, {
    stepsMax: args['steps-max'] === undefined ? null : integer(args, 'steps-max'),
  });
}

// The budget is reported alongside coverage so the Explorer sees ONE stop
// decision, never a plateau signal it has to reconcile against a separate
// budget check it might skip.
function decide(runDir, graph, args) {
  const coverage = graph.coverage();
  const { stepsMax } = stopConfig(runDir, args);
  const budget = {
    stepsUsed: graph.events.length,
    // null means unlimited. It MUST become Infinity here: `n >= null` coerces to
    // `n >= 0`, which would report stop=budget on the very first step.
    stepsMax: stepsMax === null ? Number.POSITIVE_INFINITY : stepsMax,
  };
  return { coverage, stop: shouldStop({ coverage, budget }), budget };
}

function main(argv) {
  const args = parseArgs(argv);
  const command = args._[0];
  const runDir = required(args, 'run-dir');

  if (command === 'observe') {
    const url = required(args, 'url');
    const treePath = required(args, 'a11y-file');
    // Read before touching the graph: a malformed tree must fail the step, not
    // land an empty state that would fake a plateau.
    const a11yTree = JSON.parse(readFileSync(treePath, 'utf8'));
    const graph = loadGraph(runDir, integer(args, 'plateau-k', undefined));
    const node = graph.observe({ url, a11yTree, step: integer(args, 'step', 0) });
    saveGraph(runDir, graph);
    return { nodeId: node.id, newNode: node.visits === 1, ...decide(runDir, graph, args) };
  }

  if (command === 'edge') {
    const graph = loadGraph(runDir);
    graph.addEdge(
      required(args, 'from'),
      required(args, 'to'),
      action(args),
      integer(args, 'step', 0),
    );
    saveGraph(runDir, graph);
    return decide(runDir, graph, args);
  }

  if (command === 'novelty') {
    const graph = loadGraph(runDir);
    return { novelty: graph.novelty(required(args, 'node'), action(args)) };
  }

  if (command === 'coverage') {
    return decide(runDir, loadGraph(runDir), args);
  }

  throw new TypeError(`unknown command: ${command ?? '(none)'}`);
}

try {
  console.log(JSON.stringify(main(process.argv.slice(2))));
} catch (err) {
  console.error(`explore-step: ${err.message}`);
  process.exit(1);
}
