/**
 * The signature: the few things that never vary, and the licence to vary the rest.
 *
 * FORK-ONLY. Upstream has no equivalent and no notion of a person-level signature,
 * so this file carries zero merge burden.
 *
 * WHY THIS EXISTS. The tool's strength is that it rolls genuinely different visual
 * worlds, and that is also the problem: every roll produces a competent design by
 * a stranger. The owner has one design signature of his own (one bold warm colour
 * leading a near-silent greyscale field, an arty blue as the spark, serif for
 * content and mono for data, held by a ratio rule) and he wants it to survive every
 * world the tool deals him. Without something that states the invariants at
 * generation time, each surface starts from zero and the through-line between the
 * things he makes never forms.
 *
 * WHY THE FREE LIST IS PART OF THE BLOCK, NOT AN AFTERTHOUGHT. Naming only what is
 * fixed makes a model careful everywhere, and careful is exactly the failure mode:
 * it flattens the world back into safe defaults, which is the thing this whole tool
 * exists to avoid. So the block ends by naming the layers where the model is not
 * merely allowed but expected to be strange. Constraint plus explicit licence, not
 * constraint alone.
 *
 * HOME, NOT PROJECT, AND DELIBERATELY OUTSIDE THIS REPO. The store is
 * `~/.impeccable/signature.json` for the same reason the taste ledger lives there:
 * a signature is a property of the person, not of a checkout, and it should hold
 * across every project he starts. The second reason is specific to this repo, which
 * is a public fork of someone else's product: his personal brand constants must
 * never be committed into it, not even as a fixture. The tests use a tmp home.
 *
 * NO VALUES IN THIS FILE. The module knows the SHAPE, never the hexes. Someone
 * else's signature.json has to render just as well, and a hex duplicated in code is
 * a hex that goes stale in silence the first time the source of truth moves.
 *
 * FAILURE POLICY. A missing, unreadable, or malformed signature must never fail a
 * design flow. Every entry point swallows its own errors, `loadSignature` answers
 * null, `renderSignatureBlock` answers an empty string, and the CLI prints one line
 * and exits 0. Working without the signature is a smaller loss than not working.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Keys inside an invariant that carry prose rather than a value. */
const PROSE_KEYS = new Set(['role', 'note', 'concept']);

export function signaturePath(home = os.homedir()) {
  return path.join(home, '.impeccable', 'signature.json');
}

/**
 * Read and parse the signature. Returns null for missing, unreadable, or invalid
 * JSON, and also for valid JSON that is not an object (an array or a bare `null`
 * parses fine and is still not a signature). Never throws.
 */
export function loadSignature({ home = os.homedir() } = {}) {
  try {
    const parsed = JSON.parse(fs.readFileSync(signaturePath(home), 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Render one invariant as its lines. Value fields go on the header line so the
 * hexes stay scannable; prose goes underneath, indented, so a long role sentence
 * cannot push the values off the edge of a model's attention.
 *
 * A field literally named `value` renders bare, because `coral: value #FD4E5A`
 * reads as a field name where `coral: #FD4E5A` reads as the fact it is.
 */
function renderInvariant(name, value) {
  if (value === null || value === undefined) return [];
  if (typeof value !== 'object') return [`${name}: ${value}`];

  const facts = [];
  const prose = [];
  for (const [key, field] of Object.entries(value)) {
    // Skip nested objects rather than inventing a format for a shape that does
    // not exist yet. One level is what the schema uses.
    if (field === null || field === undefined || typeof field === 'object') continue;
    if (PROSE_KEYS.has(key)) prose.push(String(field));
    else facts.push(key === 'value' ? String(field) : `${key} ${field}`);
  }

  const head = facts.length ? `${name}: ${facts.join(', ')}` : `${name}:`;
  return [head, ...prose.map((line) => `  ${line}`)];
}

/**
 * Build the LLM-facing block. Deterministic: same JSON in, same string out, in the
 * file's own key order.
 *
 * `schemaVersion` and `source` are deliberately not rendered. `source` names a
 * private vault note, and a path a model cannot open is noise at best and an
 * invitation to go looking at worst.
 */
export function renderSignatureBlock(sig) {
  if (!sig || typeof sig !== 'object') return '';

  const invariants = sig.invariants && typeof sig.invariants === 'object' && !Array.isArray(sig.invariants)
    ? sig.invariants
    : {};
  const lines = Object.entries(invariants).flatMap(([name, value]) => renderInvariant(name, value));
  // A block titled SIGNATURE INVARIANTS that lists none is worse than silence.
  if (!lines.length) return '';

  const free = Array.isArray(sig.free) ? sig.free.filter((layer) => typeof layer === 'string' && layer.trim()) : [];
  const out = ['SIGNATURE INVARIANTS'];
  if (typeof sig.oneLine === 'string' && sig.oneLine.trim()) out.push(sig.oneLine.trim());
  out.push('These hold in every world. Carry the values exactly; do not resample, retune, or substitute them.', '');
  out.push(...lines);
  if (free.length) {
    out.push('', `FREE, and expected to vary world to world: ${free.join(', ')}.`);
  }
  return out.join('\n');
}

function cli() {
  const sig = loadSignature();
  const block = renderSignatureBlock(sig);
  // One line, not an error: a design flow that asked for the signature and found
  // none should carry on knowing that, not stop.
  process.stdout.write(`${block || 'NO_SIGNATURE'}\n`);
}

// Run cli() only when this module is the entry point. Compare realpaths rather
// than endsWith(): a loose suffix match also fires for unrelated scripts, and
// realpath tolerates symlinked invocation (the test harness symlinks the skill dir).
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
  cli();
}
