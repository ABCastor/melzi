# The bar: taste you hold yourself

Load this with [craft-floor.md](craft-floor.md), immediately before any UI edit, and come back to its last section every time you look at a render. The craft floor says what must not be wrong. This file says what good looks like, and makes you prove it on the rendered pixels before anyone else sees them.

Why it exists. The person you build for is not a design reviewer and has said so plainly. Asking them to rate screens, rank candidates, or score anything hands the judgement to the one person who told you they cannot make it, and it costs them an evening besides. So the judgement is yours. Hold a bar a design director would hold, check your own work against it honestly, and show only what passed.

## 1. What you may read, and what you never ask

Read standing preferences silently; they are facts on file, not questions:

- PRODUCT.md, DESIGN.md, and the surface brief that `impeccable context` loaded.
- The signature. Run `node {{scripts_path}}/melzi/signature.mjs` before choosing a single colour or face, on every design task and not only in the genesis flow. `NO_SIGNATURE` means there is nothing to hold. Anything else is not a leaning: it prints the few choices that hold across every surface this person ships, and you carry those values exactly as printed, in whatever world the task deals you. Only the project's own committed DESIGN.md or a brief in the user's words sets a different identity for one product. The layers the block names as free stay free.
- `node {{scripts_path}}/melzi/taste-store.mjs --profile` when it exits 0: attribute preferences learned earlier. Treat them as leanings to weigh, never as rules, and never as grounds to collect more. Exit 3 means nothing is on file; carry on without it.

Never open a comparison session, never ask for a rating, a score, a ranking, or "which do you prefer" as a way to settle a taste question this file can settle. The calibration loop in [taste.md](taste.md) runs only when the user asks for it by name. A direction round that puts worked directions in front of them (new-work.md) is a product decision and stays; what goes is using them as the quality gate.

## 2. The standard: durable, structural, quiet where it works

Three ideas decide most cases.

**Durable beats fashionable.** What dates a design is the cheap surface trick of its year: bevels, then textures, then long shadows, then glass, blur, glow and grain. Each aged the moment it became free to produce. Proportion, geometry, rhythm and type set with care never became cheap, so they never dated. Put the identity there, keep novelty on one axis, and never let a current free effect carry the look. The target is the thin band that is advanced and still instantly understood.

**Structure carries identity, the surface does not.** Content order, measure, rhythm, alignment, how numbers sit, what the navigation is: these can belong to this product alone. A typeface, a tint and a texture are available to everyone.

**The task outranks the style.** On a screen someone works in or reads, ornament yields the moment the work starts. Nothing decorative runs behind, through, or between the words and controls a person is using.

## 3. The tests

Each test is run on the render, has a pass condition you can state, and names what to do on a fail. Numbers are defaults: the signature, a committed world, or DESIGN.md may set different ones, and then the test is that the screen keeps its own numbers.

**Squint.** View the screenshot at about a quarter size. Pass: one element leads each viewport, and you can name the first, second and third thing the eye lands on, in the order the task needs. Fail looks like an even grey field, or decoration winning. Fix by removing emphasis from the losers, not by adding it to the winner.

**Font swap.** Imagine every face replaced by Georgia and Arial. Pass: the screen is still recognisably this product, through its layout, rhythm and proportions. Fail: the identity was a downloaded file. Fix the structure before reaching for a more distinctive font.

**Costume (Operate and Read surfaces).** Cover the product name. Pass: it reads first as a well-made product of its category, and a person who uses such tools knows where everything is. The world contributes type, palette, density, and one signature move that does a job. Fail: textures, ruled or gridded backgrounds, period lettering, themed labels, row numbers, or controls restyled as artefacts of the world. Fix: keep the one move that carries information and delete the rest; a second world-derived element that does no job is a costume.

**Subtraction.** For every rule, border, tint, shadow, icon, label and divider, ask what breaks if it goes. Pass: each one separates, groups, signals state, or names something. Separate with space first, then a hairline, then a surface change; never all three on one edge. A screen usually gets better with a third of its lines removed.

**Edges.** Count the distinct left edges of text and controls in one viewport. Pass: three or fewer on desktop, two or fewer on a phone, and every control in a list shares one edge and one width. Stray edges are the most common reason a screen looks assembled; nobody can name them, everybody sees them.

**Rhythm.** List the spacing values in use. Pass: six or fewer, from one scale, and the gap between groups is at least twice the gap inside a group. One value used everywhere fails as surely as twenty.

**Proportion.** Pass: a form or settings column holds a width where a label and its control read as one row, about 560 to 720px, and does not stretch across a wide window; reading text holds 60 to 75 characters; a wide viewport is used on purpose (a second column with a job, or calm margin), never by pulling a control 900px away from its label. On a phone: one column, no horizontal scroll, targets at least 44px, body text at least 16px.

**Type.** Pass: two families at most, mono only for code and for figures that must align; four sizes or fewer on a working screen, each step at least 1.2 times the last; hierarchy carried by weight and colour before size; UI labels upright, never italic; figures in tabular numerals, amounts right-aligned on their decimal; nothing functional under 12px.

**Signature.** List every colour and every face in the render. Pass: each one is a value the signature printed, or a neutral step the field needs that you can name and count on one hand. `impeccable detect` reports the rest as outside the signature; read its list after every render. Fail looks like a competent screen by a stranger: a world's own palette and faces where this person's were on file. If a signature value fails a floor on this surface (a text colour short of 4.5:1, say), keep the value, use it where it passes or accept the advisory, and report the number; changing the signature is the user's call, never yours.

**Colour.** Name the job of every distinct colour in the render. Pass: one neutral ramp (the signature's neutrals as written when it names them; otherwise tinted slightly toward the brand hue instead of pure grey, cream by reflex, pure black or pure white); one accent, kept for what is interactive, selected or primary; state colours only where there is a state. A colour with no job goes. A colour meaning two things is split or cut.

**Familiar controls.** Pass: a switch looks like a switch, a choice among two to four options is visible as a segmented control or radio group where width allows, a menu is used only when the options do not fit, and the current value of every setting is readable without opening anything.

**Real content.** Pass: the longest real name, the largest plausible amount, the empty list and the error all fit without clipping, wrapping into a control, or pushing an edge.

## 4. The director's pass

This is the self-critique. It runs inside the inspection rounds SKILL.md already bounds: once after the build, once after the fixes, and then you stop.

1. **Render and look.** Capture the shipped widths (390 and 1440 on the web, the device classes on a native platform) as PNG at natural page height. Open each at full size, and once at quarter size for the squint. Judge the pixels, not your memory of the CSS: the code tells you what you meant, the image tells you what happened.
2. **Defects first.** Before any score, write down the three most visible faults at each width, each pointing at something you can see (the element, roughly where). A pass that finds nothing has not looked; first drafts always have three. Then run the tests in section 3 and `impeccable detect` on the file, and add what they catch.
3. **Score seven axes, 1 to 5, each with its evidence:** hierarchy, structure and alignment, type, colour, density and proportion, fit to task, finish (states, browser surfaces, real content). 5 means a director at the best product in this category would ship it unchanged; 4 means shippable with a nit; 3 means competent and forgettable; 2 means a visible fault; 1 means broken. A score without a visible reason does not count, and effort is not a reason.
4. **Fix.** Every axis under 4 gets a named fix. Then name the weakest axis even when everything reached 4, and improve that too. Ask the send-back question last: what is the first thing a design director would point at before sending this back? Fix that. Batch all of it into one round of edits.
5. **Confirm.** Render again, look again at full size, and rescore the axes you touched. This is the second round and the ceiling.
6. **Report what you judged, never ask to be judged.** Hand over the screenshots with two or three lines: what the pass found, what changed, and anything still under 4 with the reason it stayed. If an axis is still under 3, say so plainly and say what it needs; do not present it as finished and do not ask the user to rate it.

Where the harness has subagents and the build runs through new-work.md, the finish reviewer applies this same bar from fresh eyes; your own pass still runs first, because a reviewer should meet your second draft, not your first.

A brief that pins a look, in the user's own words, outranks sections 2 and 3 on the axes it names, exactly as it outranks the craft floor. Section 4 always runs.
