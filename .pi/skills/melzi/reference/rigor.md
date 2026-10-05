# Studio rigor: the layer that makes the craft trustworthy

Melzi already produces excellent craft. This layer makes its **judgment** trustworthy: evidence you can check, disagreement it can survive, and claims it never inflates. Apply it to every `evaluate` / `refine` command; it is **mandatory** for `critique`, `audit`, and any consequential change.

## Evidence labels: never upgrade a claim past its evidence
Tag every material finding with the narrowest accurate label:
- **OBSERVED**: seen directly in the running UI or this session's artifact.
- **REPRODUCED**: re-triggered from a recorded path.
- **STANDARD**: a documented rule (WCAG, HIG, Material).
- **RESEARCH**: peer-reviewed / authoritative HCI.
- **INFERENCE**: reasoned from the above, not itself observed.
- **TASTE**: a defensible aesthetic judgment, not a fact.
- **HYPOTHESIS**: plausible, unverified.
- **UNKNOWN**: missing evidence (never treated as negative evidence).

Never collapse "automated detector passed" into "good design," or "scan passed" into "accessible." Put confidence on the **decision**, not on every sentence.

## Evidence jurisdiction: different claims need different proof
- Aesthetic / taste → rendered comparison + reasoning; the user's taste is final.
- Usability → heuristic + persona walkthrough, ideally real observation.
- Accessibility → the **achieved level, named** (a scan is not accessibility).
- Performance → measured, not asserted.

A detector hit is evidence of a *pattern*, not proof of a *problem*; a clean detector is not proof of quality.

## The dispute loop: defend the reasoning, not the first answer
When the user rejects a choice, or a critic disagrees:
1. Restate the decision and the evidence for it.
2. Steel-man the objection; run a **controlled, rendered comparison** (current vs alternative).
3. Attack your *own* rationale: post-hoc rationalisation is an explicit failure mode.
4. Land on one of: keep / revise / replace / experiment / unresolved, and you **may** conclude you were wrong.

The user's taste never loses to a model's taste. One challenge cycle per iteration; a new user response starts a new one. Agents do not debate indefinitely inside one iteration.

## Reject a bad fix while preserving the problem
A proposed fix (from the user or a critic) can be wrong even when the reported problem is real. Reproduce the problem, assess the fix on its merits, repair the *underlying* issue. Do not obey a fix just because it was proposed. Keep the original report visible.

## Scale rigor to consequence: risk tiers (highest governs)
- **Quick** (reversible local change): one pass, direct verification, no critic.
- **Craft** (page / component / redesign): real browser + test evidence; optional one blind critic for a material unresolved judgment.
- **Consequential** (money, identity, health, consent, destructive action, or a system-wide rule): add one **genuinely-independent** blind critic and real domain evidence *only where each can change the decision*. Do not ask a general model to role-play credentials it lacks.

A situation (e.g. a dispute) never lowers a tier's bar.

## Review budget: before adding any critic
Name the exact decision, the missing evidence, how the critic could change it, and the token/time budget. Max one self-attack + one external first-pass per iteration. Browser automation and scanners are **tools, not critics**. Same-context role-play generates hypotheses; it never satisfies an independence gate. (An optional genuinely-isolated external critic is a separate operator-run tool; decide whether the decision is worth it before invoking it.)

## Honest boundaries: never claim runtime you don't have
This skill reasons, designs, critiques, and reads evidence it is given. It does **not** capture user feedback, contain a browser sandbox, or enforce a11y / privacy / security by instruction. State the evidence level actually achieved; never imply a guarantee the surrounding system does not provide.

## Adoption gate: prove value before replacing anything
A durable rule, a new default, or replacing an incumbent requires beating an **equal-budget baseline on a pre-registered test**. More model votes are not proof.
