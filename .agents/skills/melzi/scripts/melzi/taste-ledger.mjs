/**
 * The taste ledger: keep what he picked, and what he refused.
 *
 * FORK-ONLY. Upstream has no equivalent, so this file carries zero merge burden.
 * The only patch it needs in an upstream file is two lines in serve-question.mjs
 * (one import, one call), recorded as a fork delta.
 *
 * WHY THIS EXISTS. The visual-direction round is the one place in the whole tool
 * where the owner's own taste enters as data: the browser table shows him two or
 * three worlds and he clicks one, re-rolls the hand, or types a steer. That is a
 * preference signal produced at almost no cost to him, and it was being destroyed.
 * `serve-question.mjs` wrote the answer to a file, printed it, then removed the
 * file (`fs.rmSync(answerFile(key))`); nothing anywhere aggregated it and nothing
 * ever read it back into a later generation. Measured 2026-07-28: 100% of choices
 * discarded. The product goal is design "tuned only by my taste", and the taste was
 * going in the bin.
 *
 * WHAT IT RECORDS, AND WHY THE REFUSALS MATTER MORE THAN THE PICK. A pick is one
 * bit of information about a hand of two or three. The options he did NOT take,
 * named, are the rest of it, and a re-roll is a refusal of the entire hand, which
 * is the strongest signal the table can produce. "Not that" is also the judgement a
 * non-designer makes most reliably: he has said plainly he will never be able to
 * say what is good, and he does not need to be in order to say that is not it. So
 * every line carries the refused labels and lineages, not just the chosen one.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not act on the data. Nothing reads
 * this file yet, on purpose: a promotion rule ("after three consistent picks this
 * becomes law") would certify itself, because the same clicks would both create the
 * preference and ratify it, with no point at which the preference could be shown to
 * have made output worse. Collecting is cheap and safe; acting needs a way to tell
 * whether acting helped. Until that exists this is a ledger, not a policy.
 *
 * HOME, NOT PROJECT. The store is `~/.impeccable/taste.jsonl`, one canonical
 * append-only file, because taste is a property of the person and not of a repo:
 * a preference expressed in one project should inform the next one. Each line
 * carries `project` so a single project can still be filtered out.
 *
 * FAILURE POLICY. Never break the question flow. Every entry point swallows its
 * own errors: a full disk or a read-only home must not cost him his answer.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const LEDGER_VERSION = 1;

/** Reserved option ids that are actions on the hand, not worlds within it. */
const RESERVED = new Set(['reroll', 'canon']);

export function ledgerPath(home = os.homedir()) {
  return path.join(home, '.impeccable', 'taste.jsonl');
}

/** Keep only the identifying fields. The card art URLs and body copy are noise here. */
function slim(option) {
  if (!option) return null;
  const out = { id: option.id ?? null, label: option.label ?? null };
  if (option.lineage) out.lineage = option.lineage;
  // A genesis option's screen is the artifact he actually judged, so its path is
  // identity, not noise, even after the file itself is gone.
  if (option.screen) out.screen = option.screen;
  return out;
}

/**
 * Build the record. Pure, exported for the tests: the whole point of this module
 * is the shape of the line, so the shape is what gets asserted.
 *
 * `at` is passed in rather than read from the clock so a test can pin it.
 */
export function buildEntry({ optionId, steer, options, title, project, at }) {
  const hand = Array.isArray(options) ? options : [];
  const chosen = RESERVED.has(optionId) ? null : slim(hand.find((o) => o.id === optionId));

  // A re-roll refuses the whole hand. `canon` is a refusal of every offered world
  // in favour of the category standard, which is just as informative.
  const kind = optionId === 'reroll' ? 'reroll' : optionId === 'canon' ? 'canon' : 'pick';
  const refused = hand
    .filter((o) => !RESERVED.has(o.id) && o.id !== optionId)
    .map(slim);

  const entry = {
    v: LEDGER_VERSION,
    at,
    kind,
    project: project ?? null,
    title: title ?? null,
    chosen,
    refused,
  };
  // Only record a steer when he actually typed one. An empty string is not a signal.
  const trimmed = typeof steer === 'string' ? steer.trim() : '';
  if (trimmed) entry.steer = trimmed;
  return entry;
}

/**
 * Append one line. Returns true when it was written, false when it was skipped or
 * failed; callers ignore the result and must never let it throw.
 */
export function recordChoice(input, { home = os.homedir(), now } = {}) {
  try {
    if (process.env.IMPECCABLE_NO_TASTE_LEDGER) return false;
    // Nothing to learn from a hand with no options, and no id means no answer.
    if (!input || input.optionId === undefined || input.optionId === null) return false;

    const at = now ?? new Date().toISOString();
    const entry = buildEntry({ ...input, at });
    const target = ledgerPath(home);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.appendFileSync(target, `${JSON.stringify(entry)}\n`);
    return true;
  } catch {
    return false;
  }
}

/** Read the ledger back. Tolerates a truncated final line rather than throwing. */
export function readLedger({ home = os.homedir() } = {}) {
  try {
    const raw = fs.readFileSync(ledgerPath(home), 'utf8');
    return raw.split('\n').filter(Boolean).flatMap((line) => {
      try { return [JSON.parse(line)]; } catch { return []; }
    });
  } catch {
    return [];
  }
}
