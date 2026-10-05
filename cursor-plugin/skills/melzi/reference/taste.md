# Taste: learn what he picks, apply it to what he has not seen

The user can say which of two screens he prefers, and he can point at a thing he dislikes. He cannot say what is good, and asking him to produces a made-up answer that then steers everything downstream. This flow takes the two judgements he makes reliably and turns them into a model that scores a design he has never looked at. That last part is the point of the whole loop: a ranking of the candidates in front of him is worth nothing on the next surface, and only a model over attributes carries across.

The store is `~/.impeccable/taste/`, beside the genesis ledger, because taste is a property of the person and not of a repo.

## 1. When this runs

After a genesis hand exists, or any time two or more candidate screens are worth comparing: two directions in a redesign, two renditions of one world, a child screen against the parent it came from.

Never as the first step in a fresh project. There is nothing to compare, and a profile fitted on nothing still prints a confident-looking answer with no evidence under it. Build first, through [genesis.md](genesis.md) or [new-work.md](new-work.md), then come back here with screens in hand.

`node <skill-base-dir>/scripts/melzi/taste-store.mjs --profile` exits 3 while there are fewer than one comparison on file. Read exit 3 as "not yet", never as a failure to retry.

## 2. The loop

One pass is: ask for a pair, show it, collect the verdict, confirm it was recorded, name the attributes. Then repeat.

1. `node <skill-base-dir>/scripts/melzi/taste-store.mjs --next` prints the next valid pair as JSON, chosen because its outcome is the least predictable one available. It never deals two different known subjects. Take the pair it deals. Substituting your own defeats the selection and buys fewer bits per click.
2. `node <skill-base-dir>/scripts/melzi/serve-compare.mjs --schema` for the exact input shape, then `--start` with the two candidates. It daemonizes and prints a URL and a key: open that URL for the user, in-app browser first, then the system opener, then showing the URL.
3. `--wait --key <key>` collects the verdict, repeating while it exits 3. The answer carries `outcome` (`a`, `b`, or `tie`), every annotation he dropped on either screen, and any steer he typed.
4. The server records the click as part of accepting it and prints whether the store write succeeded. Never append the same click again. Use `--no-record` only for a throwaway comparison or a test. A store failure never blocks the answer file or the `COMPARISON:` output, so keep the answer and state the recording failure plainly.

Every candidate is registered before it can appear: `appendCandidate` with its id, label, `subject`, and the absolute path of its screen. `subject` says what the screen is of, such as `ema-persona-site` or `melzi-studio-site`. It is a stable identifier, not the world or visual treatment. Leave a legacy candidate unknown rather than guessing. A candidate produced by recombination also carries `parents`, so lineage stays inspectable.

Author a candidate at `<project>/.impeccable/screens/<id>.html`. Registration copies it to `~/.impeccable/screens/<id>.html` and stores that global copy as the canonical screen, so the corpus survives the project. If the source file is missing, registration warns and keeps the candidate instead of taking the session down.

### Intuition mode

The ordinary comparison flow has no timer. Turn intuition mode on only when the point is his first reaction:

```bash
node <skill-base-dir>/scripts/melzi/taste-session.mjs --deal --intuition --intuition-session <session-id> --intuition-seconds 3 --intuition-cap 8
```

Keep the same session id for that short run. The payload carries the timer and cap into `serve-compare`; pass it straight through. It records the elapsed response time and gives the pair a bounded weight: a response at three seconds is ordinary evidence, a fast answer is slightly stronger, a long answer still counts less strongly, and a timeout is always a tie at the lower confidence weight. A timeout must carry both `timedOut: true` and `outcome: "tie"`; never write one without the other.

`--intuition-seconds 0` keeps the intuition session and response-time tracking but turns the countdown off. Use it for a deliberate session, not for an ordinary flow that has no reason to collect timing. `--intuition-cap` defaults to 8 and stops a session cleanly at the cap. Do not raise it casually. Pairwise comparison protects attention only while the session is short.

The timing number is evidence about these pairings, not a solved measure of difficulty. A close pair can take longer than an obvious pair even when neither attribute matters more. Treat the profile's immediate and deliberated attribute lines as a prompt to inspect that gap, never as a causal explanation.

### Stopping rule: calibrate, then commit

Use this only for a bounded choice session. It extends one intuition session, including a timer-off deliberate session, rather than creating a second session beside it:

```bash
node <skill-base-dir>/scripts/melzi/taste-session.mjs --deal --intuition --intuition-session <session-id> --intuition-seconds 0 --intuition-cap 8 --stopping-candidate-cap 9
```

The candidate cap is a commitment fixed when the session starts. A candidate consumes it on its first display, never on a later recall. The first third calibrates the scale. A pair needs two screens, so the calibration target is rounded up to one whole pair. During calibration he still picks left, right, or tie and every verdict enters the ledger. What is withheld is the terminal choice and every ranking, profile ordering, or current-leader display. Show only the named calibration phase and the number of calibration comparisons left before the bar is set.

After calibration, show the bar, its spread, and the evidence sentence before asking him to fix it. The default is the strongest calibration candidate's one-standard-error lower bound on the attribute score. This is more cautious than its highest point score, which is exactly where a few early comparisons are most likely to exaggerate a lead. The spread names each calibration candidate's score, uncertainty, and cautious bound. If shared recorded attributes cannot separate the calibration candidates, say that plainly and do not print a number that looks precise.

He may adjust the displayed bar once. The session stores both the derived value and the fixed value. To change the candidate cap after starting, use `--set-stopping-candidate-cap <n>` with the same session id. That is an explicit recorded act: the session keeps the old value, new value, and time. A plain re-run with a different `--stopping-candidate-cap` is refused.

**Raising the cap after the bar is set does not re-open calibration, and that has a consequence worth saying out loud rather than leaving him to work out.** The phase is stored state, not a fraction recomputed from the current cap, so a bar he has already reviewed and fixed is never silently discarded by a later raise. The trade is that the calibration set then stops being a third of the budget: three calibration candidates under a cap raised from nine to thirty is a tenth of it, not a third, and the scale he is judging against was bought from that smaller sample. Say so when reporting a raise. Re-deriving the bar instead would throw away a judgement he already made, which is the worse of the two, so the honest move is to keep the bar and name what it now rests on.

Once the bar is fixed, inspect candidates in registry order and stop at the first whose cautious score clears it. The server says which candidate cleared the bar and that the session is over. It does not offer another pair. If no candidate clears before the candidate cap, select the best candidate seen as the designed fallback. Nothing from calibration is discarded; all early candidates remain selectable.

There are two ceilings. `--stopping-candidate-cap` limits first displays and decides the fallback branch. `--intuition-cap` limits comparisons and protects attention. Whichever arrives first ends the session visibly. If the intuition cap arrives first, do not quietly start another pair or call the candidate-budget fallback: start a new committed session if more evidence is worth the attention.

## 3. Name the attributes

This is the step a model has to actually perform, and the reason any of this generalizes. Do it after every comparison, before asking for the next pair.

Look at the two screens and name the concrete properties on which they genuinely DIFFER: whitespace, type scale, column count, contrast, border treatment, density, ornament, motion, image weight, corner radius, alignment, whatever is in front of you. Score each candidate 0 to 1 on each attribute you named, where 0 is not at all and 1 is maximally. Continuous, never booleans, because the weighted sum needs magnitude.

- **Propose from what you see, never from a fixed list.** A checklist can only ever learn the axes someone guessed in advance, and the axis separating his two favourites is usually not on it. Three to six attributes per comparison is a working range: name the ones that differ, not the ones you can think of.
- **Attributes are observable properties of the artifact, not judgements.** "Three-column layout", not "feels cluttered". "8px corner radius", not "friendly". A judgement is the thing the model is supposed to be learning; feeding one in as an input teaches it your opinion instead of his.
- **Merge, then write.** `mergeAttributes` collapses synonyms by normalized label, so "generous whitespace" proposed today and "whitespace generosity" proposed two rounds later stay one attribute rather than splitting his evidence in half. `setVector` then writes each candidate's scores.
- **Score both candidates on the merged vocabulary, not only on today's proposals.** An attribute named three rounds ago still applies to the screen in front of you, and a missing value is a hole in the fit.

## 4. Confounds: when the pair was not a fair test

A confound is a difference between the two screens that nobody chose. He hit one himself: he compared a screen in light mode against a screen in dark mode, and the second was dark only because the first had no mode control at all. Whatever he picked, the fit would read it as a verdict on dark grounds, and he never gave one. That is worse than weak evidence. It is a confident claim about an axis that was never tested, on a system whose whole point is that he cannot check its claims.

**Before the pair goes up.** Run `flagLikelyConfound(vectorA, vectorB, { attributes, candidateA, candidateB })` from `taste-model.mjs`. Two different known subjects set `refused: true` and name both subjects. Stop there. Pairwise taste compares renditions of one thing, and a preference between unrelated things is not evidence. An unknown subject is not a conflict, so do not guess subjects onto older candidates.

After the subject check, the same function keeps the existing uncontrolled-variable check. It flags one attribute miles apart while everything else nearly matches. It cannot tell an accident from a deliberate one-axis test, and it does not try. It names the axis and hands you the question. You built both screens, so you are the one who knows whether that difference was a decision.

- If it was a decision, deal the pair. A pair built to isolate one axis is the best evidence about that axis there is.
- If it was not, fix the pair before he sees it. Make the two screens match on everything except what is genuinely being compared, then ask. A rebuilt pair is always worth more than a marked one.

**After the answer is in.** Do not delete the comparison. His preference between those two screens was real and it still ranks them; only the accidental axis has to lose its claim on it. `markConfounded({ a, b, at }, ['attribute-id'], { home })` in `taste-store.mjs` adds the mark to a row already written, and `fitAttributeWeights` then drops that attribute's evidence from that row and nothing else. The comparison still trains every other attribute and still counts in the ranking.

Marking is damage control, not a repair. The remaining attributes now have to explain an outcome the accidental axis may in fact have caused, so a little of it leaks into them. That is the reason the pre-flight check exists and the reason to prefer rebuilding the pair.

**Never ask him whether a difference was intentional.** It is your bookkeeping about screens you built, not a design judgement he can make. The floor in section 8 holds here too.

## 5. Show him the profile

Print `--profile` after every few comparisons so he watches it form, and state the comparison count beside it, plainly, every time. "Prefers generous whitespace, dislikes three-column layouts, neutral on serif against sans, from 6 comparisons" is honest. The same three lines with the count taken off is a claim the evidence does not support.

An attribute whose interval crosses zero prints as neutral and stays neutral. Do not promote one because it would make the profile look decided, and do not quietly drop it either: a real "no opinion yet" is a finding about him, not a gap to fill.

When intuition mode has enough timed evidence, the profile adds a plain response-time readout beside the ranking: which attributes appeared in quick choices and which repeatedly took longer. It refuses that claim until an attribute appears in at least three timed comparisons. Read the refusal as information, not as a blank report.

A line that says comparisons were set aside is standing on less evidence than the headline count, because a confound took some of it away (section 4). Read that clause out with the line; it is the only place the shortfall is visible. If the profile warns that a mark matched no attribute on file, fix the spelling and refit: an axis you believe is protected and is not is worse than one you never marked.

## 6. Cycles

`detectCycles` returns a cycle when he preferred A over B, B over C, and C over A. Surface it. Do not re-fit until it goes away, and do not average it into a number that hides it.

A cycle is not a mistake he made. It means he judged those pairs on two criteria at once, so `cycleTensions` names the attributes whose difference flips sign around the loop. Put those to him as a question about this surface: on these three you took the roomier screen, and you also took the denser grid, so which one matters here? Keep his answer in the surface brief and carry on with the cycle still on record. Exposing the tension is the job; resolving it on his behalf is not.

## 7. Recombination

When the population stops separating, every remaining pair reads as a coin flip, or the profile stalls, breed rather than compare.

- `selectParents` returns the strongest candidates with a diversity guard, so you are not crossing a screen with its own near-twin.
- `keptRegions` gathers every `keep` annotation for a parent, including annotations from comparisons that parent LOST. Nothing he liked is thrown away because the screen around it lost.
- `buildRecombinationBrief` assembles the brief for the child: what each parent contributes, the exact regions to preserve with their selector, their text, and his own words, what to avoid, and the learned profile as a constraint.
- Author the child at `<project>/.impeccable/screens/<id>.html` from that brief at the standard [genesis.md](genesis.md) section 3 sets: one self-contained HTML page, one viewport, real content out of PRODUCT.md, the signature's invariants held exactly, any named technique built rather than pictured. A sketch is not a candidate, and a finished screen next to a sketch measures effort instead of taste.
- `registerChild` appends it with `parents:[a,b]`, and it enters the loop at step 1 like any other candidate.

## 8. The floor

He clicks which of two, or he clicks tie. That is the entire ask, here and in anything that loads this file.

Never ask him to score a design, rate it out of ten, rank a set, weight an attribute, or say why he prefers what he prefers. He has stated plainly that he cannot review design, and a forced explanation comes back as a plausible sentence that then steers the whole system wrong. Working out the why from the what is what the attribute layer and the weight fit exist to do. Ask him only for the what.
