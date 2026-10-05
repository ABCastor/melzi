// The taste store. FORK-ONLY (skill/scripts/melzi/taste-store.mjs).
//
// What these tests are really guarding, in order of how much product rides on it:
//
//  1. The attribute vocabulary. Attributes are proposed fresh by a model at every
//     comparison, so four spellings of one idea is the normal case. If they become
//     four attributes, every weight is split across synonyms and the learned profile
//     turns to mush. So the merge tests assert the collapse AND assert the two
//     documented limits, because a limit nobody wrote down is a limit somebody will
//     assume away later.
//  2. Pair selection. Every pair he is shown costs a click, and a candidate with
//     zero comparisons carries no information at all. A freshly recombined child is
//     always in that state, so the tests prove it can never be starved out, whatever
//     the model thinks of it.
//  3. Storage. Round-trips, dedupe, and the tolerance that keeps a truncated line
//     from taking a session's worth of taste with it.
//
// No test here touches the network or the real HOME.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  tastePaths,
  readCandidates,
  readComparisons,
  readReviewVerdicts,
  readReviewRounds,
  readAttributes,
  appendCandidate,
  migrateScreens,
  appendComparison,
  appendReviewVerdict,
  appendReviewRound,
  markConfounded,
  mergeAttributes,
  setVector,
  nextPair,
  STORE_VERSION,
} from '../skill/scripts/melzi/taste-store.mjs';

const SCRIPT = fileURLToPath(new URL('../skill/scripts/melzi/taste-store.mjs', import.meta.url));
const AT = '2026-07-28T09:00:00.000Z';

function withHome(fn) {
  const home = mkdtempSync(join(tmpdir(), 'melzi-taste-store-'));
  try { return fn(home); } finally { rmSync(home, { recursive: true, force: true }); }
}

/** A comparison as the compare server writes it, minus the fields under test. */
function comparison(a, b, outcome = 'a', extra = {}) {
  return { a, b, outcome, project: '/p/app', ...extra };
}

// ---------------------------------------------------------------- storage

test('a candidate and a comparison round-trip with their shapes intact', () => withHome((home) => {
  const project = join(home, 'project');
  const authored = join(project, '.impeccable', 'screens', 'wpa-park-poster.html');
  fs.mkdirSync(join(project, '.impeccable', 'screens'), { recursive: true });
  fs.writeFileSync(authored, '<h1>WPA Park Poster</h1>');

  assert.equal(appendCandidate({
    id: 'wpa-park-poster',
    label: 'WPA Park Poster',
    screen: authored,
    world: 'posters-covers-sleeves-wpa-park-poster',
    subject: 'ema-persona-site',
    project,
  }, { home, now: AT }), true);
  assert.equal(appendCandidate({ id: 'teletext', label: 'Teletext Service', parents: ['wpa-park-poster', 'swiss'] }, { home, now: AT }), true);

  const [first, second] = readCandidates({ home });
  assert.equal(first.v, STORE_VERSION);
  assert.equal(first.id, 'wpa-park-poster');
  assert.equal(first.screen, join(home, '.impeccable', 'screens', 'wpa-park-poster.html'));
  assert.equal(fs.readFileSync(first.screen, 'utf8'), '<h1>WPA Park Poster</h1>');
  assert.equal(fs.existsSync(authored), true, 'registration copies the screen and leaves the project artifact alone');
  assert.equal(first.subject, 'ema-persona-site');
  assert.deepEqual(first.parents, [], 'a genesis screen is bred from nothing');
  assert.equal(first.at, AT);
  assert.deepEqual(second.parents, ['wpa-park-poster', 'swiss'], 'lineage survives so a child is inspectable');

  assert.equal(appendComparison(comparison('wpa-park-poster', 'teletext', 'b', { source: 'click' }), { home, now: AT }), true);
  const [only] = readComparisons({ home });
  assert.deepEqual(only, {
    v: STORE_VERSION,
    at: AT,
    project: '/p/app',
    a: 'wpa-park-poster',
    b: 'teletext',
    outcome: 'b',
    source: 'click',
    annotations: [],
  });

  const raw = fs.readFileSync(tastePaths(home).comparisons, 'utf8');
  assert.ok(raw.endsWith('\n'), 'trailing newline so the next append cannot corrupt this line');
}));

test('review verdicts and Go rounds share the taste ledger JSONL conventions', () => withHome((home) => {
  const verdict = {
    project: 'portfolio',
    candidate: { id: 'quiet', name: 'Quiet', tokens: {}, faces: {} },
    verdict: { id: 'v1', candidateId: 'quiet', verdict: 'love', at: AT },
  };
  const round = { project: 'portfolio', at: AT, record: { version: 1, page: '/alpha', candidates: [] } };

  assert.equal(appendReviewVerdict(verdict, { home }), true);
  assert.equal(appendReviewRound(round, { home }), true);
  assert.deepEqual(readReviewVerdicts({ home }), [{ v: STORE_VERSION, ...verdict }]);
  assert.deepEqual(readReviewRounds({ home }), [{ v: STORE_VERSION, ...round }]);
  assert.ok(fs.readFileSync(tastePaths(home).reviewVerdicts, 'utf8').endsWith('\n'));
  assert.ok(fs.readFileSync(tastePaths(home).reviewRounds, 'utf8').endsWith('\n'));
}));

test('a missing screen warns but does not stop candidate registration', (t) => withHome((home) => {
  const warnings = [];
  t.mock.method(process.stderr, 'write', (chunk) => {
    warnings.push(String(chunk));
    return true;
  });
  const missing = join(home, 'project', '.impeccable', 'screens', 'missing.html');

  assert.equal(appendCandidate({ id: 'missing', screen: missing }, { home, now: AT }), true);
  assert.equal(readCandidates({ home })[0].screen, missing, 'the caller still sees the path it supplied');
  assert.match(warnings.join(''), /warning.*missing.*screen/i);
}));

test('screen migration copies temporary candidates once and leaves durable candidates untouched', () => withHome((home) => {
  const paths = tastePaths(home);
  const temporaryDir = join(home, 'scratchpad');
  const temporary = join(temporaryDir, 'temporary.html');
  const durable = join(home, '.impeccable', 'screens', 'durable.html');
  fs.mkdirSync(temporaryDir, { recursive: true });
  fs.mkdirSync(join(home, '.impeccable', 'screens'), { recursive: true });
  fs.writeFileSync(temporary, '<h1>Temporary</h1>');
  fs.writeFileSync(durable, '<h1>Durable</h1>');
  fs.mkdirSync(paths.dir, { recursive: true });
  fs.writeFileSync(paths.candidates, [
    JSON.stringify({ v: 1, id: 'temporary', screen: temporary, subject: 'one-site' }),
    JSON.stringify({ v: 1, id: 'durable', screen: durable, subject: 'one-site' }),
    '',
  ].join('\n'));

  const first = migrateScreens({ home });
  assert.equal(first.copied.length, 1);
  assert.deepEqual(first.copied[0], {
    id: 'temporary',
    from: temporary,
    to: join(home, '.impeccable', 'screens', 'temporary.html'),
  });
  assert.deepEqual(first.alreadyDurable, ['durable']);
  assert.equal(fs.existsSync(temporary), true, 'migration copies rather than moves the source');
  assert.equal(fs.readFileSync(first.copied[0].to, 'utf8'), '<h1>Temporary</h1>');

  const candidates = readCandidates({ home });
  assert.equal(candidates[0].screen, first.copied[0].to);
  assert.equal(candidates[0].subject, 'one-site', 'rewriting the screen path preserves new and unknown fields');
  assert.equal(candidates[1].screen, durable);

  const second = migrateScreens({ home });
  assert.deepEqual(second.copied, []);
  assert.deepEqual(second.alreadyDurable, ['temporary', 'durable']);
}));

test('a candidate is registered once, however many rounds offer it', () => withHome((home) => {
  assert.equal(appendCandidate({ id: 'teletext' }, { home }), true);
  assert.equal(appendCandidate({ id: 'teletext', label: 'offered again' }, { home }), false);
  assert.equal(readCandidates({ home }).length, 1, 'two registry lines would double its weight in every count');
}));

test('a half-shaped comparison is refused rather than stored', () => withHome((home) => {
  assert.equal(appendComparison({ a: 'x', outcome: 'a' }, { home }), false, 'no second side');
  assert.equal(appendComparison(comparison('x', 'x'), { home }), false, 'a candidate cannot beat itself');
  assert.equal(appendComparison(comparison('x', 'y', 'left'), { home }), false, 'only a, b, tie');
  assert.equal(appendComparison(null, { home }), false);
  assert.equal(readComparisons({ home }).length, 0);
}));

test('annotations keep the candidate they belong to, and an ownerless one is dropped', () => withHome((home) => {
  appendComparison(comparison('x', 'y', 'tie', {
    annotations: [
      { candidate: 'x', kind: 'keep', target: { selector: 'main > h1', text: 'DEPARTURES', rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.05 } }, text: 'this masthead stays' },
      { candidate: 'y', kind: 'shouty', text: 'the two triangles at the top' },
      { kind: 'dislike', text: 'no owner, no evidence' },
    ],
  }), { home });

  const [row] = readComparisons({ home });
  assert.equal(row.annotations.length, 2);
  assert.equal(row.annotations[0].kind, 'keep');
  assert.equal(row.annotations[0].target.selector, 'main > h1');
  assert.deepEqual(row.annotations[0].target.rect, { x: 0.1, y: 0.2, w: 0.3, h: 0.05 });
  assert.equal(row.annotations[1].kind, 'note', 'an unknown kind degrades to a note rather than being invented');
}));

test('a missing store reads as empty defaults rather than throwing', () => withHome((home) => {
  assert.deepEqual(readCandidates({ home }), []);
  assert.deepEqual(readComparisons({ home }), []);
  assert.deepEqual(readAttributes({ home }), { attributes: [], vectors: {} });
}));

test('a truncated line costs its own line and nothing else', () => withHome((home) => {
  appendComparison(comparison('x', 'y'), { home });
  fs.appendFileSync(tastePaths(home).comparisons, '{"v":1,"a":"x","b":');
  assert.equal(readComparisons({ home }).length, 1, 'the intact line still reads');

  fs.writeFileSync(tastePaths(home).attributes, '{ not json');
  assert.deepEqual(readAttributes({ home }), { attributes: [], vectors: {} }, 'a corrupt vocabulary reads as none, not as a crash');
}));

// ------------------------------------------------------------- confounds
//
// The pair he caught himself: one screen light, the other dark, and only because
// the first had no mode control. The verdict was real, the ground difference was
// an accident, and a fit that reads a preference off it is confidently wrong on
// an axis nobody tested. The row stays; the axis loses its claim on it.

test('a comparison carries the axes whose difference was an accident', () => withHome((home) => {
  appendComparison(comparison('light', 'dark', 'b', { confounded: ['ground', ' ground ', 'ground-mode', 42, ''] }), { home, now: AT });
  const [row] = readComparisons({ home });
  assert.deepEqual(row.confounded, ['ground', 'ground-mode'], 'deduped and trimmed, junk dropped');
}));

test('an ordinary comparison keeps the shape it always had', () => withHome((home) => {
  appendComparison(comparison('a', 'b'), { home, now: AT });
  appendComparison(comparison('c', 'd', 'a', { confounded: [] }), { home, now: AT });
  for (const row of readComparisons({ home })) {
    assert.equal('confounded' in row, false, 'nothing to say means no field, not an empty one');
  }
}));

test('an intuition timeout is stored as a timed low-confidence tie, never as an ordinary verdict', () => withHome((home) => {
  assert.equal(appendComparison(comparison('a', 'b', 'tie', {
    source: 'timeout', responseMs: 3000, timedOut: true, weight: 1.25,
    intuition: { session: 'first-pass', timerSeconds: 3, cap: 8 },
  }), { home, now: AT }), true);
  const [row] = readComparisons({ home });
  assert.equal(row.outcome, 'tie');
  assert.equal(row.source, 'timeout');
  assert.equal(row.responseMs, 3000);
  assert.equal(row.timedOut, true);
  assert.equal(row.weight, 0.35, 'a timeout cannot be laundered into high-confidence evidence');
  assert.deepEqual(row.intuition, { session: 'first-pass', timerSeconds: 3, cap: 8 });

  assert.equal(appendComparison(comparison('c', 'd', 'a', { responseMs: 3000, timedOut: true }), { home }), false);
  assert.equal(appendComparison(comparison('c', 'd', 'tie', { timedOut: true }), { home }), false);
}));

test('a comparison already taken is marked rather than deleted', () => withHome((home) => {
  appendComparison(comparison('light', 'dark', 'b'), { home, now: AT });
  appendComparison(comparison('light', 'teletext', 'a'), { home, now: AT });

  // Either order matches: he does not know or care which side was dealt as `a`.
  assert.equal(markConfounded({ a: 'dark', b: 'light' }, ['ground'], { home }), 1);
  const rows = readComparisons({ home });
  assert.equal(rows.length, 2, 'nothing is removed; his judgement is still on file');
  assert.deepEqual(rows[0].confounded, ['ground']);
  assert.equal(rows[0].outcome, 'b', 'and the verdict itself is untouched');
  assert.equal('confounded' in rows[1], false, 'the other comparison is left alone');

  // Marks accumulate rather than replacing, so a second look adds a second axis.
  assert.equal(markConfounded({ a: 'light', b: 'dark' }, ['ground', 'hero-image'], { home }), 1);
  assert.deepEqual(readComparisons({ home })[0].confounded, ['ground', 'hero-image']);
}));

test('a mark that matches nothing returns zero instead of looking like success', () => withHome((home) => {
  appendComparison(comparison('light', 'dark', 'b'), { home, now: AT });
  assert.equal(markConfounded({ a: 'light', b: 'nobody' }, ['ground'], { home }), 0);
  assert.equal(markConfounded({ a: 'light', b: 'dark' }, [], { home }), 0, 'no axis named, nothing to do');
  assert.equal(markConfounded({ a: 'light' }, ['ground'], { home }), 0, 'a pair needs two sides');
  assert.equal(markConfounded({ a: 'light', b: 'dark' }, ['ground'], { home: join(home, 'nothing-here') }), 0);
  assert.equal('confounded' in readComparisons({ home })[0], false);
}));

test('a timestamp narrows the mark to the one round it belongs to', () => withHome((home) => {
  appendComparison(comparison('light', 'dark', 'b'), { home, now: AT });
  appendComparison(comparison('light', 'dark', 'a'), { home, now: '2026-07-29T11:00:00.000Z' });

  assert.equal(markConfounded({ a: 'light', b: 'dark', at: AT }, ['ground'], { home }), 1);
  const rows = readComparisons({ home });
  assert.deepEqual(rows[0].confounded, ['ground']);
  assert.equal('confounded' in rows[1], false);

  // Without a timestamp the mark covers every round of that pair.
  assert.equal(markConfounded({ a: 'light', b: 'dark' }, ['ground'], { home }), 2);
  assert.deepEqual(readComparisons({ home }).map((r) => r.confounded), [['ground'], ['ground']]);
}));

test('marking rewrites the ledger without eating a line it cannot read', () => withHome((home) => {
  appendComparison(comparison('light', 'dark', 'b'), { home, now: AT });
  fs.appendFileSync(tastePaths(home).comparisons, '{"v":1,"a":"x","b":\n');
  appendComparison(comparison('light', 'teletext', 'a'), { home, now: AT });

  assert.equal(markConfounded({ a: 'light', b: 'dark' }, ['ground'], { home }), 1);
  const raw = fs.readFileSync(tastePaths(home).comparisons, 'utf8');
  assert.ok(raw.includes('{"v":1,"a":"x","b":'), 'a rewrite that quietly drops a bad line turns one bad append into data loss');
  assert.ok(raw.endsWith('\n'), 'and the file still ends where an append expects it to');
  assert.equal(readComparisons({ home }).length, 2);
}));

// ---------------------------------------------------------- the vocabulary

test('the spellings of one attribute stay one attribute', () => withHome((home) => {
  // Exactly the shapes a model produces across rounds when nobody hands it a list:
  // case, punctuation, word order, a plural, and a split compound.
  const first = mergeAttributes([
    { label: 'generous whitespace', description: 'more room between blocks' },
    { label: 'Generous Whitespace' },
    { label: 'whitespace, generous' },
    { label: 'generous white space' },
    { label: 'generous whitespaces' },
  ], { home, now: AT });

  assert.equal(first.added.length, 1, 'five proposals, one attribute');
  assert.equal(first.merged.length, 4);
  assert.equal(first.added[0].id, 'generous-whitespace');
  assert.equal(first.added[0].firstSeen, AT);
  assert.equal(first.added[0].comparisons, 1, 'one round counts once, not once per spelling');

  // A later round proposing it again is a second comparison behind the same weight.
  const second = mergeAttributes(['Whitespace Generous'], { home });
  assert.equal(second.added.length, 0);
  assert.deepEqual(second.merged, [{ label: 'Whitespace Generous', into: 'generous-whitespace' }]);
  assert.equal(readAttributes({ home }).attributes[0].comparisons, 2);
}));

test('attributes that only look alike are kept apart', () => withHome((home) => {
  const result = mergeAttributes(['high contrast', 'low contrast', 'the three-column layout', 'three column layouts'], { home });
  assert.deepEqual(result.attributes.map((row) => row.id), ['high-contrast', 'low-contrast', 'the-three-column-layout']);
  assert.equal(result.merged.length, 1, 'only the plural of the layout folded in');
  // Polarity words are never treated as filler: merging these two would produce an
  // attribute that means nothing at all.
  assert.notEqual(result.attributes[0].id, result.attributes[1].id);
}));

test('the merge states its own limits: a derived form is a new attribute', () => withHome((home) => {
  mergeAttributes(['generous whitespace'], { home });
  const result = mergeAttributes(['whitespace generosity'], { home });
  // Documented, not accidental. "generosity" and "generous" share no stem under a
  // rule set this small, and real stemming starts merging things that differ. The
  // backstop is that both show up next to each other in the printed profile.
  assert.equal(result.added.length, 1);
  assert.deepEqual(result.attributes.map((row) => row.id), ['generous-whitespace', 'whitespace-generosity']);
}));

test('a description arriving in a later round fills the gap the first one left', () => withHome((home) => {
  mergeAttributes(['dense data display'], { home });
  mergeAttributes([{ label: 'Dense Data Displays', description: 'more rows visible without scrolling' }], { home });
  const [attribute] = readAttributes({ home }).attributes;
  assert.equal(attribute.description, 'more rows visible without scrolling');
}));

test('an id the model reuses beats its own choice of wording that round', () => withHome((home) => {
  mergeAttributes([{ label: 'generous whitespace' }], { home });
  const result = mergeAttributes([{ id: 'generous-whitespace', label: 'roomy layout' }], { home });
  assert.equal(result.added.length, 0);
  assert.equal(result.merged[0].into, 'generous-whitespace');
  assert.equal(readAttributes({ home }).attributes.length, 1);
}));

test('junk proposals are skipped without taking the round with them', () => withHome((home) => {
  const result = mergeAttributes(['generous whitespace', '', '   ', null, 42, { description: 'no label' }], { home });
  assert.equal(result.attributes.length, 1);
}));

// -------------------------------------------------------------- the vectors

test('setVector clamps into 0..1 and merges instead of replacing', () => withHome((home) => {
  setVector('wpa', { 'generous-whitespace': 0.8, 'high-contrast': 1.7, 'flat-hierarchy': -3 }, { home });
  const merged = setVector('wpa', { 'high-contrast': 0.25, 'serif-body': 1 }, { home });

  assert.deepEqual(merged, {
    'generous-whitespace': 0.8,
    'high-contrast': 0.25,
    'flat-hierarchy': 0,
    'serif-body': 1,
  }, 'an earlier reading survives a round that said nothing about it');
  assert.deepEqual(readAttributes({ home }).vectors.wpa, merged);
}));

test('a non-numeric value is dropped, never laundered into a reading of zero', () => withHome((home) => {
  setVector('wpa', { 'generous-whitespace': 0.6 }, { home });
  const merged = setVector('wpa', { 'generous-whitespace': 'quite a lot', 'high-contrast': NaN }, { home });
  assert.deepEqual(merged, { 'generous-whitespace': 0.6 });
}));

test('setting a vector leaves the vocabulary alone', () => withHome((home) => {
  mergeAttributes(['generous whitespace'], { home });
  setVector('wpa', { 'generous-whitespace': 0.5 }, { home });
  assert.equal(readAttributes({ home }).attributes.length, 1);
}));

// ----------------------------------------------------------- the next pair

const FOUR = ['a', 'b', 'c', 'd'].map((id) => ({ id }));

test('a candidate nobody has compared is always reachable, whatever the model thinks of it', () => {
  const candidates = [...FOUR.slice(0, 3), { id: 'child' }];
  const comparisons = [comparison('a', 'b'), comparison('a', 'c'), comparison('b', 'c')];
  // The model is as dismissive of the newcomer as it can be: a huge strength with no
  // uncertainty makes every pair containing it look like a foregone conclusion, so
  // its base score is zero. A newly recombined child is exactly this case.
  const model = {
    strengths: [
      { id: 'a', theta: 0, se: 1 },
      { id: 'b', theta: 0.05, se: 1 },
      { id: 'c', theta: -0.05, se: 1 },
      { id: 'child', theta: 100, se: 0 },
    ],
  };

  const pair = nextPair({ candidates, comparisons, model });
  assert.ok(pair.a === 'child' || pair.b === 'child', 'the population step stops working if a child can be starved out');
  assert.match(pair.reason, /never been compared/);
});

test('a question already answered is not asked again while one is unasked', () => {
  const comparisons = [
    comparison('a', 'b'), comparison('a', 'b', 'b'), comparison('a', 'b'),
    comparison('c', 'd'), comparison('a', 'c'),
  ];
  const pair = nextPair({ candidates: FOUR, comparisons });
  const key = [pair.a, pair.b].sort().join('|');
  assert.equal(['a|d', 'b|c', 'b|d'].includes(key), true, `expected an unasked pair, got ${key}`);
  assert.notEqual(key, 'a|b', 'three clicks already spent on that one');
  assert.match(pair.reason, /not asked yet/);
});

test('with nothing unasked left, the least predictable pair wins', () => {
  const comparisons = [
    comparison('a', 'b'), comparison('a', 'c'), comparison('a', 'd'),
    comparison('b', 'c'), comparison('b', 'd'), comparison('c', 'd'),
  ];
  // a and b are neck and neck; c and d are settled at opposite ends. Asking about c
  // against d spends a click on an outcome anyone could call.
  const model = {
    strengths: [
      { id: 'a', theta: 0, se: 1 },
      { id: 'b', theta: 0.01, se: 1 },
      { id: 'c', theta: 5, se: 1 },
      { id: 'd', theta: -5, se: 1 },
    ],
  };
  const pair = nextPair({ candidates: FOUR, comparisons, model });
  assert.deepEqual([pair.a, pair.b], ['a', 'b']);
  assert.match(pair.reason, /least settled/);
});

test('a wider gap in what we know breaks a tie in predictability', () => {
  const comparisons = [comparison('a', 'b'), comparison('a', 'c'), comparison('b', 'c'), comparison('c', 'd'), comparison('a', 'd'), comparison('b', 'd')];
  const model = {
    strengths: [
      { id: 'a', theta: 0, se: 0.1 },
      { id: 'b', theta: 0, se: 0.1 },
      { id: 'c', theta: 0, se: 2 },
      { id: 'd', theta: 0, se: 2 },
    ],
  };
  // Every pair is an even match, so the only thing left to separate them is how
  // unsure we are of the gap. c against d is the pair we know least about.
  const pair = nextPair({ candidates: FOUR, comparisons, model });
  assert.deepEqual([pair.a, pair.b], ['c', 'd']);
});

test('the same store always proposes the same pair', () => {
  const comparisons = [comparison('a', 'b')];
  const first = nextPair({ candidates: FOUR, comparisons });
  const second = nextPair({ candidates: FOUR, comparisons });
  assert.deepEqual(first, second);
});

test('nextPair refuses known cross-subject pairs without excluding an unknown subject', () => {
  const personaA = { id: 'persona-a', subject: 'ema-persona-site' };
  const studio = { id: 'studio', subject: 'melzi-studio-site' };
  const personaB = { id: 'persona-b', subject: 'ema-persona-site' };

  assert.deepEqual(
    nextPair({ candidates: [personaA, studio, personaB] }),
    { a: 'persona-a', b: 'persona-b', reason: 'neither has been compared yet' },
  );
  assert.equal(nextPair({ candidates: [personaA, studio] }), null, 'two different known subjects have no valid pair');

  const legacy = nextPair({ candidates: [personaA, { id: 'legacy-without-subject' }] });
  assert.deepEqual([legacy.a, legacy.b], ['persona-a', 'legacy-without-subject']);
});

test('there is no pair to offer below two candidates', () => withHome((home) => {
  assert.equal(nextPair({ home }), null, 'an empty store');
  assert.equal(nextPair({ candidates: [{ id: 'a' }] }), null);
  assert.equal(nextPair({ candidates: [{ id: 'a' }, { id: 'a' }] }), null, 'one candidate twice is still one candidate');
}));

test('nextPair reads the store when it is given nothing', () => withHome((home) => {
  appendCandidate({ id: 'a' }, { home });
  appendCandidate({ id: 'b' }, { home });
  const pair = nextPair({ home });
  assert.deepEqual([pair.a, pair.b], ['a', 'b']);
  assert.match(pair.reason, /neither has been compared/);
}));

// ------------------------------------------------------------------- CLI

function cli(args, home) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf-8',
    env: { ...process.env, HOME: home },
  });
}

test('--path prints the store and durable screen locations under the caller home', () => withHome((home) => {
  const result = cli(['--path'], home);
  assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout), {
    dir: join(home, '.impeccable', 'taste'),
    candidates: join(home, '.impeccable', 'taste', 'candidates.jsonl'),
    comparisons: join(home, '.impeccable', 'taste', 'comparisons.jsonl'),
    reviewVerdicts: join(home, '.impeccable', 'taste', 'review-verdicts.jsonl'),
    reviewRounds: join(home, '.impeccable', 'taste', 'review-rounds.jsonl'),
    attributes: join(home, '.impeccable', 'taste', 'attributes.json'),
    sessions: join(home, '.impeccable', 'taste', 'sessions.json'),
    screens: join(home, '.impeccable', 'screens'),
  });
}));

test('--migrate-screens reports copied candidates and is idempotent', () => withHome((home) => {
  const paths = tastePaths(home);
  const source = join(home, 'scratchpad', 'cli.html');
  fs.mkdirSync(join(home, 'scratchpad'), { recursive: true });
  fs.mkdirSync(paths.dir, { recursive: true });
  fs.writeFileSync(source, '<h1>CLI migration</h1>');
  fs.writeFileSync(paths.candidates, `${JSON.stringify({ v: 1, id: 'cli', screen: source })}\n`);

  const first = cli(['--migrate-screens'], home);
  assert.equal(first.status, 0);
  assert.match(first.stdout, /copied cli/);
  assert.match(first.stdout, /1 copied, 0 already durable, 0 missing/);

  const second = cli(['--migrate-screens'], home);
  assert.equal(second.status, 0);
  assert.match(second.stdout, /0 copied, 1 already durable, 0 missing/);
}));

test('--profile exits 3 with a plain message before anyone has been asked anything', () => withHome((home) => {
  const result = cli(['--profile'], home);
  // Not an empty profile: printed from nothing it reads as "he has no preferences",
  // when the truth is that nobody has asked him yet.
  assert.equal(result.status, 3);
  assert.match(result.stderr, /not enough taste yet/);
  assert.equal(result.stdout, '');
}));

test('--next prints the pair as JSON, and needs no model to do it', () => withHome((home) => {
  const empty = cli(['--next'], home);
  assert.equal(empty.status, 3);
  assert.match(empty.stderr, /fewer than two candidates/);

  appendCandidate({ id: 'wpa-park-poster' }, { home });
  appendCandidate({ id: 'teletext' }, { home });
  const result = cli(['--next'], home);
  assert.equal(result.status, 0);
  const pair = JSON.parse(result.stdout);
  assert.deepEqual([pair.a, pair.b], ['wpa-park-poster', 'teletext']);
  assert.equal(typeof pair.reason, 'string');
  assert.ok(pair.reason.length > 0);
}));

// The guard that already cost this project one blocker bug: a path.resolve(argv[1])
// comparison does not match when the script is reached through a symlink, so the CLI
// block never runs and the process exits 0 having printed nothing at all.
test('the CLI still runs when the script is reached through a symlink', () => withHome((home) => {
  const link = join(home, 'taste-store-link.mjs');
  fs.symlinkSync(SCRIPT, link);
  const result = spawnSync(process.execPath, [link, '--path'], { encoding: 'utf-8', env: { ...process.env, HOME: home } });
  assert.equal(result.status, 0);
  assert.notEqual(result.stdout.trim(), '', 'a silent exit 0 is what the broken guard looks like');
  assert.equal(JSON.parse(result.stdout).dir, join(home, '.impeccable', 'taste'));
}));
