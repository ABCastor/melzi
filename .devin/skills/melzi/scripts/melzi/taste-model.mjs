/**
 * The taste model: turn "I prefer this one" into something that can judge a
 * design he has never seen.
 *
 * FORK-ONLY. Upstream has no equivalent, so this file carries zero merge burden.
 * Pure math, zero IO, zero imports. Everything here is a function of its inputs,
 * which is deliberate: this is the one module where a silent error is invisible
 * to the person it is about.
 *
 * WHY THIS EXISTS. The owner has said plainly that he cannot review a design. He
 * can reliably say WHICH OF THESE TWO, and he can point at a thing he dislikes.
 * So the tool has to learn from binary choices plus pointing. The obvious way to
 * do that is to score each candidate and keep the winners, and it is wrong: a
 * per-candidate score dies with the candidate. The next screen is a new screen
 * and the score has nothing to say about it. Only a model over ATTRIBUTES
 * generalizes, because attributes are the part that travels. That is the whole
 * reason `fitAttributeWeights` and `scoreDesign` exist, and it is why
 * `scoreDesign` on a never-compared candidate is the payload of the feature
 * rather than a nicety.
 *
 * WHY THE UNCERTAINTY IS TREATED AS SERIOUSLY AS THE ESTIMATE. The failure mode
 * that costs him most is not a missing answer, it is a confident wrong one. He
 * cannot check the statement "you prefer generous whitespace" against anything;
 * he has to take it. So every number here ships with a standard error, the
 * verdict `neutral` comes from a confidence interval crossing zero rather than
 * from a magnitude threshold, and `renderProfile` says out loud how thin the
 * evidence is. "Neutral on serif vs sans" has to be an honest statement about
 * evidence, not a rounding artifact.
 *
 * THE TWO TRAPS THAT ARE ALREADY HANDLED, SO NOBODY REMOVES THEM BY ACCIDENT:
 *
 * 1. Bradley-Terry without a prior diverges. After three clicks an undefeated
 *    candidate is the NORMAL state, and the unregularized maximum likelihood
 *    estimate for it is +infinity. `prior` adds fictitious wins and losses
 *    against a virtual average opponent, which keeps every theta finite. It is
 *    not a tuning knob to be zeroed for "purity"; zero it and the first real
 *    session produces Infinity.
 *
 * 2. The logistic fit has NO intercept, and its features are antisymmetric by
 *    construction (`x_a - x_b`). Add an intercept and the model happily learns
 *    "the left panel is better", which is a fact about the comparison UI and not
 *    about his taste. The absence of that term is a correctness property, and
 *    the test suite proves it by mirroring a dataset and demanding identical
 *    weights.
 *
 * CONFOUNDED COMPARISONS. A comparison may carry `confounded: ['attr-id', ...]`,
 * naming the attributes whose difference between the two screens was an ACCIDENT
 * rather than the thing being compared. The case that bought this: two screens
 * put side by side where one was light and the other dark, not because either was
 * designed that way but because one simply had no mode control. His preference
 * between those two screens was real and belongs in the record. His preference
 * for dark grounds was never expressed, and a fit that reads one off that
 * comparison is not weakly wrong, it is confidently wrong on an axis nobody
 * tested.
 *
 * The fix is per attribute, not per comparison. `fitAttributeWeights` zeroes the
 * named feature on that row, which means the row contributes nothing to that
 * attribute's gradient, nothing to its curvature, and therefore nothing to its
 * weight or its certainty, while still contributing to every other attribute.
 * `fitBradleyTerry` never reads the field at all, because the outcome itself was
 * a genuine judgement about those two screens. Throwing the whole comparison away
 * would discard that judgement to protect one axis.
 *
 * WHAT MARKING DOES NOT BUY, and it must be said out loud somewhere: the other
 * attributes now have to explain an outcome that the accidental axis may in fact
 * have caused, so their weights absorb a little of it. A mark is damage control
 * on a comparison already taken, never as good as a pair that was matched
 * properly. That is why `flagLikelyConfound` exists, to catch the shape before he
 * ever clicks.
 *
 * TIES. A tie counts as half a win to each side, in both fits. Davidson (1970)
 * is the principled alternative: it adds an explicit tie parameter and models
 * the probability of a draw rather than splitting it. It is not taken here
 * because it costs another parameter estimated from the same handful of clicks,
 * and because a tie in this tool means "these two are close enough that I do not
 * care", which half-a-win-each represents adequately.
 */

/* ------------------------------------------------------------------ *
 * Small dense linear algebra. Written out rather than pulled in: this
 * module must stay dependency-free, and the matrices here are tiny.
 * ------------------------------------------------------------------ */

function zeros(rows, cols) {
  return Array.from({ length: rows }, () => new Array(cols).fill(0));
}

/**
 * Gauss-Jordan inverse with partial pivoting. Returns null when the matrix is
 * singular, because a caller that gets null reports Infinity for the standard
 * error, which is the honest answer, and a caller that gets a silently wrong
 * inverse reports a confident wrong one.
 */
export function invertMatrix(matrix) {
  const n = Array.isArray(matrix) ? matrix.length : 0;
  if (n === 0) return [];
  const a = matrix.map((row, i) => {
    const copy = new Array(2 * n).fill(0);
    for (let j = 0; j < n; j += 1) copy[j] = Number(row[j]) || 0;
    copy[n + i] = 1;
    return copy;
  });

  for (let col = 0; col < n; col += 1) {
    // Partial pivoting: swap in the row with the largest magnitude in this
    // column. Without it a legitimate matrix with a tiny leading entry loses
    // most of its precision on the way through.
    let pivot = col;
    for (let r = col + 1; r < n; r += 1) {
      if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    }
    if (!Number.isFinite(a[pivot][col]) || Math.abs(a[pivot][col]) < 1e-12) return null;
    if (pivot !== col) { const t = a[pivot]; a[pivot] = a[col]; a[col] = t; }

    const d = a[col][col];
    for (let j = 0; j < 2 * n; j += 1) a[col][j] /= d;

    for (let r = 0; r < n; r += 1) {
      if (r === col) continue;
      const factor = a[r][col];
      if (factor === 0) continue;
      for (let j = 0; j < 2 * n; j += 1) a[r][j] -= factor * a[col][j];
    }
  }

  return a.map((row) => row.slice(n));
}

/* ------------------------------------------------------------------ *
 * Input normalizing. Every entry point takes either records or bare ids
 * and never throws on junk, because these come off disk in Module 2.
 * ------------------------------------------------------------------ */

function idsOf(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const item of list) {
    if (typeof item === 'string' && item) out.push(item);
    else if (item && typeof item.id === 'string' && item.id) out.push(item.id);
  }
  return out;
}

/** Build the id universe: the registry first, then anything a comparison names. */
function universe(candidates, rows) {
  const ids = [];
  const index = new Map();
  const add = (id) => {
    if (typeof id !== 'string' || !id || index.has(id)) return;
    index.set(id, ids.length);
    ids.push(id);
  };
  idsOf(candidates).forEach(add);
  for (const r of rows) {
    if (!r) continue;
    add(r.a);
    add(r.b);
  }
  return { ids, index };
}

/**
 * Weighted win counts. `w[i][j]` is how often i beat j, with a tie contributing
 * half to each direction.
 */
export const RESPONSE_WEIGHT_MIN = 0.5;
export const RESPONSE_WEIGHT_MAX = 1.25;
export const TIMEOUT_WEIGHT = 0.35;
/** Below this a click cannot be a judgement about the screens. See weightForResponseMs. */
export const SUSPECT_RESPONSE_MS = 150;

/**
 * Turn a measured response time into bounded evidence.
 *
 * The mapping is deliberately piecewise on a log scale. It gives a response at
 * three seconds ordinary weight (1), makes a 200ms reflex only 25% stronger
 * (a reflex can be a mis-click), and holds any answer at or beyond 30 seconds
 * at 0.5 so a deliberated choice still counts. A timeout is lower at 0.35: it
 * is a real tie, but it also says the person could not decide under the agreed
 * pressure. Neither bound is zero or unbounded, because either would quietly
 * delete or let one row dominate a fit.
 */
export function weightForResponseMs(responseMs, { timedOut = false } = {}) {
  if (timedOut) return TIMEOUT_WEIGHT;
  const ms = Number(responseMs);
  if (!Number.isFinite(ms) || ms <= 0) return 1;
  // Below the floor a click cannot be ABOUT the two screens. Simple visual reaction
  // time alone runs 200 to 250ms, and this is a two-alternative choice over full
  // page renders, which is slower still. So an answer under 150ms did not involve
  // seeing and comparing anything: it is a double-click, a held key, or a click
  // landing as the next pair swaps in. That last case is not hypothetical here,
  // because intuition mode deals pairs on a three-second timer, which is exactly
  // the setup that produces stray clicks.
  //
  // It gets the FLOOR rather than the ceiling. Treating it as the strongest
  // evidence in the ledger, which is what a plain "faster is better" curve does,
  // would let a misfire outvote every considered choice he ever made. We cannot
  // tell a genuine reflex from a slip, so we decline to reward it either way.
  if (ms < SUSPECT_RESPONSE_MS) return RESPONSE_WEIGHT_MIN;
  if (ms <= 250) return RESPONSE_WEIGHT_MAX;
  if (ms <= 3000) {
    const progress = Math.log(ms / 250) / Math.log(3000 / 250);
    return RESPONSE_WEIGHT_MAX - 0.25 * progress;
  }
  if (ms <= 30000) {
    const progress = Math.log(ms / 3000) / Math.log(30000 / 3000);
    return 1 - (1 - RESPONSE_WEIGHT_MIN) * progress;
  }
  return RESPONSE_WEIGHT_MIN;
}

/** Missing timing is legacy full evidence, not a measurement of slowness. */
function comparisonWeight(row) {
  const value = Number(row?.weight);
  if (!Number.isFinite(value) || value <= 0) return 1;
  return Math.min(RESPONSE_WEIGHT_MAX, Math.max(TIMEOUT_WEIGHT, value));
}

function winMatrix(rows, index, n, { weighted = true } = {}) {
  const w = zeros(n, n);
  for (const r of rows) {
    if (!r) continue;
    const i = index.get(r.a);
    const j = index.get(r.b);
    if (i === undefined || j === undefined || i === j) continue;
    const weight = weighted ? comparisonWeight(r) : 1;
    if (r.outcome === 'a') w[i][j] += weight;
    else if (r.outcome === 'b') w[j][i] += weight;
    else if (r.outcome === 'tie') { w[i][j] += 0.5 * weight; w[j][i] += 0.5 * weight; }
  }
  return w;
}

/* ------------------------------------------------------------------ *
 * Bradley-Terry
 * ------------------------------------------------------------------ */


/**
 * Fit per-candidate strengths from pairwise outcomes.
 *
 * Model: P(i beats j) = exp(theta_i) / (exp(theta_i) + exp(theta_j)).
 * Fitted by the MM algorithm of Hunter (2004), which is a handful of lines,
 * cannot overshoot, and increases the likelihood at every step.
 *
 * THE PRIOR IS THE POINT. Each candidate is given `prior` fictitious wins and
 * `prior` fictitious losses against a virtual opponent pinned at the average
 * (theta = 0). Two things follow. First, an undefeated candidate can no longer
 * run away to infinity, because it now has a loss on the books. Second, the
 * scale is anchored, so the fit is identified before any centering happens.
 * With `prior = 0` this function reproduces the plain MLE, which is exactly the
 * thing that breaks after three clicks.
 *
 * `theta` is mean-centered on the way out. That is presentation, not fitting:
 * only differences between thetas mean anything, and centering makes the
 * numbers readable (positive is above average) without changing any difference.
 *
 * Standard errors come from the Fisher information evaluated at the fit, with
 * one row and column dropped for identifiability, inverted, then mapped back
 * through the centering contrast. Results are sorted strongest first, ties in
 * theta broken by id, so the order is deterministic and usable as a ranking.
 *
 * `iterations` counts accelerated cycles, each of which is two or three MM
 * sweeps; see the SQUAREM note in the loop for why the acceleration is there.
 */
export function fitBradleyTerry(comparisons, { candidates, prior = 0.5, tol = 1e-9, maxIter = 500 } = {}) {
  const rows = Array.isArray(comparisons) ? comparisons : [];
  const { ids, index } = universe(candidates, rows);
  const n = ids.length;
  if (n === 0) return { strengths: [], converged: true, iterations: 0, tiedGroups: [] };

  const w = winMatrix(rows, index, n);
  const pairCount = zeros(n, n);
  const wins = new Array(n).fill(0);
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      if (i === j) continue;
      pairCount[i][j] = w[i][j] + w[j][i];
      wins[i] += w[i][j];
    }
  }

  const lambda = Math.max(0, Number(prior) || 0);

  /** One MM sweep. Strength scale, p = exp(theta); the virtual opponent is p = 1. */
  const sweep = (cur) => {
    const next = new Array(n).fill(1);
    for (let i = 0; i < n; i += 1) {
      const numerator = wins[i] + lambda;
      let denominator = (2 * lambda) / (cur[i] + 1);
      for (let j = 0; j < n; j += 1) {
        if (i === j || pairCount[i][j] === 0) continue;
        denominator += pairCount[i][j] / (cur[i] + cur[j]);
      }
      // A candidate with no games and no prior has nothing to estimate; leave it
      // at the average rather than dividing by zero.
      next[i] = denominator > 0 && numerator > 0 ? numerator / denominator : cur[i];
    }
    return next;
  };

  const logLikAt = (cur) => {
    let total = 0;
    for (let i = 0; i < n; i += 1) {
      for (let j = 0; j < n; j += 1) {
        if (i === j || w[i][j] === 0) continue;
        total += w[i][j] * Math.log(cur[i] / (cur[i] + cur[j]));
      }
      if (lambda > 0) total += lambda * Math.log(cur[i] / (cur[i] + 1)) + lambda * Math.log(1 / (cur[i] + 1));
    }
    return total;
  };

  let p = new Array(n).fill(1);
  let converged = false;
  let iterations = 0;

  while (iterations < maxIter) {
    const p1 = sweep(p);
    const p2 = sweep(p1);
    let candidate = p2;

    // SQUAREM (Varadhan and Roland, 2008) over two MM sweeps. Plain MM converges
    // here, but linearly and slowly: a few hundred comparisons need tens of
    // thousands of sweeps to settle at 1e-9. That matters because `converged`
    // would otherwise report false on a fit that is correct to four decimals,
    // and a false alarm about reliability is exactly the kind of dishonest
    // output this module is built to avoid. The accelerated step has the same
    // fixed point as the sweep it accelerates; it is guarded by the likelihood,
    // so a bad extrapolation is discarded rather than accepted.
    const l0 = p.map(Math.log);
    const l1 = p1.map(Math.log);
    const l2 = p2.map(Math.log);
    const r = l1.map((v, i) => v - l0[i]);
    const v = l2.map((x, i) => x - l1[i] - r[i]);
    const rn = r.reduce((a, x) => a + x * x, 0);
    const vn = v.reduce((a, x) => a + x * x, 0);
    if (rn > 0 && vn > 1e-30 && Number.isFinite(rn) && Number.isFinite(vn)) {
      let alpha = -Math.sqrt(rn / vn);
      const floor = logLikAt(p2);
      for (let back = 0; back < 12 && alpha < -1; back += 1) {
        const trial = l0.map((x, i) => Math.exp(x - 2 * alpha * r[i] + alpha * alpha * v[i]));
        if (trial.every((x) => Number.isFinite(x) && x > 0)) {
          const stabilized = sweep(trial);
          if (logLikAt(stabilized) >= floor) { candidate = stabilized; break; }
        }
        alpha = (alpha - 1) / 2; // Walk back toward the plain MM step.
      }
    }

    let delta = 0;
    for (let i = 0; i < n; i += 1) {
      delta = Math.max(delta, Math.abs(Math.log(candidate[i]) - Math.log(p[i])));
    }
    p = candidate;
    iterations += 1;
    // Convergence is judged on the parameters alone, never on the likelihood
    // flattening out. Those two are not interchangeable here: without a prior
    // the likelihood of an undefeated candidate approaches a supremum it never
    // reaches, so a likelihood-based rule would report `converged: true` on a
    // fit whose true answer is infinity. A false "still working" costs a
    // caller nothing; a false "this is settled" is the confident wrong answer
    // this module exists to avoid.
    if (Number.isFinite(delta) && delta < tol) { converged = true; break; }
    if (!Number.isFinite(delta)) break;
  }

  const rawTheta = p.map((v) => Math.log(v));
  const finite = rawTheta.filter((v) => Number.isFinite(v));
  const mean = finite.length === n && n > 0 ? finite.reduce((a, b) => a + b, 0) / n : 0;
  const theta = rawTheta.map((v) => v - mean);

  const se = standardErrors({ p, pairCount, lambda, n });

  const strengths = ids
    .map((id, i) => ({ id, theta: theta[i], se: se[i] }))
    .sort((x, y) => (y.theta - x.theta) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));

  return { strengths, converged, iterations, tiedGroups: tiedGroupsOf(strengths) };
}

/**
 * Fisher information for the Bradley-Terry log-likelihood in theta space, then
 * the reduced inverse mapped back to the mean-centered parametrization.
 *
 *   I_ii = sum_j n_ij * pi_ij * (1 - pi_ij)   (plus the virtual opponent's term)
 *   I_ij = -n_ij * pi_ij * (1 - pi_ij)
 *
 * The last row and column are dropped before inverting. That is the standard
 * move for a model identified only up to a shift: it fixes the last candidate as
 * the reference. The inverse is then embedded back into an n by n matrix with a
 * zero row and column, and pushed through the centering contrast
 * C = I - (1/n) * ones, which converts "variance relative to the reference" into
 * "variance relative to the mean", the parametrization the reported theta uses.
 */
function standardErrors({ p, pairCount, lambda, n }) {
  if (n === 1) return [0]; // With one candidate the centered theta is exactly 0.

  const info = zeros(n, n);
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      if (i === j) continue;
      const c = pairCount[i][j];
      if (c === 0) continue;
      const s = p[i] + p[j];
      const v = (c * p[i] * p[j]) / (s * s);
      info[i][i] += v;
      info[i][j] -= v;
    }
    if (lambda > 0) {
      const s = p[i] + 1;
      info[i][i] += (2 * lambda * p[i]) / (s * s);
    }
  }

  const reduced = zeros(n - 1, n - 1);
  for (let i = 0; i < n - 1; i += 1) {
    for (let j = 0; j < n - 1; j += 1) reduced[i][j] = info[i][j];
  }
  const inv = invertMatrix(reduced);
  if (!inv) return new Array(n).fill(Infinity);

  // Embed, with the reference candidate's row and column at zero.
  const cov = zeros(n, n);
  for (let i = 0; i < n - 1; i += 1) {
    for (let j = 0; j < n - 1; j += 1) cov[i][j] = inv[i][j];
  }

  // Centering: var_i = C_i . cov . C_i, where C_i = e_i - 1/n.
  const rowMeans = cov.map((row) => row.reduce((a, b) => a + b, 0) / n);
  const grandMean = rowMeans.reduce((a, b) => a + b, 0) / n;
  const out = new Array(n).fill(0);
  for (let i = 0; i < n; i += 1) {
    const v = cov[i][i] - 2 * rowMeans[i] + grandMean;
    out[i] = v > 0 ? Math.sqrt(v) : 0;
  }
  return out;
}

/**
 * Pairs whose strengths are not distinguishable at 95%: |theta_a - theta_b| is
 * smaller than 1.96 * sqrt(se_a^2 + se_b^2). This is the contract's formula and
 * it treats the two estimates as independent, which they are not; see the open
 * concerns in the module's delivery note.
 */
function tiedGroupsOf(strengths) {
  const out = [];
  for (let i = 0; i < strengths.length; i += 1) {
    for (let j = i + 1; j < strengths.length; j += 1) {
      const a = strengths[i];
      const b = strengths[j];
      const spread = Math.sqrt(a.se * a.se + b.se * b.se);
      if (!Number.isFinite(spread)) { out.push([a.id, b.id]); continue; }
      if (Math.abs(a.theta - b.theta) < 1.96 * spread) out.push([a.id, b.id]);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Attribute weights: the part that generalizes
 * ------------------------------------------------------------------ */

function attributeList(attributes) {
  const ids = idsOf(attributes);
  const labels = new Map();
  if (Array.isArray(attributes)) {
    for (const a of attributes) {
      if (typeof a === 'string') labels.set(a, a);
      else if (a && typeof a.id === 'string') labels.set(a.id, a.label || a.id);
    }
  }
  return { ids, labels };
}

function vectorFor(vectors, id, attrIds) {
  const v = (vectors && vectors[id]) || {};
  return attrIds.map((k) => {
    const x = Number(v[k]);
    return Number.isFinite(x) ? x : 0;
  });
}

const logistic = (z) => (z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)));

/* ------------------------------------------------------------------ *
 * Confounds: an attribute whose difference in a pair was an accident
 * ------------------------------------------------------------------ */

/** Case, spacing and punctuation removed, so `Dark ground` reaches `dark-ground`. */
function normalizeKey(text) {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

/** The field, tolerated as one id or a list of them. Anything else is no marks. */
function confoundedIdsOf(row) {
  const raw = row?.confounded;
  if (typeof raw === 'string') return raw.trim() ? [raw.trim()] : [];
  if (!Array.isArray(raw)) return [];
  return raw.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim());
}

/**
 * Map a written confound onto an attribute index: exact id first, then the
 * normalized id, then the normalized label.
 *
 * The unmatched case is returned rather than swallowed, and the caller reports
 * it. A typo in a confound is the worst failure this feature has: it looks like
 * the axis was protected, and it was not, and the person the profile is about
 * cannot possibly check.
 */
function confoundResolver(attrIds, labels) {
  const exact = new Map();
  const loose = new Map();
  attrIds.forEach((id, i) => {
    exact.set(id, i);
    const key = normalizeKey(id);
    if (key && !loose.has(key)) loose.set(key, i);
  });
  attrIds.forEach((id, i) => {
    const key = normalizeKey(labels.get(id) || '');
    if (key && !loose.has(key)) loose.set(key, i);
  });
  return (raw) => {
    if (exact.has(raw)) return exact.get(raw);
    const key = normalizeKey(raw);
    return key && loose.has(key) ? loose.get(key) : -1;
  };
}

/** How far apart two candidates sit on each attribute, widest first. */
function attributeGaps(vectorA, vectorB, attributes) {
  const va = vectorA && typeof vectorA === 'object' ? vectorA : {};
  const vb = vectorB && typeof vectorB === 'object' ? vectorB : {};
  const { ids, labels } = attributeList(attributes);
  const keys = ids.length > 0
    ? ids
    : Array.from(new Set([...Object.keys(va), ...Object.keys(vb)]));
  const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);
  return keys
    .map((id) => ({ attribute: id, label: labels.get(id) || id, gap: Math.abs(num(va[id]) - num(vb[id])) }))
    .sort((x, y) => (y.gap - x.gap) || (x.attribute < y.attribute ? -1 : 1));
}

/**
 * The pre-flight check: does this pair have the SHAPE of an uncontrolled variable?
 *
 * One attribute miles apart while every other one is nearly matched is what it
 * looks like when a difference was not chosen: one screen simply had the thing
 * and the other simply did not. The caller is told to fix the pair before asking,
 * because a verdict on that pair will be read as a verdict on that one axis
 * whether or not anybody meant it that way.
 *
 * IT CANNOT TELL AN ACCIDENT FROM A DELIBERATE A/B, and pretending otherwise
 * would be the same confident-wrong-answer failure in a new place. A pair built
 * on purpose to isolate one axis has exactly this shape and is the best possible
 * evidence about it. So the return is a suspicion with the axis named, and the
 * question it asks is whether that difference was intended. If it was, ask.
 * If it was not, match the two screens or mark the answer as confounded.
 */
export const CONFOUND_DOMINANT_GAP = 0.6;
export const CONFOUND_QUIET_GAP = 0.2;

export function flagLikelyConfound(vectorA, vectorB, {
  attributes = [],
  dominant = CONFOUND_DOMINANT_GAP,
  quiet = CONFOUND_QUIET_GAP,
  candidateA = null,
  candidateB = null,
} = {}) {
  const subjectOf = (candidate) => (
    typeof candidate?.subject === 'string' && candidate.subject.trim()
      ? candidate.subject.trim()
      : null
  );
  const subjectA = subjectOf(candidateA);
  const subjectB = subjectOf(candidateB);
  const quietly = (message) => ({
    refused: false,
    suspected: false,
    attribute: null,
    label: null,
    gap: 0,
    runnerUp: 0,
    message,
  });

  if (subjectA && subjectB && subjectA !== subjectB) {
    return {
      ...quietly(''),
      refused: true,
      subjects: { a: subjectA, b: subjectB },
      message: `Refusing this comparison: ${subjectA} and ${subjectB} are different subjects. Pairwise taste compares renditions of one thing.`,
    };
  }

  const gaps = attributeGaps(vectorA, vectorB, attributes);
  if (gaps.length < 2) {
    return quietly('Fewer than two attributes are scored on this pair, so there is nothing to tell a controlled pair apart from an uncontrolled one.');
  }
  const [top, next] = gaps;
  if (top.gap < dominant || next.gap > quiet) {
    return quietly('These two differ on more than one axis, which is what a fair comparison looks like.');
  }
  return {
    refused: false,
    suspected: true,
    attribute: top.attribute,
    label: top.label,
    gap: top.gap,
    runnerUp: next.gap,
    message: `These two screens are near twins except for ${top.label}. Whatever he picks will be read as a verdict on ${top.label}, so make sure that difference is the thing you meant to ask about. If one screen simply cannot do it, fix the pair and ask again rather than recording the answer; if the answer is already taken, mark it confounded on ${top.attribute} instead of deleting it.`,
  };
}

/**
 * Fit how much each attribute pulls a choice, from the same pairwise outcomes.
 *
 * This is a logistic regression with NO intercept on the antisymmetric feature
 * x_a - x_b. Both halves of that sentence are load-carrying:
 *
 *   - antisymmetric features mean the model is the same whichever candidate
 *     happens to be shown on the left, which is what makes the fit a statement
 *     about taste rather than about the layout of the comparison screen;
 *   - no intercept means there is nowhere for a side bias to live. Give the
 *     model an intercept and it will find one, because the UI has one.
 *
 * L2 is mandatory. Early on there are more attributes than comparisons, and an
 * unpenalized fit in that regime is not merely uncertain, it is unidentified:
 * infinitely many weight vectors explain the data equally well and the solver
 * picks one at random. The penalty picks the smallest, which is the one that
 * claims the least.
 *
 * A tie enters as two half-weight observations, one in each direction, which is
 * the same half-a-win convention the strength fit uses.
 *
 * `se` is taken from the inverse of the penalized curvature, so it is the width
 * of a posterior credible interval under the Gaussian prior the L2 term implies,
 * not a frequentist confidence interval. The distinction matters for a
 * statistician and not for the verdict: `neutral` still means the interval
 * covers zero, which is the honest reading of "the evidence does not say".
 *
 * A row's `confounded` list zeroes those features on that row and nothing else.
 * A zero feature contributes nothing to its own gradient and nothing to its own
 * curvature, so the attribute gets no weight and no certainty out of it, while
 * the row still trains every other attribute and still counts in `comparisons`.
 * How many rows were set aside per attribute is reported on the weight, because
 * an attribute quietly holding less evidence than the headline count is how a
 * profile ends up looking more settled than it is.
 *
 * A row may also carry a bounded `weight` from a measured response time. It scales
 * the whole observation, including both halves of a tie, after confounded features
 * are zeroed. Missing weights are legacy rows and mean ordinary full evidence.
 */
export function fitAttributeWeights(comparisons, { vectors = {}, attributes = [], l2 = 1.0, maxIter = 500, tol = 1e-9 } = {}) {
  const { ids: attrIds, labels } = attributeList(attributes);
  const k = attrIds.length;
  const rows = Array.isArray(comparisons) ? comparisons : [];
  const resolveConfound = confoundResolver(attrIds, labels);

  // Design rows: feature vector, outcome, observation weight.
  const design = [];
  const setAside = new Array(k).fill(0);
  const unknownConfounds = [];
  let used = 0;
  for (const r of rows) {
    if (!r || typeof r.a !== 'string' || typeof r.b !== 'string' || r.a === r.b) continue;
    if (r.outcome !== 'a' && r.outcome !== 'b' && r.outcome !== 'tie') continue;
    const xa = vectorFor(vectors, r.a, attrIds);
    const xb = vectorFor(vectors, r.b, attrIds);
    const x = xa.map((v, i) => v - xb[i]);
    for (const raw of confoundedIdsOf(r)) {
      const at = resolveConfound(raw);
      if (at === -1) {
        // Named but unmatched. Reported, never swallowed: a mark that hits
        // nothing looks exactly like a mark that worked.
        if (!unknownConfounds.includes(raw)) unknownConfounds.push(raw);
        continue;
      }
      // Only a real difference was evidence, so only a real difference can be
      // set aside. Marking an axis the two screens already matched on costs
      // nothing and must not be reported as a loss.
      if (x[at] !== 0) setAside[at] += 1;
      x[at] = 0;
    }
    used += 1;
    const weight = comparisonWeight(r);
    if (r.outcome === 'a') design.push({ x, y: 1, w: weight });
    else if (r.outcome === 'b') design.push({ x, y: 0, w: weight });
    else { design.push({ x, y: 1, w: 0.5 * weight }); design.push({ x, y: 0, w: 0.5 * weight }); }
  }

  const penalty = Math.max(0, Number(l2) || 0);
  if (k === 0) return { weights: [], converged: true, logLik: 0, comparisons: used, unknownConfounds };

  let beta = new Array(k).fill(0);
  let converged = false;

  for (let iter = 0; iter < maxIter; iter += 1) {
    const grad = new Array(k).fill(0);
    const hess = zeros(k, k);
    for (const row of design) {
      let z = 0;
      for (let i = 0; i < k; i += 1) z += beta[i] * row.x[i];
      const pr = logistic(z);
      const resid = row.w * (row.y - pr);
      const curve = row.w * pr * (1 - pr);
      for (let i = 0; i < k; i += 1) {
        grad[i] += resid * row.x[i];
        if (curve === 0) continue;
        for (let j = 0; j < k; j += 1) hess[i][j] += curve * row.x[i] * row.x[j];
      }
    }
    for (let i = 0; i < k; i += 1) {
      grad[i] -= penalty * beta[i];
      hess[i][i] += penalty;
    }

    const inv = invertMatrix(hess);
    if (!inv) break; // No penalty and a degenerate design: stop and report it.

    const step = new Array(k).fill(0);
    let biggest = 0;
    for (let i = 0; i < k; i += 1) {
      let s = 0;
      for (let j = 0; j < k; j += 1) s += inv[i][j] * grad[j];
      step[i] = s;
      biggest = Math.max(biggest, Math.abs(s));
    }
    // Cap the first few strides. Newton is exact near the optimum and wild far
    // from it, and a separable dataset is exactly "far from it".
    const scale = biggest > 4 ? 4 / biggest : 1;
    for (let i = 0; i < k; i += 1) beta[i] += scale * step[i];
    if (biggest * scale < tol) { converged = true; break; }
  }

  // Data log-likelihood, unpenalized, so it can be compared across L2 settings.
  let logLik = 0;
  for (const row of design) {
    let z = 0;
    for (let i = 0; i < k; i += 1) z += beta[i] * row.x[i];
    const pr = Math.min(1 - 1e-12, Math.max(1e-12, logistic(z)));
    logLik += row.w * (row.y === 1 ? Math.log(pr) : Math.log(1 - pr));
  }

  const se = weightErrors(design, beta, penalty, k);
  const weights = attrIds.map((id, i) => {
    const weight = beta[i];
    const err = se[i];
    const decisive = Number.isFinite(err) && err > 0 && Math.abs(weight) > 1.96 * err;
    return {
      id,
      label: labels.get(id) || id,
      weight,
      se: err,
      verdict: !decisive ? 'neutral' : weight > 0 ? 'prefers' : 'dislikes',
      confounded: setAside[i],
    };
  });

  return { weights, converged, logLik, comparisons: used, unknownConfounds };
}

function weightErrors(design, beta, penalty, k) {
  const hess = zeros(k, k);
  for (const row of design) {
    let z = 0;
    for (let i = 0; i < k; i += 1) z += beta[i] * row.x[i];
    const pr = logistic(z);
    const curve = row.w * pr * (1 - pr);
    if (curve === 0) continue;
    for (let i = 0; i < k; i += 1) {
      for (let j = 0; j < k; j += 1) hess[i][j] += curve * row.x[i] * row.x[j];
    }
  }
  for (let i = 0; i < k; i += 1) hess[i][i] += penalty;
  const inv = invertMatrix(hess);
  if (!inv) return new Array(k).fill(Infinity);
  return inv.map((row, i) => (row[i] > 0 ? Math.sqrt(row[i]) : Infinity));
}

/**
 * Score a design that has never been compared with anything. This is the whole
 * point of the attribute layer: the input is a vector, not an id, so a screen
 * generated one second ago can be judged by everything he has said so far.
 *
 * The score is the weighted sum of the point estimates, neutral attributes
 * included. Dropping the neutrals would look tidier and be worse: an attribute
 * whose evidence is thin still carries the best guess available, and zeroing it
 * throws that guess away in favour of a different guess (that it does not
 * matter) with no more evidence behind it.
 *
 * Only differences between scores mean anything. The absolute number has no
 * unit and should never be shown to a person as a grade.
 */
export function scoreDesign(vector, weights) {
  const list = Array.isArray(weights) ? weights : Array.isArray(weights?.weights) ? weights.weights : [];
  const v = vector && typeof vector === 'object' ? vector : {};
  let total = 0;
  for (const entry of list) {
    if (!entry || typeof entry.id !== 'string') continue;
    const value = Number(v[entry.id]);
    const weight = Number(entry.weight);
    if (!Number.isFinite(value) || !Number.isFinite(weight)) continue;
    total += weight * value;
  }
  return total;
}

/**
 * Derive the stopping bar on the same score scale used for unseen candidates.
 *
 * The highest point score would be the noisiest order statistic in a tiny
 * calibration set. We instead use the best candidate's one-standard-error lower
 * bound. It is still thin evidence, stated as such, but it does not turn one lucky
 * early score into a demanding threshold. The error is diagonal-only because this
 * fit exposes per-weight errors, not the full covariance matrix; the surface says
 * that it is a cautious estimate, never a confidence guarantee.
 */
export function deriveStoppingBar({ candidates = [], scoreCandidates = candidates, comparisons = [], attributes = [], vectors = {} } = {}) {
  const calibration = Array.isArray(candidates) ? candidates.filter((candidate) => candidate?.id) : [];
  const scored = Array.isArray(scoreCandidates) ? scoreCandidates.filter((candidate) => candidate?.id) : calibration;
  const fit = fitAttributeWeights(comparisons, { attributes, vectors });
  const weights = Array.isArray(fit?.weights) ? fit.weights : [];
  const usableWeights = weights.filter((weight) => Number.isFinite(weight?.weight) && Number.isFinite(weight?.se));
  const comparisonCount = Array.isArray(comparisons) ? comparisons.length : 0;
  const evidence = comparisonCount < 5
    ? `Built from ${comparisonCount} comparison${comparisonCount === 1 ? '' : 's'}. That is very little, so this bar is a first guess rather than a finding.`
    : `Built from ${comparisonCount} comparisons. The bar can still move as more evidence arrives.`;
  if (calibration.length === 0 || usableWeights.length === 0) {
    return {
      value: null,
      method: 'no separable calibration bar',
      spread: [],
      candidateScores: [],
      evidence: `${evidence} The calibration candidates cannot separate on shared recorded attributes, so no precise-looking threshold is being invented.`,
    };
  }
  const candidateScores = scored.flatMap((candidate) => {
    const vector = vectors?.[candidate.id];
    if (!vector || typeof vector !== 'object') return [];
    let used = 0;
    let variance = 0;
    for (const weight of usableWeights) {
      const value = Number(vector[weight.id]);
      if (!Number.isFinite(value)) continue;
      used += 1;
      variance += (value * weight.se) ** 2;
    }
    if (used === 0) return [];
    const score = scoreDesign(vector, usableWeights);
    const uncertainty = Math.sqrt(variance);
    return [{ id: candidate.id, label: candidate.label ?? candidate.id, score, uncertainty, lowerBound: score - uncertainty }];
  });
  if (candidateScores.length === 0) {
    return {
      value: null,
      method: 'no separable calibration bar',
      spread: [],
      candidateScores: [],
      evidence: `${evidence} The calibration candidates have no scored shared attributes, so no precise-looking threshold is being invented.`,
    };
  }
  const spread = candidateScores
    .filter((row) => calibration.some((candidate) => candidate.id === row.id))
    .sort((a, b) => b.lowerBound - a.lowerBound);
  if (spread.length === 0) {
    return {
      value: null,
      method: 'no separable calibration bar',
      spread: [],
      candidateScores,
      evidence: `${evidence} The calibration candidates have no scored shared attributes, so no precise-looking threshold is being invented.`,
    };
  }
  return {
    value: spread[0].lowerBound,
    method: 'best calibration lower bound',
    spread,
    candidateScores,
    evidence,
  };
}

/** A candidate clears only when its cautious lower bound reaches the fixed bar. */
export function candidateClearsStoppingBar(candidateScore, bar) {
  return Number.isFinite(candidateScore?.lowerBound) && Number.isFinite(Number(bar)) && candidateScore.lowerBound >= Number(bar);
}

/* ------------------------------------------------------------------ *
 * The readable profile
 * ------------------------------------------------------------------ */

const CLEAR_Z = 3;

/**
 * Render the learned profile as something a person with no statistics reads
 * correctly on the first pass.
 *
 * Three rules shape the output. Strongest signals first, because the top of the
 * list is the only part anyone reads. Neutrals last and named as neutrals, so
 * that "no opinion" is visibly different from "no data" and from "a weak
 * opinion". And a plain sentence about how much evidence there actually is,
 * before any of the claims, because four comparisons cannot support a sentence
 * that reads like a finding.
 *
 * Ordering is by the ratio of the weight to its own error, not by the raw
 * weight. A big weight with a big error is noise wearing a suit, and putting it
 * at the top is exactly the confident-wrong-statement failure this module is
 * built to avoid.
 *
 * A fourth rule, for the same reason as the third: any attribute whose evidence
 * was cut by a confound says so on its own line, and the report says how many
 * answers were set aside overall. The headline count is what a reader takes the
 * whole profile to rest on, so an attribute standing on less than that count has
 * to declare it or the profile reads as more settled than it is.
 */
export function renderProfile(weightResult, { attributes = [], limit = 12, comparisons } = {}) {
  const list = Array.isArray(weightResult?.weights) ? weightResult.weights : [];
  const { labels } = attributeList(attributes);
  const n = Number.isFinite(comparisons)
    ? comparisons
    : Number.isFinite(weightResult?.comparisons) ? weightResult.comparisons : null;

  const head = 'Your taste, as far as the comparisons show it.';
  if (list.length === 0) {
    return `${head}\n\nNothing to report yet: no attributes have been recorded, so there is nothing to have an opinion about.`;
  }

  const scored = list.map((entry) => {
    const err = Number(entry.se);
    const weight = Number(entry.weight) || 0;
    const z = Number.isFinite(err) && err > 0 ? Math.abs(weight) / err : 0;
    const label = labels.get(entry.id) || entry.label || entry.id;
    const band = entry.verdict === 'neutral' ? 'neutral' : z >= CLEAR_Z ? 'clear' : 'leaning';
    const claim = entry.verdict === 'neutral'
      ? `neutral on ${label}`
      : `${entry.verdict} ${label}`;
    // An attribute can be built on fewer comparisons than the headline count,
    // and the count is the only thing anyone reads. Say it on the line itself.
    const aside = Math.max(0, Math.round(Number(entry.confounded) || 0));
    const line = aside > 0
      ? `${claim} (${aside} comparison${aside === 1 ? '' : 's'} set aside here: the two screens differed on this by accident)`
      : claim;
    return { band, z, line, aside };
  });

  const rank = { clear: 0, leaning: 1, neutral: 2 };
  scored.sort((a, b) => (rank[a.band] - rank[b.band]) || (b.z - a.z));
  const shown = scored.slice(0, Math.max(1, Number(limit) || 12));
  const hidden = scored.length - shown.length;

  const out = [head, '', evidenceLine(n, list.length)];
  // Confounds shrink the evidence behind ONE line without touching the count at
  // the top, so the count is where a reader would be misled. Explain it there.
  const setAside = scored.reduce((sum, s) => sum + s.aside, 0);
  if (setAside > 0) {
    // No aggregate count here on purpose: one comparison can be set aside on two
    // attributes, so any single number would be arithmetic waiting to be wrong.
    // The per-line counts are the exact ones.
    out.push('', 'Some of those comparisons were set aside, one attribute at a time: the two screens differed there by accident rather than by choice, so the answer still counts for everything else and counts for nothing on that one axis. Every line below that says so rests on less evidence than the number above.');
  }
  const unknown = Array.isArray(weightResult?.unknownConfounds) ? weightResult.unknownConfounds : [];
  if (unknown.length > 0) {
    out.push('', `Check this: ${unknown.join(', ')} ${unknown.length === 1 ? 'was' : 'were'} marked as an accidental difference but ${unknown.length === 1 ? 'matches' : 'match'} no attribute on file, so nothing was set aside for ${unknown.length === 1 ? 'it' : 'them'}. A mark that hits nothing looks exactly like a mark that worked.`);
  }
  // Silence here is not the tool doing nothing. `scoreDesign` runs on the point
  // estimates, so the guesses are already steering which design gets picked;
  // what is missing is enough evidence to say any of it out loud. Without this
  // sentence an all-neutral profile reads as a broken feature.
  if (shown.every((s) => s.band === 'neutral')) {
    out.push('', 'Nothing can be claimed yet. The guesses behind these lines are already being used to choose between designs, so this is the tool declining to tell you something it cannot back, not the tool sitting idle.');
  }
  const sections = [
    ['clear', 'Clear so far'],
    ['leaning', 'Leaning, but this could still flip'],
    ['neutral', 'Not enough evidence either way'],
  ];
  for (const [band, title] of sections) {
    const rowsInBand = shown.filter((s) => s.band === band);
    if (rowsInBand.length === 0) continue;
    out.push('', title);
    for (const row of rowsInBand) out.push(`  ${row.line}`);
  }
  if (hidden > 0) out.push('', `${hidden} weaker signal${hidden === 1 ? '' : 's'} not shown.`);
  return out.join('\n');
}

function evidenceLine(n, attributeCount) {
  if (n === null) return 'Built from an unrecorded number of comparisons, so treat all of it as provisional.';
  if (n === 0) return 'Nothing has been compared yet, so every line below is a guess with no evidence behind it.';
  const thin = attributeCount > n
    ? ` There are ${attributeCount} attributes and only ${n} comparison${n === 1 ? '' : 's'}, so most of these are held near zero on purpose until more arrives.`
    : '';
  if (n < 5) return `Built from ${n} comparison${n === 1 ? '' : 's'}. That is very little: read every line below as a first guess, not a finding.${thin}`;
  if (n < 15) return `Built from ${n} comparisons. Still thin, so every line below can still flip.${thin}`;
  return `Built from ${n} comparisons. Enough to steer by, not enough to treat as law.${thin}`;
}

const INSTANT_RESPONSE_MS = 1000;
const DELIBERATE_RESPONSE_MS = 2500;
const TIMING_ATTRIBUTE_MINIMUM = 3;

/**
 * Explain response time in the same plain language as the ranking.
 *
 * Timing is attached only to attributes that actually differed on the row, and
 * confounded differences are excluded for the same reason they are excluded from
 * the fit. Three timed comparisons on one attribute is the minimum before this
 * names an immediate reaction or a deliberation. A slow response may describe a
 * genuinely close pair rather than an attribute that matters, so the result names
 * the observed pairings and refuses to call it a causal explanation.
 */
export function renderResponseTimeProfile(comparisons, { vectors = {}, attributes = [] } = {}) {
  const rows = Array.isArray(comparisons) ? comparisons : [];
  const { ids: attrIds, labels } = attributeList(attributes);
  const resolveConfound = confoundResolver(attrIds, labels);
  const timed = rows.filter((row) => Number.isFinite(Number(row?.responseMs)) && Number(row.responseMs) > 0);
  if (timed.length === 0) {
    return 'Response time has not been measured yet, so there is nothing honest to say about immediate reactions or deliberation.';
  }

  const values = timed.map((row) => Number(row.responseMs)).sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  const median = values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
  const quick = timed.filter((row) => !row.timedOut && Number(row.responseMs) <= INSTANT_RESPONSE_MS).length;
  const slow = timed.filter((row) => row.timedOut || Number(row.responseMs) >= DELIBERATE_RESPONSE_MS).length;
  const timeouts = timed.filter((row) => row.timedOut).length;
  const stats = new Map(attrIds.map((id) => [id, { seen: 0, quick: 0, slow: 0 }]));

  for (const row of timed) {
    if (typeof row?.a !== 'string' || typeof row?.b !== 'string') continue;
    const xa = vectorFor(vectors, row.a, attrIds);
    const xb = vectorFor(vectors, row.b, attrIds);
    const confounded = new Set(confoundedIdsOf(row).map(resolveConfound).filter((index) => index >= 0));
    for (let i = 0; i < attrIds.length; i += 1) {
      if (confounded.has(i) || xa[i] === xb[i]) continue;
      const entry = stats.get(attrIds[i]);
      entry.seen += 1;
      if (!row.timedOut && Number(row.responseMs) <= INSTANT_RESPONSE_MS) entry.quick += 1;
      if (row.timedOut || Number(row.responseMs) >= DELIBERATE_RESPONSE_MS) entry.slow += 1;
    }
  }

  const immediate = [];
  const deliberated = [];
  for (const [id, stat] of stats) {
    if (stat.seen < TIMING_ATTRIBUTE_MINIMUM) continue;
    const label = labels.get(id) || id;
    if (stat.quick >= TIMING_ATTRIBUTE_MINIMUM && stat.quick / stat.seen >= 2 / 3) immediate.push({ label, ...stat });
    if (stat.slow >= TIMING_ATTRIBUTE_MINIMUM && stat.slow / stat.seen >= 2 / 3) deliberated.push({ label, ...stat });
  }
  immediate.sort((a, b) => (b.quick / b.seen - a.quick / a.seen) || (b.seen - a.seen) || a.label.localeCompare(b.label));
  deliberated.sort((a, b) => (b.slow / b.seen - a.slow / a.seen) || (b.seen - a.seen) || a.label.localeCompare(b.label));

  const seconds = (ms) => ms < 1000 ? 'under a second' : `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} seconds`;
  const out = [
    `Response time: ${timed.length} timed comparison${timed.length === 1 ? '' : 's'}, typically ${seconds(median)}. ${quick} chose quickly and ${slow} took longer${timeouts ? `, including ${timeouts} timeout${timeouts === 1 ? '' : 's'}` : ''}.`,
  ];
  if (attrIds.length === 0) {
    out.push('No attributes are named yet, so timing cannot be connected to what differed between the screens.');
  } else if (immediate.length === 0 && deliberated.length === 0) {
    out.push(`Too early to say which attributes trigger an immediate reaction or deliberation. That needs ${TIMING_ATTRIBUTE_MINIMUM} timed comparisons involving the same attribute.`);
  } else {
    if (immediate.length > 0) out.push(`Instant reactions: ${immediate.map((entry) => `${entry.label} (${entry.quick} of ${entry.seen} quick)`).join(', ')}.`);
    if (deliberated.length > 0) out.push(`Took longer over: ${deliberated.map((entry) => `${entry.label} (${entry.slow} of ${entry.seen} slow or timed out)`).join(', ')}.`);
  }
  out.push('This describes these pairings, not an attribute’s inherent difficulty: a genuinely close pair can take longer than an obvious one.');
  return out.join('\n');
}

/* ------------------------------------------------------------------ *
 * Cycles: the places where a single ranking is the wrong shape
 * ------------------------------------------------------------------ */

/**
 * Find loops in his stated preferences: a beat b, b beat c, and c beat a.
 *
 * A cycle is not an error and it is not noise to be smoothed. It is the
 * signature of judging on two criteria at once, which is what a person actually
 * does. Bradley-Terry will happily fit a single ranking over a cycle and the
 * ranking will be a lie by averaging. Naming the loop lets `cycleTensions` say
 * what the two criteria were.
 *
 * The graph is the majority-preference digraph: a -> b when a beat b more often
 * than b beat a. Ties contribute half a win each way, so a pair that only ever
 * tied produces no edge, and neither does an evenly split pair.
 *
 * All 3-cycles are enumerated exactly. Longer loops are reported one per
 * strongly connected component that contains no 3-cycle, found by depth-first
 * search: enumerating every long cycle is exponential and buys nothing, since
 * one witness per component is enough to say "you were judging on two axes here".
 * Above `MAX_EXHAUSTIVE` candidates the triple scan is skipped and only the
 * component witnesses are returned, which is stated rather than silent.
 */
const MAX_EXHAUSTIVE = 200;

export function detectCycles(comparisons, { candidates } = {}) {
  const rows = Array.isArray(comparisons) ? comparisons : [];
  const { ids, index } = universe(candidates, rows);
  const n = ids.length;
  if (n < 3) return [];

  // A cycle is a record of contradictory stated choices, not a confidence fit.
  // Keep it unweighted so response-time weighting cannot make a real tension vanish.
  const w = winMatrix(rows, index, n, { weighted: false });
  const adj = Array.from({ length: n }, () => new Set());
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      if (i !== j && w[i][j] > w[j][i]) adj[i].add(j);
    }
  }

  const edgeFor = (i, j) => ({ from: ids[i], to: ids[j], wins: w[i][j], losses: w[j][i] });
  const seen = new Set();
  const out = [];
  const push = (idxCycle) => {
    const rotated = canonicalRotation(idxCycle);
    const key = rotated.join('>');
    if (seen.has(key)) return;
    seen.add(key);
    const edges = rotated.map((v, i) => edgeFor(v, rotated[(i + 1) % rotated.length]));
    out.push({ cycle: rotated.map((v) => ids[v]), edges });
  };

  if (n <= MAX_EXHAUSTIVE) {
    for (let i = 0; i < n; i += 1) {
      for (const j of adj[i]) {
        for (const k of adj[j]) {
          if (k !== i && adj[k].has(i)) push([i, j, k]);
        }
      }
    }
  }

  // Longer loops, one witness per component that produced no triangle.
  const covered = new Set(out.flatMap((c) => c.cycle));
  for (const comp of stronglyConnected(adj, n)) {
    if (comp.length < 3) continue;
    if (comp.some((v) => covered.has(ids[v]))) continue;
    const found = findCycleWithin(adj, comp);
    if (found) push(found);
  }

  return out;
}

/** Rotate so the smallest index leads, which makes a>b>c and b>c>a one cycle. */
function canonicalRotation(cycle) {
  let best = 0;
  for (let i = 1; i < cycle.length; i += 1) if (cycle[i] < cycle[best]) best = i;
  return cycle.slice(best).concat(cycle.slice(0, best));
}

/** Tarjan. The graphs here are a few dozen nodes, so recursion is safe. */
function stronglyConnected(adj, n) {
  const idx = new Array(n).fill(-1);
  const low = new Array(n).fill(0);
  const onStack = new Array(n).fill(false);
  const stack = [];
  const comps = [];
  let counter = 0;

  const strong = (v) => {
    idx[v] = counter;
    low[v] = counter;
    counter += 1;
    stack.push(v);
    onStack[v] = true;
    for (const u of adj[v]) {
      if (idx[u] === -1) { strong(u); low[v] = Math.min(low[v], low[u]); }
      else if (onStack[u]) low[v] = Math.min(low[v], idx[u]);
    }
    if (low[v] === idx[v]) {
      const comp = [];
      for (;;) {
        const u = stack.pop();
        onStack[u] = false;
        comp.push(u);
        if (u === v) break;
      }
      comps.push(comp);
    }
  };

  for (let v = 0; v < n; v += 1) if (idx[v] === -1) strong(v);
  return comps;
}

/** First back-edge found by DFS inside one component gives one real cycle. */
function findCycleWithin(adj, comp) {
  const inComp = new Set(comp);
  const position = new Map();
  const path = [];
  const visited = new Set();

  const walk = (v) => {
    position.set(v, path.length);
    path.push(v);
    visited.add(v);
    for (const u of adj[v]) {
      if (!inComp.has(u)) continue;
      if (position.has(u)) return path.slice(position.get(u));
      if (!visited.has(u)) {
        const found = walk(u);
        if (found) return found;
      }
    }
    path.pop();
    position.delete(v);
    return null;
  };

  return walk(comp[0]);
}

/**
 * Name the attributes a cycle was fought over.
 *
 * Walk the loop in the direction he preferred, and for each attribute take the
 * winner-minus-loser difference on every edge. Some edges support the attribute
 * (the winner had more of it) and some contradict it. Around a closed loop those
 * two totals are ALWAYS equal, because differences around a cycle sum to zero.
 * That identity is not a quirk of the measure, it is the reason a cycle exists:
 * no single attribute can explain a loop, so any attribute that varies across it
 * is partly arguing against itself.
 *
 * `disagreement` is that shared total: how much of the loop the attribute both
 * explains and contradicts. An attribute held constant across the cycle scores
 * zero and is dropped, because it cannot be what he was trading off. Strongest
 * disagreement first, so the top of the list is the axis to ask him about.
 *
 * Never average a cycle away. The right response to one is to ask which of the
 * two named attributes matters more in the case at hand.
 */
export function cycleTensions(cycle, { vectors = {}, attributes = [] } = {}) {
  const nodes = Array.isArray(cycle) ? cycle : Array.isArray(cycle?.cycle) ? cycle.cycle : [];
  const ring = nodes.filter((id) => typeof id === 'string' && id);
  if (ring.length < 3) return [];

  const { ids: attrIds, labels } = attributeList(attributes);
  const out = [];
  for (const attr of attrIds) {
    let support = 0;
    let oppose = 0;
    let saw = false;
    for (let i = 0; i < ring.length; i += 1) {
      const winner = Number((vectors[ring[i]] || {})[attr]);
      const loser = Number((vectors[ring[(i + 1) % ring.length]] || {})[attr]);
      const d = (Number.isFinite(winner) ? winner : 0) - (Number.isFinite(loser) ? loser : 0);
      if (d > 0) { support += d; saw = true; }
      else if (d < 0) { oppose -= d; saw = true; }
    }
    if (!saw) continue;
    const disagreement = Math.min(support, oppose);
    if (disagreement <= 1e-12) continue;
    out.push({ attribute: attr, label: labels.get(attr) || attr, disagreement });
  }

  return out.sort((a, b) => (b.disagreement - a.disagreement) || (a.attribute < b.attribute ? -1 : 1));
}
