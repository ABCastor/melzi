/**
 * Recombination: treat the candidates as a population, and never bin the salvage.
 *
 * FORK-ONLY. Upstream has no population step and no notion of a candidate's
 * lineage, so this file carries zero merge burden. It reads `taste-store.mjs` and `taste-model.mjs` and writes nothing else.
 *
 * WHY THIS EXISTS. The owner cannot review a design and has said so plainly. What he
 * can do reliably is say WHICH OF THESE TWO, and point at a part of a screen and say
 * something about it. His own words for the step this module implements: "Let me
 * mark a region of a candidate I am rejecting as keep this part. Treat the candidate
 * set as an evolving population: my pairwise choices are the fitness signal, and the
 * system generates new candidates by recombining high-scoring candidates and my kept
 * regions." So the fitness signal is the pairwise verdict, chosen because it costs
 * him almost nothing next to scoring, and the crossover material is the verdict plus
 * the regions he pointed at.
 *
 * THE PART THAT CARRIES THE WHOLE FEATURE. `keptRegions` gathers keep-annotations
 * from comparisons the candidate LOST. That is not an edge case, it is the normal
 * case and the entire reason he asked for it: he rejects a screen as a whole and
 * salvages one part of it. If the loss discarded the salvage, the annotation would be
 * an expensive way of doing nothing. Everything else in this file exists to carry
 * those regions, in his exact words, into the brief.
 *
 * WHY THE DIVERSITY GUARD IS NOT OPTIONAL. The two highest-strength candidates are
 * usually near-twins, because a candidate wins by being close to what already won.
 * Crossing twins produces a third twin, the population's variety collapses, and the
 * tool goes back to dealing him one world with three names. So parent selection
 * measures the distance between attribute vectors and refuses a parent that sits on
 * top of one already chosen. When there are no vectors to measure, the guard
 * ABSTAINS rather than blocks: absence of a vector is not evidence of similarity, and
 * starving the population is the failure we are trying to prevent.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not author the child. `buildRecombination
 * Brief` returns plain text for the model that will write the screen, because the
 * judgement of how to cross two designs is exactly the judgement a model is good at
 * and a scoring function is not. This module's job is to state the material honestly:
 * which parents, what each brings, which regions survive and in whose words, what to
 * avoid, and the invariants that hold whatever happens.
 *
 * FAILURE POLICY. Every entry point swallows its own errors and answers null or an
 * empty string, so a broken or unreadable taste store costs him a recorded child and
 * never costs him the run. The sibling modules are imported outright rather than
 * resolved defensively: they ship in this same directory, so a missing one is a
 * packaging bug that should fail loudly at load, not a runtime condition that turns
 * `registerChild` into a silent no-op and quietly stops recording lineage.
 */
import os from 'node:os';

import { appendCandidate } from './taste-store.mjs';
import { scoreDesign } from './taste-model.mjs';
import { renderSignatureBlock } from './signature.mjs';

export const CANDIDATE_VERSION = 1;

/**
 * Minimum attribute distance between two parents, on the 0..1 RMS scale below.
 * Chosen low on purpose: the guard is there to catch near-identical twins, not to
 * enforce novelty. Set it high and it rejects every plausible parent and the
 * relaxation path below fires every time, which is the guard doing nothing loudly.
 */
export const MIN_PARENT_DISTANCE = 0.15;

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/**
 * Distance between two attribute vectors, 0 (identical) to 1 (opposite on every
 * axis). Root mean square over the UNION of the attributes either vector mentions,
 * with a missing attribute read as 0, so a candidate scored on more attributes than
 * its rival is not silently treated as closer.
 *
 * Returns null when there is nothing to measure. Null means abstain, never zero:
 * reading "no data" as "identical" would block every parent pair in a fresh project.
 */
export function attributeDistance(a, b) {
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return null;
  const ids = new Set([...Object.keys(a), ...Object.keys(b)]);
  if (!ids.size) return null;

  let sum = 0;
  for (const id of ids) sum += (clamp01(a[id]) - clamp01(b[id])) ** 2;
  return Math.sqrt(sum / ids.size);
}

/** How many recorded comparisons each candidate actually took part in. */
function comparisonCounts(comparisons) {
  const counts = new Map();
  for (const cmp of Array.isArray(comparisons) ? comparisons : []) {
    if (!cmp) continue;
    for (const id of [cmp.a, cmp.b]) {
      if (typeof id === 'string' && id) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * Pick the parents for the next child: highest strength first, with the diversity
 * guard biting on near-twins.
 *
 * `vectors` is the `vectors` half of the store's attributes file, keyed by candidate
 * id. It is optional because the guard abstains without it.
 *
 * Returns `{ parents, skipped, relaxed, guard }` rather than a bare array. The
 * skipped list is the thing a human needs when the population looks inbred: it names
 * which strong candidate was refused, against which parent, and by how little.
 *
 * `guard` is one of:
 *   'vectors'      at least one pair was actually measured
 *   'no-vectors'   nothing was measurable, selection was strength only
 *   'insufficient' fewer than two usable candidates exist, so there is nothing to guard
 */
export function selectParents({
  strengths,
  comparisons = [],
  count = 2,
  vectors = {},
  minDistance = MIN_PARENT_DISTANCE,
} = {}) {
  const pool = (Array.isArray(strengths) ? strengths : [])
    .filter((s) => s && typeof s.id === 'string' && s.id && Number.isFinite(s.theta));

  const counts = comparisonCounts(comparisons);
  const ranked = pool
    .map((s) => ({ ...s, comparisons: counts.get(s.id) ?? 0 }))
    .sort((x, y) => {
      // A candidate nobody has compared carries the regularizing prior's theta, not
      // evidence. It must not out-rank a candidate that actually won something.
      const evidenced = (e) => (e.comparisons > 0 ? 1 : 0);
      if (evidenced(x) !== evidenced(y)) return evidenced(y) - evidenced(x);
      if (y.theta !== x.theta) return y.theta - x.theta;
      return x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
    });

  const wanted = Math.max(0, Math.trunc(Number(count) || 0));
  const parents = [];
  const skipped = [];
  let measuredAnything = false;

  for (const entry of ranked) {
    if (parents.length >= wanted) break;
    let tooClose = null;
    for (const chosen of parents) {
      const distance = attributeDistance(vectors?.[entry.id], vectors?.[chosen.id]);
      if (distance === null) continue; // abstain, see attributeDistance
      measuredAnything = true;
      if (distance < minDistance) {
        tooClose = { id: entry.id, to: chosen.id, distance };
        break;
      }
    }
    if (tooClose) skipped.push(tooClose);
    else parents.push(entry);
  }

  // Better a near-twin than no second parent: a recombination needs two, and a run
  // that produces nothing teaches him nothing. If the guard starved the selection,
  // refill in strength order and say so in `relaxed` so the collapse is visible.
  const relaxed = [];
  if (parents.length < wanted) {
    for (const miss of skipped) {
      if (parents.length >= wanted) break;
      const entry = ranked.find((r) => r.id === miss.id);
      if (!entry || parents.includes(entry)) continue;
      parents.push(entry);
      relaxed.push(miss);
    }
  }

  const guard = ranked.length < 2 ? 'insufficient' : measuredAnything ? 'vectors' : 'no-vectors';
  return { parents, skipped, relaxed, guard };
}

/** Did `candidate` win, lose, or tie this comparison? */
function outcomeFor(cmp, candidate) {
  if (cmp.outcome === 'tie') return 'tie';
  if (cmp.outcome === 'a') return cmp.a === candidate ? 'won' : 'lost';
  if (cmp.outcome === 'b') return cmp.b === candidate ? 'won' : 'lost';
  return 'unknown';
}

function targetKey(target) {
  if (!target || typeof target !== 'object') return '';
  return `${target.selector ?? ''}|${target.text ?? ''}`;
}

/**
 * Every annotation of one kind, for one candidate (or for all of them when
 * `candidate` is omitted), gathered across every comparison the candidate appears in,
 * WON OR LOST. The loss is the case that matters; see the header.
 *
 * Repeats are folded into one region with a `times` count, because saying the same
 * thing about the same element three times is a stronger instruction than saying it
 * once, and three identical paragraphs in the brief are just noise to the author. A
 * region he asked to keep on a screen he lost is reported as `outcome:'lost'` even if
 * he also kept it on a screen that won: the salvage framing is the one the author
 * needs to read.
 */
function regionsOfKind(comparisons, kind, candidate) {
  const folded = new Map();

  for (const cmp of Array.isArray(comparisons) ? comparisons : []) {
    if (!cmp || !Array.isArray(cmp.annotations)) continue;
    for (const ann of cmp.annotations) {
      if (!ann || ann.kind !== kind) continue;
      if (typeof ann.candidate !== 'string' || !ann.candidate) continue;
      if (candidate && ann.candidate !== candidate) continue;
      // An annotation belongs to one candidate of the pair by definition. Anything
      // else is malformed data, and inventing a provenance for it helps nobody.
      if (ann.candidate !== cmp.a && ann.candidate !== cmp.b) continue;

      const text = typeof ann.text === 'string' ? ann.text.trim() : '';
      const key = `${ann.candidate}|${targetKey(ann.target)}|${text}`;
      const outcome = outcomeFor(cmp, ann.candidate);
      const existing = folded.get(key);
      if (existing) {
        existing.times += 1;
        if (outcome === 'lost') existing.outcome = 'lost';
        continue;
      }
      folded.set(key, {
        candidate: ann.candidate,
        kind,
        text,
        target: ann.target ?? null,
        outcome,
        at: cmp.at ?? null,
        times: 1,
      });
    }
  }

  return [...folded.values()];
}

/**
 * Every `kind:'keep'` annotation for a candidate, INCLUDING the ones he made while
 * rejecting it. This is the function the requirement is about.
 */
export function keptRegions(comparisons, { candidate } = {}) {
  return regionsOfKind(comparisons, 'keep', candidate);
}

/** The mirror: every `kind:'dislike'` annotation, so the brief can say what to avoid. */
export function dislikedRegions(comparisons, { candidate } = {}) {
  return regionsOfKind(comparisons, 'dislike', candidate);
}

function labelFor(id, labels) {
  const label = labels.get(id);
  return label && label !== id ? `${label} (${id})` : id;
}

function attributeLabels(attributes) {
  const map = new Map();
  for (const attr of Array.isArray(attributes) ? attributes : []) {
    if (attr && typeof attr.id === 'string') map.set(attr.id, attr.label || attr.id);
  }
  return map;
}

function weightMap(weights) {
  const map = new Map();
  for (const w of Array.isArray(weights) ? weights : []) {
    if (w && typeof w.id === 'string' && Number.isFinite(w.weight)) map.set(w.id, w.weight);
  }
  return map;
}

/**
 * What this parent brings that the other parents do not. The edge is the parent's
 * value on an attribute minus the best value any other parent has on it, so a trait
 * both parents share is not reported as a contribution: it would arrive in the child
 * either way, and naming it wastes the author's attention.
 *
 * Where the learned weights exist, an attribute he is known to prefer outranks an
 * equally distinctive one he is neutral about. Where they do not, distinctiveness is
 * all there is and the line says so.
 */
function contributionsFor(id, others, vectors, attrLabels, weights, limit = 4) {
  const mine = vectors?.[id];
  if (!mine || typeof mine !== 'object') return [];

  const scored = [];
  for (const [attrId, raw] of Object.entries(mine)) {
    const value = clamp01(raw);
    let best = 0;
    for (const other of others) best = Math.max(best, clamp01(vectors?.[other]?.[attrId]));
    const edge = value - best;
    if (edge <= 0.05) continue; // shared, or noise
    const weight = weights.get(attrId);
    const rank = edge * (Number.isFinite(weight) ? Math.max(weight, 0) + 0.25 : 1);
    scored.push({ attrId, value, edge, rank });
  }

  return scored
    .sort((x, y) => y.rank - x.rank)
    .slice(0, limit)
    .map((s) => `${attrLabels.get(s.attrId) ?? s.attrId} (${s.value.toFixed(2)}, +${s.edge.toFixed(2)} over the other parents)`);
}

function renderRegion(index, region, labels, parentIds) {
  const lines = [];
  const source = labelFor(region.candidate, labels);
  const salvage = region.outcome === 'lost'
    ? ' He rejected this screen in comparison and still wanted this part.'
    : '';
  const stray = parentIds.has(region.candidate) ? '' : ' This candidate is not a parent; carry the region across anyway.';
  lines.push(`[${index}] from ${source}.${salvage}${stray}`);

  const selector = region.target?.selector;
  const text = region.target?.text;
  const rect = region.target?.rect;
  if (selector) lines.push(`    selector: ${selector}`);
  if (text) lines.push(`    element text: "${text}"`);
  if (!selector && !text && rect && Number.isFinite(rect.x)) {
    // No selector survived the click, so the only handle left is where on the screen
    // he pointed. Normalized to the viewport, so it reads the same at any width.
    lines.push(`    position: x ${Number(rect.x).toFixed(2)}, y ${Number(rect.y).toFixed(2)} of the viewport`);
  }
  // His exact words, never paraphrased: they are the only part of this brief that is
  // literally his, and a summary of them is a summary of the taste we are learning.
  if (region.text) lines.push(`    he said: "${region.text}"`);
  if (region.times > 1) lines.push(`    he said this ${region.times} times, on different comparisons`);
  return lines;
}

/**
 * The brief for the model that will author the child screen. Plain text, no markup,
 * deterministic for the same input.
 *
 * `signature` accepts either the parsed signature object or an already rendered
 * block. Either way it is carried through unchanged: the invariants are the one part
 * of this brief that recombination is not allowed to touch.
 */
export function buildRecombinationBrief({
  parents = [],
  kept = [],
  disliked = [],
  profile = '',
  signature = null,
  vectors = {},
  attributes = [],
  weights = [],
  candidates = [],
  goal = '',
} = {}) {
  const entries = (Array.isArray(parents) ? parents : [])
    .map((p) => (typeof p === 'string' ? { id: p } : p))
    .filter((p) => p && typeof p.id === 'string' && p.id);

  const labels = new Map();
  for (const c of Array.isArray(candidates) ? candidates : []) {
    if (c && typeof c.id === 'string' && c.label) labels.set(c.id, c.label);
  }
  const attrLabels = attributeLabels(attributes);
  const weightsById = weightMap(weights);
  const parentIds = new Set(entries.map((e) => e.id));

  const out = [];
  out.push('RECOMBINATION BRIEF', '');
  out.push(
    'Author ONE new screen by crossing the parents below. This is a population step:',
    'the parents scored highest under his own pairwise choices, and the regions quoted',
    'further down are parts he asked to keep, including parts of screens he otherwise',
    'rejected. Do not average the parents into a compromise, and do not soften either',
    'one. Take the named strength from each and make them live on one screen.',
  );
  if (typeof goal === 'string' && goal.trim()) out.push('', `The screen has to do this: ${goal.trim()}`);

  out.push('', 'PARENTS');
  if (!entries.length) {
    out.push('None. There is no population to cross yet, so treat this as a fresh screen');
    out.push('and follow the profile and the invariants below.');
  }
  entries.forEach((entry, i) => {
    const facts = [];
    if (Number.isFinite(entry.theta)) facts.push(`strength ${entry.theta >= 0 ? '+' : ''}${entry.theta.toFixed(2)}`);
    if (Number.isFinite(entry.comparisons)) facts.push(`${entry.comparisons} comparison${entry.comparisons === 1 ? '' : 's'}`);
    out.push(`${i + 1}. ${labelFor(entry.id, labels)}${facts.length ? `  ${facts.join(', ')}` : ''}`);

    // What the learned profile predicts for this parent, so the author can see which
    // one the model expects him to like and by how little.
    if (vectors?.[entry.id] && weightsById.size) {
      const score = scoreDesign(vectors[entry.id], weights);
      if (Number.isFinite(score)) out.push(`   predicted taste score ${score.toFixed(2)}`);
    }

    const others = entries.filter((e) => e.id !== entry.id).map((e) => e.id);
    const contributions = contributionsFor(entry.id, others, vectors, attrLabels, weightsById);
    if (contributions.length) {
      out.push(`   contributes: ${contributions.join('; ')}`);
    } else {
      // Honest about the gap. A model told nothing about a parent invents a reason
      // to prefer one, and the invented reason is not his taste.
      out.push('   contributes: no attribute vector on file for this parent. Read the screen');
      out.push('   itself and take what is strongest in it rather than guessing from the label.');
    }
  });

  const keptRows = Array.isArray(kept) ? kept.filter(Boolean) : [];
  out.push('', 'PRESERVE THESE REGIONS, IN HIS WORDS');
  if (!keptRows.length) {
    out.push('He has not marked anything to keep yet. Nothing is pinned, so the whole screen is yours.');
  } else {
    out.push('These are quoted exactly. Find each element, keep what he named about it, and let');
    out.push('the rest of the screen change around it.', '');
    keptRows.forEach((region, i) => out.push(...renderRegion(i + 1, region, labels, parentIds)));
  }

  const dislikedRows = Array.isArray(disliked) ? disliked.filter(Boolean) : [];
  if (dislikedRows.length) {
    out.push('', 'AVOID THESE, HE POINTED AT THEM');
    out.push('Do not reproduce these in the child, and do not reproduce a near variant of them.', '');
    dislikedRows.forEach((region, i) => out.push(...renderRegion(i + 1, region, labels, parentIds)));
  }

  out.push('', 'LEARNED TASTE PROFILE');
  const profileText = typeof profile === 'string' ? profile.trim() : '';
  if (profileText) {
    out.push('This is a constraint on the child, not a suggestion.', '', profileText);
  } else {
    // Saying nothing here would read as "no constraints". Saying it is empty and why
    // is the honest version, and it tells the author what to lean on instead.
    out.push('No profile has formed yet: there are too few comparisons. Lean on the quoted');
    out.push('regions and the invariants below, and make the child clearly different from');
    out.push('its parents so the next comparison is worth him answering.');
  }

  const block = renderSignature(signature);
  if (block) out.push('', block);

  return out.join('\n');
}

/** A signature object renders through its own module; a string is already the block. */
function renderSignature(signature) {
  if (typeof signature === 'string') return signature.trim();
  if (!signature || typeof signature !== 'object') return '';
  try {
    return renderSignatureBlock(signature) || '';
  } catch {
    return '';
  }
}

function slug(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function normalizeParentIds(parents) {
  const ids = [];
  for (const p of Array.isArray(parents) ? parents : []) {
    const id = typeof p === 'string' ? p : p?.id;
    if (typeof id === 'string' && id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/**
 * Build the child's candidate record. Pure and exported for the same reason
 * `taste-ledger.buildEntry` is: the shape of the line IS the feature, so the shape is
 * what gets asserted, without going anywhere near a disk.
 *
 * The generated id carries both parents and the timestamp. Parents alone would
 * collide the second time the same pair is crossed, and the store dedupes by id, so
 * the second child would vanish without a word.
 */
export function buildChildCandidate({ parents, id, label, screen, world, project, at }) {
  const ids = normalizeParentIds(parents);
  const stamp = at ?? new Date().toISOString();
  const generated = `child-${ids.map(slug).join('-x-') || 'orphan'}-${stamp.replace(/[^0-9]/g, '').slice(0, 14)}`;
  return {
    v: CANDIDATE_VERSION,
    id: (typeof id === 'string' && id.trim()) ? id.trim() : generated,
    label: label ?? null,
    screen: screen ?? null,
    world: world ?? null,
    parents: ids,
    project: project ?? null,
    at: stamp,
  };
}

/**
 * Append the child to the candidate registry so its lineage is inspectable later:
 * without `parents` on the record there is no way to ask whether recombination ever
 * produced anything he preferred, which is the only question that decides whether
 * this whole step is worth keeping.
 *
 * Returns the written record, or null when it was refused or the store is absent.
 * Never throws.
 */
export function registerChild(child, { home = os.homedir(), at } = {}) {
  try {
    const candidate = buildChildCandidate({ ...(child ?? {}), at });
    // A child of nothing is not a recombination, and an unparented record would
    // pollute the lineage it exists to record.
    if (!candidate.parents.length) return null;

    // The store answers false for a duplicate id as well as for a failed write, and
    // from here the two are the same thing: no new lineage was recorded.
    return appendCandidate(candidate, { home }) === false ? null : candidate;
  } catch {
    return null;
  }
}

/**
 * Convenience for a caller that has the store on hand: gather the crossover material
 * for one child in a single call. Kept separate from `buildRecombinationBrief` so the
 * brief itself stays pure and testable with hand-written rows.
 */
export function gatherMaterial({ comparisons, parents }) {
  const ids = normalizeParentIds(parents);
  const kept = [];
  const disliked = [];
  for (const id of ids) {
    kept.push(...keptRegions(comparisons, { candidate: id }));
    disliked.push(...dislikedRegions(comparisons, { candidate: id }));
  }
  return { kept, disliked };
}
