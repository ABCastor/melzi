# Image generation as a design instrument

Load this before you call any image model on a design job. It is about the GENERATION. [handdrawn.md](handdrawn.md) is about the DRAWING, and the drawing is what ships.

**The rule that governs everything here: the generation is a reference and a diagnosis, never the artefact.** For a mark, a logo, an icon, a mascot, the shipped file is hand-authored SVG. Nothing generated is traced, embedded, or shipped. What you take from an image is a **construction**, how the parts attach to each other. Rebuild that relationship in your own geometry.

---

## 1. Choose a model for the operation

Text-to-image generation and editing are separate tasks. [Artificial Analysis text-to-image](https://artificialanalysis.ai/image/leaderboard/text-to-image) and [editing](https://artificialanalysis.ai/image/leaderboard/editing) leaderboards use blind pairwise votes and Elo scores; consult each for its own task. Compare confidence intervals before treating neighbouring ranks as different. For example, a 50-point gap with narrow, non-overlapping intervals gives more evidence of a preference difference than a 7-point gap with intervals of ±6 and ±7. A cluster spanning 1257 to 1246 with intervals that wide is poor evidence for choosing one editor over another.

Those votes measure which picture people prefer on the prompts sampled. They do not test whether a mark reads at 32px, whether its curves are constructible, or whether it survives one-colour reduction. Rich, detailed rendering can win a preference vote while damaging a logo. Rank can suggest a model to try; inspect the result against the asset's actual constraints.

Use an image tool the agent has, such as one exposing `gpt-image-2`, a Gemini image model, or Recraft. Check its current model, access, billing, reference limits, and output format before choosing. A model being listed does not mean this harness can call it.

| Model or family | Capability to evaluate | Access or output question |
|---|---|---|
| **GPT Image 2** (`gpt-image-2`), GPT Image 1.5 | Instruction following, text placement, designed-asset layout, edits of attached images | Does the available tool expose generation and image editing? What does the account pay for each? |
| **Nano Banana 2 (Gemini 3.1 Flash Image)** and **Nano Banana Pro (Gemini 3 Pro Image)** | Multiple references, separate object and character capacities, high-resolution output | Check the selected model's reference slots, resolution and API billing. |
| **Recraft V4.1 Vector** | Native SVG and a reusable `style_id` based on reference images | Confirm vector mode and inspect the actual geometry. A reusable style does not prove editable construction. |
| **Midjourney 8.2** | Aesthetic exploration and Omni Reference | Check permitted access and which renderer `--oref` selects; reference mode may use V7 instead of the selected newer renderer. |
| **Ideogram 4.0** | Typography and structured JSON prompts | Check API availability and whether an SVG export is native or traced. |
| **FLUX.2 [dev]** | Local 32B weights, multiple references and LoRA training | Check hardware and the exact weights' licence. Local fine-tuning can preserve a character in weights you control. |
| **MAI-Image-2.6-Preview**, **MAI-Image-2.5-Pro**, and **Reve 2.1** | Alternative generation and editing candidates | Check availability, preview access and the relevant operation's quality; a ranking is not an accessible tool. |

## 2. Use the available image tool

### Attach references and inspect outputs

Use the harness's supported image input mechanism. Attach the edit target or load it with an image-viewing tool, then pass it through the image tool's documented reference argument. A filesystem path written in a prompt is not proof the image reached the model. Check the tool result and the returned image. Ask for one generation or edit and an account of the result, so the agent acts instead of describing a possible workflow. Some tools require inputs to be visible in the conversation: attach them at invocation or open disk images with the harness's viewer before editing. Others accept explicit reference paths. Passing a reference may select edit mode automatically; check the tool's schema.

For an edit, label each input by role and preserve the invariant list on every turn. Prefer a tool that preserves the attached subject while applying the requested change. Confirm the output path and save the reference in the project's chosen reference directory; generation output directories are harness-specific. If the tool returns an attachment or downloadable artifact, use its supported save or download operation before treating it as a local file, and retain a link to it when no file export is available.

**Inspect alpha before judging a silhouette.** Model documentation and a tool's returned PNG can disagree about transparency because a wrapper may post-process the image. A measured cutout contained 753,514 fully transparent pixels out of 1,572,516, with corner alpha 0 and black mass alpha 254. Regions requested as white returned almost transparent: eye counters at alpha 5 and tooth faces at alpha 1. Those are pixel values on a 0-255 scale, not evidence of opaque white. On a dark background the counters disappear or the mark's apparent values change.

Flatten a viewing copy onto explicit white before judging it or running the 24px test, then check the intended dark background separately. Inspect alpha values with an available image utility. On macOS, `sips -g hasAlpha <file>` reports the alpha channel and `sips -s format jpeg <in.png> --out flat.jpg` produces a white-composited viewing copy. Retain the original PNG for inspection.

If the chosen tool cannot produce usable alpha, generate on a flat `#00ff00` chroma-key field, or `#ff00ff` for a green subject, and key it out using a supported image utility. Border-based key detection, a soft matte and colour despill help with edge contamination. Verify the alpha channel first; do not key out a background that is already transparent. A transparency-capable alternative such as GPT Image 1.5 may require separate API access, so check the tool's actual options.

Treat `input_fidelity`, dimensions and pricing as properties of the selected tool. A tool may force high-fidelity image inputs, making reference-heavy edits cost more than plain generation. Where a GPT Image tool exposes dimensions up to a 3840px edge in multiples of 16 with an aspect ratio up to 3:1, `3840x2160` is a 4K option; validate those limits against its current schema instead of assuming all wrappers accept them.

### Multiple references and metered calls

Use a Gemini image tool when its available interface offers the reference capacity, direct API automation, independent comparison, or resolution the task needs. Check object slots separately from character slots. Documented capacities to verify for the selected version include Nano Banana 2's 10 objects plus 4 characters, Nano Banana Pro's 6 objects plus 5 characters, and Flash Lite's 14 objects with no dedicated character slot. A large object allowance does not imply the same number of identities can be preserved.

Check current pricing by model and output resolution. A subscription-backed tool and a separately billed API can expose the same model with different account costs; neither should be described as universally free. For image-token billing, include image inputs and outputs instead of presenting a derived per-image estimate as a vendor price. For a capped batch, reserve cost using the selected model and resolution before each call. If a budget reserves $0.028 for an image that costs $0.067, the batch spends about 2.4 times what its ledger records. Keep that calculation tied to live pricing.

### Which to reach for

Start with an accessible tool that supports the required operation and compare one result against the brief. Switch for a concrete reason: more character references, scriptable repeated calls, independent criticism, different geometry, or larger output. Both GPT Image and Gemini can support generation and editing; choose by the interface's actual capabilities instead of assigning one family exclusively to fresh images and the other to edits.

---

## 3. Prompt architecture

Use a **structured brief**. The OpenAI and Gemini prompting guides below organise requests by subject, scene and constraints, with labelled input images.

### The skeleton

A structured scaffold adapted from OpenAI's prompting guidance. Use the lines that help and drop the rest:

```
Use case: <logo-brand | ui-mockup | illustration-story | precise-object-edit | identity-preserve | ...>
Asset type: <where the asset will be used>
Primary request: <the main prompt>
Input images: <Image 1: edit target; Image 2: style reference>
Scene/backdrop: <environment>
Subject: <main subject>
Style/medium: <photo / illustration / flat vector / 3D>
Composition/framing: <wide/close/top-down; placement>
Lighting/mood:
Color palette:
Materials/textures:
Text (verbatim): "<exact text>"
Constraints: <must keep / must avoid>
Avoid: <negative constraints>
```

OpenAI's cookbook gives the ordering as **background/scene → subject → key details → constraints**, and says to use short labelled segments rather than one long paragraph. Google's formula for Gemini is shorter and differently ordered: **`[Subject] + [Action] + [Location/context] + [Composition] + [Style]`**, and for reference work **`[Reference images] + [Relationship instruction] + [New scenario]`**: say what role each image plays and how they combine. Both agree on one thing: **label every input image by index and role.**

### Length

Long works if it is structured. Max Woolf, testing Nano Banana with roughly 2,600-token JSON character specs, got high per-attribute fidelity, and found the model handles JSON and markdown lists well. But **debug short**: start from a clean base prompt and change one variable per turn. A long prompt that fails tells you nothing about which of its forty clauses failed.

### Negative constraints: combine physical states with exclusions

- Google's official guide: *"Use positive framing: describe what you want, not what you don't want (e.g. 'empty street' instead of 'no cars')."*
- The architectural argument behind that: these are autoregressive multimodal models, not diffusion with classifier-free guidance, so there is no negative-conditioning vector for a "negative prompt" to attach to.
- Against it, Woolf's testing found explicit `do not include` directives **did** work on Nano Banana, and that **ALL CAPS measurably improves instruction adherence**.
- OpenAI's cookbook sits in the middle: state exclusions and invariants explicitly, and its own worked examples are full of negations.
- The academic evidence is one-sided and unflattering. ASU's negation benchmark is titled *"Text-to-Image Models Do NOT Know How to Interpret 'No'"* and found state-of-the-art models generate the very objects users ask to omit; the vision-language literature says the same (*Vision-Language Models Do Not Understand Negation*, arXiv 2501.09425). The cited benchmarks do not establish how `gpt-image-2` handles this particular task; verify the constraint on the output.

**Resolution: negation is a weak second-order steer, and the main instruction is a positive constraint that makes the tell impossible.** Assert the physical state first ("every region is either pure black or pure white with a hard edge between them"), then add an ALL-CAPS exclusion list as a cheap backstop ("NO grey, NO gradient, NO keyline"). Never rely on the exclusion alone: a bare "no shading" leaves the model with no instruction about what the surface actually *is*, and it fills that hole with its default. Where you can express the constraint as a **number** or as a **named physical process**, do that instead of prohibiting anything: see section 6.

### Ask for the construction, not the rendering

Naming the attachment can change what information the image supplies. A generator asked for a *thing* returns a rendering of that thing. A generator asked **how the parts attach** returns information you can draw from.

- Weak: "cute cartoon rabbit mascot"
- Strong: "showing two large white buck teeth hanging BELOW the muzzle, separated from each other by a visible gap, with the mouth line ending where the teeth begin"

Name the joins, the overlaps, the gaps, and what sits in front of what. Then read the result for that one relationship and ignore everything else in the picture.

---

## 4. Prompt templates

### 4a. Silhouette study

Use this to study a two-value animal head: eyes, nostrils and the gap between identifying features are holes in one black mass. Keep a real gap between separate teeth or other paired parts. Inspect for keylines, eye highlights, drop shadows and excess contour detail.

```
Use case: logo-brand
Asset type: single flat vector mascot mark, used at 24px in a UI
Primary request: a <SUBJECT>, front view, drawn as ONE solid black silhouette on white
Style/medium: solid black shape on white, the way a stencil or a rubber stamp is cut
Composition/framing: centred, generous margin, the whole <SUBJECT> inside the frame
Color palette: EXACTLY two values, #000000 and #FFFFFF, nothing between them
Constraints: every region is either pure black or pure white with a hard edge between them;
  the eyes, the nostrils and <the identifying interior feature> are cut as WHITE HOLES out
  of the black mass, not drawn as lines; the silhouette alone must identify the subject
Avoid: NO outline stroke, NO keyline, NO second contour around the shape, NO grey, NO
  gradient, NO shading, NO texture, NO fur spikes on the contour, NO highlight dots in the
  eyes, NO drop shadow, NO sticker border, NO background object, NO text, NO watermark
```

The template names a physical process, stencil or rubber stamp, and avoids "sticker", which can bring a die-cut border. **Try a shape budget** such as `Constraints: the whole mark is built from at most 9 closed shapes`. This is a checkable constraint, not a guarantee of compliance; count the shapes in the result.

**Residual faults to check:** identical mirrored eye ovals (perfect bilateral symmetry) and an over-rounded, blobby contour after fur spikes are forbidden: check for both faults. In a measured 24px reduction, **the whiskers did not disappear, they turned to grey mush that fattened both cheeks into shapeless lobes, and the nostril dots merged into the muzzle.** A narrow tooth gap barely survived while the larger eye counters stayed readable. Redundant detail at small size is not neutral, it actively corrupts the silhouette. Suppressing the tells is not the same as producing a good mark; section 6 has the rest.

### 4b. Construction reference

```
Use case: logo-brand
Primary request: four small studies on one sheet, side by side, of how <FEATURE> attaches
  to <PART> on a <SUBJECT>: <variant A>, <variant B>, <variant C>, <variant D>
Style/medium: plain black line diagram on white, like a model sheet, no styling
Composition/framing: 2x2 grid, each study labelled with a number only
Constraints: identical subject in all four, ONLY <FEATURE> differs between them; draw the
  attachment clearly enough to see which shapes overlap and where the gaps are
Avoid: NO colour, NO shading, NO background, NO decorative treatment, NO text besides the numbers
```

### 4c. Edit exactly one thing

Attach the current render through the available image tool. Repeat the invariant list **on every turn**: restating it is what reduces drift, and OpenAI's guide is explicit about that.

```
Image 1: edit target.
Change ONLY this: <the single change>.
Keep everything else exactly the same: the silhouette, the proportions, the position and
size of every other element, the line weight, the palette, the framing, the margins.
Do not restyle. Do not add anything. Do not redraw parts you were not asked to change.
```

### 4d. Character lock

```
Same character as Image 1. Preserve exactly: <3-6 named invariants: the head-to-body ratio,
the ear shape, the tooth construction, the palette, the line weight>.
Change only: <pose / angle / expression>.
```

---

## 5. Character consistency: what holds, what is folklore

**Holds:**

1. **Reference conditioning is the mechanism.** Everything else is a hint. Attach the actual image: use the image tool's supported attachment arguments, within its documented reference count and any separate object/character slots. An API edits endpoint may allow up to 16 references while a wrapper exposes a smaller limit; check both.
2. **A character sheet generated once, then reused as the reference for everything after.** Front, 3/4, side, back, plus expression and prop variants. For a tool with 4-5 character-image slots, a four-view sheet is a useful unit. Reuse avoids generating the sheet again, though each attached reference may still incur input cost.
3. **Stable identity language, pasted verbatim.** Write the identity clause once and reuse the same string in every prompt. Rewording it each turn is a common, self-inflicted source of drift.
4. **Staying in one thread.** Multi-turn editing keeps the character in context; a fresh session throws away what was holding it stable.
5. **Restating the invariant list every turn**, which is what OpenAI's guide prescribes for identity preservation.
6. **LoRA on FLUX.2 [dev]** if the character matters enough. Fine-tuning puts character information in model weights rather than relying solely on the current context, and local weights stay under your control.

**Folklore, or much weaker than claimed:**

- **Seeds.** A fixed seed plus a fixed prompt reproduced an image in the diffusion era. Many image tools expose no seed at all, and a seed alone does not preserve character identity across changed prompts or model versions. Use one only when the selected interface documents its behaviour.
- **"Same character as before"** with nothing attached. There is no memory of it.
- **Midjourney `--cref`/`--oref`.** Check the actual renderer and operation limits when attaching Omni Reference. Its documented V7 route doubles GPU time and excludes Fast Mode, Draft Mode, Vary Region, Pan and Zoom Out. Confirm current documentation and permitted access before planning an automated workflow.
- **Style transfer as a consistency tool.** Woolf, blunt: Nano Banana *"is terrible at style transfer even with prompt engineering shenanigans."* Do not try to hold a character by transferring a style onto a new drawing.

**The honest ceiling: for a logo, none of this is consistent enough.** "Perfectly, unbelievably consistent every single time" is not something a generator delivers. It is what a vector file delivers, because the same file is literally the same file. Generator consistency is a tool for *studying* a character across poses. Identity comes from the SVG.

---

## 6. Why generated mascots read as AI, and what to write instead

**First, an honesty note that changes how you use this section.** The published practitioner literature on AI tells is almost entirely about photorealistic and painterly work, not flat vector marks. Search it and you get one abstraction level up: additive detail, gloss, symmetry, muddled tangencies, convergence to a mean. The specific flat-vector tells below (spiky fur, twin eye highlights, the inner highlight stroke) are **visual heuristics with less evidence than the broader patterns**. Use the sourced rows first and test the rest on the actual output. The linked material does not establish consensus across design communities.

### The three counter-moves that actually do the work

**1. Numbers, not adjectives.** "Simple" is inside the model's idea of simple, which is not yours. A count is not. `"the whole rabbit is built from 9 closed shapes"`, `"exactly 4 flat spot colours, every shape a single solid fill"`, `"exactly two incisors, separated by a visible gap"`. Counts give both model families a concrete constraint to follow and give you something to check.

**2. Name a physical process, not a digital style.** "Flat vector" sits *inside* the glossy distribution: training examples labelled flat vector can still contain gloss. A physical print process supplies more specific surface constraints: `"1970s screen-printed vinyl decal"`, `"risograph, two inks"`, `"letterpress, one colour"`, `"rubber stamp"`. Gloss is the best-sourced tell there is, and it comes from aesthetic-preference tuning baked into the models; you escape it by leaving the distribution, not by forbidding shine.

**3. Never say "sticker".** The white keyline is not a stylistic default, it is a **die-cut buffer**: the line a cutting machine follows. Every sticker in the training data has one, so any prompt near "sticker", "badge", or "mascot decal" imports it whether or not you also say "no white outline". Note the trap: **Google's own official flat-art template is a sticker template**, so following the vendor guide literally pulls the tell in.

### The tells

Well-sourced ones first. Assert the positive, then exclude in caps.

| The tell | Why it reads as generated | Prompt move |
|---|---|---|
| **Additive detail** (the best-attested tell of all) | The model adds; logo design subtracts. Restraint is judgement, and there is none | Cap the shape count numerically. State the intended use: "designed to read at 16 pixels" |
| **Gloss and uniform plastic surface** | Aesthetic-preference tuning. Everything looks injection-moulded, "too smooth or too busy, with no thought behind where the details go" | Anchor a print process. Adobe shipped a "Visual Intensity" slider to dial this down, which is a control to inspect if the output is over-glossed |
| **Gradients, ambient shading, micro-texture under "flat"** | Named independently by three design studios as the thing that breaks in print | "EXACTLY N flat colours and nothing between them, every shape a single solid fill, NO blends" |
| **Fudged tangencies** (the one that matters most for a mascot) | Where ear meets head, tail meets body, tooth meets lip, the model **blurs the join or hides it in shadow** rather than deciding. A hand-drawn mark decides | Ask for the join explicitly: "the ear is a separate shape that overlaps the head with a visible edge between them". A tooth drawn below the head instead of emerging from the mouth is an attachment fault |
| **Malformed anatomy that survives stylisation** | Misproportioned eyes, lopsided construction, and famously "three rows of teeth" | Name the count and arrangement of the feature that carries the character |
| **Over-symmetry** | Canonical tell, though nobody quantifies it | Ask for a specific asymmetry: "head turned to its left, tail sweeping right, weight on one foot". Usually still needs hand-fixing |
| **White die-cut keyline, drop shadow** | The sticker production requirement, inherited wholesale | Drop the word "sticker". Then "flat on the ground, NO keyline, NO drop shadow, NO glow" |
| **Convergence to the category mean** | Generators recombine category clichés and default compositions, so everything lands on the same generic middle | Nothing in the prompt fixes this. It is the argument for hand-drawing the final mark |
| **Raster-only, no variants** | The clearest tell in the deliverable rather than the image: no one-colour, reversed, stacked, or small-size version exists | Not a prompt problem. It is what the SVG is for |
| **Detail that dies at small size** | Whiskers, freckles, nostril dots. **A measured 24px reduction turned those details into grey mush that fattened the cheeks into shapeless lobes** | "only shapes that survive at 24 pixels; NO whiskers, NO freckles, NO interior detail lines" |

Weaker, from the eye rather than the literature, but worth firing anyway since the exclusions are free: **spiky fur clumps** on the contour ("the outer contour is a small number of long smooth arcs"); **twin glossy eye highlights** ("the eyes are solid holes, NO catchlight"); **the thick outline with a lighter inner stroke**, two concentric contours nobody drew ("the shape has NO outline at all, it is a filled silhouette", and remove the stroke rather than thinning it); **unbidden crosshatch or grain** ("NO texture, NO hatching, NO stipple"); **over-rounded blobbiness** ("the contour mixes straight runs and tight corners with the curves"). This one gets *worse* when you ban the spikes: banning a tell pushes the model toward the next one.

**Two claims in circulation that the sources contradict, so do not build rules on them.** *"Uniform stroke weight with no taper is an AI tell"* is backwards: the documented tell is stroke weights and corner radii that vary **inconsistently** between shapes that should match. If a batch came back dead-uniform, that points at a vector-native model rather than a diffusion one, which is a different diagnosis. And *"the 3/4 friendly pose is the AI default"* is unsettled: one widely-read critic claims the opposite, that generators are stuck at eye-level head-on. Specify the view explicitly either way and the question does not arise.

**The move that beats all of them: ask for less.** The convergent practitioner answer for why a logo looks AI-made is that it is over-made. Reduction, one dominant visual hook, two or three identifying features and nothing else, a strong silhouette, geometric construction. OpenAI's own logo template says it in their words: *"Favor simplicity over detail so it reads clearly at small and large sizes."* When a generation still looks generated, the fix is almost never a better adjective. It is deleting three elements.

---

## 7. Generation to vector: do not trace

**Tracing converts a picture of a logo into a picture of a logo made of paths. It never produces a logo.** That is the whole argument, and it is structural rather than aesthetic: a logo is geometry with intent, and a tracer produces geometry without intent. A traced circle is not a circle. Two traced matching ears are two unrelated polygons that happen to look similar at 1000px and stop matching at 32px. A traced corner radius is a different value at every corner. A designer working from a trace cannot nudge one curve without fighting forty nodes, cannot make the parts that should match actually match, and cannot build the small-size cousin from it. And a traced mark carries every generated tell straight into the SVG.

The tools, and what each actually is:

- **Illustrator Image Trace**: classical deterministic edge detection, most controllable once tuned, still the print standard. It follows the source faithfully, so noise in the generation becomes extra anchors and doubled edges.
- **Inkscape Trace Bitmap = potrace**: **black and white only**; colour is stacked independently-traced layers, which is where hairline gaps and overlaps between adjacent shapes come from. Corner detection is one threshold (`alphamax`), speckle suppression is `turdsize`.
- **vtracer**: Rust, open source, native colour, deliberately skips potrace's optimal-polygon search for speed. Best of the free options for scripted work; `--simplify` roughly halves file size. Still node-dense by logo standards.
- **Vectorizer.AI**: fits *intended* geometry rather than pixel boundaries: it fits circles, ellipses, rounded rectangles and stars as parameterised primitives, models corners explicitly, and detects mirror and rotational symmetry. Check the current input limit, historically 3MP/30MB. For a tracing task outside this authored-mark workflow, evaluate whether its primitive fitting reduces cleanup.

**Native-SVG generation is real, and one widely-assumed route is not.** Recraft V4.1 Vector offers native output and a `style_id` built from 1-10 reference images, reusable across later calls. Test this style-consistency mechanism separately from character preservation and check current API pricing. Its output quality is contested and both sides are self-interested (Recraft and its integrators claim real paths and clean geometry; a competitor claims excessive anchors and redundant layers), and the linked claims do not supply a neutral measurement. Run a bounded check before relying on it: generate one, open it, count the anchors on a shape that should be a circle.

**The route that is not what it looks like: Illustrator's generative vector features are split, and only half are native.** Text to Vector Graphic on Adobe's own Firefly model produces editable vector. But the same features running on **partner models such as GPT Image, Gemini 2.5 and 3 (Nano Banana and Pro), and Imagen 4** work differently, and Adobe says so plainly in its own docs: *"Partner models generate raster images, and then Illustrator automatically converts these images into vector graphics."* So "generate with Nano Banana inside Illustrator and get vectors" is auto-trace with a nicer interface. An Ideogram SVG download also needs its generation route checked; a download format alone does not establish native vector construction. An LLM can author SVG geometry, but plausible markup does not prove a successful logo. Render it and inspect its construction and small-size behaviour.

Even native SVG is not *authored* SVG: the geometry is whatever the model emitted, not a construction you can reason about and reuse. Good for exploring. Never the shipped mark.

**What a generation is actually worth in a hand-vector workflow, and it is a lot:**

- **Silhouette study**: does the shape identify the subject as one black mass? The test the whole mark passes or fails, and cheap to run a dozen times.
- **Construction reference**: how the parts attach. For example, separate teeth emerging from a mouth instead of one scored block below a head.
- **Negative-space check**: where the white gets in, whether the counters hold.
- **Value study**: how many distinct values the design really needs. Usually fewer.
- **Pose and view reference**: what a 3/4 turn does to the proportions.
- **Diagnosis**: section 8, locating a structural fault in an existing drawing.

Then draw it by hand. The craft, and the reason the hand-drawn version is worth the effort, is in [handdrawn.md](handdrawn.md).

**Judging it.** The professional tests are cheap and mechanical: flatten to a solid black silhouette and see if it still reads; squint until it blurs and see what shape persists; render or print at 25mm and at 12mm and check it survives. Run these on the generation before you believe anything it suggested.

---

## 8. Diagnosis: the call worth more than generating

Pass your own render back and ask what is structurally wrong before generating another alternative. A useful diagnosis names the attachment fault and its effect. For example, on a rabbit mascot:

> *"the teeth attach to the underside head silhouette while the mouth line ends elsewhere, so no mouth or lips frame them as incisors"*

That is a fault, located, in structural terms, with its consequence stated. Getting that reliably takes a specific prompt shape, because the default failure modes are documented: vision models are **notably positive** in art critique unless forced otherwise, they produce **generic comments** when unconstrained, and they are **poor at visual grounding from scratch**: the design-critique research found models do badly when asked to locate a problem region first, so generate the critique text first and locate it second.

### The five patterns

**1. Ask for the fault, not the fix.** A model asked "how can I improve this" writes a listicle. A model asked "what is structurally wrong" looks.

```
This is a work in progress, not a finished piece. Do not praise it and do not suggest
improvements. Name what is STRUCTURALLY WRONG: where a shape attaches to the wrong shape,
where a line ends somewhere it should not, where two parts contradict each other, where a
form does not read as the thing it is meant to be. State the fault and its consequence.
```

**2. Ask about construction, not style.** Bar the vocabulary you do not want.

```
Describe only how the parts are CONSTRUCTED and how they attach to each other. Do not
comment on style, mood, charm, colour choice, or whether it is appealing.
```

**3. Ask what a viewer sees first.** Catches the failure where the drawing contains all the right elements and still reads as the wrong thing.

```
Look at this for one second and then answer: what animal is it, and what is the FIRST
feature you noticed? Then name anything you had to work out rather than simply see.
```

**4. Ask for a ranked small-size list.** Force the ranking; an unranked list is a listicle.

```
Rank, most damaging first, what breaks when this is reduced to 24 pixels wide. For each,
say whether it merges with a neighbouring shape, disappears, or turns to mush.
```

**5. Compare two things you supply.** Attach the generation and your drawing and ask for the difference, never which is better. The fastest way to turn a generation into an instruction.

```
Image 1 is a reference. Image 2 is my drawing. Name only the differences in CONSTRUCTION:
how the parts attach, what overlaps what, where there are gaps. Ignore style and quality.
Rank them by how much each one changes what the mark reads as.
```

### Three things that make diagnosis land

- **Crop first.** A whole-animal reference is decided by one square inch of it. Crop to the region and ask about the crop; a zoomed-in patch can make an attachment easier to locate than it is in the full composition.
- **Critique with a different model than the one that generated.** Models show *self-bias* and favour their own output during refinement, which is why the published critique pipelines use separate models for generation and refinement. If a GPT Image tool generated it, critique with a Gemini vision tool or another available model; reverse the roles when Gemini generated it.
- **Filter the output yourself.** Even the best published critique pipeline scored below human experts on comment validity (0.47 against 0.56). Expect roughly half the comments to be useless. One real structural fault is a successful call.

---

## 9. Evidence and verification

Separate measured output from vendor promises and practitioner hypotheses. A successful reference edit demonstrates that a particular call preserved its target; it does not prove every wrapper accepts images or that every future edit preserves identity. Repeat the attachment check when changing tools.

Inspect the returned file directly. The alpha values in section 2 demonstrate how requested white can become transparent. The 24px reduction in section 4 demonstrates a different failure: whiskers spread grey into the cheeks, nostril dots merge with the muzzle, a narrow tooth gap barely survives, and the larger eye counters remain readable. Keep both checks; a correct large preview proves neither opacity nor small-size legibility.

Vendor documentation supports prompt structure, input limits, reference slots, dimensions and billing options. Those contracts change. Check the linked official documentation for the chosen model and interface; keep price calculations tied to the current model, resolution, input count and output usage. Do not turn a third-party per-image estimate for a token-priced model into an official rate.

Leaderboard interpretation, Recraft SVG quality, Omni Reference renderer changes, FLUX LoRA behaviour, Woolf's prompt findings and tracer failure modes require their own evaluation. They are useful starting points for a comparison, not proof that a particular output is suitable.

The flat-vector specifics in section 6 have weaker support than the photorealistic and painterly patterns in the wider literature. Treat them as hypotheses and do not infer community agreement from a few linked articles. Claims such as "5,000+ anchor points" or "847 where 124 were needed" circulate in paid redraw marketing and an uncorroborated blog; do not repeat them as benchmarks. Inspect the actual path count, anchors, repeated shapes and corner radii. The structural case for authoring geometry is testable without those numbers.

**Sources.** [AA text-to-image](https://artificialanalysis.ai/image/leaderboard/text-to-image) · [AA editing](https://artificialanalysis.ai/image/leaderboard/editing) · [OpenAI cookbook prompting guide](https://developers.openai.com/cookbook/examples/multimodal/image-gen-models-prompting-guide) · [gpt-image-2 API docs](https://developers.openai.com/api/docs/models/gpt-image-2) · [Gemini image docs](https://ai.google.dev/gemini-api/docs/image-generation) · [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing) · [Google Cloud Nano Banana prompting guide](https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-nano-banana) · [Max Woolf on Nano Banana](https://minimaxir.com/2025/11/nano-banana-prompts/) · [Midjourney Omni Reference](https://docs.midjourney.com/hc/en-us/articles/36285124473997-Omni-Reference) · [Recraft API pricing](https://www.recraft.ai/pricing?tab=api) · [Adobe: partner models in Illustrator generate raster then vectorise](https://helpx.adobe.com/illustrator/desktop/use-generative-ai/partner-models-overview.html) · [potrace](https://potrace.sourceforge.net/) · [vtracer](https://github.com/visioncortex/vtracer) · [Vectorizer.AI](https://vectorizer.ai/) · [ASU: text-to-image models do not interpret "no"](https://forge.engineering.asu.edu/furiproject/text-to-image-models-do-not-know-how-to-interpret-no/) · [Vision-language models do not understand negation](https://arxiv.org/abs/2501.09425) · [Visual prompting with iterative refinement for design critique](https://arxiv.org/abs/2412.16829) · [Keith Edwards, why does all AI art look like that](https://vocal.media/art/why-does-all-ai-art-look-like-that) · [Left Hand Design, spotting an AI logo](https://lefthd.com/how-to-spot-an-ai-generated-logo-design/) · [Flux Creative on vectorising AI logos](https://www.fluxcreative.com.au/insights/creating-vector-files-from-ai-generated-logos) · [SOSFactory, mascot logo craft](https://www.sosfactory.com/how-to-design-a-mascot-logo/) · [Creative Bloq, the silhouette test](https://www.creativebloq.com/features/5-big-brand-logos-that-pass-the-silhouette-test)
