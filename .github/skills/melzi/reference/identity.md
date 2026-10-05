# Identity: turn evidence and visual choices into a usable design system

Use this command when the user asks for help deciding fonts, colours, brand identity, a complete visual system, or an identity mark. It is a guided session, not a questionnaire. Its Mark phase owns logos, symbols, monograms, app marks, favicons, and responsive mark families.

The user never supplies a hex, typeface name, pixel value, ratio, or score. Every question is a choice between two or three rendered versions of the same real content. The user clicks what they can see. You carry the resulting value forward.

## Scope

This version includes four entry points, colour derivation, type and spacing derivation, three visual picks, pairwise treatment of real uncertainty, identity-mark research and construction, `~/.impeccable/signature.json`, project `DESIGN.md`, and the binding proof.

It does not decide whether to leave sRGB for P3. That is a decision about where the work will be seen, not a calculation. The mark workflow preserves its own campaign manifest while adoption joins the approved mark to the signature, so later checks can see the colours, dose, content face, and production mark together.

## 1. Pick the starting point

Put these four routes on one rendered page. Ask only: **Where should we start?** The labels are orientation, not values to name.

1. **Start fresh.** Use the existing [genesis.md](genesis.md) route. Deal worlds with `melzi/world-pool.mjs`, build real screens, and present them through `impeccable serve-question`. The chosen real screen is the evidence from which you read the provisional invariant colours and type roles. Do not build a new colour extractor or screenshot reader.
2. **Start from this project.** Inspect the project with the existing `detect` CLI, then use [document.md](document.md) to record the incumbent system. Render the extracted system on real project content before any choice. A detected value is evidence, not a design decision.
3. **Start from a brand I admire.** Route the URL or image to [study.md](study.md). It extracts design DNA and can append a world to `melzi/world-pool.mjs`; then return through the existing genesis route. Never reproduce the source.
4. **Start from what I have liked before.** Route to [taste.md](taste.md). The existing pairwise system, `taste-store.mjs`, `taste-model.mjs`, and `serve-compare.mjs` carry this path. Use candidates already in the ledger or build fair rendered candidates first.

Do not write a colour extractor, a font extractor, or a screenshot reader. The four routes above already own those jobs. If a route cannot provide enough evidence, say which route failed and why. Do not fill the gap by guessing an identity.

## 2. Establish the invariants, then keep the free axes free

The session needs a signature before it can derive values. Read an existing one with:

`node .github/skills/melzi/scripts/melzi/signature.mjs`

If it prints `NO_SIGNATURE`, create a candidate signature only from evidence the chosen route rendered or extracted. Render it on the same real content and let the user click it before keeping it. The durable invariants are the two seed colours, their roles and dose, the content face, the data face, and the neutral light and dark fields.

The deriver never proposes a hue. It never rebalances the colour dose. Coral leads Klein at roughly 70/30, and that means coral against Klein, not coral as a full-bleed page field.

`free` is a hard boundary. Layout, composition, density, texture, imagery, motion, ornament, scale, grid, and materiality remain free. Do not turn any of them into a derived token, a preferred screen layout, or a session answer.

## 3. Ask the three required questions as rendered choices

Render each choice on the same representative project content. Put no numeric question in front of the user. Build a page with two or three options, use `impeccable serve-question`, and ask a plain visual question. The option cards may carry stable internal ids, but do not ask the user to read or type one.

1. **Body size.** Render the same reading block at three defensible candidate sizes for the target device. Ask which is easiest to read for the intended use.
2. **Measure.** Render the same copy at three candidate measures inside the 55 to 75 character band. Ask which reading width feels easiest to follow. Do not ask the user to choose a character count. Speed tends toward longer lines, comprehension toward medium lines, and the literature's often-repeated 45 to 75 range traces back to an inferred 52, so this is a real visual decision, not an established universal number.
3. **Mono.** Render the same data table, code fragment, and labels in three available mono faces. Ask which makes the data easiest to scan. For the selected face, call `measureFontMetrics(fontPath, { family })` from `identity.mjs`. It reads the SFNT `head`, `hhea`, `hmtx`, `OS/2`, and `cmap` tables and measures average advance over sample prose. If it returns `null`, record the documented 0.5em average-advance fallback rather than claiming a measurement.

Keep the selected values as data for `identity.mjs`. Do not ask the user to restate them.

## 4. Derive what arithmetic can derive

Call the pure module. It has no prompts and no I/O:

```js
import { completeIdentity } from './melzi/identity.mjs';

const completed = completeIdentity(signature, {
  bodySize: selectedBodySize,
  measure: selectedMeasure,
  mono: selectedMonoName,
  monoFontPath: selectedMonoFontPath,
  contentFontPath: selectedContentFontPath,
  traits: selectedPairwiseTraits,
});
```

`completeIdentity` calls `deriveSignature()` from `derive.mjs`; do not recreate its maths in the session. The deriver uses OKLCH, solves the neutral spine before accents, and anchors tokens to contrast jobs. Its chroma policy is `min(C_identity, 0.92 × maxChroma(L, hue))`. WCAG 2 is a hard floor on every surface. APCA is advisory on light surfaces and binding on dark surfaces. Never quietly take the stricter metric on a light background, because it turns the identity coral into a different colour.

Read the defect report. A legal accessibility floor, such as a failing `coralText`, is auto-derived. Other defects are reported rather than silently normalised.

The type output stores actual sizes, not a modular ratio. Spacing starts from the computed body line height. State the line-height evidence in `DESIGN.md` exactly as supplied: it is a field fit over ten sites, R² 0.41, with roughly ±0.08 tolerance, not a validated law. Do not use CSS `ex` to derive it for Source Serif 4. Its Google Fonts variable build has no MVAR table, so its declared x-height is frozen while the drawn x-height moves across the optical-size axis.

## 5. Hand genuine uncertainty to a pairwise click

These are not defaults. Build both sides as real renderings of identical content and route each through the existing `serve-compare.mjs` flow. Record the selected result in `traits` as a dated learned trait. Never choose it silently.

1. **Klein on dark.** Compare the constant-hue candidate and the hand-picked candidate. Do not explain this as a colour-science lecture to the user. The reason is Oklab hue non-linearity near blue-purple, so mathematics cannot settle whether `#4264F5` or `#5A5CF5` is better for this signature.
2. **Foreground on coral.** Compare dark and white foreground text on the same coral-filled component. WCAG favours dark text and APCA favours white. The click decides the conflict.

The existing pairwise flow records the comparison. `identity.mjs` additionally writes the settled selections as dated traits in `signature.json`, so later tools can see that these were learned choices rather than defaults.

## 6. Write artifacts safely

First show the proposed `DESIGN.md`. If a project `DESIGN.md` exists, ask whether to merge or overwrite. Do not silently replace it.

Use `writeIdentityArtifacts()` or `finalizeIdentity()` from `identity.mjs` only after the three visual picks and both pairwise choices exist. The write backs up an existing `~/.impeccable/signature.json` before replacing it. It writes a schema-version-2 signature with the original invariants and free axes intact, derived tokens and scales, the defect report, selected visual settings, and dated learned traits.

Then run the binding proof against the project:

`node .github/skills/melzi/scripts/melzi/bind-verify.mjs <project-dir>`

`finalizeIdentity()` performs the same gate. Do not call the session complete unless it exits 0. A non-zero result means the files may exist, but the system is not yet proved to bind. Report the proof's failing direction and repair the token artifact, not the test.

## 7. Close the session

Return the derived token set, type scale, spacing scale, defects, two dated learned traits, and the binding output. State which entry route supplied the evidence. Mention that the session chose values only on invariant axes and intentionally left the free axes open.

If the request includes a logo, symbol, monogram, app mark, favicon family, or identity-mark system, continue into the Mark phase. A typed `logo` command enters here directly.

## 8. Mark phase: build the production mark inside the identity

The output may be a field of options or a finished production family, depending on the user's authority and the evidence available. The mark is narrower than the whole identity, but it is not separate from it: the approved mark joins the signature at adoption.

### 8.1 Load the signature before any mark work

Run this first, even when the user typed `logo` directly:

`node .github/skills/melzi/scripts/melzi/signature.mjs`

The mark has to know the signature's two colours, their roles and dose, the neutral fields, and the content and data faces it will sit beside. If the command prints `NO_SIGNATURE`, complete sections 1-7 before constructing or adopting a mark. Do not infer a palette or type context from the logo brief alone.

Read the brand brief, existing marks, product truth, deployment assets, and prior rejected concepts. Search the project for every place a mark appears before deciding what the master must support.

### 8.2 Keep the claims honest

An agent can research, generate genuinely different constructions, build clean vector masters, expose defects, preserve lineage, create fair proofs, run synthetic critics, and prepare human tests. It cannot infer authorship from geometry, replace audience evidence with model opinion, perform legal clearance, or declare that a hidden meaning works because it can explain the brief.

Irregularity is not proof of human authorship. Symmetry, exact primitives, uniform strokes, and negative space are legitimate choices. Coherent concept-specific decisions, optical review, retained revisions, and human sign-off are evidence of a human-led result. Random wobble, fake pencil texture, and arbitrary inconsistency are not.

Put every requirement in one lane before drawing:

1. **Universal production gates.** The asset is inert, reproducible, self-contained, editable, rendered in its real contexts, and honest about what was not tested.
2. **Project decisions.** One ink, a 24-unit grid, an overlap, a monogram, a gradient, an animal, a responsive family, or a founder redraw can bind this project without becoming Melzi law.
3. **Evidence-backed heuristics.** Distinctive silhouette, coherent relationships, moderate complexity, exposure-aware recognition tests, and actual-size optical review are useful defaults.
4. **Hypotheses to test.** A hidden second reading, an asymmetric correction, an eclipse metaphor, a terminal, or a proposed human quality remains a hypothesis until a fair comparison or audience observation supports it.

Write the classification into the campaign manifest or project record. Repetition in the brief does not turn a hypothesis into a validator failure.

### 8.3 State the test before the concept

Restate the task as observable outcomes:

- the primary reading a new viewer should report;
- any secondary reading and whether it must be spontaneous or may be discovered later;
- the relationship the construction must carry;
- the real deployment contexts and smallest native pixel size;
- fatal associations;
- who can choose or redraw the final mark;
- evidence for rejection, revision, and adoption.

"Recognisable" needs an object, audience, and exposure condition. "Simple" needs the complexity it is meant to remove. Translate "not AI-made" into coherence, specificity, production quality, process lineage, and an optional blind perception question. Never promise an AI detector.

### 8.4 Read references as mechanics, then research only decisions that move the construction

Route each supplied URL or image through [study.md](study.md). Build a contact sheet for a large set. Analyse dominant silhouette; reading order; shared contour, overlap, substitution, or negative space; contour economy; optical correction; positive and reverse behaviour; what disappears at favicon size; and what the reference refuses. Treat order, awards, chronology, and claims that a version won as provenance until the original evidence is verified. Never reproduce the source.

Search current primary, peer-reviewed, official, and directly read practitioner sources only where the answer can change the construction. Record publication date, access date, acquisition completeness, supported claim, and limitation. Community evidence can supply working vocabulary and recurring failures, not general perception.

Investigate category symbols used by current competitors; recognition and exposure effects relevant to the planned test; real small-size and reverse-rendering constraints; cultural, medical, religious, and legal associations; trademark search routes in the intended jurisdictions and classes; and production mechanics such as tracing, path simplification, and responsive masters. Keep a claim ledger with `solid`, `provisional`, `unsupported`, and `project decision`. Preserve gaps.

### 8.5 Generate mechanisms before styles

Start wider than the final shortlist. A concept changes how meanings interact, not merely colour, radius, or point position. Useful families include one contour with two readings; one form substituted for a necessary part of another; two forms with an explicit intersection; negative space structurally required by the first silhouette; a boundary, seam, bridge, or interruption belonging to both sides; a size-specific companion; and a wordmark whose distinctive event carries the concept.

For each concept, write its short name and family; primary and secondary readings; fusion mechanism; redrawable geometry; target-size behaviour; likely mistaken reading; motion logic, when deployment needs it; strongest objection; parent IDs; and the changed hypothesis. Reject adjacent-symbol rebuses, decorative hidden pictures, category cliches, and variants whose only novelty is surface treatment. A second reading is optional unless the project requires it, and it must not destroy the first.

### 8.6 Preserve an editable master and a production export

When a construction depends on two forms and their overlap, preserve them as independently addressable geometry. A component master names `form-a`, `form-b`, and `overlap`. When those filled components would render differently from the production compound path, keep the components non-rendering with `fill="none"` and add a visible `artwork` path that exactly matches the export. A flattened one-ink export may combine path data for delivery.

The component master must keep ownership of source geometry, future overlap colour, deliberate motion, independent revision, and source/export comparison. The production export must embed simply; support `currentColor` when required; render predictably in positive and reverse; and depend on no font, network, script, filter, or raster image.

One path is useful only when it improves the export. Multiple intentional paths beat one unreadable compound path. Anchor count is a structural diagnostic, not an authorship score. Flag duplicate and near-collinear points, tiny segments, self-intersections, and unexplained tangencies. Do not rank marks by node count.

### 8.7 Use the campaign manifest as the no-loss home

Create one campaign manifest. All asset paths are relative to it so the package can move:

```json
{
  "schema": "melzi.logo-campaign/v1",
  "project": "Project name",
  "wordmark": "Project name",
  "rules": {
    "viewBox": "0 0 24 24",
    "currentColorOnly": true,
    "requireComponentMaster": true,
    "requiredComponents": ["form-a", "form-b", "overlap"],
    "preferredMaxExportPaths": 1,
    "proofSizes": [96, 32, 16]
  },
  "candidates": [{
    "id": "c01",
    "name": "Working name",
    "master": "masters/c01.svg",
    "export": "svg/c01.svg",
    "primaryReading": "what should register first",
    "secondaryReading": "what may arrive later",
    "fusion": "why this is one construction",
    "construction": ["step one", "step two", "step three"],
    "smallSize": "what survives and what drops out",
    "confusion": "the most plausible wrong reading",
    "motion": "how components move, or none",
    "objection": "the strongest case against it",
    "lineage": {
      "parents": [],
      "change": "what changed from the parent",
      "hypothesis": "what the change should improve",
      "evidence": ["observed result or explicitly pending test"]
    },
    "status": "generated"
  }]
}
```

Project rules remain project choices. `preferredMaxExportPaths` is a warning. A project that permits colour or does not use components records different rules rather than weakening the validator.

### 8.8 Run both mechanical validators

First validate the campaign, component envelopes, lineage, and flattened/master parity:

```sh
node .github/skills/melzi/scripts/melzi/logo.mjs check path/to/campaign.json
```

The strict profile accepts lowercase direct `<path>` children of the lowercase root `<svg>`, XML-separated attributes, a small presentation-attribute allowlist, and self-contained paint values. Convert primitives to paths and flatten transforms. XML declarations, entities, malformed self-close syntax, animation, inline styles, CSS variables, scripts, raster images, filters, masks, text, external references, symbolic-link escapes, and network dependencies are rejected. `currentColor` must reach a non-zero paint channel.

With a component master, each of `form-a`, `form-b`, and `overlap` needs parseable geometry, an anchor inside the viewBox, and coarse bounds that meet paint-bearing envelopes. The overlap bounds must meet both source forms. These checks catch missing, off-canvas, and displaced placeholders. Bounds cannot prove semantic correctness, so `component-semantic-correctness` stays a human review item.

Then run the signature-aware mark validator on the selected export and derive the production family when needed:

```sh
node .github/skills/melzi/scripts/melzi/mark-check.mjs --check path/to/mark.svg --json
node .github/skills/melzi/scripts/melzi/mark-check.mjs --variants path/to/mark.svg --out path/to/variants
```

This second validator checks icon-size stroke survival, brand-hue dominance, ink coverage, and signature-colour conformance. It derives mono, reversed, icon, and favicon variants. Neither validator replaces the other.

After adoption, call the propagation pass through the mark workflow:

```sh
node .github/skills/melzi/scripts/melzi/logo.mjs propagate path/to/project
```

That command calls `mark-check.mjs`'s read-only propagation scanner. It finds mark-carrying pages and assets that contain none of the signature colours, reports off-signature drift, and labels raster marks unverifiable rather than passing them silently. Exit non-zero means propagation is incomplete.

An exit-zero campaign report proves only the named mechanics. It does not prove authorship, recognition, preference, originality, legal clearance, component semantic correctness, nonempty raster output, or pixel equivalence across renderers. `rasterVisibilityVerdict` remains `null`, and the public report keeps every non-claim explicit.

### 8.9 Render one fair proof before ranking

Generate the offline proof:

```sh
node .github/skills/melzi/scripts/melzi/logo.mjs proof path/to/campaign.json --output path/to/proof.html
```

The proof has no JavaScript, image request, font request, or network dependency. It inlines validated exports at declared sizes, on both grounds, beside the wordmark and in a browser-tab context. It prints the readings, likely confusion, and strongest objection.

Open it in a real browser. Inspect CSS pixels at DPR 1 and 2; native 16x16 and 32x32 captures where those sizes ship; apparent weight in positive and reverse; fill-in, dropout, antialiasing, and counter collapse; browser-tab and real-product context; and empty console and request logs. A single master is not sacred. Record a truthful small-size companion as a separate master with its own parity and deployment rule. Do not let browser scaling invent it.

### 8.10 Use synthetic councils for objections, never audience evidence

Keep roles independent and label every result synthetic:

1. Divergent builders use the same constraints in different mechanism lanes and do not rank their own work.
2. A production prosecutor sees vectors and manifest without the builders' defence.
3. Blind visual jurors see anonymous contact sheets and report readings, confusions, and comparative weaknesses as hypotheses.
4. A research prosecutor checks whether each rejection rule is evidence, project choice, or superstition.
5. An integrator retains dissent, revises named hypotheses, and records parents instead of averaging taste into consensus.

Send an external model only the evidence it needs. An anonymous proof is often enough. Keep private project context local. Run bounded rounds: generate widely, reject mechanical failures, prosecute visually, revise failing hypotheses once, and package the declared field.

### 8.11 Learn taste only after recognition survives

Use [taste.md](taste.md), `taste-store.mjs`, and `serve-compare.mjs` for fair pairwise comparisons. Keep context, size, subject, background, and wordmark identical. Ask which better fits the intended character and allow annotations. Do not ask for scores, compare unequal levels of finish, or train on accidental confounds. Mark confounded attributes instead of deleting a real preference.

Pairwise taste does not prove recognition. It begins only after a mark is legible enough to be meaningfully preferred.

### 8.12 Separate pilot recognition, discovery, and preference

Five uninformed people can reveal catastrophic confusion. They cannot estimate population recognition or crown a winner. Use balanced, randomised subsets so participants do not learn the trick from dozens of related marks.

For each mark, show the unlabelled mark for one second and ask "What is it?" Record the verbatim answer, latency, and any second reading volunteered spontaneously. Then allow a longer unprompted view and ask "What else do you see?" Record that as prompted discovery. Ask pairwise preference only after those fields close.

Do not explain the intended answer, count prompted recognition as spontaneous, ask which is prettiest in round one, or let one participant compare every close variant. Commercial adoption needs a larger real-audience sample and a predefined pass criterion. Model jurors never fill human-result columns; pending evidence stays pending.

### 8.13 Screen collisions before adoption

Run an early category and association scan before investing heavily. At shortlist stage, search the word mark and design separately across intended goods, services, jurisdictions, common-law web results, and dates. Record prominent elements, USPTO design codes, class and goods/service queries, EUIPO or TMview image searches, and unresolved neighbours. Similarity includes appearance, sound, meaning, and commercial impression. Reverse-image similarity is neither sufficient nor legal clearance.

Before filing or public launch, route to a qualified trademark professional. Melzi prepares the record and flags collisions; it never declares legal availability.

### 8.14 Adopt the mark into the signature, then prove propagation

The final adoption decision is human. If the brief assigns the founder the final redraw, treat that redraw as the new master and validate it.

After the user explicitly selects a candidate and both validator gates plus the real-browser proof are complete, join it to the signature with `adoptIdentityMark()` from `identity.mjs`. Pass the loaded clean campaign, the selected candidate ID, and the current signature. The returned signature preserves every invariant and free axis and adds the validated master, production export, construction, lineage, and adoption time under `mark`.

Write the updated signature through the same backed-up artifact path used in section 6. Then run the propagation command in section 8.8 against the real project. Adoption is incomplete while it reports a failure or an unverifiable raster without a named manual check.

### 8.15 Close with evidence tiers

The handoff contains the campaign manifest and source log; editable masters and production exports; both validator reports and warnings; the static proof and real-browser evidence; candidate objections and lineage; synthetic council output labelled synthetic; pairwise founder choices; pilot recognition results or explicit pending status; collision-search record and legal-review status; the updated signature carrying the selected mark; and the propagation report.

Rank only when the evidence supports an order. Otherwise use tiers such as `ready for pilot`, `mechanically sound but ambiguous`, `needs revision`, and `rejected`. Generated and reviewed options are still options, not validated logos. State what could reverse each recommendation.
