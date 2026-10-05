// The population step. FORK-ONLY (skill/scripts/melzi/recombine.mjs).
//
// What these tests are really guarding, in order of how much it would cost to lose:
//
// 1. A keep-annotation made on a candidate he REJECTED has to survive into the brief.
//    That is the whole feature. He rejects a screen and salvages one part of it; if
//    the loss binned the salvage, marking a region would be an expensive no-op.
// 2. His EXACT words reach the author, next to the selector and the element text, so
//    the author can find the thing he pointed at. A paraphrase of his words is a
//    paraphrase of the taste being learned.
// 3. The diversity guard actually bites on near-twins. Two twins produce a third
//    twin and the population collapses back to one world with three names.
//
// The rows are hand-written against the contract's shapes rather than produced by a
// fit, so a change in taste-model's numerics cannot make these pass or fail by
// accident. The one test that writes goes through the real taste-store under a tmp
// HOME and reads the file back, because a lineage that is not on disk is no lineage.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  attributeDistance,
  buildChildCandidate,
  buildRecombinationBrief,
  dislikedRegions,
  gatherMaterial,
  keptRegions,
  registerChild,
  selectParents,
  CANDIDATE_VERSION,
  MIN_PARENT_DISTANCE,
} from '../skill/scripts/melzi/recombine.mjs';

const AT = '2026-07-28T09:00:00.000Z';

function withHome(fn) {
  const home = mkdtempSync(join(tmpdir(), 'melzi-recombine-'));
  try { return fn(home); } finally { rmSync(home, { recursive: true, force: true }); }
}

// Two near-twins at the top of the ranking, and one genuinely different candidate
// slightly below them. This is the ordinary shape of a population after a few rounds.
const VECTORS = {
  teletext: { whitespace: 0.90, rules: 0.80, serif: 0.10 },
  teletext2: { whitespace: 0.92, rules: 0.78, serif: 0.12 },
  wpa: { whitespace: 0.20, rules: 0.15, serif: 0.85 },
};

const STRENGTHS = [
  { id: 'teletext', theta: 0.90, se: 0.3 },
  { id: 'teletext2', theta: 0.85, se: 0.3 },
  { id: 'wpa', theta: 0.40, se: 0.3 },
];

const ATTRIBUTES = [
  { id: 'whitespace', label: 'generous whitespace', description: 'more air between blocks', firstSeen: AT, comparisons: 3 },
  { id: 'rules', label: 'heavy rule work', description: 'thick lines dividing the page', firstSeen: AT, comparisons: 2 },
  { id: 'serif', label: 'serif display type', description: 'a serif carrying the headline', firstSeen: AT, comparisons: 2 },
];

/** Every candidate appears in at least one comparison, so none is prior-only. */
const SEEN_BY_ALL = [
  { v: 1, at: AT, project: null, a: 'teletext', b: 'wpa', outcome: 'a', source: 'click', annotations: [] },
  { v: 1, at: AT, project: null, a: 'teletext2', b: 'wpa', outcome: 'a', source: 'click', annotations: [] },
];

test('parent selection takes the two strongest when they are far enough apart', () => {
  const only = STRENGTHS.filter((s) => s.id !== 'teletext2');
  const { parents, skipped, guard } = selectParents({
    strengths: only,
    comparisons: SEEN_BY_ALL,
    vectors: VECTORS,
  });

  assert.deepEqual(parents.map((p) => p.id), ['teletext', 'wpa']);
  assert.deepEqual(skipped, [], 'nothing was refused, the guard had no reason to bite');
  assert.equal(guard, 'vectors', 'the distance was actually measured, not assumed');
});

// The reason the guard exists. Without it the answer here is [teletext, teletext2],
// their child is a third teletext, and the next hand he is shown is one world.
test('the diversity guard refuses a near-twin and reaches down for a different parent', () => {
  const { parents, skipped, relaxed, guard } = selectParents({
    strengths: STRENGTHS,
    comparisons: SEEN_BY_ALL,
    vectors: VECTORS,
  });

  assert.deepEqual(parents.map((p) => p.id), ['teletext', 'wpa']);
  assert.equal(guard, 'vectors');
  assert.deepEqual(relaxed, [], 'a real alternative existed, so nothing had to be relaxed');
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].id, 'teletext2');
  assert.equal(skipped[0].to, 'teletext');
  assert.ok(skipped[0].distance < MIN_PARENT_DISTANCE, 'and it says how close it was');
});

// A guard that starves the run is worse than a twin: he gets nothing to compare.
test('with only twins to choose from, the guard relaxes rather than returning one parent', () => {
  const twins = STRENGTHS.filter((s) => s.id !== 'wpa');
  const { parents, relaxed } = selectParents({
    strengths: twins,
    comparisons: SEEN_BY_ALL,
    vectors: VECTORS,
  });

  assert.deepEqual(parents.map((p) => p.id), ['teletext', 'teletext2']);
  assert.deepEqual(relaxed.map((r) => r.id), ['teletext2'], 'and the collapse is recorded, not hidden');
});

test('with no vectors the guard abstains: missing data is not evidence of similarity', () => {
  const { parents, skipped, guard } = selectParents({
    strengths: STRENGTHS,
    comparisons: SEEN_BY_ALL,
    vectors: {},
  });

  assert.deepEqual(parents.map((p) => p.id), ['teletext', 'teletext2'], 'pure strength order');
  assert.deepEqual(skipped, []);
  assert.equal(guard, 'no-vectors', 'and the caller can tell the guard never ran');
});

test('a candidate nobody has compared cannot outrank one that actually won something', () => {
  const withFresh = [{ id: 'fresh', theta: 5, se: 9 }, ...STRENGTHS];
  const { parents } = selectParents({ strengths: withFresh, comparisons: SEEN_BY_ALL, vectors: VECTORS });
  assert.deepEqual(parents.map((p) => p.id), ['teletext', 'wpa'], 'theta 5 was the prior, not evidence');
});

test('an empty population selects nothing and a single candidate selects itself, neither throws', () => {
  assert.deepEqual(selectParents({ strengths: [], comparisons: [] }), {
    parents: [], skipped: [], relaxed: [], guard: 'insufficient',
  });
  assert.deepEqual(selectParents(), { parents: [], skipped: [], relaxed: [], guard: 'insufficient' });

  const lone = selectParents({ strengths: [STRENGTHS[0]], comparisons: SEEN_BY_ALL, vectors: VECTORS });
  assert.deepEqual(lone.parents.map((p) => p.id), ['teletext']);
  assert.equal(lone.guard, 'insufficient');
});

test('attribute distance is 0 for identical vectors, null when there is nothing to measure', () => {
  assert.equal(attributeDistance(VECTORS.teletext, VECTORS.teletext), 0);
  assert.ok(attributeDistance(VECTORS.teletext, VECTORS.wpa) > 0.5, 'genuinely different worlds are far apart');
  assert.equal(attributeDistance(VECTORS.teletext, undefined), null);
  assert.equal(attributeDistance({}, {}), null);
  // An attribute only one side was scored on counts as 0 on the other, so a
  // richly-scored candidate is not silently treated as closer to everything.
  assert.ok(attributeDistance({ a: 1 }, { a: 1, b: 1 }) > 0);
});

// ---------------------------------------------------------------------------
// The requirement itself.
// ---------------------------------------------------------------------------

const LOST_BUT_KEPT = [
  {
    v: 1, at: AT, project: '/p/app', a: 'wpa', b: 'teletext', outcome: 'b', source: 'click',
    annotations: [
      {
        candidate: 'wpa',
        kind: 'keep',
        target: { selector: 'main > header .marks', text: 'DEPARTURES', rect: { x: 0.5, y: 0.08, w: 0.2, h: 0.06 } },
        text: 'the two triangles at the top',
      },
      {
        candidate: 'wpa',
        kind: 'dislike',
        target: { selector: '.hero .cta', text: 'Get started', rect: { x: 0.5, y: 0.6, w: 0.2, h: 0.06 } },
        text: 'this button is shouting at me',
      },
    ],
  },
];

test('a keep-annotation on a candidate he REJECTED survives the loss', () => {
  const kept = keptRegions(LOST_BUT_KEPT, { candidate: 'wpa' });

  assert.equal(kept.length, 1, 'the loss did not bin it');
  assert.equal(kept[0].outcome, 'lost', 'and the record remembers he was rejecting it at the time');
  assert.equal(kept[0].text, 'the two triangles at the top');
  assert.equal(kept[0].target.selector, 'main > header .marks');
  assert.equal(kept[0].candidate, 'wpa');
});

test('the salvage reaches the brief, in his words, with the selector and the element text', () => {
  const kept = keptRegions(LOST_BUT_KEPT, { candidate: 'wpa' });
  const brief = buildRecombinationBrief({
    parents: [{ id: 'teletext', theta: 0.9, comparisons: 4 }, { id: 'wpa', theta: 0.4, comparisons: 3 }],
    kept,
    candidates: [{ id: 'wpa', label: 'WPA Park Poster' }, { id: 'teletext', label: 'Teletext Service' }],
  });

  // His exact words, quoted, not summarised.
  assert.match(brief, /he said: "the two triangles at the top"/);
  // And the two handles that let the author find the thing he pointed at.
  assert.match(brief, /selector: main > header \.marks/);
  assert.match(brief, /element text: "DEPARTURES"/);
  // And the framing that explains why a rejected screen is contributing anything.
  assert.match(brief, /WPA Park Poster \(wpa\)/);
  assert.match(brief, /rejected this screen in comparison and still wanted this part/i);
});

test('keep and dislike are gathered separately, and dislikes become avoid instructions', () => {
  const disliked = dislikedRegions(LOST_BUT_KEPT, { candidate: 'wpa' });
  assert.equal(disliked.length, 1);
  assert.equal(disliked[0].kind, 'dislike');

  const brief = buildRecombinationBrief({ parents: ['wpa'], kept: [], disliked });
  assert.match(brief, /AVOID THESE, HE POINTED AT THEM/);
  assert.match(brief, /he said: "this button is shouting at me"/);
  assert.match(brief, /selector: \.hero \.cta/);
  assert.match(brief, /do not reproduce a near variant/i);
});

test('regions are gathered from every comparison a candidate appears in, won or lost', () => {
  const many = [
    ...LOST_BUT_KEPT,
    {
      v: 1, at: AT, a: 'wpa', b: 'teletext2', outcome: 'a', source: 'click',
      annotations: [{ candidate: 'wpa', kind: 'keep', target: { selector: 'footer', text: 'colophon' }, text: 'the footer rule' }],
    },
  ];
  const kept = keptRegions(many, { candidate: 'wpa' });
  assert.deepEqual(kept.map((k) => k.text).sort(), ['the footer rule', 'the two triangles at the top']);
  assert.deepEqual(kept.map((k) => k.outcome), ['lost', 'won']);
});

test('the same region marked across two comparisons folds into one, counted, and stays a salvage', () => {
  const repeat = {
    candidate: 'wpa', kind: 'keep',
    target: { selector: 'main > header .marks', text: 'DEPARTURES', rect: { x: 0.5, y: 0.08, w: 0.2, h: 0.06 } },
    text: 'the two triangles at the top',
  };
  const twice = [
    LOST_BUT_KEPT[0],
    { v: 1, at: AT, a: 'wpa', b: 'teletext2', outcome: 'a', source: 'click', annotations: [repeat] },
  ];

  const kept = keptRegions(twice, { candidate: 'wpa' });
  assert.equal(kept.length, 1, 'one region, not two identical paragraphs in the brief');
  assert.equal(kept[0].times, 2);
  assert.equal(kept[0].outcome, 'lost', 'the salvage framing wins: it is the one the author needs');
  assert.match(buildRecombinationBrief({ parents: ['wpa'], kept }), /he said this 2 times/);
});

test('omitting the candidate gathers every keep in the population, so nothing is thrown away', () => {
  const mixed = [
    ...LOST_BUT_KEPT,
    {
      v: 1, at: AT, a: 'teletext', b: 'teletext2', outcome: 'a', source: 'click',
      annotations: [{ candidate: 'teletext2', kind: 'keep', target: { selector: 'nav', text: 'INDEX' }, text: 'this nav' }],
    },
  ];
  assert.deepEqual(keptRegions(mixed).map((k) => k.candidate), ['wpa', 'teletext2']);
});

test('an annotation naming a candidate that was not in the pair is dropped, not given a provenance', () => {
  const malformed = [{
    v: 1, at: AT, a: 'wpa', b: 'teletext', outcome: 'b', source: 'click',
    annotations: [{ candidate: 'someone-else', kind: 'keep', target: null, text: 'x' }],
  }];
  assert.deepEqual(keptRegions(malformed), []);
});

test('a salvaged region from a candidate that is not a parent is still carried, and flagged', () => {
  const kept = keptRegions(LOST_BUT_KEPT, { candidate: 'wpa' });
  const brief = buildRecombinationBrief({ parents: ['teletext'], kept });
  assert.match(brief, /he said: "the two triangles at the top"/);
  assert.match(brief, /not a parent; carry the region across anyway/);
});

test('a region with no selector falls back to where on the screen he pointed', () => {
  const pinOnly = [{
    v: 1, at: AT, a: 'wpa', b: 'teletext', outcome: 'b', source: 'click',
    annotations: [{ candidate: 'wpa', kind: 'keep', target: { selector: null, text: null, rect: { x: 0.24, y: 0.71, w: 0.1, h: 0.1 } }, text: 'that block' }],
  }];
  const brief = buildRecombinationBrief({ parents: ['wpa'], kept: keptRegions(pinOnly, { candidate: 'wpa' }) });
  assert.match(brief, /position: x 0\.24, y 0\.71 of the viewport/);
  assert.match(brief, /he said: "that block"/);
});

// ---------------------------------------------------------------------------
// The rest of the brief.
// ---------------------------------------------------------------------------

test('each parent is named with what it contributes, grounded in the vectors not in vibes', () => {
  // Both parents sit high on `grid`, so it is not a contribution of either one.
  const vectors = {
    teletext: { ...VECTORS.teletext, grid: 0.75 },
    wpa: { ...VECTORS.wpa, grid: 0.78 },
  };
  const brief = buildRecombinationBrief({
    parents: [{ id: 'teletext', theta: 0.9, comparisons: 4 }, { id: 'wpa', theta: 0.4, comparisons: 3 }],
    vectors,
    attributes: [...ATTRIBUTES, { id: 'grid', label: 'visible grid', description: 'the column structure showing', firstSeen: AT, comparisons: 2 }],
    weights: [
      { id: 'whitespace', weight: 1.4, se: 0.4, verdict: 'prefers' },
      { id: 'serif', weight: 0.6, se: 0.3, verdict: 'prefers' },
      { id: 'grid', weight: 1.9, se: 0.4, verdict: 'prefers' },
      { id: 'rules', weight: -0.2, se: 0.5, verdict: 'neutral' },
    ],
    candidates: [{ id: 'teletext', label: 'Teletext Service' }, { id: 'wpa', label: 'WPA Park Poster' }],
  });

  assert.match(brief, /1\. Teletext Service \(teletext\)\s+strength \+0\.90, 4 comparisons/);
  assert.match(brief, /contributes: generous whitespace \(0\.90, \+0\.70 over the other parents\)/);
  // The other parent brings the attribute the first one lacks, which is the point of
  // crossing them rather than re-rolling the winner.
  assert.match(brief, /contributes: serif display type \(0\.85, \+0\.75 over the other parents\)/);
  // An attribute both parents share is not a contribution: it arrives either way, and
  // it outranks everything on weight, so naming it would crowd out the real answer.
  assert.doesNotMatch(brief, /visible grid/);
});

test('a parent with no vector says so plainly instead of letting the author invent a reason', () => {
  const brief = buildRecombinationBrief({ parents: ['ghost'], vectors: {}, attributes: ATTRIBUTES });
  assert.match(brief, /no attribute vector on file for this parent/);
});

test('the learned profile is carried through as a constraint, and its absence is stated honestly', () => {
  const profile = 'prefers generous whitespace\ndislikes three-column layouts\nneutral on serif vs sans';
  const withProfile = buildRecombinationBrief({ parents: ['teletext'], profile });
  assert.match(withProfile, /LEARNED TASTE PROFILE/);
  assert.match(withProfile, /This is a constraint on the child, not a suggestion\./);
  assert.ok(withProfile.includes(profile), 'verbatim, not reworded');

  const without = buildRecombinationBrief({ parents: ['teletext'] });
  assert.match(without, /No profile has formed yet: there are too few comparisons\./);
});

test('the signature invariants are carried through unchanged, from a block or an object', () => {
  const block = 'SIGNATURE INVARIANTS\ncoral: #FD4E5A, role the one warm lead\nFREE: everything else.';
  assert.ok(buildRecombinationBrief({ parents: ['teletext'], signature: block }).includes(block));

  // The object path renders through signature.mjs, which is present in this fork.
  const rendered = buildRecombinationBrief({
    parents: ['teletext'],
    signature: { oneLine: 'one warm lead in a near-silent field', invariants: { coral: { value: '#FD4E5A', role: 'the one warm lead' } }, free: ['layout', 'texture'] },
  });
  assert.match(rendered, /SIGNATURE INVARIANTS/);
  assert.match(rendered, /coral: #FD4E5A/);
  assert.match(rendered, /the one warm lead/);
});

test('an empty population still produces a usable brief rather than an empty string', () => {
  const brief = buildRecombinationBrief({ parents: [], kept: [] });
  assert.match(brief, /^RECOMBINATION BRIEF/);
  assert.match(brief, /There is no population to cross yet/);
  assert.match(brief, /He has not marked anything to keep yet/);
  assert.doesNotMatch(brief, /AVOID THESE/, 'no dislikes means no avoid section, not an empty one');
});

test('the brief is deterministic and takes no arguments without failing', () => {
  const args = { parents: [{ id: 'a', theta: 1, comparisons: 2 }], kept: keptRegions(LOST_BUT_KEPT, { candidate: 'wpa' }) };
  assert.equal(buildRecombinationBrief(args), buildRecombinationBrief(args));
  assert.match(buildRecombinationBrief(), /^RECOMBINATION BRIEF/);
});

test('gatherMaterial collects both kinds for a whole parent set in one call', () => {
  const { kept, disliked } = gatherMaterial({ comparisons: LOST_BUT_KEPT, parents: [{ id: 'wpa' }, { id: 'teletext' }] });
  assert.deepEqual(kept.map((k) => k.text), ['the two triangles at the top']);
  assert.deepEqual(disliked.map((d) => d.text), ['this button is shouting at me']);
});

// ---------------------------------------------------------------------------
// Lineage.
// ---------------------------------------------------------------------------

test('the child records both parents, so lineage is inspectable later', () => {
  const child = buildChildCandidate({
    parents: [{ id: 'teletext' }, 'wpa'],
    label: 'Teletext x WPA',
    screen: '/tmp/x/child.html',
    world: 'posters-covers-sleeves-wpa-park-poster',
    project: '/p/app',
    at: AT,
  });

  assert.equal(child.v, CANDIDATE_VERSION);
  assert.deepEqual(child.parents, ['teletext', 'wpa'], 'the only question worth asking later is whether crossing helped');
  assert.equal(child.at, AT);
  assert.equal(child.project, '/p/app');
  assert.equal(child.screen, '/tmp/x/child.html');
  assert.deepEqual(Object.keys(child).sort(), ['at', 'id', 'label', 'parents', 'project', 'screen', 'v', 'world']);
});

test('a generated id carries the parents and the timestamp, so a second crossing is not deduped away', () => {
  const first = buildChildCandidate({ parents: ['teletext', 'wpa'], at: AT });
  const later = buildChildCandidate({ parents: ['teletext', 'wpa'], at: '2026-07-29T11:22:33.000Z' });
  assert.match(first.id, /^child-teletext-x-wpa-/);
  assert.notEqual(first.id, later.id, 'the store dedupes by id; a collision would silently drop the child');
  assert.equal(buildChildCandidate({ parents: ['a'], id: '  chosen-id ', at: AT }).id, 'chosen-id');
});

test('registerChild refuses a child of nothing rather than polluting the lineage', () => withHome((home) => {
  assert.equal(registerChild({ parents: [] }, { home, at: AT }), null);
  assert.equal(registerChild(null, { home, at: AT }), null);
  assert.equal(registerChild(undefined, { home }), null);
}));

// Through the real taste-store, under a tmp HOME. The lineage only counts once it is
// on disk in the shape the rest of the system reads.
test('registerChild appends the child to the candidate registry under HOME', () => withHome((home) => {
  const written = registerChild({ parents: ['teletext', 'wpa'], label: 'Teletext x WPA', screen: '/tmp/x/child.html', project: '/p/app' }, { home, at: AT });
  assert.ok(written, 'the write was accepted');

  const raw = fs.readFileSync(join(home, '.impeccable', 'taste', 'candidates.jsonl'), 'utf8');
  const rows = raw.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].parents, ['teletext', 'wpa']);
  assert.equal(rows[0].id, written.id);
  assert.equal(rows[0].at, AT);

  // Same id twice records no new lineage, and says so rather than reporting a write.
  assert.equal(registerChild({ id: written.id, parents: ['teletext', 'wpa'] }, { home, at: AT }), null);
  assert.equal(fs.readFileSync(join(home, '.impeccable', 'taste', 'candidates.jsonl'), 'utf8').split('\n').filter(Boolean).length, 1);
}));
