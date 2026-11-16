/**
 * The run's stop decision. NEITHER reason proves coverage.
 *
 * `stalled` replaces the old `plateau` reason, which claimed the app had been
 * "genuinely exhausted". It never meant that. A stagnation window (K events with
 * no new node and no new edge) measures the ABSENCE OF DISCOVERY in recent
 * activity, and is unsound in both directions:
 *
 *   - false positive on an IDLE Explorer. Observing one unchanged page K+1 times
 *     while taking ZERO actions pushes {newNode:false,newEdge:false} every time,
 *     so it reports 1 node, 0 edges and "stalled" while every control on the page
 *     is still untried. Measured; see the floor-case test in coverage-stop.test.mjs.
 *   - false negative on a DILIGENT one. explore.md step 2 says prefer untried
 *     actions, so every first-time action sets newEdge and resets the window.
 *
 * "I found nothing new" equals "there is nothing new" only if everything available
 * was tried, and the graph cannot tell those apart: Contract 3 specifies
 * `node.actionsAvailable[]`, state-graph.mjs initializes it to [], and NOTHING
 * writes it. No denominator, therefore no coverage.
 *
 * So this engine has NO coverage-proving stop reason, and that is the honest
 * state. A real one (`model-frontier-exhausted`: every discovered, replayable,
 * in-scope action case carries a terminal disposition) needs the action-case
 * frontier model that does not exist yet (D2). Until then both reasons mean the
 * same thing about coverage: unproven.
 *
 * Budget is checked FIRST. It is a hard fact about resources, while stalling is a
 * heuristic over recent events, and checking the heuristic first silently upgraded
 * a run that had merely run out of room into a coverage-flavoured claim, flattering
 * the run at exactly the moment it was weakest.
 *
 * Note on naming: the graph's `coverage.plateau` field keeps its name on purpose.
 * It names the MEASUREMENT (a stagnation window), which is real and still useful as
 * a diversification trigger. `stalled` names the CLAIM this module publishes. Only
 * the claim was ever wrong.
 *
 * ADR: pollux-uxui/adr-retire-the-exhaustion-claim.md (D1, accepted 2026-07-16).
 */
export function shouldStop({ coverage, budget }) {
  if (budget.stepsUsed >= budget.stepsMax) return { stop: true, reason: 'budget' };
  if (
    budget.tokensUsed !== undefined
    && budget.tokensMax !== undefined
    && budget.tokensUsed >= budget.tokensMax
  ) {
    return { stop: true, reason: 'budget' };
  }
  if (coverage.plateau) return { stop: true, reason: 'stalled' };
  return { stop: false, reason: null };
}
