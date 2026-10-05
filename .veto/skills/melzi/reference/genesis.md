# Genesis: pick a world, get a real screen

Load this from [new-work.md](new-work.md) when all five hold: the run creates or replaces a visual world, the session is attended, the platform is web, no user- or brief-pinned direction is in play (a pinned direction beats every roll and every deal, always), and a local world pool answers. Anything else stays on new-work.md's catalog-card path, unchanged.

Test the last condition first, before any other work:

`node .veto/skills/melzi/scripts/melzi/world-pool.mjs --deal --count 3`

Success is exit 0 with a JSON hand on stdout; that output IS the first hand, so do not deal again in section 2. Exit 3 means this machine has no pool: say so in one line, return to [new-work.md](new-work.md) step 4, and run the presentation there as written. Nothing in the pick reaches the network: the hand comes from the local pool or the deal fails. The one external request in this whole flow is the Google Fonts link the signature's faces need.

## 1. Load the signature

`node .veto/skills/melzi/scripts/melzi/signature.mjs`

It prints the invariants that make everything the user ships recognisably theirs, and ends by naming the layers that are free to vary. Hold the invariants exactly in every screen you build: the values as printed, no resampling, no near-substitutes. `NO_SIGNATURE` means there is nothing to hold; carry on through this flow and let each world bring its own palette and faces.

## 2. The hand

The first hand is the gate call's own output. Every later hand runs the same command with the exclude list:

`node .veto/skills/melzi/scripts/melzi/world-pool.mjs --deal --count 3 --exclude id,id,id`

The exclude list is every world id already shown in this genesis, comma separated. The hand comes back as JSON: `id`, `name`, `form`, `spark`, `system` (the world's grammar), `webLeverage` (the technique it lives on), and `structure`, a named whole-page shape from [macrostructures.md](macrostructures.md). That is the brief for the screen you are about to build; nothing else about the world is authoritative.

The world and the structure are two axes, and both bind. The world says what the screen is made of; the structure says where the headings sit, what order the page is read in, and how dense it is. Build the dealt structure rather than the one the world suggests to you: a hand whose three screens share a shape is three paint jobs, and it can only ever teach which paint he prefers.

Three at a time out of a wide pool, on purpose. Generating breadth and comparing breadth are separate knobs, and only the first is free: a large simultaneous set costs most when the person choosing cannot say why one thing beats another, which is the condition this flow is built for. So the pool holds many worlds and the hand holds three. The spread inside the hand is mechanical, MMR in the dealer trading closeness against novelty, so "mostly far apart, a couple near" is a parameter rather than something you curate. Take the hand as dealt: do not drop a world that reads unpromising on paper, and do not add one of your own.

## 3. Build one real screen for each dealt world

Three files, one per world, authored as `<project>/.impeccable/screens/<id>.html`. Each is a single self-contained HTML page, one viewport, real content read from PRODUCT.md, at the fidelity of something shippable. Not a card, not a moodboard, not three panels in one document. Keeping the authored file inside the project lets the coding agent write it and read it back without a permission prompt.

- **The invariants hold exactly.** Colours and the role each one plays, the neutrals, the type pairing, the ratio. Where a world's system grammar names its own palette or typeface, the signature wins and the world adapts around it. A world that cannot survive that swap had nothing but its palette.
- **The world lives only in the free layers**: layout, composition, density, texture, imagery, motion, ornament, scale, grid, materiality. That split is what lets three widely different screens still read as one product.
- **Build the technique, do not imitate it.** When the dealt world's `webLeverage` names canvas, WebGL, view transitions, or generative motion, the screen runs it for real at one viewport's worth. A still picture of a technique is what makes three screens look like the same screen.
- **Self-contained.** Inline the CSS and the JS, no build step and no dev server, so the page renders from the file itself inside the decision card. The Google Fonts link for the signature's faces is the only permitted external request.
- **Real content, invented commerce never.** Names, copy, and states come from PRODUCT.md. Author whatever illustrative material the screen needs at full fidelity and label it synthetic. Prices, customers, benchmarks, and capabilities the product does not have stay out.

Build all three at the same level of commitment. A hand where one screen is finished and two are sketched is not a choice between worlds, it is a choice between amounts of effort.

## 4. Put the three screens in front of the user

`.veto/skills/melzi/scripts/impeccable serve-question --start --payload <file>` (run it with `--schema` first for the exact shape). One option per dealt world, each carrying the absolute path of its project-owned screen as the option's `screen`; enable re-roll and steer. Keep `canon` enabled too: the standing exit is the user's permanent door to the category standard and genesis does not close it, though you never recommend it or weigh it against the hand. Collect the choice with `--wait --key <key>`, repeating while it exits 3. The ANSWER carries the chosen `screen` path back.

What the user approves here is a screen, so the usual gap between an approved mood and the surface it produces does not exist in this flow: there is nothing left to translate. Their reaction to the screen outranks the world's lineage, the card, and your reading of the brief. When the user passes on the world you rated highest, that is the answer, not a misunderstanding to argue with.

## 5. Re-roll deals the next three

A re-roll excludes every id shown so far in this genesis, deals three more from the pool, and gets three fresh screens built to the same standard. The pool is finite, so name the thin cases instead of assuming three: a deal that returns one or two worlds is the pool running dry; present what came back and say so. A deal that exits 3 mid-flow means the pool is exhausted; say so, keep the ids already shown and any steer, and return to [new-work.md](new-work.md) step 4 for the remainder. After two consecutive re-rolls, stop dealing and ask in plain words what quality is missing, then feed that answer back as the steer on the next hand. Two full hands refused is information about the pool or the signature, and dealing a third blind wastes it.

## 6. The chosen screen is the reference

The approved file is what the build that follows is measured against: its composition, density, type scale, and material, the way an approved comp governs an ordinary build. Do not reinterpret the world from scratch once the choice lands. Record the chosen world in the surface brief as new-work.md section 5, Record the decision, directs, then continue there for the direction contract, the build, and the finishing pass, and come back to section 7 here to prove the binding before calling genesis done. Section 4, Commit the world, still binds on the way through: with a signature loaded its colour and typeface calls are already made and the approved screen fixes the rendition, but its calibration against the saturated default looks applies in full to every layer the signature left free, and applies to everything when this flow ran NO_SIGNATURE.

## 7. Register the hand, and learn from it

Every screen you built is a candidate, whether he picked it or not. Register all three with `appendCandidate` from [taste.md](taste.md) before the session ends, each with its id, label, a shared `subject` naming what the screens are of, and the absolute path of its project-owned screen file. Registration copies each file to `~/.impeccable/screens/<id>.html` and records that durable copy, so the losers stay available to compare and breed after this project is gone.

A pick here is one bit about a hand of three, and it does not carry to the next surface. When he has the appetite for a few more clicks, follow [taste.md](taste.md): it compares the same screens two at a time, names the attributes on which they differ, and fits a profile that can score a screen he has never seen. Genesis is the fast door, one look and a commitment. The comparison loop is the one that generalizes. Neither replaces the other, and a session may reasonably do both, in that order.
## 8. Prove the binding, then call it done

Genesis does not end when the build lands: it ends when the pick provably binds. Once new-work.md's finishing pass has recorded DESIGN.md from the built world, run `node .veto/skills/melzi/scripts/melzi/declared-waivers.mjs` in the project so the taste rules defer to what DESIGN.md now declares, then run `node .veto/skills/melzi/scripts/melzi/bind-verify.mjs`, which plants a canary on each side of the line and checks both directions: an off-system value draws a drift finding, a declared value passes clean. Quote its output to the user verbatim. Exit 0 is the only close of this flow; any other exit means the approved look is a decorative file enforcing nothing, so name the direction that failed and repair the binding before declaring genesis complete. Waivers never touch accessibility rules: a real contrast failure stays flagged whatever the declaration says.

## 9. Top up the pool between runs, never during one

When online and not in the middle of a pick:

`node .veto/skills/melzi/scripts/melzi/world-pool.mjs --build --rounds 2`

extends the pool for next time. Never during the pick itself. A pick that waits on generation is a pick that waits on the network, and removing that wait is why the pool exists.
