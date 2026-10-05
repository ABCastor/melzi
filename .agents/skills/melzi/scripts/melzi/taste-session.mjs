#!/usr/bin/env node
/**
 * The seam: one comparison, start to finish.
 *
 * FORK-ONLY. Upstream has no equivalent, so this file carries zero merge burden.
 *
 * WHY THIS EXISTS. The taste system arrived as four correct modules with a hole
 * between them. `taste-store.mjs` knows which pair to deal and how to record an
 * outcome, `serve-compare.mjs` knows how to put two screens in front of him and
 * collect a verdict, and neither knows about the other on purpose: coupling the
 * server to the store would have made the server untestable without a home
 * directory. So the glue was left unowned, and unowned glue is where a loop
 * quietly stops running. This file is that glue, and nothing else.
 *
 * WHAT IT DOES. Three verbs, each one step of the loop in [taste.md]:
 *
 *   --deal     pick the next pair, render the current profile, and print the
 *              payload serve-compare wants. The profile goes in so he watches
 *              his own taste form while he clicks, which is the thing that makes
 *              the loop feel like it is going somewhere rather than like a quiz.
 *   --record   take a serve-compare ANSWER line (stdin or --answer) and append
 *              the comparison, annotations and all.
 *   --profile  print the readable profile plus any cycles, for showing him.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not name attributes. That step is a
 * model looking at two screens and saying how they differ, and no script can do
 * it; `taste.md` section 3 owns it and calls `mergeAttributes` and `setVector`
 * directly. Automating it with a heuristic would fill the vocabulary with the
 * axes a regex can see, which are exactly the axes that do not matter.
 *
 * FAILURE POLICY. Nothing here throws into a caller's flow. A missing store, an
 * unparsable answer, or a pool too small to deal from prints one plain line and
 * exits non-zero; it never takes his verdict down with it.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  appendComparison,
  nextPair,
  readAttributes,
  readCandidates,
  readComparisons,
  configureStoppingRule,
  finishStoppingRule,
  readTasteSession,
  recordStoppingCandidates,
  saveDerivedStoppingBar,
} from './taste-store.mjs';
import {
  cycleTensions,
  detectCycles,
  fitAttributeWeights,
  renderProfile,
  renderResponseTimeProfile,
  deriveStoppingBar,
  candidateClearsStoppingBar,
  weightForResponseMs,
} from './taste-model.mjs';

/** Fit the weights and render the profile, or say plainly that there is nothing yet. */
export function currentProfile({ home = os.homedir() } = {}) {
  try {
    const comparisons = readComparisons({ home });
    if (comparisons.length === 0) {
      return { text: 'Nothing learned yet. This is the first comparison.', comparisons: 0, cycles: [] };
    }
    const { attributes, vectors } = readAttributes({ home });
    const weights = fitAttributeWeights(comparisons, { attributes, vectors });
    const ranking = attributes.length > 0
      ? renderProfile(weights, { attributes, comparisons: comparisons.length })
      : `${comparisons.length} comparison(s) recorded, no attributes named yet. Name them (taste.md section 3) or the profile cannot generalize.`;
    const timing = renderResponseTimeProfile(comparisons, { attributes, vectors });
    const text = `${ranking}\n\n${timing}`;

    // Cycles are surfaced, never smoothed. A cycle means he judged on two
    // criteria at once, and the tension is the finding.
    const candidates = readCandidates({ home });
    const cycles = detectCycles(comparisons, { candidates }).map((cycle) => ({
      ...cycle,
      tensions: cycleTensions(cycle, { vectors, attributes }).slice(0, 3),
    }));
    return { text, comparisons: comparisons.length, cycles };
  } catch {
    return { text: 'Profile unavailable.', comparisons: 0, cycles: [] };
  }
}

/** Build the serve-compare payload for the next pair worth showing him. */
function option(candidate) {
  return { id: candidate.id, label: candidate.label ?? candidate.id, screen: candidate.screen ?? null };
}

function stoppingSurface(stopping, { phase = stopping.phase, bar = stopping.derivedBar } = {}) {
  const calibrationLeft = Math.max(0, stopping.calibrationCandidateCap - stopping.calibrationCandidateIds.length);
  return {
    phase,
    candidateCap: stopping.candidateCap,
    seenCandidates: stopping.seenCandidateIds.length,
    calibrationCandidateCap: stopping.calibrationCandidateCap,
    calibrationComparisonsRemaining: Math.ceil(calibrationLeft / 2),
    derivedBar: bar,
    adjustedBar: stopping.adjustedBar,
    budgetChanges: stopping.budgetChanges,
    winner: stopping.winner,
  };
}

function stoppingDeal({ home, project, intuition, candidates, comparisons }) {
  const record = readTasteSession(intuition.stopping.session, { home });
  const stopping = record?.stopping;
  if (!stopping) return null;
  const find = (id) => candidates.find((candidate) => candidate?.id === id) || null;
  if (stopping.phase === 'complete') {
    return { title: 'Session complete', question: `${stopping.winner?.label ?? stopping.winner?.id ?? 'A candidate'} was selected. This session is over.`, terminal: true, winner: stopping.winner, stoppingRule: stoppingSurface(stopping), intuition };
  }
  if (stopping.phase === 'calibration') {
    const unseen = candidates.filter((candidate) => !stopping.seenCandidateIds.includes(candidate.id));
    const needed = stopping.calibrationCandidateCap - stopping.calibrationCandidateIds.length;
    const pool = needed === 1
      ? [...unseen.slice(0, 1), ...stopping.calibrationCandidateIds.map(find).filter(Boolean)]
      : unseen;
    const pair = nextPair({ home, candidates: pool, comparisons });
    if (!pair) return null;
    const a = find(pair.a);
    const b = find(pair.b);
    if (!a || !b) return null;
    const before = stoppingSurface(stopping, { phase: 'calibration' });
    recordStoppingCandidates(intuition.stopping.session, [a.id, b.id], { home });
    return {
      title: 'Calibration pair',
      question: 'Pick left, right, or tie. This records the warm-up, but no candidate can win yet.',
      a: option(a), b: option(b), profile: null, comparisons: comparisons.length, project, reason: pair.reason ?? null,
      intuition, stoppingRule: before,
    };
  }
  if (stopping.phase === 'bar-review') {
    const calibration = stopping.calibrationCandidateIds.map(find).filter(Boolean);
    const { attributes, vectors } = readAttributes({ home });
    const calibrationRows = comparisons.filter((row) => stopping.calibrationCandidateIds.includes(row.a) && stopping.calibrationCandidateIds.includes(row.b));
    const derived = stopping.derivedBar ?? deriveStoppingBar({ candidates: calibration, scoreCandidates: candidates, comparisons: calibrationRows, attributes, vectors });
    if (!stopping.derivedBar) saveDerivedStoppingBar(intuition.stopping.session, derived, { home });
    return { title: 'Set the quality bar', question: 'Calibration is complete. Review the spread, then set this bar once.', barReview: true, stoppingRule: stoppingSurface(stopping, { bar: derived }), intuition };
  }
  if (stopping.phase === 'selection') {
    const { attributes, vectors } = readAttributes({ home });
    const calibration = stopping.calibrationCandidateIds.map(find).filter(Boolean);
    const calibrationRows = comparisons.filter((row) => stopping.calibrationCandidateIds.includes(row.a) && stopping.calibrationCandidateIds.includes(row.b));
    const scored = deriveStoppingBar({ candidates: calibration, scoreCandidates: candidates, comparisons: calibrationRows, attributes, vectors });
    const bar = stopping.adjustedBar?.value;
    const unseen = candidates.filter((candidate) => !stopping.seenCandidateIds.includes(candidate.id));
    const clear = unseen.find((candidate) => candidateClearsStoppingBar(scored.candidateScores.find((row) => row.id === candidate.id), bar));
    if (clear) {
      const finished = finishStoppingRule(intuition.stopping.session, { ...clear, reason: 'cleared the fixed quality bar' }, { home });
      return { title: 'Candidate selected', question: `${clear.label ?? clear.id} clears the fixed bar. The session is over.`, terminal: true, winner: finished?.stopping?.winner, stoppingRule: stoppingSurface(finished?.stopping ?? stopping), intuition };
    }
    if (unseen.length === 0 || stopping.seenCandidateIds.length >= stopping.candidateCap) {
      const seen = candidates.filter((candidate) => stopping.seenCandidateIds.includes(candidate.id));
      const fallback = scored.candidateScores.filter((row) => seen.some((candidate) => candidate.id === row.id)).sort((a, b) => b.lowerBound - a.lowerBound)[0] ?? seen[0];
      const finished = finishStoppingRule(intuition.stopping.session, { ...fallback, reason: 'best candidate seen at the candidate budget' }, { home });
      return { title: 'Budget complete', question: `${fallback?.label ?? fallback?.id ?? 'The best candidate seen'} is the designed fallback. The session is over.`, terminal: true, winner: finished?.stopping?.winner, stoppingRule: stoppingSurface(finished?.stopping ?? stopping), intuition };
    }
    const next = unseen[0];
    const anchor = find(stopping.calibrationCandidateIds[0]);
    if (!next || !anchor) return null;
    recordStoppingCandidates(intuition.stopping.session, [next.id, anchor.id], { home });
    const profile = currentProfile({ home });
    return { title: 'Selection pair', question: 'The bar is fixed. Pick left, right, or tie while the session tests the next candidate.', a: option(next), b: option(anchor), profile: profile.text, comparisons: profile.comparisons, project, intuition, stoppingRule: stoppingSurface(stopping) };
  }
  return null;
}

export function dealPayload({ home = os.homedir(), project = null, intuition = null } = {}) {
  const candidates = readCandidates({ home });
  const comparisons = readComparisons({ home });
  if (intuition?.stopping) return stoppingDeal({ home, project, intuition, candidates, comparisons });
  const pair = nextPair({ home, candidates, comparisons });
  if (!pair) return null;

  const find = (id) => candidates.find((c) => c && c.id === id) || null;
  const a = find(pair.a);
  const b = find(pair.b);
  if (!a || !b) return null;

  const profile = currentProfile({ home });
  return {
    title: 'Which of these two',
    question: 'Click anywhere on either screen to say what you think about that exact spot. Then pick the one you prefer, or call it a tie.',
    a: option(a),
    b: option(b),
    profile: profile.text,
    comparisons: profile.comparisons,
    project,
    reason: pair.reason ?? null,
    ...(intuition ? { intuition } : {}),
  };
}

/**
 * Record one verdict. `answer` is serve-compare's parsed answer object; the
 * annotations come through untouched because his own words are the most
 * specific thing the system ever gets and paraphrasing them loses the value.
 */
export function recordVerdict(answer, { home = os.homedir(), project = null, now } = {}) {
  if (!answer || typeof answer !== 'object') return null;
  const { outcome, a, b } = answer;
  if (!a || !b) return null;
  if (outcome !== 'a' && outcome !== 'b' && outcome !== 'tie') return null;
  const timedOut = answer.timedOut === true;
  const responseMs = Number(answer.responseMs);
  if (timedOut && outcome !== 'tie') return null;
  if ((timedOut || Number.isFinite(responseMs)) && (!Number.isFinite(responseMs) || responseMs <= 0)) return null;

  const comparison = {
    at: now ?? new Date().toISOString(),
    project: project ?? answer.project ?? null,
    a,
    b,
    outcome,
    source: timedOut ? 'timeout' : 'click',
    annotations: Array.isArray(answer.annotations) ? answer.annotations : [],
  };
  if (Number.isFinite(responseMs) && responseMs > 0) {
    comparison.responseMs = responseMs;
    comparison.weight = weightForResponseMs(responseMs, { timedOut });
  }
  if (timedOut) comparison.timedOut = true;
  if (answer.intuition && typeof answer.intuition === 'object') comparison.intuition = answer.intuition;
  if (typeof answer.steer === 'string' && answer.steer.trim()) comparison.steer = answer.steer.trim();
  return appendComparison(comparison, { home }) ? comparison : null;
}

/** Pull the JSON object out of a serve-compare `COMPARISON: {...}` line. */
export function parseAnswerLine(text) {
  const raw = String(text || '');
  const line = raw.split('\n').find((l) => l.startsWith('COMPARISON:')) || raw;
  const start = line.indexOf('{');
  if (start === -1) return null;
  try {
    return JSON.parse(line.slice(start));
  } catch {
    return null;
  }
}

function invokedAsScript() {
  const arg = process.argv[1];
  if (!arg) return false;
  try {
    return fs.realpathSync(arg) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedAsScript()) {
  const args = process.argv.slice(2);
  const flag = (name) => {
    const i = args.indexOf(name);
    return i === -1 ? undefined : args[i + 1];
  };
  const project = flag('--project') ?? process.cwd();

  const intuition = () => {
    if (!args.includes('--intuition')) return null;
    const session = flag('--intuition-session') ?? `intuition-${crypto.randomUUID().slice(0, 8)}`;
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(session)) return null;
    const timerSeconds = Number(flag('--intuition-seconds') ?? 3);
    const cap = Number(flag('--intuition-cap') ?? 8);
    if (!Number.isFinite(timerSeconds) || timerSeconds < 0 || timerSeconds > 60) return null;
    if (!Number.isInteger(cap) || cap < 1 || cap > 50) return null;
    const stoppingCap = flag('--stopping-candidate-cap') ?? flag('--set-stopping-candidate-cap');
    if (stoppingCap === undefined) return { session, timerSeconds, cap };
    const configured = configureStoppingRule({
      session,
      candidateCap: Number(stoppingCap),
      intuition: { timerSeconds, cap },
      explicitBudgetChange: flag('--set-stopping-candidate-cap') !== undefined,
    });
    if (!configured.ok) return null;
    return { session, timerSeconds, cap, stopping: { session } };
  };

  if (args.includes('--deal')) {
    const mode = intuition();
    if (args.includes('--intuition') && !mode) {
      process.stderr.write('taste-session: intuition needs a valid session id, timer between 0 and 60 seconds, a cap between 1 and 50, and a valid stopping candidate cap when requested\n');
      process.exit(1);
    }
    const completed = mode ? readComparisons().filter((row) => row?.intuition?.session === mode.session).length : 0;
    if (mode && completed >= mode.cap) {
      process.stdout.write(`Intuition session ${mode.session} ended after ${completed} choices (cap ${mode.cap}) to prevent fatigue. Start a new session or deal without --intuition.\n`);
      process.exit(0);
    }
    const payload = dealPayload({ project, intuition: mode });
    if (!payload) {
      process.stderr.write('taste-session: nothing to compare yet; register at least two candidates first\n');
      process.exit(3);
    }
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    process.exit(0);
  }

  if (args.includes('--record')) {
    const file = flag('--answer');
    let text = '';
    try {
      text = file ? fs.readFileSync(path.resolve(file), 'utf8') : fs.readFileSync(0, 'utf8');
    } catch {
      process.stderr.write('taste-session: could not read the answer\n');
      process.exit(1);
    }
    const recorded = recordVerdict(parseAnswerLine(text), { project });
    if (!recorded) {
      process.stderr.write('taste-session: that is not a usable verdict; nothing recorded\n');
      process.exit(1);
    }
    process.stdout.write(`${JSON.stringify(recorded)}\n`);
    process.exit(0);
  }

  if (args.includes('--profile')) {
    const profile = currentProfile();
    process.stdout.write(`${profile.text}\n`);
    for (const cycle of profile.cycles) {
      process.stdout.write(`\nCYCLE: ${cycle.cycle.join(' > ')} > ${cycle.cycle[0]}\n`);
      process.stdout.write('He judged these on two criteria at once. Attributes in tension:\n');
      for (const t of cycle.tensions) {
        process.stdout.write(`  - ${t.label ?? t.attribute}\n`);
      }
      process.stdout.write('Ask which one matters on this surface. Do not resolve it for him.\n');
    }
    process.exit(profile.comparisons > 0 ? 0 : 3);
  }

  process.stdout.write('usage: taste-session.mjs --deal [--intuition --intuition-session <id> --intuition-seconds <0-60> --intuition-cap <1-50> --stopping-candidate-cap <2-100>] | --record [--answer <file>] | --profile\n');
  process.exit(0);
}
