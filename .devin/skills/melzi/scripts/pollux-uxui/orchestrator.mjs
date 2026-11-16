// E2 orchestrator: ties the live Explorer stream to the deterministic core.
// The LLM Explorer drives the browser (Playwright MCP) and emits opaque candidate flaws; this
// CODE owns structure (Sol Arch-1.5): it runs the stream through the runner to get observations +
// coverage, completes each candidate into a schema-valid Contract-1 flaw, records it via the
// controller, and reports the plateau/stop decision. No browser or subprocess logic lives here
// (that is the live wrapper); this is pure + unit-testable on a recorded stream.

import { checkpoint, createRun, recordFlaw } from './controller.mjs';
import { flawId, validateFlaw } from './evidence.mjs';
import { buildObservations, parseStream } from './runner.mjs';

const DEFECT_TYPES = new Set([
  'dead-control', 'silent-failure', 'validation-gap', 'broken-resource',
  'wrong-state', 'layout-overflow', 'runtime-error', 'misleading-affordance', 'other',
]);
const SEVERITIES = new Set(['critical', 'high', 'medium', 'low']);
const OPS = new Set(['navigate', 'click', 'type', 'select', 'key', 'hover', 'wait']);

function toActionLog(rawLog) {
  return (Array.isArray(rawLog) ? rawLog : []).map((action, index) => {
    const op = OPS.has(action?.op) ? action.op : 'click';
    // Keep the durable selector as its OWN field (Contract 1 v0.2); do NOT collapse it into ref.
    // ref prefers the real snapshot ref, then the selector, then url/value as a last resort.
    const ref = String(action?.ref ?? action?.selector ?? action?.url ?? action?.value ?? `step-${index}`);
    const entry = { step: index, op, ref };
    if (action?.value !== undefined) entry.value = String(action.value);
    if (typeof action?.selector === 'string' && action.selector.length > 0) {
      entry.selector = action.selector;
    }
    return entry;
  });
}

// Merge the observed evidence across the run into a Contract-1 `observed` block. One page in P1, so
// the network/console/pageError context is shared; per-flaw evidence attribution is an E3+ refinement.
export function aggregateObserved(observations) {
  const network = [];
  const consoleErrors = [];
  const pageErrors = [];
  let screenshot = '';
  let bbox = { x: 0, y: 0, w: 0, h: 0 };

  for (const observation of observations) {
    for (const entry of observation.network ?? []) network.push(entry);
    for (const message of observation.consoleMessages ?? []) consoleErrors.push(String(message));
    for (const error of observation.pageErrors ?? []) {
      pageErrors.push(typeof error === 'string' ? error : (error?.message ?? JSON.stringify(error)));
    }
    if (observation.screenshot) screenshot = observation.screenshot;
    if (observation.bbox) bbox = observation.bbox;
  }
  return { screenshot: screenshot || 'n/a', bbox, consoleErrors, pageErrors, network };
}

export function completeFlaw({ candidate, runId, runStateId, observed }) {
  const actionLog = toActionLog(candidate?.actionLog);
  const assertion = String(candidate?.assertion ?? candidate?.title ?? 'unspecified expectation');
  return {
    schemaVersion: '0.1',
    runId,
    flawId: flawId(actionLog, assertion),
    defectType: DEFECT_TYPES.has(candidate?.defectType) ? candidate.defectType : 'other',
    severity: SEVERITIES.has(candidate?.severity) ? candidate.severity : 'medium',
    title: String(candidate?.title ?? 'untitled'),
    assertion,
    actionLog,
    observed: {
      ...observed,
      domProbes: candidate?.evidence ? { explorerEvidence: String(candidate.evidence) } : {},
    },
    runStateId,
    reproStatus: 'reproduced',
    createdBy: 'explorer',
  };
}

export function orchestrateExploration({ streamText, candidateFlaws, runState, runDir, budget }) {
  const steps = parseStream(streamText);
  const { observations, coverage, stop } = buildObservations(steps);
  const runId = createRun({
    runDir,
    runState,
    budget: budget ?? { stepsUsed: observations.length, stepsMax: 200 },
  });
  const observed = aggregateObserved(observations);

  const recorded = [];
  for (const candidate of Array.isArray(candidateFlaws) ? candidateFlaws : []) {
    const flaw = completeFlaw({ candidate, runId, runStateId: runState.id, observed });
    const result = validateFlaw(flaw);
    if (!result.valid) {
      recorded.push({ ok: false, title: candidate?.title, errors: result.errors });
      continue;
    }
    recordFlaw(runDir, flaw);
    recorded.push({ ok: true, flawId: flaw.flawId, title: flaw.title });
  }

  checkpoint(runDir, { coverage, stop, phase: 'explore' });
  return { runId, coverage, stop, observationCount: observations.length, recorded };
}
