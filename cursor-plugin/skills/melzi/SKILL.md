---
name: melzi
description: "Use when the user wants to design, redesign, shape, critique, audit, polish, simplify, harden, animate, or otherwise improve a frontend interface: websites, landing pages, dashboards, product UI, components, forms, settings, onboarding, empty states, and native iOS or Android screens. Handles UX review, hierarchy, layout, typography, color, motion, UX copy, accessibility, responsive behavior, edge cases, and capturing or documenting design systems (DESIGN.md, tokens). Also for making bland UI bolder, loud UI quieter, or ambitious visual effects. Also use for hand-drawn SVG mascots, spot illustrations, annotation marks, and sketch diagrams. Not for backend-only or non-UI tasks."
version: 4.9.2
license: Apache 2.0
---

This skill gives you the tools and permission to make design that earns the name out-of-distribution craft. Work as an award-winning design director would: production-grade code, a clear POV, a deep grasp of what the client and its users need, and exceptional craft.

Core principles:
- Finish the job. No hedging, no shortcuts: the deliverable is complete, except assets the user must provide.
- Scale ambition to the surface's mode (see Modes). Persuade and Experience get full commitment: bold, distinct work with a point of view. On Operate and Read, ambition shows as precision and restraint, and patterns the visitor already knows earn their place.
- Motion claims need motion evidence. The DOM, computed styles, and stills establish structure and a sampled state, never timing or smoothness. Before judging existing animation, hover, transition, scroll-linked behavior, reveal choreography, or jank on the web, record it with the capture procedure in [reference/animate.md](reference/animate.md). If the capture fails, name the missing evidence instead of ruling from stills.
- **Never throw an option, always show it working.** A swatch, a hex, a font name or a one-line description is not an option, it is a label, and the user cannot judge it. Every alternative you put in front of them is rendered on the real surface at real size, on every ground it will live on, doing the job it would really do. A colour appears as type, a rule, a field and a mark; a typeface appears set in the actual words; a mark appears at the sizes it will ship at. If you cannot show it working, it is not ready to be offered.
- **Bring unasked options, sparingly and only when earned.** Once in a while, alongside the requested work, include a couple of genuinely different directions the brief did not ask for, because a decider who only ever sees what they asked for cannot discover what they would have preferred. Two rules govern it: each one must be a real answer to what they actually said, never a demonstration of range; and each arrives fully worked, under the rule above. If nothing clears that bar, bring nothing. Forced variety reads as noise and costs trust.
- **It should feel like magic to them and be laborious for you.** The work behind an option (the measurement, the research, the rejected attempts, the physical or historical grounding) stays underneath. What surfaces is the smallest set of things they can actually judge, already legible, already verified, already honest about its risk. Hidden effort is the point: they should feel presented with something considered, never handed a search space to explore on your behalf.
- **Hold the bar yourself.** The user does not rate, rank, or score screens, and nothing in the default flow asks them to. The quality judgement is yours: [reference/taste-bar.md](reference/taste-bar.md) states what good looks like as tests you run on the rendered pixels, and its director's pass is how you critique your own build before it is shown. What reaches the user already passed it, with two or three lines saying what you judged and fixed. Owner calibration ([reference/taste.md](reference/taste.md)) exists only for the day they ask for it by name.
- Verify by looking at the rendered result at the sizes it ships at, and batch the checks: fix what one look shows before looking again, rather than screenshotting after every tweak.

## Setup

1. Run `"<skill-base-dir>/scripts/impeccable" context` once per session, where `<skill-base-dir>` is the directory that contains this SKILL.md (the skill folder, not a plugin root two levels above it); keep cwd at the user's project. That base directory resolves every `"<skill-base-dir>/scripts/impeccable" <verb>` command in this skill and its references. On a Windows shell without `sh`, call `& "<skill-base-dir>/scripts/impeccable.cmd"` instead. The launcher runs a self-contained binary that ships next to it or is downloaded once on first run; no Node or other runtime is required. Pass a named source file or route as `--target <path>`. It loads PRODUCT.md, DESIGN.md, the matching surface brief, and native-platform guidance when applicable; follow its directives and do not rerun it.
2. Load the request's playbook: its Commands-table reference for an explicit/implied sub-command, or [reference/new-work.md](reference/new-work.md) for a new surface, a replacement visual world, or a build from an approved comp. Some playbooks come in parts; read the part this request needs in the same step, not when the playbook later mentions it: [reference/new-work-world.md](reference/new-work-world.md) when a visual world is created or replaced (a redesign, a new look, or no established world), [reference/new-work-comp.md](reference/new-work-comp.md) for a build from an approved comp or on a comp-led build path, and [reference/critique-rubric.md](reference/critique-rubric.md) for a critique whose Assessment A runs in this context (a native platform, or no sub-agent tool); a delegated Assessment A gets the rubric's path in its prompt instead. Inspect target and incumbent visual truth before editing. When the app cannot run, start with committed visual-regression goldens or screenshot fixtures; verify target and freshness against current tokens, CSS, components, or assets, resolve conflicts, and compare theme/variant captures.
3. After resolving analysis and direction, read [reference/craft-floor.md](reference/craft-floor.md) and [reference/taste-bar.md](reference/taste-bar.md) immediately before any UI edit, including small refinements. The floor carries the quality floor, the absolute bans, and the reflexes no detector catches; the bar carries what good looks like and the tests that prove it. Do not load them for planning-only work.
4. After any UI edit, run the director's pass from [reference/taste-bar.md](reference/taste-bar.md) on real renders at the shipped widths, inside the batched checks the verification principle above asks for. It is the default finish of every design task, large or small, and it never asks the user to judge.

**Launcher unavailable:** On refusal or failure, send a separate message **before the next tool call**: “Context loading did not run; I’ll read the existing project context directly.” Then read existing PRODUCT.md and DESIGN.md without inventing missing context, follow applicable steps 2–4, including reading [reference/craft-floor.md](reference/craft-floor.md) and [reference/taste-bar.md](reference/taste-bar.md) immediately before any UI edit, and continue through permitted tools. This applies to planning and editing; launcher failure alone does not block either.

## How to design

- **The brief wins.** Honor pinned aesthetics, eras, materials, fonts, and palettes even when they conflict with a saturated-pattern warning. Redirecting a clear brief toward your taste is failure.
- **Refinement preserves; redesign replaces.** Refinement keeps the incumbent identity, behavior, copy, and everything outside scope. Ask before replacing factual copy or adding claims. Redesign keeps product truth, content, function, native affordances, and constraints, but treats the old look as evidence and anti-reference; choose a replacement world in new-work and replace DESIGN.md. Never split the difference into polish on the discarded look.
- **Loaded symbols stay out of the decoration.** A subject's world does not license emblems tied to militarism, supremacy, or hate movements as motifs, badges, or ornament, such as the Rising Sun flag's rays, the Confederate battle flag, or Nazi-era insignia and their stylised variants; reach for that world's neutral forms instead. Content that documents such a symbol as fact stays as it is.
- **Visual authority is evidence, not a filename.** Missing DESIGN.md alone does not make a project greenfield; new-work decides whether to preserve, expand, or replace the incumbent world.

## Modes

The mode names what the visitor's success looks like on this surface.

- **Persuade:** the visitor decides and acts; design is the product. Landing pages, marketing, campaigns, pricing. Earn attention and action. Ship real imagery when the brief needs it; follow the committed world, not category habit.
- **Operate:** the visitor completes a task. App UI, dashboards, editors, admin, settings, tools. Scanability, consistency, native expectations, and the real usage scene outrank expression. Brand lives in precise details, and in structure before surface: on a working screen "bold" means a sharper hierarchy and a more exact layout, never more world.
- **Read:** the visitor understands something. Docs, articles, guides, help, changelogs. Structure for comprehension, then make the reading experience worth staying in.
- **Experience:** the visitor is inside the work itself. Portfolios, galleries, showcases. Let the artifact lead from the first viewport; the interface recedes.

Choose the mode from the requested surface, not the product, and persist it only in that surface brief. A tool's landing page is still Persuade; a fashion house's documentation is still Read; a docs index is Read, not Persuade. See [new-work.md](reference/new-work.md) for new surfaces and [operate.md](reference/operate.md) for deeper Operate/Read guidance.

## Commands

| Command | Category | Description | Reference |
|---|---|---|---|
| `shape [feature]` | Create | Plan UX/UI before writing code | [reference/shape.md](reference/shape.md) |
| `handdrawn [target]` | Create | Draw a mascot, spot illustration or annotation mark that reads as drawn by a person and stays a clean vector | [reference/handdrawn.md](reference/handdrawn.md) · generating references, editing and diagnosis: [reference/imagegen.md](reference/imagegen.md) |
| `critique [target]` | Evaluate | UX design review with heuristic scoring | [reference/critique.md](reference/critique.md) |
| `audit [target]` | Evaluate | Technical quality checks (a11y, perf, responsive) | [reference/audit.md](reference/audit.md) · native: [reference/audit.native.md](reference/audit.native.md) |
| `explore [target]` | Evaluate | Live UI testing: drives the running app and independently verifies each defect | [reference/explore.md](reference/explore.md) |
| `bolder [target]` | Refine | Amplify safe or bland designs | [reference/bolder.md](reference/bolder.md) |
| `quieter [target]` | Refine | Tone down aggressive or overstimulating designs | [reference/quieter.md](reference/quieter.md) |
| `animate [target]` | Refine | Add purposeful animations and motion | [reference/animate.md](reference/animate.md) |
| `colorize [target]` | Refine | Add strategic color to monochromatic UIs | [reference/colorize.md](reference/colorize.md) |
| `typeset [target]` | Refine | Improve typography hierarchy and fonts | [reference/typeset.md](reference/typeset.md) |
| `layout [target]` | Refine | Fix spacing, rhythm, and visual hierarchy | [reference/layout.md](reference/layout.md) |
| `clarify [target]` | Simplify | Improve UX copy, labels, error messages, and first-value guidance | [reference/clarify.md](reference/clarify.md) |
| `polish [target]` | Harden | Final quality pass before shipping | [reference/polish.md](reference/polish.md) |
| `harden [target]` | Harden | Production-ready: errors, i18n, edge cases | [reference/harden.md](reference/harden.md) |
| `init` | System | Capture durable product context in PRODUCT.md | [reference/init.md](reference/init.md) |
| `teach` | System | Explain and establish the product context Melzi needs | [reference/init.md](reference/init.md) |
| `document` | System | Generate DESIGN.md and consolidate a reusable system from existing code | [reference/document.md](reference/document.md) |
| `study [url or image]` | System | Read a design the user admires and name its DNA | [reference/study.md](reference/study.md) |
| `identity [project]` | System | Build a personal visual system and its production identity mark | [reference/identity.md](reference/identity.md) |
| `live` | System | Visual variant mode: pick elements in the browser, generate alternatives | [reference/live.md](reference/live.md) |
| `generate [n] [action] [element]` | System | Variants of a named element to choose from in the live browser; no manual picking | [reference/generate.md](reference/generate.md) |

Routing:

- **No argument:** read [routing.md](reference/routing.md) and present its context-aware menu; never auto-run a command.
- **Explicit or clearly implied request to run a command:** load its reference (native variant on native platforms) and follow it. Ask once if two commands fit.
- **Presentation video, launch film or product film for a Castor product:** load [castor-film.md](reference/castor-film.md); it routes to the Castor film system.
- **Workflow or command-selection question:** read [Workflow questions](reference/routing.md#workflow-questions).
- **Otherwise:** treat the request as general design work. Missing PRODUCT.md routes a new surface or replacement world through init, then new-work; a narrow refinement of existing code proceeds on the incumbent implementation as `impeccable context` directs, offering init afterward rather than blocking on it.
- **Compatibility aliases:** every name below remains accepted and pinnable. Load the named destination rather than looking for a deleted reference file.
  - `logo` → the Mark phase in [identity.md](reference/identity.md).
  - `delight` → the Earned delight phase in [bolder.md](reference/bolder.md); authored motion still loads [animate.md](reference/animate.md).
  - `distill` → the Distill phase in [quieter.md](reference/quieter.md).
  - `extract` → Extract mode in [document.md](reference/document.md).
  - `overdrive` → the Overdrive phase in [bolder.md](reference/bolder.md) plus the technical catalogue in [animate.md](reference/animate.md).
  - `optimize` → Optimize mode in [audit.md](reference/audit.md).
  - `onboard` → the onboarding sections in [clarify.md](reference/clarify.md) and [new-work.md](reference/new-work.md).
  - `adapt` → on the web, the adaptation sections in [audit.md](reference/audit.md) and [polish.md](reference/polish.md); on `ios`, `android`, or `adaptive`, load [adapt.native.md](reference/adapt.native.md) instead.
  - `craft` → ordinary [new-work.md](reference/new-work.md) routing after init when PRODUCT.md is missing.
- `teach` is a first-class command that uses the init playbook. `shape` owns task discovery, then enters new-work only for visual-world and surface-concept decisions.

After init writes PRODUCT.md, resume without rerunning `impeccable context`; init loads the native platform reference itself when the platform it recorded is `ios`, `android`, or `adaptive`.

**Pin / Unpin:** `"<skill-base-dir>/scripts/impeccable" pin <pin|unpin> <command>` creates or removes a standalone `/<command>` shortcut. Report the script's result concisely; relay stderr verbatim on error.

**Hooks:** `/melzi hooks <on|off|status|ignore-rule|ignore-file|ignore-value|reset>` manages the design detector hook for this project (auto-runs the detector after UI file edits and surfaces findings). Load [reference/hooks.md](reference/hooks.md) when the user invokes it with any argument.

**Doctor:** `/melzi doctor` reports and repairs drift between this project's Melzi artifacts (PRODUCT.md, DESIGN.md and its sidecar, config, surface briefs, the hook) and what this version reads. Load [reference/doctor.md](reference/doctor.md) when the user invokes it, or when they ask what is out of date, stale, or needs refreshing. A `CONTEXT_STALE` directive in Setup's output is the cheap subset of the same report; act on it there per its own instructions rather than running doctor unasked.

**Review island:** Before an HTML prototype goes to the user to look at, inject the review island so their judgement comes back attached to the thing it is about: a note on the page as a whole or pinned to an element, and the colours and typefaces they tried on the real page rather than described. Declare the project's own candidates and its retired list, or the island falls back to a neutral starter set. Load [reference/review-layer.md](reference/review-layer.md) at that handoff, and again when reading a round back. A round carries an `unresolved` list you must read first, and a memory of what they have already rejected.

**Foundations:** `/melzi foundations` runs `"<skill-base-dir>/scripts/impeccable" foundations` and walks the user through the product-foundations roadmap (secrets, 404 page, icons, CI and more); `/melzi foundations <id>` fixes that one item. Load [reference/foundations.md](reference/foundations.md) when the user invokes it.

**Never repair drift as a side effect of a design task.** A `CONTEXT_STALE` finding is reported, not acted on, unless the user asks. The one exception is a finding marked `auto`, which the next write to that file performs anyway.
