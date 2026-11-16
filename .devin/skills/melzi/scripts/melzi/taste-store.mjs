#!/usr/bin/env node
/**
 * The taste store: keep every comparison, grow the vocabulary it is judged in, and
 * decide which two screens to show him next.
 *
 * FORK-ONLY. Upstream has no equivalent, so this file carries zero merge burden.
 *
 * WHY THIS EXISTS. The owner cannot review design and has said so plainly. What he
 * can do reliably is say WHICH OF THESE TWO, and point at a thing he dislikes. So
 * the tool has to learn his taste from binary choices plus pointing, and the learned
 * thing has to apply to designs he has never seen. A score attached to a candidate
 * cannot do that: the candidate is gone the moment the round ends. Only a model over
 * ATTRIBUTES generalizes, which is why this file spends most of its length on the
 * attribute vocabulary rather than on the comparisons themselves. The attribute layer
 * is the product, not bookkeeping around it.
 *
 * WHY THE VOCABULARY IS NOT A FIXED LIST. The model proposes attributes fresh at
 * each comparison, because a fixed list can only measure taste along axes someone
 * guessed in advance, and the interesting part of anyone's taste is the axis nobody
 * thought to name. The cost of that choice lands here: near-duplicate labels are the
 * normal case, not the exception. "generous whitespace", "Generous Whitespace",
 * "whitespace, generous" and "generous white space" are one attribute, and if they
 * become four then every weight is diluted across synonyms and the learned profile
 * turns to mush. `mergeAttributes` is where that is paid for; its comment states
 * exactly which collisions it catches and which it knowingly does not.
 *
 * WHY THE PAIR SELECTION MATTERS AS MUCH AS THE MATH. Every pair he is shown costs
 * a click and a chunk of attention, and his attention is the scarcest input in the
 * whole system. A pair whose outcome is already obvious teaches nothing and spends
 * that budget anyway. So `nextPair` is a fatigue budget, not a scheduler.
 *
 * WHY A COMPARISON CAN BE MARKED AND NEVER DELETED. A pair sometimes differs on
 * something nobody chose: one screen was dark only because it had no light mode.
 * The verdict is still a real judgement about those two screens, so the row stays;
 * what has to go is that ONE attribute's claim on it. `confounded` on the row names
 * those attributes, `markConfounded` adds them to a row already written, and
 * `fitAttributeWeights` drops the named attribute's evidence from that row alone.
 * Deleting the row instead would protect one axis by discarding a real answer.
 *
 * HOME, NOT PROJECT. `~/.impeccable/taste/`, beside the taste ledger and the world
 * pool, because taste is a property of the person and not of a checkout. A comparison
 * made while building one thing should still count while building the next.
 *
 * NO STATIC DEPENDENCY ON taste-model.mjs. The maths module is loaded lazily, and
 * only by the CLI, so a missing or broken model can never take persistence down with
 * it. `nextPair` takes an already-fitted model as an argument instead of fitting one,
 * which keeps this file free of matrix code and lets the caller fit once per round.
 *
 * FAILURE POLICY. Nothing here throws into a caller's flow. A read that fails is an
 * empty store, a write that fails is a false, and a selection that cannot be made is
 * a null. Losing a comparison is smaller than losing his session.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const STORE_VERSION = 1;

/** The only three verdicts he ever gives. No sliders, no 1-10, ever. */
const OUTCOMES = new Set(['a', 'b', 'tie']);

/** Review-island judgements are unary, so they keep their own honest vocabulary. */
const REVIEW_OUTCOMES = new Set(['love', 'like', 'no']);

/** Annotation kinds: what he kept, what he disliked, and everything else he typed. */
const ANNOTATION_KINDS = new Set(['keep', 'dislike', 'note']);

export function tastePaths(home = os.homedir()) {
  const root = path.join(home, '.impeccable');
  const dir = path.join(root, 'taste');
  return {
    dir,
    candidates: path.join(dir, 'candidates.jsonl'),
    comparisons: path.join(dir, 'comparisons.jsonl'),
    reviewVerdicts: path.join(dir, 'review-verdicts.jsonl'),
    reviewRounds: path.join(dir, 'review-rounds.jsonl'),
    attributes: path.join(dir, 'attributes.json'),
    sessions: path.join(dir, 'sessions.json'),
    screens: path.join(root, 'screens'),
  };
}

function warnScreen(message) {
  try {
    process.stderr.write(`warning: ${message}\n`);
  } catch {
    // A warning must not turn a recoverable screen-copy failure into a crash.
  }
}

function candidateScreenTarget(id, { home }) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id)) return null;
  return path.join(tastePaths(home).screens, `${id}.html`);
}

function copyCandidateScreen(candidate, { home, id }) {
  const supplied = candidate?.screen;
  if (typeof supplied !== 'string' || !supplied) return supplied ?? null;

  const target = candidateScreenTarget(id, { home });
  if (!target) {
    warnScreen(`candidate ${id} has an unsafe id, so its screen remains at ${supplied}`);
    return supplied;
  }

  try {
    const source = path.resolve(supplied);
    if (!fs.statSync(source).isFile()) throw new Error('the screen path is not a file');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (source !== path.resolve(target)) fs.copyFileSync(source, target);
    return target;
  } catch (error) {
    warnScreen(`candidate ${id} screen could not be copied from ${supplied}: ${error?.message ?? String(error)}`);
    return supplied;
  }
}

/** Read a JSONL file back. A truncated or garbage line is skipped, never fatal. */
function readJsonl(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
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

/** One append, trailing newline, so the next append cannot corrupt this line. */
function appendLine(file, record) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(record)}\n`);
}

export function readCandidates({ home = os.homedir() } = {}) {
  return readJsonl(tastePaths(home).candidates);
}

export function readComparisons({ home = os.homedir() } = {}) {
  return readJsonl(tastePaths(home).comparisons);
}

export function readReviewVerdicts({ home = os.homedir(), project } = {}) {
  const records = readJsonl(tastePaths(home).reviewVerdicts);
  return project ? records.filter((record) => record.project === project) : records;
}

export function readReviewRounds({ home = os.homedir(), project } = {}) {
  const records = readJsonl(tastePaths(home).reviewRounds);
  return project ? records.filter((record) => record.project === project) : records;
}

/** Store one island verdict beside, but not disguised as, a pairwise comparison. */
export function appendReviewVerdict(payload, { home = os.homedir() } = {}) {
  try {
    const project = typeof payload?.project === 'string' ? payload.project.trim() : '';
    const candidate = payload?.candidate;
    const verdict = payload?.verdict;
    if (!project || !candidate?.id || verdict?.candidateId !== candidate.id || !REVIEW_OUTCOMES.has(verdict?.verdict)) return false;
    appendLine(tastePaths(home).reviewVerdicts, { v: STORE_VERSION, ...payload, project });
    return true;
  } catch {
    return false;
  }
}

/** Store one complete Go bundle without splitting its page-level judgement apart. */
export function appendReviewRound(payload, { home = os.homedir() } = {}) {
  try {
    const project = typeof payload?.project === 'string' ? payload.project.trim() : '';
    if (!project || !payload?.record || typeof payload.record !== 'object') return false;
    appendLine(tastePaths(home).reviewRounds, { v: STORE_VERSION, ...payload, project });
    return true;
  } catch {
    return false;
  }
}

/**
 * Intuition was originally carried only on comparison rows. A stopping rule needs
 * a durable commitment before its first answer, so its state lives in one record
 * for that same intuition session rather than in a second kind of session.
 */
function readSessions({ home = os.homedir() } = {}) {
  try {
    const parsed = JSON.parse(fs.readFileSync(tastePaths(home).sessions, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeSessions(sessions, { home }) {
  const target = tastePaths(home).sessions;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(sessions, null, 2)}\n`);
  fs.renameSync(tmp, target);
}

function stoppingSessionId(value) {
  const id = typeof value === 'string' ? value.trim() : '';
  return /^[a-zA-Z0-9_-]{1,64}$/.test(id) ? id : null;
}

function candidateCap(value) {
  const cap = Number(value);
  return Number.isInteger(cap) && cap >= 2 && cap <= 100 ? cap : null;
}

function stoppingSnapshot(record) {
  return record && typeof record === 'object' ? JSON.parse(JSON.stringify(record)) : null;
}

export function readTasteSession(session, { home = os.homedir() } = {}) {
  const id = stoppingSessionId(session);
  if (!id) return null;
  return stoppingSnapshot(readSessions({ home })[id]);
}

/**
 * Start the stopping rule by fixing its candidate ceiling on the intuition session.
 * A different ceiling is rejected unless the caller says this is the explicit act
 * of changing it, which leaves a dated before/after trail for the later reader.
 */
export function configureStoppingRule({ session, candidateCap: requestedCap, intuition, explicitBudgetChange = false, now } = {}, { home = os.homedir() } = {}) {
  try {
    const id = stoppingSessionId(session);
    const cap = candidateCap(requestedCap);
    if (!id || cap === null) return { ok: false, message: 'Stopping rule needs a session id and a candidate cap between 2 and 100.' };
    const timerSeconds = Number(intuition?.timerSeconds);
    const intuitionCap = Number(intuition?.cap);
    if (!Number.isFinite(timerSeconds) || timerSeconds < 0 || !Number.isInteger(intuitionCap) || intuitionCap < 1) {
      return { ok: false, message: 'Stopping rule belongs to a valid intuition session.' };
    }
    const sessions = readSessions({ home });
    const existing = sessions[id];
    const at = now ?? new Date().toISOString();
    if (existing?.stopping) {
      const stopping = existing.stopping;
      if (stopping.candidateCap !== cap && !explicitBudgetChange) {
        return { ok: false, message: `Candidate cap is ${stopping.candidateCap}. Changing it requires an explicit recorded budget change.` };
      }
      if (stopping.candidateCap !== cap) {
        stopping.budgetChanges = Array.isArray(stopping.budgetChanges) ? stopping.budgetChanges : [];
        stopping.budgetChanges.push({ from: stopping.candidateCap, to: cap, at });
        stopping.candidateCap = cap;
        stopping.calibrationCandidateCap = Math.max(2, Math.ceil(cap / 3));
      }
      existing.intuition = { session: id, timerSeconds, cap: intuitionCap };
      sessions[id] = existing;
      writeSessions(sessions, { home });
      return { ok: true, session: stoppingSnapshot(existing) };
    }

    const record = {
      v: STORE_VERSION,
      id,
      startedAt: at,
      intuition: { session: id, timerSeconds, cap: intuitionCap },
      stopping: {
        candidateCap: cap,
        calibrationCandidateCap: Math.max(2, Math.ceil(cap / 3)),
        seenCandidateIds: [],
        calibrationCandidateIds: [],
        budgetChanges: [],
        phase: 'calibration',
        derivedBar: null,
        adjustedBar: null,
        winner: null,
      },
    };
    sessions[id] = record;
    writeSessions(sessions, { home });
    return { ok: true, session: stoppingSnapshot(record) };
  } catch {
    return { ok: false, message: 'Could not save the stopping-rule commitment.' };
  }
}

/** Record a candidate only when this session actually deals it. */
export function recordStoppingCandidates(session, candidateIds, { home = os.homedir() } = {}) {
  try {
    const id = stoppingSessionId(session);
    const sessions = readSessions({ home });
    const record = id ? sessions[id] : null;
    const stopping = record?.stopping;
    if (!stopping) return null;
    const ids = Array.isArray(candidateIds) ? candidateIds : [];
    for (const raw of ids) {
      if (typeof raw !== 'string' || !raw || stopping.seenCandidateIds.includes(raw)) continue;
      if (stopping.seenCandidateIds.length >= stopping.candidateCap) break;
      stopping.seenCandidateIds.push(raw);
      if (stopping.phase === 'calibration' && stopping.calibrationCandidateIds.length < stopping.calibrationCandidateCap) {
        stopping.calibrationCandidateIds.push(raw);
      }
    }
    if (stopping.phase === 'calibration' && stopping.calibrationCandidateIds.length >= stopping.calibrationCandidateCap) {
      stopping.phase = 'bar-review';
    }
    sessions[id] = record;
    writeSessions(sessions, { home });
    return stoppingSnapshot(record);
  } catch {
    return null;
  }
}

export function saveDerivedStoppingBar(session, derivedBar, { home = os.homedir() } = {}) {
  try {
    const id = stoppingSessionId(session);
    const sessions = readSessions({ home });
    const record = id ? sessions[id] : null;
    if (!record?.stopping || record.stopping.phase !== 'bar-review') return null;
    record.stopping.derivedBar = stoppingSnapshot(derivedBar);
    sessions[id] = record;
    writeSessions(sessions, { home });
    return stoppingSnapshot(record);
  } catch {
    return null;
  }
}

/** The review action locks the bar. A second adjustment is deliberately refused. */
export function lockStoppingBar(session, value, { home = os.homedir(), now } = {}) {
  try {
    const id = stoppingSessionId(session);
    const sessions = readSessions({ home });
    const record = id ? sessions[id] : null;
    const stopping = record?.stopping;
    if (!stopping?.derivedBar) return { ok: false, message: 'There is no derived bar to lock yet.' };
    if (stopping.adjustedBar) return { ok: false, message: 'The stopping bar is already fixed for this session.' };
    const derived = Number(stopping.derivedBar.value);
    const requested = Number(value);
    const chosen = Number.isFinite(requested) ? requested : derived;
    if (!Number.isFinite(chosen)) return { ok: false, message: 'The model could not form a numeric bar, so a numeric adjustment is required.' };
    stopping.adjustedBar = { value: chosen, at: now ?? new Date().toISOString(), adjusted: Number.isFinite(derived) && chosen !== derived };
    stopping.phase = 'selection';
    sessions[id] = record;
    writeSessions(sessions, { home });
    return { ok: true, session: stoppingSnapshot(record) };
  } catch {
    return { ok: false, message: 'Could not lock the stopping bar.' };
  }
}

/** A terminal winner is recorded once. A stopped session never deals another pair. */
export function finishStoppingRule(session, winner, { home = os.homedir(), now } = {}) {
  try {
    const id = stoppingSessionId(session);
    const sessions = readSessions({ home });
    const record = id ? sessions[id] : null;
    const stopping = record?.stopping;
    if (!stopping || stopping.winner || !winner?.id) return null;
    stopping.winner = { id: winner.id, label: winner.label ?? winner.id, reason: winner.reason ?? 'cleared', at: now ?? new Date().toISOString() };
    stopping.phase = 'complete';
    sessions[id] = record;
    writeSessions(sessions, { home });
    return stoppingSnapshot(record);
  } catch {
    return null;
  }
}

/**
 * Register a candidate. Deduped by id against the file, because a screen offered in
 * two rounds is one candidate and two registry lines would double its weight in
 * every count that follows. Returns false for a duplicate as well as for a failure:
 * neither is a caller's problem.
 */
export function appendCandidate(candidate, { home = os.homedir(), now } = {}) {
  try {
    const id = candidate?.id;
    if (typeof id !== 'string' || id === '') return false;
    if (readCandidates({ home }).some((row) => row?.id === id)) return false;
    const screen = copyCandidateScreen(candidate, { home, id });

    const record = {
      v: STORE_VERSION,
      id,
      label: candidate.label ?? id,
      screen,
      world: candidate.world ?? null,
      // Lineage is the reason a recombined child is inspectable at all; an empty
      // array means "not bred from anything", which is true of every genesis screen.
      parents: Array.isArray(candidate.parents)
        ? candidate.parents.filter((parent) => typeof parent === 'string' && parent)
        : [],
      project: candidate.project ?? null,
      at: now ?? candidate.at ?? new Date().toISOString(),
    };
    const subject = typeof candidate.subject === 'string' ? candidate.subject.trim() : '';
    if (subject) record.subject = subject;
    appendLine(tastePaths(home).candidates, record);
    return true;
  } catch {
    return false;
  }
}

function isDurableScreen(screen, { home }) {
  if (typeof screen !== 'string' || !screen) return false;
  const root = path.resolve(tastePaths(home).screens);
  const resolved = path.resolve(screen);
  return resolved === root || resolved.startsWith(`${root}${path.sep}`);
}

/**
 * Copy registered screens into the global corpus and rewrite only their canonical
 * paths. Existing durable paths and unreadable JSONL lines pass through untouched.
 * The source files stay where they are.
 */
export function migrateScreens({ home = os.homedir() } = {}) {
  const report = { copied: [], alreadyDurable: [], missing: [], failed: [] };
  const file = tastePaths(home).candidates;
  let lines;
  try {
    lines = fs.readFileSync(file, 'utf8').split('\n');
  } catch {
    return report;
  }

  let changed = false;
  const rewritten = lines.map((line) => {
    if (!line) return line;
    let row;
    try { row = JSON.parse(line); } catch { return line; }
    if (!row || typeof row !== 'object' || typeof row.id !== 'string' || !row.id) return line;
    if (isDurableScreen(row.screen, { home })) {
      report.alreadyDurable.push(row.id);
      return line;
    }
    if (typeof row.screen !== 'string' || !row.screen || !fs.existsSync(row.screen)) {
      report.missing.push(row.id);
      warnScreen(`candidate ${row.id} has no readable screen at ${row.screen ?? '(none)'}`);
      return line;
    }

    const target = candidateScreenTarget(row.id, { home });
    if (!target) {
      report.failed.push(row.id);
      warnScreen(`candidate ${row.id} has an unsafe id, so migration left its screen at ${row.screen}`);
      return line;
    }

    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(row.screen, target);
      report.copied.push({ id: row.id, from: row.screen, to: target });
      changed = true;
      return JSON.stringify({ ...row, screen: target });
    } catch (error) {
      report.failed.push(row.id);
      warnScreen(`candidate ${row.id} screen could not be migrated from ${row.screen}: ${error?.message ?? String(error)}`);
      return line;
    }
  });

  if (changed) {
    try {
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, rewritten.join('\n'));
      fs.renameSync(tmp, file);
    } catch (error) {
      report.failed.push('candidates.jsonl');
      warnScreen(`candidate screen paths could not be rewritten: ${error?.message ?? String(error)}`);
    }
  }
  return report;
}

/**
 * Keep the fields that say what he pointed at and what he said about it. An
 * annotation with no candidate is dropped rather than guessed at: it belongs to one
 * side of the pair or it is not evidence about anything.
 */
function slimAnnotations(annotations) {
  if (!Array.isArray(annotations)) return [];
  return annotations.flatMap((note) => {
    if (!note || typeof note !== 'object') return [];
    if (typeof note.candidate !== 'string' || !note.candidate) return [];
    const kind = ANNOTATION_KINDS.has(note.kind) ? note.kind : 'note';
    const target = note.target && typeof note.target === 'object'
      ? {
        selector: note.target.selector ?? null,
        text: note.target.text ?? null,
        rect: note.target.rect ?? null,
      }
      : null;
    return [{
      candidate: note.candidate,
      kind,
      target,
      text: typeof note.text === 'string' ? note.text : '',
    }];
  });
}

/**
 * Attribute ids whose difference in this pair was an ACCIDENT rather than the
 * thing being compared: one screen was dark only because it had no light mode,
 * one had no hero image only because none existed yet. Kept as a plain list of
 * ids, deduped, and omitted from the record entirely when empty, so a normal
 * comparison keeps the shape it has always had.
 */
function slimConfounded(value) {
  const list = typeof value === 'string' ? [value] : Array.isArray(value) ? value : [];
  const out = [];
  for (const item of list) {
    if (typeof item !== 'string') continue;
    const id = item.trim();
    if (!id || out.includes(id)) continue;
    out.push(id);
  }
  return out;
}

/** Timing is optional. An absent field belongs to the pre-intuition ledger. */
function slimResponseMs(value) {
  const ms = Number(value);
  return Number.isFinite(ms) && ms > 0 ? Math.round(ms) : null;
}

/** Keep a malformed external row from deleting or dominating evidence. */
function slimWeight(value) {
  const weight = Number(value);
  if (!Number.isFinite(weight) || weight <= 0) return null;
  return Math.min(1.25, Math.max(0.35, weight));
}

function slimIntuition(value) {
  if (!value || typeof value !== 'object') return null;
  const session = typeof value.session === 'string' ? value.session.trim() : '';
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(session)) return null;
  const timerSeconds = Number(value.timerSeconds);
  const cap = Number(value.cap);
  return {
    session,
    timerSeconds: Number.isFinite(timerSeconds) && timerSeconds >= 0 ? timerSeconds : 0,
    cap: Number.isInteger(cap) && cap > 0 ? cap : 8,
  };
}

/**
 * Record one comparison. Rejects a half-shape (missing side, a candidate compared
 * with itself, an outcome outside the three) rather than storing it, because a
 * malformed row silently poisons every fit downstream and there is no later moment
 * at which anyone would notice.
 */
export function appendComparison(comparison, { home = os.homedir(), now } = {}) {
  try {
    const a = comparison?.a;
    const b = comparison?.b;
    if (typeof a !== 'string' || !a) return false;
    if (typeof b !== 'string' || !b || a === b) return false;
    if (!OUTCOMES.has(comparison.outcome)) return false;

    const record = {
      v: STORE_VERSION,
      at: now ?? comparison.at ?? new Date().toISOString(),
      project: comparison.project ?? null,
      a,
      b,
      outcome: comparison.outcome,
      source: comparison.source === 'text' || comparison.source === 'timeout' ? comparison.source : 'click',
      annotations: slimAnnotations(comparison.annotations),
    };
    const responseMs = slimResponseMs(comparison.responseMs);
    const timedOut = comparison.timedOut === true;
    // A timeout is only meaningful as a tie with the elapsed time recorded. Keeping
    // either fact without the other creates exactly the false confidence this field
    // exists to prevent.
    if (timedOut && (comparison.outcome !== 'tie' || responseMs === null)) return false;
    if (responseMs !== null) record.responseMs = responseMs;
    if (timedOut) record.timedOut = true;
    const weight = timedOut ? 0.35 : slimWeight(comparison.weight);
    if (weight !== null) record.weight = weight;
    const intuition = slimIntuition(comparison.intuition);
    if (intuition) record.intuition = intuition;
    const confounded = slimConfounded(comparison.confounded);
    if (confounded.length > 0) record.confounded = confounded;
    appendLine(tastePaths(home).comparisons, record);
    return true;
  } catch {
    return false;
  }
}

/**
 * Mark a comparison already on file as confounded on one or more attributes.
 *
 * THE ONLY REWRITE IN THIS LEDGER, and it exists so the alternative never gets
 * used. When a pair turns out to have differed on something nobody chose, the
 * instinct is to delete the row. Deleting throws away a genuine judgement about
 * two screens to protect one axis; marking keeps the judgement and disqualifies
 * the axis. The fit reads the mark and drops that attribute's evidence from this
 * row alone.
 *
 * Matches on the pair in either order, optionally narrowed by `at` when the same
 * two screens were compared more than once. Returns how many rows were marked,
 * so a selector that matched nothing is visible instead of looking like success.
 * Marks accumulate: a second call naming a different attribute keeps the first.
 *
 * Lines this module cannot parse are copied through byte for byte rather than
 * dropped. A rewrite that quietly discards a truncated line would turn one bad
 * append into permanent data loss.
 */
export function markConfounded(selector, attributes, { home = os.homedir() } = {}) {
  try {
    const add = slimConfounded(attributes);
    const a = selector?.a;
    const b = selector?.b;
    if (add.length === 0) return 0;
    if (typeof a !== 'string' || !a || typeof b !== 'string' || !b) return 0;
    const at = typeof selector?.at === 'string' && selector.at ? selector.at : null;

    const file = tastePaths(home).comparisons;
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    let marked = 0;
    const next = lines.map((line) => {
      if (!line) return line;
      let row;
      try { row = JSON.parse(line); } catch { return line; }
      if (!row || typeof row !== 'object') return line;
      const samePair = (row.a === a && row.b === b) || (row.a === b && row.b === a);
      if (!samePair) return line;
      if (at && row.at !== at) return line;
      const merged = slimConfounded(row.confounded);
      for (const id of add) if (!merged.includes(id)) merged.push(id);
      marked += 1;
      return JSON.stringify({ ...row, confounded: merged });
    });
    if (marked === 0) return 0;

    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, next.join('\n'));
    fs.renameSync(tmp, file);
    return marked;
  } catch {
    return 0;
  }
}

export function readAttributes({ home = os.homedir() } = {}) {
  try {
    const parsed = JSON.parse(fs.readFileSync(tastePaths(home).attributes, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { attributes: [], vectors: {} };
    return {
      attributes: Array.isArray(parsed.attributes)
        ? parsed.attributes.filter((row) => row && typeof row.id === 'string' && row.id)
        : [],
      vectors: parsed.vectors && typeof parsed.vectors === 'object' && !Array.isArray(parsed.vectors)
        ? parsed.vectors
        : {},
    };
  } catch {
    return { attributes: [], vectors: {} };
  }
}

/**
 * Write via a temp file and a rename. This is the one store here that is not
 * append-only, and it holds the entire learned vocabulary plus every vector: a
 * process killed halfway through a plain write truncates all of it, and there is
 * nothing to reconstruct it from. Rename is atomic within a filesystem.
 */
function writeAttributes(state, { home }) {
  const target = tastePaths(home).attributes;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
  fs.renameSync(tmp, target);
}

/**
 * Filler that carries no signal about a design. Deliberately short: polarity words
 * are NOT in here, because dropping "high" would merge "high contrast" into "low
 * contrast" and produce an attribute that means nothing at all.
 */
const STOP_WORDS = new Set(['a', 'an', 'the', 'of', 'and', 'or', 'with', 'very', 'more']);

/** Crude English singulariser. Consistency matters more than linguistic accuracy: a
 * wrong-but-stable stem still maps every spelling of one word to one key. */
function singular(token) {
  if (token.length > 4 && token.endsWith('ies')) return `${token.slice(0, -3)}y`;
  if (token.length > 4 && /(?:ss|sh|ch|x|z)es$/.test(token)) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
  return token;
}

/** NFKD first so an accented label decomposes to letters the split can keep. */
function labelTokens(label) {
  return String(label ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map(singular)
    .filter((token) => !STOP_WORDS.has(token));
}

/**
 * Two keys per label, and a proposal merges into an existing attribute when EITHER
 * matches. They catch different collisions and both are cheap:
 *
 *   order  sorted tokens, so word order and punctuation stop mattering
 *          ("generous whitespace" = "Generous Whitespace" = "whitespace, generous")
 *   glue   tokens joined with nothing, so a split compound is one word
 *          ("generous white space" = "generous whitespace")
 *
 * WHAT THIS DELIBERATELY DOES NOT CATCH, so nobody assumes more than is here:
 *   - derivational forms: "whitespace generosity" does not reach "generous
 *     whitespace", because "generosity" and "generous" share no stem under a rule
 *     set this small, and real stemming would start merging things that differ.
 *   - synonyms with no shared token: "airy" and "generous whitespace" stay apart.
 *   - antonym pairs stay apart on purpose, which is the reason polarity words are
 *     not stop words.
 * The backstop for all three is the profile itself: duplicates show up next to each
 * other in `renderProfile` output, where a human can see them.
 */
function attributeKeys(label) {
  const parts = labelTokens(label);
  if (parts.length === 0) return null;
  return { order: [...parts].sort().join('-'), glue: parts.join('') };
}

function slugify(label) {
  const slug = String(label)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'attribute';
}

/** Ids are slugged from the first label seen, so they read like the thing they name. */
function uniqueId(label, attributes) {
  const base = slugify(label);
  let id = base;
  let suffix = 2;
  while (attributes.some((row) => row.id === id)) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }
  return id;
}

/**
 * Fold this round's proposed attributes into the stored vocabulary.
 *
 * Returns `{ added, merged, attributes }`: `added` the records created, `merged` the
 * proposals folded into something that already existed as `{ label, into }`, and
 * `attributes` the whole vocabulary afterwards. Counting is per call, not per
 * proposal, so a round that proposes the same thing twice bumps `comparisons` once.
 *
 * Keys are recomputed from the stored labels on every call and never persisted. That
 * costs a few string operations and buys the thing that matters: when the
 * normalisation rules improve, the next write re-merges the existing vocabulary
 * instead of leaving fossils behind a stale key.
 */
export function mergeAttributes(proposed, { home = os.homedir(), now } = {}) {
  const state = readAttributes({ home });
  const attributes = state.attributes.map((row) => ({ ...row }));
  const added = [];
  const merged = [];
  try {
    const batch = Array.isArray(proposed) ? proposed : (proposed ? [proposed] : []);
    const at = now ?? new Date().toISOString();
    const counted = new Set();

    for (const raw of batch) {
      const item = typeof raw === 'string' ? { label: raw } : raw;
      if (!item || typeof item !== 'object') continue;
      const label = typeof item.label === 'string' && item.label.trim()
        ? item.label.trim()
        : (typeof item.id === 'string' ? item.id : '');
      const keys = attributeKeys(label);
      if (!keys) continue;

      // An explicit id that already exists wins over label matching: a model handed
      // the current vocabulary and reusing an id from it is being more precise than
      // its own choice of wording that round.
      let existing = typeof item.id === 'string' && item.id
        ? attributes.find((row) => row.id === item.id)
        : undefined;
      if (!existing) {
        existing = attributes.find((row) => {
          const other = attributeKeys(row.label);
          return other && (other.order === keys.order || other.glue === keys.glue);
        });
      }

      if (existing) {
        // A later round often explains an attribute the first one only named.
        if (!existing.description && typeof item.description === 'string' && item.description.trim()) {
          existing.description = item.description.trim();
        }
        if (!counted.has(existing.id)) {
          existing.comparisons = Number.isFinite(existing.comparisons) ? existing.comparisons + 1 : 1;
          counted.add(existing.id);
        }
        merged.push({ label, into: existing.id });
        continue;
      }

      const record = {
        id: uniqueId(label, attributes),
        label,
        description: typeof item.description === 'string' ? item.description.trim() : '',
        firstSeen: at,
        comparisons: 1,
      };
      attributes.push(record);
      counted.add(record.id);
      added.push(record);
    }

    writeAttributes({ attributes, vectors: state.vectors }, { home });
  } catch {
    // Keep whatever was assembled. A vocabulary the caller can still use in memory
    // beats throwing in the middle of his comparison round.
  }
  return { added, merged, attributes };
}

/**
 * Set how strongly one candidate exhibits some attributes, 0 to 1.
 *
 * Merges rather than replaces, because a round scores the attributes it proposed and
 * says nothing about the rest; replacing would silently reset every earlier reading
 * to absent. Values clamp into range. A non-numeric value is DROPPED rather than
 * clamped to 0: a NaN arriving here is a bug upstream, and recording it as "this
 * design has none of that attribute" would launder the bug into evidence.
 *
 * Returns the candidate's merged vector.
 */
export function setVector(candidateId, values, { home = os.homedir() } = {}) {
  try {
    if (typeof candidateId !== 'string' || !candidateId) return {};
    const state = readAttributes({ home });
    const current = { ...(state.vectors[candidateId] ?? {}) };
    const incoming = values && typeof values === 'object' && !Array.isArray(values) ? values : {};
    for (const [attrId, raw] of Object.entries(incoming)) {
      const value = Number(raw);
      if (!Number.isFinite(value)) continue;
      current[attrId] = Math.min(1, Math.max(0, value));
    }
    writeAttributes({ attributes: state.attributes, vectors: { ...state.vectors, [candidateId]: current } }, { home });
    return current;
  } catch {
    return {};
  }
}

/**
 * One key per unordered pair, and it must not be ambiguous. With a plain join, the
 * ids `a:b` + `c` and `a` + `b:c` collide, and their comparison counts silently
 * merge. The length prefix settles it: the leading number says exactly where the
 * first id ends, so no id content can produce the same key twice. `appendCandidate`
 * takes `id` verbatim with no charset check, so nothing upstream of here rules any
 * separator out on its own.
 *
 * A NUL byte did this job until 2026-07-29 and cost three false "the feature is
 * missing" readings in one session: two NUL bytes make `file(1)` call the whole file
 * binary, and plain grep then returns silence rather than "no match". A pair key is
 * never persisted (it lives only in the `asked` map below), so the format was free
 * to change. `tests/source-bytes.test.mjs` now keeps control bytes out of source.
 */
function pairKey(a, b) {
  const [first, second] = a < b ? [a, b] : [b, a];
  return `${first.length}:${first}:${second}`;
}

/**
 * A pair with an unasked question in it always beats one without. These two numbers
 * only have to dominate the base score, which lives in [0, 1) by construction.
 */
const UNSEEN_PAIR_BONUS = 1;
const COLD_CANDIDATE_BONUS = 2;

/**
 * Choose the two screens to put in front of him next.
 *
 * THE RULE, PLAINLY: prefer the pair whose outcome is least predictable under the
 * current Bradley-Terry fit, weighted by how unsure we are of the gap between them.
 * `4 * p * (1 - p)` is 1 at a coin flip and 0 at a foregone conclusion;
 * `var / (1 + var)` squashes the variance of `theta_a - theta_b` into 0 to 1 so the
 * two terms are comparable. Their product is the base score. Already-asked pairs
 * divide it by how many times they were asked.
 *
 * THIS IS A PROXY FOR EXPECTED INFORMATION GAIN, NOT A D-OPTIMAL DESIGN. A proper
 * design would maximise the determinant of the Fisher information over the whole
 * remaining schedule; this maximises one pair's contribution to it, ignores the
 * covariance term in `var(theta_a - theta_b)`, and is greedy rather than
 * forward-looking. It is cheap, it has no tuning surface, and it gets the ordering
 * right in the regime that matters here, which is a dozen clicks and not a thousand.
 *
 * THE TWO BONUSES ARE THE PART THAT IS NOT NEGOTIABLE. A candidate with zero
 * comparisons carries no information at all, and a freshly recombined child is
 * always in exactly that state. Left to the base score alone, a child could sit
 * unasked forever behind pairs that merely look uncertain, and the population step
 * would quietly stop working. So a cold endpoint adds 2 and an unasked pair adds 1,
 * which puts them in strictly higher bands than any base score can reach: cold pairs
 * first, then unasked pairs, then the least settled repeat.
 *
 * `model` is a fitted result from `fitBradleyTerry`, or nothing. With nothing, every
 * candidate reads as theta 0 and se 1, which is the honest cold-start position and
 * leaves the bonuses to do the ordering.
 */
export function nextPair({ home = os.homedir(), candidates, comparisons, model } = {}) {
  try {
    const source = Array.isArray(candidates) ? candidates : readCandidates({ home });
    const ids = [];
    const known = new Set();
    const subjectById = new Map();
    for (const entry of source) {
      const id = typeof entry === 'string' ? entry : entry?.id;
      if (typeof id !== 'string' || !id || known.has(id)) continue;
      known.add(id);
      ids.push(id);
      const subject = typeof entry === 'object' && typeof entry?.subject === 'string'
        ? entry.subject.trim()
        : '';
      if (subject) subjectById.set(id, subject);
    }
    if (ids.length < 2) return null;

    const rows = Array.isArray(comparisons) ? comparisons : readComparisons({ home });
    const asked = new Map();
    const seenBy = new Map();
    for (const row of rows) {
      if (!row || !known.has(row.a) || !known.has(row.b) || row.a === row.b) continue;
      const key = pairKey(row.a, row.b);
      asked.set(key, (asked.get(key) ?? 0) + 1);
      seenBy.set(row.a, (seenBy.get(row.a) ?? 0) + 1);
      seenBy.set(row.b, (seenBy.get(row.b) ?? 0) + 1);
    }

    const theta = new Map();
    const stderrOf = new Map();
    for (const row of model?.strengths ?? []) {
      if (!row || typeof row.id !== 'string') continue;
      theta.set(row.id, Number.isFinite(row.theta) ? row.theta : 0);
      stderrOf.set(row.id, Number.isFinite(row.se) && row.se >= 0 ? row.se : 1);
    }

    let best = null;
    let bestScore = -Infinity;
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const a = ids[i];
        const b = ids[j];
        const subjectA = subjectById.get(a);
        const subjectB = subjectById.get(b);
        if (subjectA && subjectB && subjectA !== subjectB) continue;
        const repeats = asked.get(pairKey(a, b)) ?? 0;
        const cold = (seenBy.get(a) ? 0 : 1) + (seenBy.get(b) ? 0 : 1);

        const gap = (theta.get(a) ?? 0) - (theta.get(b) ?? 0);
        const p = 1 / (1 + Math.exp(-gap));
        const seA = stderrOf.get(a) ?? 1;
        const seB = stderrOf.get(b) ?? 1;
        const variance = seA * seA + seB * seB;
        const base = (4 * p * (1 - p)) * (variance / (1 + variance)) / (1 + repeats);

        const score = base
          + (repeats === 0 ? UNSEEN_PAIR_BONUS : 0)
          + COLD_CANDIDATE_BONUS * cold;

        // Strictly greater, so ties fall to registry order and the same store always
        // proposes the same pair.
        if (score > bestScore) {
          bestScore = score;
          best = { a, b, cold, repeats, p };
        }
      }
    }
    if (!best) return null;

    let reason;
    if (best.cold === 2) reason = 'neither has been compared yet';
    else if (best.cold === 1) reason = `${seenBy.get(best.a) ? best.b : best.a} has never been compared`;
    else if (best.repeats === 0) reason = `not asked yet, and the outcome looks close (p=${best.p.toFixed(2)})`;
    else reason = `nothing left unasked; re-asking the least settled pair (asked ${best.repeats}x)`;

    return { a: best.a, b: best.b, reason };
  } catch {
    return null;
  }
}

// Run the CLI only when this module is the entry point. Compare realpaths, same as
// signature.mjs and world-pool.mjs: generated skills are reached through symlinked
// harness dirs, and a plain path.resolve(argv[1]) comparison silently exits 0 there,
// which already cost this project one blocker bug. fileURLToPath, not URL.pathname,
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

/**
 * The maths lives in taste-model.mjs and is loaded here and nowhere else, so a
 * missing or broken model degrades the CLI instead of breaking every write path in
 * this file. Returns null when it cannot be loaded.
 */
async function loadModel() {
  try {
    return await import('./taste-model.mjs');
  } catch {
    return null;
  }
}

if (invokedAsScript()) {
  const args = process.argv.slice(2);
  const paths = tastePaths();

  if (args.includes('--path')) {
    process.stdout.write(`${JSON.stringify(paths)}\n`);
    process.exit(0);
  }

  if (args.includes('--migrate-screens')) {
    const report = migrateScreens();
    for (const item of report.copied) {
      process.stdout.write(`copied ${item.id}: ${item.from} -> ${item.to}\n`);
    }
    process.stdout.write(`${report.copied.length} copied, ${report.alreadyDurable.length} already durable, ${report.missing.length} missing, ${report.failed.length} failed\n`);
    process.exit(report.failed.length > 0 ? 1 : 0);
  }

  if (args.includes('--profile')) {
    const comparisons = readComparisons();
    if (comparisons.length < 1) {
      // Exit 3, not an empty profile: a profile printed from nothing reads as "he
      // has no preferences" when the truth is that nobody has asked him yet.
      process.stderr.write(`not enough taste yet: 0 comparisons recorded (${paths.comparisons}); run a compare round first\n`);
      process.exit(3);
    }
    const model = await loadModel();
    if (!model) {
      process.stderr.write('taste-model.mjs could not be loaded; the profile needs it\n');
      process.exit(1);
    }
    const { attributes, vectors } = readAttributes();
    const ids = readCandidates().map((row) => row.id);
    const weights = model.fitAttributeWeights(comparisons, { vectors, attributes });
    process.stdout.write(`${model.renderProfile(weights, { attributes })}\n`);

    const cycles = model.detectCycles(comparisons, { candidates: ids });
    if (cycles.length) {
      // A cycle is not noise to be averaged away: it means he judged on two criteria
      // at once, and the tension is the finding.
      process.stdout.write('\nCYCLES\n');
      for (const cycle of cycles) {
        process.stdout.write(`${cycle.cycle.join(' > ')} > ${cycle.cycle[0]}\n`);
        for (const tension of model.cycleTensions(cycle.cycle, { vectors, attributes }).slice(0, 3)) {
          process.stdout.write(`  in tension: ${tension.attribute}\n`);
        }
      }
    }
    process.exit(0);
  }

  if (args.includes('--next')) {
    const comparisons = readComparisons();
    const candidates = readCandidates();
    const model = await loadModel();
    let fit = null;
    try {
      // A model that is absent, or present and unhappy, must not stop the round: the
      // bonuses alone still produce a sane cold-start pair.
      if (model) fit = model.fitBradleyTerry(comparisons, { candidates: candidates.map((row) => row.id) });
    } catch {
      fit = null;
    }
    const pair = nextPair({ candidates, comparisons, model: fit });
    if (!pair) {
      process.stderr.write(`no pair to offer: fewer than two candidates registered (${paths.candidates})\n`);
      process.exit(3);
    }
    process.stdout.write(`${JSON.stringify(pair)}\n`);
    process.exit(0);
  }

  process.stdout.write('usage: taste-store.mjs --profile | --next | --path | --migrate-screens\n');
  process.exit(0);
}
