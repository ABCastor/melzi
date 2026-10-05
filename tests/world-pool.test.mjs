// The world pool. FORK-ONLY (skill/scripts/melzi/world-pool.mjs).
//
// What these tests are really guarding: the pick path currently dies when
// impeccable.style is unreachable, because the catalog is service-side and this
// fork has no local copy. So the assertions are about the OFFLINE GUARANTEE (a
// failing fetch still yields the cached pool), about the pool filling only
// through the documented re-roll chain, and about a dealt hand spreading rather
// than serving three variations of one world.
//
// No test here touches the network. Every build injects a fetchImpl.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  poolPath,
  readPool,
  appendWorlds,
  buildPool,
  similarity,
  dealHand,
  MACROSTRUCTURES,
  structureFor,
  withStructure,
} from '../skill/scripts/melzi/world-pool.mjs';

const SCRIPT = fileURLToPath(new URL('../skill/scripts/melzi/world-pool.mjs', import.meta.url));
const API = 'https://example.invalid/api';

function withHome(fn) {
  const home = mkdtempSync(join(tmpdir(), 'melzi-worlds-'));
  try { return fn(home); } finally { rmSync(home, { recursive: true, force: true }); }
}

function challenger(id, extra = {}) {
  return {
    id,
    name: `World ${id}`,
    form: `the form of ${id}`,
    spark: `the spark of ${id}`,
    system: [`rule one for ${id}`, `rule two for ${id}`],
    webLeverage: `how ${id} pays off on the web`,
    wellTier: 'graphic',
    ...extra,
  };
}

/**
 * A fetch replacement, not a payload source: it returns Response-shaped objects
 * so the module under test exercises the same `.ok` / `.json()` path it takes
 * against the real roll API. `rounds` maps reroll number to its challengers.
 */
function fakeFetch(rounds) {
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    const round = Number(new URL(url).searchParams.get('reroll'));
    const challengers = rounds[round];
    if (!challengers) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, json: async () => ({ challengers }) };
  };
  impl.calls = calls;
  return impl;
}

test('the pool lives in the HOME dir, so a world dealt in one project serves the next', () => {
  assert.match(poolPath('/Users/x'), /^\/Users\/x\/\.impeccable\/worlds\/pool\.jsonl$/);
});

test('a missing pool reads as empty rather than throwing', () => withHome((home) => {
  assert.deepEqual(readPool({ home }), []);
}));

test('buildPool walks the documented re-roll chain and keeps what it deals', async () => withHome(async (home) => {
  const fetchImpl = fakeFetch({
    0: [challenger('a'), challenger('b')],
    1: [challenger('c'), challenger('d')],
  });

  const result = await buildPool({ rounds: 2, key: 'chain-key', home, apiBase: API, fetchImpl });
  assert.deepEqual(result, { added: 4, total: 4 });

  // The chain is the only way in: one direction roll per round, same base key,
  // reroll incrementing. No enumeration endpoint, no id guessing.
  assert.equal(fetchImpl.calls.length, 2);
  fetchImpl.calls.forEach((url, round) => {
    const params = new URL(url).searchParams;
    assert.ok(url.startsWith(`${API}/roll?`), url);
    assert.equal(params.get('scope'), 'direction');
    assert.equal(params.get('key'), 'chain-key');
    assert.equal(params.get('reroll'), String(round));
  });

  const stored = readPool({ home });
  assert.deepEqual(stored.map((world) => world.id), ['a', 'b', 'c', 'd']);
  assert.deepEqual(stored.map((world) => world.round), [0, 0, 1, 1]);
  assert.deepEqual([...new Set(stored.map((world) => world.sourceKey))], ['chain-key']);
}));

test('a mode is passed through to the roll, and a trailing slash on the base is stripped', async () => withHome(async (home) => {
  const fetchImpl = fakeFetch({ 0: [challenger('a')] });
  await buildPool({ rounds: 1, key: 'k', mode: 'persuade', home, apiBase: `${API}/`, fetchImpl });

  const url = fetchImpl.calls[0];
  assert.equal(url.includes('//roll'), false, 'no doubled slash from the base');
  assert.equal(new URL(url).searchParams.get('mode'), 'persuade');
}));

test('only the identifying and descriptive fields are stored; card art and review noise are dropped', async () => withHome(async (home) => {
  const fetchImpl = fakeFetch({
    0: [challenger('a', { cardHero: 'https://x/h.webp', cardBoard: 'https://x/b.webp', review: { rating: 3 }, status: 'approved' })],
  });
  await buildPool({ rounds: 1, key: 'k', home, apiBase: API, fetchImpl });

  const [world] = readPool({ home });
  assert.deepEqual(
    Object.keys(world).sort(),
    ['form', 'id', 'name', 'round', 'sourceKey', 'spark', 'system', 'webLeverage', 'wellTier']
  );
  assert.equal('cardHero' in world, false);
  assert.equal('review' in world, false);
}));

test('dedupe holds within a batch, across rounds, and across repeat builds', async () => withHome(async (home) => {
  // Round 1 repeats one of round 0's worlds, and round 0 repeats one inside itself.
  const fetchImpl = fakeFetch({
    0: [challenger('a'), challenger('b'), challenger('a')],
    1: [challenger('b'), challenger('c')],
  });
  assert.deepEqual(await buildPool({ rounds: 2, key: 'k', home, apiBase: API, fetchImpl }), { added: 3, total: 3 });

  // A second build on the same key deals the same worlds and must add nothing.
  const second = await buildPool({ rounds: 2, key: 'k', home, apiBase: API, fetchImpl: fakeFetch(
    { 0: [challenger('a'), challenger('b')], 1: [challenger('c')] }
  ) });
  assert.deepEqual(second, { added: 0, total: 3 });
  assert.deepEqual(readPool({ home }).map((world) => world.id), ['a', 'b', 'c']);
}));

test('appendWorlds skips entries with no id and reports what it wrote', () => withHome((home) => {
  assert.equal(appendWorlds([challenger('a'), { name: 'no id' }, null, challenger('a')], { home }), 1);
  assert.equal(appendWorlds([], { home }), 0);
  assert.equal(readPool({ home }).length, 1);
}));

// The whole reason the file exists: the network is the failure everyone hits,
// and it must cost nothing beyond the worlds that round would have added.
test('a rejecting fetch still returns the cache, which is the offline guarantee', async () => withHome(async (home) => {
  await buildPool({ rounds: 1, key: 'k', home, apiBase: API, fetchImpl: fakeFetch({ 0: [challenger('a'), challenger('b')] }) });

  const offline = await buildPool({
    rounds: 4,
    key: 'k2',
    home,
    apiBase: API,
    fetchImpl: async () => { throw new Error('getaddrinfo ENOTFOUND'); },
  });
  assert.deepEqual(offline, { added: 0, total: 2 });
  assert.deepEqual(dealHand({ count: 2, home }).map((world) => world.id), ['a', 'b'], 'the pick path still deals with no network');
}));

test('a failure mid-chain ends the chain and keeps the rounds that landed', async () => withHome(async (home) => {
  let calls = 0;
  const fetchImpl = async (url) => {
    calls += 1;
    if (calls > 1) throw new Error('connection reset');
    return { ok: true, json: async () => ({ challengers: [challenger('a'), challenger('b')] }) };
  };
  assert.deepEqual(await buildPool({ rounds: 4, key: 'k', home, apiBase: API, fetchImpl }), { added: 2, total: 2 });
  assert.equal(calls, 2, 'the chain stops at the failure instead of grinding through every round');
}));

test('a non-ok response and an empty challenger list both end the chain quietly', async () => withHome(async (home) => {
  const notOk = await buildPool({ rounds: 2, key: 'k', home, apiBase: API, fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }) });
  assert.deepEqual(notOk, { added: 0, total: 0 });

  const empty = await buildPool({ rounds: 2, key: 'k', home, apiBase: API, fetchImpl: async () => ({ ok: true, json: async () => ({ challengers: [] }) }) });
  assert.deepEqual(empty, { added: 0, total: 0 });
}));

test('a corrupt line is skipped, the intact ones still read', () => withHome((home) => {
  appendWorlds([challenger('a'), challenger('b')], { home });
  fs.appendFileSync(poolPath(home), '{"id":"trunc","form":"half a li\n');
  fs.appendFileSync(poolPath(home), 'not json at all\n');
  assert.deepEqual(readPool({ home }).map((world) => world.id), ['a', 'b']);
}));

// A fixture pool spanning three well tiers, with a near-identical twin inside
// each tier. Cross-tier vocabulary is deliberately disjoint.
const LETTERPRESS = {
  id: 'graphic-letterpress', name: 'Letterpress Broadside', wellTier: 'graphic',
  form: 'letterpress broadside printed on cotton rag',
  spark: 'ink bitten deep into thick cotton paper',
  system: ['letterpress rules divide the broadside', 'wood type headline sits above cotton margins'],
  webLeverage: 'letterpress texture survives cheap screens',
};
const BROADSIDE = {
  id: 'graphic-broadside', name: 'Cotton Broadside', wellTier: 'graphic',
  form: 'letterpress broadside printed on cotton stock',
  spark: 'ink bitten deep into heavy cotton paper',
  system: ['letterpress rules divide the broadside', 'wood type headline sits above cotton borders'],
  webLeverage: 'letterpress texture survives small screens',
};
const MIXER = {
  id: 'instrument-mixer', name: 'Mixing Desk', wellTier: 'interaction',
  form: 'analog mixing desk crowded with faders',
  spark: 'each channel exposes its own lit fader',
  system: ['faders travel vertically', 'channel strips repeat identical controls'],
  webLeverage: 'faders map onto sliders without translation',
};
const CONSOLE = {
  id: 'instrument-console', name: 'Console Desk', wellTier: 'interaction',
  form: 'analog console desk crowded with faders',
  spark: 'each channel exposes its own labelled fader',
  system: ['faders travel vertically', 'channel strips repeat identical knobs'],
  webLeverage: 'faders map onto sliders without confusion',
};
const FOG = {
  id: 'atmosphere-fog', name: 'Coastal Fog', wellTier: 'atmosphere',
  form: 'coastal fog rolling across cold water',
  spark: 'shapes dissolve into grey humid distance',
  system: ['fog softens every silhouette', 'distance drains saturation'],
  webLeverage: 'fog builds depth without heavy imagery',
};
const HAAR = {
  id: 'atmosphere-haar', name: 'North Sea Haar', wellTier: 'atmosphere',
  form: 'coastal haar rolling across cold water',
  spark: 'shapes dissolve into grey salted distance',
  system: ['haar softens every silhouette', 'distance drains saturation'],
  webLeverage: 'haar builds depth without heavy imagery',
};
const SPREAD_POOL = [LETTERPRESS, BROADSIDE, MIXER, CONSOLE, FOG, HAAR];

test('similarity is high for near twins, low across worlds, symmetric, and clamped', () => {
  assert.ok(similarity(LETTERPRESS, BROADSIDE) > 0.8, 'near twins read as near twins');
  assert.ok(similarity(LETTERPRESS, MIXER) < 0.3, 'different worlds read as different');
  assert.equal(similarity(LETTERPRESS, MIXER), similarity(MIXER, LETTERPRESS));
  assert.equal(similarity(LETTERPRESS, LETTERPRESS), 1, 'identity plus the tier bonus stays clamped at 1');
  assert.ok(similarity(LETTERPRESS, MIXER) >= 0);
  // Empty worlds have no tokens; no division by zero, no NaN.
  assert.equal(similarity({}, {}), 0);
});

test('the same pool and the same exclude always deal the same hand', () => {
  const first = dealHand({ count: 3, pool: SPREAD_POOL });
  const second = dealHand({ count: 3, pool: SPREAD_POOL });
  assert.deepEqual(first.map((world) => world.id), second.map((world) => world.id));
  assert.equal(first[0].id, SPREAD_POOL[0].id, 'the first pick is pool order, not a ranking');
});

// The point of MMR here: three cards that are actually three options.
test('a hand spreads across tiers and never carries two near-identical worlds', () => {
  const hand = dealHand({ count: 3, lambda: 0.3, pool: SPREAD_POOL });
  assert.equal(hand.length, 3);

  const tiers = new Set(hand.map((world) => world.wellTier));
  assert.ok(tiers.size >= 2, `expected at least two well tiers, got ${[...tiers].join(', ')}`);

  for (let i = 0; i < hand.length; i += 1) {
    for (let j = i + 1; j < hand.length; j += 1) {
      assert.ok(
        similarity(hand[i], hand[j]) < 0.5,
        `${hand[i].id} and ${hand[j].id} are too alike to sit in one hand`
      );
    }
  }
});

test('excluded ids never appear, and the hand refills from what is left', () => {
  const hand = dealHand({ count: 3, pool: SPREAD_POOL, exclude: ['graphic-letterpress', 'instrument-mixer'] });
  const ids = hand.map((world) => world.id);
  assert.equal(ids.includes('graphic-letterpress'), false);
  assert.equal(ids.includes('instrument-mixer'), false);
  assert.equal(hand.length, 3);
  assert.equal(hand[0].id, 'graphic-broadside', 'the first survivor in pool order leads');
});

test('dealHand asks for no more than the pool holds and survives an empty one', () => {
  assert.equal(dealHand({ count: 10, pool: SPREAD_POOL }).length, SPREAD_POOL.length);
  assert.deepEqual(dealHand({ count: 3, pool: [] }), []);
  assert.deepEqual(dealHand({ count: 0, pool: SPREAD_POOL }), []);
  assert.deepEqual(dealHand({ count: 3, pool: SPREAD_POOL, exclude: SPREAD_POOL.map((w) => w.id) }), []);
});

test('a duplicated pool line cannot put one world in a hand twice', () => {
  // appendWorlds is not atomic across concurrent builds, so the deal dedupes too.
  const doubled = [SPREAD_POOL[0], SPREAD_POOL[0], SPREAD_POOL[1]];
  const ids = dealHand({ count: 3, pool: doubled }).map((world) => world.id);
  assert.deepEqual(ids, [SPREAD_POOL[0].id, SPREAD_POOL[1].id]);
});

// ---------------------------------------------------------------------------
// The macrostructure axis.
//
// What these guard: a dealt world describes an identity and never a page shape,
// so a hand can differ in colour and mood while every card sits on the same
// layout. His click is the scarce resource in this system, and two options that
// differ on one axis can only teach one axis. So the assertions are that the
// shape is assigned without a coin toss (same world, same shape, always), that
// it counts in the spread rather than being a label stuck on afterwards, and
// that a world which never heard of the axis scores exactly as it did before.
// ---------------------------------------------------------------------------

test('the catalog is a curated list, each entry naming an id, a label, and what the shape does', () => {
  assert.ok(MACROSTRUCTURES.length >= 8, 'too few shapes to be an axis');
  assert.ok(MACROSTRUCTURES.length <= 20, 'a list nobody can hold in mind is not a legible axis');
  assert.equal(new Set(MACROSTRUCTURES.map((entry) => entry.id)).size, MACROSTRUCTURES.length);
  for (const entry of MACROSTRUCTURES) {
    assert.match(entry.id, /^[a-z][a-z0-9-]*$/, `${entry.id} is not a plain id`);
    assert.ok(entry.label && entry.label.trim(), `${entry.id} has no label`);
    // One line, and it has to say something actionable about all three of
    // heading placement, reading order, and density.
    assert.ok(entry.line.length > 40, `${entry.id}'s line is too thin to build from`);
    assert.equal(entry.line.includes('\n'), false, `${entry.id} is an essay, not an index line`);
    assert.match(entry.line, /head|caption|salutation|label/i, `${entry.id} says nothing about heading placement`);
    assert.match(entry.line, /read|scan|eye|browse|order/i, `${entry.id} says nothing about reading order`);
    assert.match(entry.line, /dens|sparse/i, `${entry.id} says nothing about density`);
  }
});

// The reference file is the copy a model reads while it builds the screen; the
// module is the copy the dealer stamps onto the hand. Two copies of one list is
// a drift waiting to happen, and the failure would be quiet: a hand stamped with
// a shape whose description says something else.
test('the reference index and the module catalog say the same thing, word for word', () => {
  const reference = fs.readFileSync(
    fileURLToPath(new URL('../skill/reference/macrostructures.md', import.meta.url)),
    'utf8'
  );
  for (const entry of MACROSTRUCTURES) {
    assert.ok(reference.includes(`\`${entry.id}\``), `${entry.id} is missing from macrostructures.md`);
    assert.ok(reference.includes(entry.label), `${entry.id}'s label is missing from macrostructures.md`);
    assert.ok(reference.includes(entry.line), `${entry.id}'s line has drifted from macrostructures.md`);
  }
  // And nothing in the file claims a shape the dealer cannot stamp.
  const listed = [...reference.matchAll(/^\| `([a-z][a-z0-9-]*)` \|/gm)].map((match) => match[1]);
  assert.deepEqual(listed, MACROSTRUCTURES.map((entry) => entry.id));
});

test('a structure is assigned deterministically from the world id, and never at random', () => {
  const world = { id: 'graphic-letterpress' };
  const first = structureFor(world);
  assert.ok(MACROSTRUCTURES.some((entry) => entry.id === first));
  // Fifty calls, one answer. A hand that changed shape between two deals of the
  // same pool would break genesis's exclude-and-redeal loop.
  for (let i = 0; i < 50; i += 1) assert.equal(structureFor({ id: 'graphic-letterpress' }), first);
  // Different ids do not all land on one shape.
  const spread = new Set(SPREAD_POOL.map((w) => structureFor(w)));
  assert.ok(spread.size >= 2, `every fixture world landed on ${[...spread]}`);

  // Pinned on purpose. The fallback is a hash modulo the catalog length, so
  // inserting or reordering MACROSTRUCTURES silently reassigns every world that
  // never declared its own shape. If this line fails after such an edit, that is
  // the alarm doing its job, not a broken test: decide whether the reshuffle is
  // acceptable, then update the pin.
  assert.equal(structureFor({ id: 'graphic-letterpress' }), 'specimen');
  assert.equal(structureFor({ id: 'atmosphere-fog' }), 'atlas');
});

test('a world that declares its own structure keeps it, whatever it says', () => {
  assert.equal(structureFor({ id: 'graphic-letterpress', structure: 'manifesto' }), 'manifesto');
  assert.equal(structureFor({ id: 'graphic-letterpress', structure: '  letter  ' }), 'letter');
  // An unrecognised name is still a name two worlds can share, so equality still
  // works and overruling the caller would throw away something they knew.
  assert.equal(structureFor({ id: 'x', structure: 'zine-spread' }), 'zine-spread');
  // Nothing usable to seed with, and nothing invented to cover it.
  assert.equal(structureFor({}), null);
  assert.equal(structureFor(null), null);
  // An empty declaration is not a declaration; fall back rather than pin nothing.
  assert.equal(structureFor({ id: 'x', structure: '   ' }), structureFor({ id: 'x' }));
  assert.ok(MACROSTRUCTURES.some((entry) => entry.id === structureFor({ id: 'x' })));
});

test('similarity rises when two worlds share a shape, and is untouched when neither has one', () => {
  // The pre-axis number, asserted first so the delta below is measured and not
  // assumed. These two fixtures share no vocabulary and no well tier.
  const base = similarity(LETTERPRESS, MIXER);
  assert.equal('structure' in LETTERPRESS, false, 'the fixture must stay structure-free for this to mean anything');

  const shared = similarity({ ...LETTERPRESS, structure: 'bento' }, { ...MIXER, structure: 'bento' });
  const apart = similarity({ ...LETTERPRESS, structure: 'bento' }, { ...MIXER, structure: 'letter' });
  assert.ok(shared > base, 'two bento grids must read as more alike than two unrelated shapes');
  assert.equal(apart, base, 'a different shape adds nothing, it only withholds the bonus');
  assert.ok(shared - base > 0.15, 'the bonus has to be wide enough to break a near-tie in the deal');

  // One-sided is not shared.
  assert.equal(similarity({ ...LETTERPRESS, structure: 'bento' }, MIXER), base);
  assert.equal(similarity(LETTERPRESS, { ...MIXER, structure: 'bento' }), base);

  // Still symmetric, still clamped, still no NaN.
  const a = { ...LETTERPRESS, structure: 'bento' };
  const b = { ...BROADSIDE, structure: 'bento' };
  assert.equal(similarity(a, b), similarity(b, a));
  assert.ok(similarity(a, b) <= 1, 'cosine plus both bonuses stays clamped');
  assert.equal(similarity({ structure: 'bento' }, { structure: 'bento' }), 0.2);
});

test('a dealt hand carries its structures and spans more than one of them', () => {
  const hand = dealHand({ count: 3, pool: SPREAD_POOL });
  assert.equal(hand.length, 3);
  for (const world of hand) {
    assert.ok(MACROSTRUCTURES.some((entry) => entry.id === world.structure), `${world.id} came back shapeless`);
  }
  assert.equal(
    new Set(hand.map((world) => world.structure)).size,
    3,
    `the hand doubled up on a shape: ${hand.map((w) => `${w.id}/${w.structure}`).join(', ')}`
  );
});

test('the shape counts in the spread, it is not a label added to the winners afterwards', () => {
  // Four worlds with disjoint vocabulary and no well tier, so the ONLY thing
  // similarity can see is the declared shape. Pool order offers the twin shape
  // first; MMR has to reject it for the world further down the list.
  const flat = [
    { id: 'w1', form: 'alpha alpha', spark: 'alpha', system: [], webLeverage: 'alpha', structure: 'bento' },
    { id: 'w2', form: 'bravo bravo', spark: 'bravo', system: [], webLeverage: 'bravo', structure: 'bento' },
    { id: 'w3', form: 'charlie charlie', spark: 'charlie', system: [], webLeverage: 'charlie', structure: 'letter' },
  ];
  const hand = dealHand({ count: 2, pool: flat });
  assert.deepEqual(hand.map((world) => world.id), ['w1', 'w3'], 'the second bento was taken over a different shape');
});

test('dealing does not write structures back into the caller pool', () => {
  const pool = SPREAD_POOL.map((world) => ({ ...world }));
  dealHand({ count: 3, pool });
  assert.equal(pool.some((world) => 'structure' in world), false, 'the deal mutated the pool it was handed');
  // withStructure copies for the same reason.
  const world = { id: 'graphic-letterpress' };
  assert.ok(withStructure(world).structure);
  assert.equal('structure' in world, false);
});

test('a declared structure survives a round trip through the pool; a fallback is never written down', () => withHome((home) => {
  appendWorlds([challenger('pinned', { structure: 'manifesto' }), challenger('plain')], { home });
  const stored = readPool({ home });
  assert.equal(stored[0].structure, 'manifesto');
  assert.equal('structure' in stored[1], false, 'the fallback belongs to the deal, not to the file');
  // And the pin still beats the hash after the round trip.
  assert.equal(dealHand({ count: 2, home })[0].structure, 'manifesto');
}));

function cli(args, home) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf-8',
    env: { ...process.env, HOME: home },
  });
}

test('--path prints the pool location under the caller home', () => withHome((home) => {
  const result = cli(['--path'], home);
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), join(home, '.impeccable', 'worlds', 'pool.jsonl'));
}));

test('--deal exits 3 with a plain message when the pool is empty, and prints JSON when it is not', () => withHome((home) => {
  const empty = cli(['--deal'], home);
  assert.equal(empty.status, 3);
  assert.match(empty.stderr, /world pool is empty/);
  assert.equal(empty.stdout, '');

  appendWorlds(SPREAD_POOL, { home });
  const dealt = cli(['--deal', '--count', '2', '--exclude', 'graphic-letterpress'], home);
  assert.equal(dealt.status, 0);
  const hand = JSON.parse(dealt.stdout);
  assert.equal(hand.length, 2);
  assert.equal(hand.some((world) => world.id === 'graphic-letterpress'), false);
}));

test('a dealt hand reports its structures, in the JSON and in one readable line', () => withHome((home) => {
  appendWorlds(SPREAD_POOL, { home });
  const dealt = cli(['--deal', '--count', '3'], home);
  assert.equal(dealt.status, 0);

  // stdout stays exactly the hand, so nothing already parsing it has to change.
  const hand = JSON.parse(dealt.stdout);
  assert.equal(hand.length, 3);
  for (const world of hand) {
    assert.ok(MACROSTRUCTURES.some((entry) => entry.id === world.structure), `${world.id} came back shapeless`);
  }

  assert.match(dealt.stderr, /^structures /);
  for (const world of hand) {
    assert.ok(dealt.stderr.includes(`${world.id}: ${world.structure}`), dealt.stderr);
  }
}));

test('--structures prints the whole index, so nobody keeps a second copy of the list', () => withHome((home) => {
  const result = cli(['--structures'], home);
  assert.equal(result.status, 0);
  const printed = JSON.parse(result.stdout);
  assert.deepEqual(printed, MACROSTRUCTURES);
}));

test('the usage line names the new flag', () => withHome((home) => {
  const result = cli([], home);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /--structures/);
}));
