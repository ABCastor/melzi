#!/usr/bin/env node
/**
 * The world pool: keep the worlds the roll already dealt, so choosing one stops
 * depending on a website being up.
 *
 * FORK-ONLY. Upstream has no equivalent, so this file carries zero merge burden.
 *
 * WHY THIS EXISTS. The catalog lives service-side (impeccable-site), and the
 * skill reaches it through `concept-seed.mjs`, which resolves challengers from a
 * local catalog dir, then the roll API at impeccable.style, then a degraded
 * assignment-only seed with no challengers at all. We do not have the private
 * catalog, so on this machine the middle branch is the only one that ever fires:
 * every single pick round is one HTTPS request away from serving him a seed with
 * no worlds in it. A sandboxed shell, a flight, a service outage, or the day
 * that endpoint changes shape all produce the same outcome, and the failure is
 * silent in the sense that matters: the run still completes, just without the
 * material that makes it not look like every other model's output.
 *
 * So we keep what we are dealt. Every world that comes back from a roll is
 * written once to a home-level JSONL file, and the pick path can be served from
 * that file with no network at all.
 *
 * HOW IT FILLS, AND THE LINE IT DOES NOT CROSS. Only through the documented
 * re-roll chain `concept-seed.mjs` already walks: GET /roll?scope=direction&
 * key=K&reroll=R for R = 0..rounds-1, where each round returns roughly six
 * challengers and excludes what earlier rounds drew. That is the same traffic a
 * user re-rolling a few times generates, just kept instead of thrown away. There
 * is no enumeration endpoint here, no id guessing, and no scraping: the catalog
 * is the paid service's moat and we cache only what the service chooses to deal
 * us. If that distinction ever stops holding, this file is the thing to delete.
 *
 * WHY THE HAND IS PICKED BY MMR, NOT BY RANK. A pool of cached worlds sorted by
 * anything model-shaped hands selection back to a taste function, and taste
 * functions pick the safest card, which is the exact rut the roll exists to
 * break. Maximal Marginal Relevance instead selects for spread: after the first
 * world, each next pick maximizes `lambda * relevance - (1 - lambda) * maxSim`
 * against what is already in the hand. Relevance here is a constant 1 (nothing
 * in the pool is more "wanted" than anything else yet), and with uniform
 * relevance MMR reduces to greedy max-diversity. Stated plainly so nobody
 * mistakes the knob for a live one: while relevance is constant, lambda shifts
 * every candidate's score by the same amount and therefore cannot change the
 * hand. The term stays in the formula because it becomes real the moment
 * relevance stops being 1, which is what a taste signal would supply.
 *
 * THE SECOND AXIS, AND WHY IT PAYS FOR ITSELF. Every field a dealt world carries
 * describes an IDENTITY: palette, material, type, texture, atmosphere. Not one of
 * them names the page's SHAPE. So when a hand is dealt, the three cards routinely
 * differ in colour and mood and sit on the same underlying layout, which is the
 * opposite of what dealHand exists to do. It costs more than a dull hand. His
 * clicks are the scarcest input in this whole system: he has said he will never
 * be the design reviewer, so a preference has to be inferred from which of two
 * screens he takes, and the pairwise loop deliberately deals the pair whose
 * outcome is least predictable in order to buy the most per click. A pool that
 * varies on one axis caps that ceiling no matter how cleverly the pair is chosen,
 * because two options that differ only in mood can only ever teach mood.
 *
 * So worlds gain a MACROSTRUCTURE: a whole-page shape, orthogonal to identity.
 * Same coral and same serif, one screen a bento grid and the other a long
 * document, and now a single click separates two things at once. The structures
 * are a small curated list rather than anything generated, because the value is
 * that the axis is legible: a shape he keeps refusing is a fact anyone can read
 * off the ledger, where "he dislikes world 7" is not.
 *
 * HOME, NOT PROJECT. `~/.impeccable/worlds/pool.jsonl`, beside the taste ledger,
 * because a world dealt in one project is just as good in the next one.
 *
 * FAILURE POLICY. Nothing here throws into a caller's flow. A build that cannot
 * reach the network returns what the cache already holds, which is the whole
 * point of the file.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The chain is a direction roll: worlds, not stagings. Surface rolls deal composition. */
const ROLL_SCOPE = 'direction';

/**
 * The macrostructures: whole-page shapes, not components.
 *
 * Each `line` answers the same three questions in the same order, because those
 * are the three that decide whether two screens read as different options rather
 * than two paint jobs: where the headings sit, what order the eye takes the page
 * in, and how dense it is. A model building a screen can act on all three
 * directly, and none of them requires knowing anything about the visual world.
 *
 * Curated and short on purpose. A long list would collapse into near-duplicates,
 * and the axis is only worth having while a person can hold the whole of it in
 * mind and say "not that shape again".
 *
 * ORDER IS PART OF THE CONTRACT. The fallback assignment is a hash modulo this
 * array's length, so inserting or reordering entries reassigns every world that
 * never declared a structure of its own. That is harmless while nothing has
 * pinned one, and the moment a specific assignment matters, write it into that
 * world's `structure` field, which always wins over the fallback.
 */
export const MACROSTRUCTURES = [
  {
    id: 'bento',
    label: 'Bento grid',
    line: 'Headings live inside their own tiles, the eye browses cells in any order it likes, density high and evenly spread.',
  },
  {
    id: 'long-document',
    label: 'Long document',
    line: 'One heading opens each section of a single column, reading runs strictly top to bottom, density low and unvarying.',
  },
  {
    id: 'marquee',
    label: 'Marquee hero',
    line: 'One enormous heading owns the first screen alone, the page reads as a statement followed by a thin tail, density near zero up top and ordinary below.',
  },
  {
    id: 'stat-led',
    label: 'Stat-led',
    line: 'Figures outrank headings and set the type scale, the eye lands on a number and reads its label second, density concentrated into a band and sparse around it.',
  },
  {
    id: 'workbench',
    label: 'Workbench',
    line: 'Headings shrink to panel labels around a central work surface, reading radiates outward from the middle rather than downward, density high at the edges and calm in the centre.',
  },
  {
    id: 'manifesto',
    label: 'Manifesto',
    line: 'The headings are the content, few and very large, read as a sequence of declarations with nothing between them, density as close to nothing as the page can bear.',
  },
  {
    id: 'letter',
    label: 'Letter',
    line: 'An address or salutation stands where a heading would, one measured column is read once from start to finish, density low with wide unused margin.',
  },
  {
    id: 'index-first',
    label: 'Index first',
    line: 'The opening heading is a list of everything the page contains, reading is choose-then-descend rather than scroll, density high in text and near zero in image.',
  },
  {
    id: 'split-studio',
    label: 'Split studio',
    line: 'A heading stays pinned in one half while the other half moves, two tracks are read in parallel instead of one in series, density deliberately unequal between the halves.',
  },
  {
    id: 'specimen',
    label: 'Type specimen',
    line: 'Headings demonstrate the typeface rather than label a section, reading follows the scale downward from largest to smallest, density swings hard between a giant setting and fine print.',
  },
  {
    id: 'atlas',
    label: 'Atlas',
    line: 'Headings float as captions pinned to a drawn field or map, reading order is spatial and the visitor sets it, density clustered around the drawing and empty elsewhere.',
  },
  {
    id: 'catalogue',
    label: 'Catalogue',
    line: 'A small repeated heading tops each specimen with the live thing under it, reading is scanning down a repeating unit, density uniform and modular the whole way.',
  },
];

const STRUCTURE_IDS = MACROSTRUCTURES.map((entry) => entry.id);

/**
 * The macrostructure of one world: what it declares, or a deterministic fallback.
 *
 * The seed is the world's `id`, which is the only thing about a pool entry that
 * is stable across builds, re-rolls, and repeat deals; everything else in the
 * record is prose the service may reword. Hashing it means the same world gets
 * the same shape in every hand, in every project, forever, with nothing written
 * down and nothing to keep in sync.
 *
 * It is a hash and not a reading of the world's own prose ON PURPOSE. Choosing a
 * shape that "suits" the world is a taste call, and this file's whole position is
 * that taste calls in the dealer pick the safest card. Dice here, judgement in
 * the screen the model then builds.
 *
 * A world that declares its own `structure` keeps it, whatever string it is. An
 * unrecognised name is still a name two worlds can share, so equality still does
 * its job in similarity(), and refusing it would silently overrule a caller who
 * knew something we do not.
 */
export function structureFor(world) {
  const declared = world?.structure;
  if (typeof declared === 'string' && declared.trim()) return declared.trim();
  const id = world?.id;
  if (typeof id !== 'string' || id === '') return null;
  const digest = crypto.createHash('sha256').update(id).digest();
  return STRUCTURE_IDS[digest.readUInt32BE(0) % STRUCTURE_IDS.length];
}

/**
 * A copy of the world carrying its structure. A copy, not a mutation: the pool
 * array a caller passed in is theirs, and a hand that rewrote it would make two
 * deals of the same pool disagree.
 */
export function withStructure(world) {
  const structure = structureFor(world);
  return structure ? { ...world, structure } : world;
}

export function poolPath(home = os.homedir()) {
  return path.join(home, '.impeccable', 'worlds', 'pool.jsonl');
}

/** Read the pool back. Tolerates a truncated or garbage line rather than throwing. */
export function readPool({ home = os.homedir() } = {}) {
  try {
    const raw = fs.readFileSync(poolPath(home), 'utf8');
    return raw.split('\n').filter(Boolean).flatMap((line) => {
      try {
        const parsed = JSON.parse(line);
        return parsed && typeof parsed === 'object' ? [parsed] : [];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

/**
 * Keep the fields that describe the world and the fields that say where it came
 * from. Card art URLs, review metadata, and prose the API happens to attach are
 * noise: the pool is a source of design material, not a mirror of the service.
 */
function slimWorld(world) {
  const id = world?.id;
  if (typeof id !== 'string' || id === '') return null;
  const stored = {
    id,
    name: world.name ?? null,
    form: world.form ?? null,
    spark: world.spark ?? null,
    system: Array.isArray(world.system) ? world.system : [],
    webLeverage: world.webLeverage ?? null,
    wellTier: world.wellTier ?? null,
    sourceKey: world.sourceKey ?? null,
    round: Number.isInteger(world.round) ? world.round : null,
  };
  // Only when it is really there. A declared structure is a deliberate pin and
  // must survive a round-trip through the pool, but writing `structure: null` on
  // every world would put a field in the file that nothing ever set and invite
  // the next reader to treat the fallback as stored data.
  if (typeof world.structure === 'string' && world.structure.trim()) {
    stored.structure = world.structure.trim();
  }
  return stored;
}

/**
 * Append the worlds this batch introduces, and only those. Dedupe runs against
 * the existing file AND within the batch, because re-roll rounds overlap at the
 * edges and two builds on different keys will deal the same popular world.
 * Returns how many lines were written; 0 covers "nothing new" and "could not
 * write" alike, since neither is a caller's problem.
 */
export function appendWorlds(worlds, { home = os.homedir() } = {}) {
  try {
    const batch = Array.isArray(worlds) ? worlds : [];
    if (batch.length === 0) return 0;

    const seen = new Set(readPool({ home }).map((world) => world?.id));
    const lines = [];
    for (const world of batch) {
      const stored = slimWorld(world);
      if (!stored || seen.has(stored.id)) continue;
      seen.add(stored.id);
      lines.push(JSON.stringify(stored));
    }
    if (lines.length === 0) return 0;

    const target = poolPath(home);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    // One write for the whole batch, trailing newline so the next append cannot
    // corrupt the last line.
    fs.appendFileSync(target, `${lines.join('\n')}\n`);
    return lines.length;
  } catch {
    return 0;
  }
}

function resolveApiBase(apiBase) {
  const base = apiBase || process.env.IMPECCABLE_API_URL || 'https://impeccable.style/api';
  return String(base).replace(/\/$/, '');
}

function resolveTimeoutMs() {
  const raw = Number(process.env.IMPECCABLE_API_TIMEOUT);
  return Number.isFinite(raw) && raw > 0 ? raw : 4000;
}

/**
 * One round of the chain. Returns the roll or null; a null ends the chain.
 * Deliberate near-copy of concept-seed.mjs's fetchRoll: exporting from that
 * upstream file would create a permanent re-apply burden, so keep the copy and
 * keep it in sync by hand if concept-seed's version ever changes.
 * The explicit race against the budget is not belt-and-braces: an abort signal
 * does not reliably cancel the TCP connect phase, so a blackholed route stalls
 * far past the timeout without it. Both timers are cleared so a fast reply does
 * not leave the process holding a pending timer.
 */
async function fetchRoll({ apiBase, key, mode, reroll, fetchImpl, timeoutMs }) {
  const params = new URLSearchParams({ scope: ROLL_SCOPE, key, reroll: String(reroll) });
  if (mode) params.set('mode', mode);
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), timeoutMs);
  let raceTimer = null;
  try {
    const response = await Promise.race([
      fetchImpl(`${apiBase}/roll?${params}`, { signal: controller.signal }),
      new Promise((resolveTimeout) => {
        raceTimer = setTimeout(() => resolveTimeout(null), timeoutMs);
      }),
    ]);
    if (!response || !response.ok) return null;
    const roll = await response.json();
    if (!Array.isArray(roll?.challengers) || roll.challengers.length === 0) return null;
    return roll;
  } catch {
    return null;
  } finally {
    clearTimeout(abortTimer);
    clearTimeout(raceTimer);
    // Abort unconditionally: when the race timer wins, the fetch is still live
    // and clearing its abort timer would leave the connection holding the event
    // loop. Aborting an already-consumed fetch is a no-op.
    controller.abort();
  }
}

/**
 * Walk the re-roll chain under one key and keep everything it deals.
 *
 * A network failure of any kind ends the chain where it stands rather than
 * failing the build: whatever earlier rounds returned is still worth keeping,
 * and the caller gets the same `{ added, total }` shape either way. `total` is
 * the pool size after the append, so a fully offline call reports the cache.
 */
export async function buildPool({
  rounds = 4,
  key,
  mode = null,
  home = os.homedir(),
  apiBase,
  fetchImpl = fetch,
} = {}) {
  const collected = [];
  try {
    const seedKey = key || crypto.randomBytes(4).toString('hex');
    const base = resolveApiBase(apiBase);
    const timeoutMs = resolveTimeoutMs();
    const roundCount = Number.isFinite(Number(rounds)) ? Math.floor(Number(rounds)) : 0;
    for (let round = 0; round < roundCount; round += 1) {
      const roll = await fetchRoll({ apiBase: base, key: seedKey, mode, reroll: round, fetchImpl, timeoutMs });
      if (!roll) break;
      for (const challenger of roll.challengers) {
        collected.push({ ...challenger, sourceKey: seedKey, round });
      }
    }
  } catch {
    // Keep whatever landed before the failure; the append below still runs.
  }
  const added = appendWorlds(collected, { home });
  return { added, total: readPool({ home }).length };
}

/** Words shorter than three characters carry no signal about a visual world. */
function tokenBag(world) {
  const text = [
    world?.form ?? '',
    world?.spark ?? '',
    Array.isArray(world?.system) ? world.system.join(' ') : '',
    world?.webLeverage ?? '',
  ].join(' ').toLowerCase();
  const bag = new Map();
  for (const token of text.split(/[^a-z0-9]+/)) {
    if (token.length <= 2) continue;
    bag.set(token, (bag.get(token) || 0) + 1);
  }
  return bag;
}

function magnitude(bag) {
  let sum = 0;
  for (const count of bag.values()) sum += count * count;
  return Math.sqrt(sum);
}

/**
 * How alike two worlds are, 0..1, deterministically and with no model in the
 * loop. Cosine over the token bags of the descriptive fields, plus a flat 0.15
 * when both sit in the same well tier, because two graphic-tier worlds compete
 * for the same slot in a hand even when their prose shares no vocabulary, plus a
 * flat 0.20 when both carry the same macrostructure.
 *
 * WHY 0.20, ABOVE THE TIER BONUS. The well tier is a fact about where a world
 * came from in the catalog. The macrostructure is a fact about what he actually
 * sees, and shape is what registers first, before palette, texture, or type: two
 * bento grids in one hand read as one option shown twice however far apart their
 * moods are. The number also has to do real work inside dealHand's greedy loop,
 * where a candidate's score moves by `(1 - lambda) * bonus`, so at the default
 * lambda 0.3 a 0.20 bonus shifts a score by 0.14. That is comfortably wider than
 * the gaps between cross-world cosines in practice, so it breaks near-ties toward
 * a different shape, and still small enough that it cannot make two worlds with
 * genuinely shared vocabulary look further apart than they are.
 *
 * IT READS, IT NEVER ASSIGNS. A world with no `structure` field is scored exactly
 * as it was before this axis existed. The fallback assignment belongs to
 * dealHand, where a hand is being composed; a bare similarity() call between two
 * raw catalog records must not start inventing fields.
 */
export function similarity(a, b) {
  const left = tokenBag(a);
  const right = tokenBag(b);
  let dot = 0;
  for (const [token, count] of left) {
    const other = right.get(token);
    if (other) dot += count * other;
  }
  const scale = magnitude(left) * magnitude(right);
  const cosine = scale > 0 ? dot / scale : 0;
  const tierBonus = a?.wellTier && a.wellTier === b?.wellTier ? 0.15 : 0;
  const structureBonus = a?.structure && a.structure === b?.structure ? 0.2 : 0;
  return Math.min(1, cosine + tierBonus + structureBonus);
}

/**
 * Deal a hand by MMR over the pool.
 *
 * The first pick is the first world in stable pool order, not a "best" one:
 * relevance is uniform, so there is no best, and picking by position keeps the
 * whole hand reproducible. Every later pick maximizes
 * `lambda * 1 - (1 - lambda) * maxSimToSelected`, and ties resolve to pool order
 * because the comparison is strictly greater-than. Same pool plus same exclude
 * therefore always yields the same hand.
 *
 * Every candidate is stamped with its macrostructure BEFORE the loop runs, so
 * the shape counts in the spread rather than being decoration added to the
 * winners afterwards. The stamp is a pure function of the world id, so this adds
 * no randomness and the hand stays as reproducible as it was.
 */
export function dealHand({
  count = 3,
  lambda = 0.3,
  exclude = [],
  home = os.homedir(),
  pool,
} = {}) {
  try {
    const source = Array.isArray(pool) ? pool : readPool({ home });
    const skip = new Set(Array.isArray(exclude) ? exclude : []);
    // Dedupe by id here too: appendWorlds is not atomic across concurrent
    // builds, and a duplicated pool line must not put one world in a hand twice.
    const seen = new Set();
    const available = source.filter((world) => {
      if (!world?.id || skip.has(world.id) || seen.has(world.id)) return false;
      seen.add(world.id);
      return true;
    }).map(withStructure);
    const wanted = Math.max(0, Math.min(Math.floor(Number(count)) || 0, available.length));
    if (wanted === 0) return [];

    const selected = [available[0]];
    while (selected.length < wanted) {
      let best = null;
      let bestScore = -Infinity;
      for (const candidate of available) {
        if (selected.includes(candidate)) continue;
        let maxSim = 0;
        for (const chosen of selected) maxSim = Math.max(maxSim, similarity(candidate, chosen));
        const score = lambda * 1 - (1 - lambda) * maxSim;
        if (score > bestScore) {
          bestScore = score;
          best = candidate;
        }
      }
      if (!best) break;
      selected.push(best);
    }
    return selected;
  } catch {
    return [];
  }
}

// Run the CLI only when this module is the entry point. Compare realpaths, same
// as signature.mjs: generated skills are reached through symlinked harness dirs,
// and a plain path.resolve(argv[1]) comparison silently exits 0 there, which
// would defeat genesis.md's exit-code gate. fileURLToPath, not URL.pathname,
// because this repo's own path contains a space.
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
    const index = args.indexOf(name);
    return index === -1 ? undefined : args[index + 1];
  };

  if (args.includes('--path')) {
    process.stdout.write(`${poolPath()}\n`);
    process.exit(0);
  }

  if (args.includes('--structures')) {
    // The whole index, so a caller holding a dealt hand can turn its structure
    // ids into the line that says what to build without opening the reference
    // file or hardcoding a second copy of the list.
    process.stdout.write(`${JSON.stringify(MACROSTRUCTURES)}\n`);
    process.exit(0);
  }

  if (args.includes('--build')) {
    const roundsRaw = flag('--rounds');
    const rounds = roundsRaw !== undefined ? Number(roundsRaw) : 4;
    if (!Number.isFinite(rounds) || rounds < 0) {
      // A NaN would silently run zero rounds and report {"added":0} as if the
      // network simply had nothing; refuse loudly instead.
      process.stderr.write(`world-pool: --rounds needs a non-negative number, got ${JSON.stringify(roundsRaw)}\n`);
      process.exit(1);
    }
    const result = await buildPool({
      rounds,
      key: flag('--key'),
      mode: flag('--mode') ?? null,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    // A raced-out fetch may still hold a socket; exit explicitly so the CLI
    // never lingers on a dead network path after output is written.
    process.exit(0);
  }

  if (args.includes('--deal')) {
    const excluded = flag('--exclude');
    // No --lambda flag on purpose: with uniform relevance the knob cannot change
    // the hand (see the header), so exposing it would only invite cargo-culting.
    const hand = dealHand({
      count: flag('--count') !== undefined ? Number(flag('--count')) : 3,
      exclude: excluded ? excluded.split(',').map((id) => id.trim()).filter(Boolean) : [],
    });
    if (hand.length === 0) {
      // Exit 3 rather than an empty array: an empty pool is a state the caller
      // has to act on (run --build once with network), not a hand of zero.
      process.stderr.write(`world pool is empty (${poolPath()}); run --build once with network access\n`);
      process.exit(3);
    }
    process.stdout.write(`${JSON.stringify(hand)}\n`);
    // The shapes on one line, on stderr so stdout stays the hand and nothing
    // parsing it has to change. This is the line a person reads to see at a
    // glance whether the hand is three options or three paint jobs.
    const shapes = hand.map((world) => `${world.id}: ${world.structure ?? 'none'}`).join(', ');
    process.stderr.write(`structures ${shapes}\n`);
    process.exit(0);
  }

  process.stdout.write('usage: world-pool.mjs --build [--rounds N] [--key K] | --deal [--count N] [--exclude id,id] | --structures | --path\n');
  process.exit(0);
}
