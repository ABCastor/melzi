> **Additional context needed**: performance constraints.

Use motion to explain state, relationship, and hierarchy, or to create one authored moment the surface has earned. Decoration without purpose is animation debt.

---

## Visitor mode

- **Persuade + Experience:** motion may carry the voice. Prefer one rehearsed focal sequence to repeated section reveals.
- **Operate + Read:** motion serves feedback, state, and continuity. Keep routine transitions fast and do not make users wait through page-load choreography.
- **Native (`ios` / `android` / `adaptive`):** follow the Motion section of [ios.md](ios.md) or [android.md](android.md), including the platform's Reduce Motion behavior. Do not apply the web tooling below.

## Find the job

Inspect the existing motion language, interaction states, target devices, and performance budget. Find only the places where motion would:

- acknowledge an action;
- make a state change or spatial relationship legible;
- preserve continuity through navigation or layout change;
- direct attention at a meaningful moment;
- embody the selected visual world.

Ask only when a material constraint cannot be inferred. Do not animate a static area merely because it exists.

## Set the motion thesis

Write a short plan before implementation:

- **Focal moment:** the one sequence or interaction that deserves authorship, if any.
- **Continuity:** the state, layout, or navigation changes that need explanation.
- **Feedback:** the controls and outcomes that need acknowledgment.
- **Budget:** which effects may be expensive and how often they run.

The focal moment must come from this product and surface concept. A generic fade-and-rise, hover lift, parallax layer, or scroll reveal is not a thesis.

## Choose material by meaning

Transform and opacity are reliable foundations, not the entire palette. Choose properties for what the transition communicates:

- **Continuity and relationship:** shared-element motion, FLIP-style transforms, view transitions, or deliberate spatial movement.
- **Focus and depth:** bounded blur, filter, backdrop, light, or shadow changes.
- **Reveal and composition:** masks, clip paths, cropping, or controlled occlusion.
- **Material and energy:** color, gradient position, texture, distortion, or shader effects when the world and runtime support them.
- **State and feedback:** the smallest change that makes cause and result unmistakable.

Do not stack techniques for spectacle. One strong material idea, carried through the focal sequence and quiet supporting states, is usually enough.

Sibling stagger is appropriate when a list appears as a list. Cap the total delay, and never reinterpret every scrolled section as a staggered list.

## Timing and easing

Timing should express distance and consequence:

| Duration | Typical use |
|---|---|
| 100–150 ms | immediate feedback |
| 150–300 ms | routine state change |
| 300–500 ms | layout, overlay, or view transition |
| 500–800 ms | a deliberately authored focal entrance |

Exit faster than entrance. Use natural deceleration such as `cubic-bezier(0.16, 1, 0.3, 1)` for confident arrivals; do not use bounce or elastic curves by reflex. Long feedback feels like latency.

## Implement to the runtime

- Use CSS transitions and keyframes for declarative state and bounded sequences.
- Use Web Animations API or the project's existing motion library for interruption, sequencing, and dynamic values.
- Use View Transitions or shared-element techniques when continuity across states is the point.
- Use scroll-driven motion only when the scroll relationship itself carries meaning, with a robust fallback.
- Do not add a dependency for an effect the existing stack can express cleanly.

Keep content visible in the default state so failed scripts do not hide the page. Avoid casually animating layout-driving properties such as `width`, `height`, `top`, `left`, and margins; use FLIP, transforms, or grid techniques when appropriate. Bound blur, filter, shadow, canvas, and shader work to isolated regions. Apply `will-change` only during known animation. Measure on target viewports and devices rather than assuming transform means fast.

## Accessibility and control

Respect autoplay and sound preferences. Any nonessential loop must stop when offscreen or hidden.

Every web animation needs a `prefers-reduced-motion` path with an intentional alternative. Remove or reduce spatial movement while preserving opacity, color, and state transitions that carry meaning. Reduced motion means fewer and gentler animations, not disabling all motion; feedback that confirms an action should remain legible.

## Capture existing motion

Motion you did not write has to be recorded before it can be judged. The DOM, the computed styles, and a still screenshot all describe one instant: they prove a transition is declared and show where it lands, and they say nothing about how it got there. Write the shortest interaction script that reaches the behavior in question, then record it:

```bash
node .trae/skills/melzi/scripts/motion-eyes.mjs \
  --url <url-or-local-html> \
  --do "scroll 0..100 over 4s; hover a.link for 1s; click [data-theme-toggle] then 1s" \
  --name motion-review \
  --output-dir .impeccable/motion
```

Interactions are semicolon-separated: `wait <duration>`, `scroll <start>..<end> over <duration>`, `hover <css-selector> [for <duration>]`, `click <css-selector> [then <duration>]`. Durations take `ms` or `s`; scroll positions are percentages of the document unless suffixed with `px`. `--help` carries the rest. Requires a Playwright install the script can resolve, and installs nothing itself.

Read `motion-review-frames.png` first. Twelve stamped frames in one image show choreography: which elements entered and in what order, how far the scroll travelled, whether a reveal overshoots, whether the opening and closing states cohere. Then watch `motion-review.webm` before saying anything about smoothness, frame pacing, easing shape, perceived latency, interruption, or scroll coupling. A hitch that falls between two sampled frames leaves no trace on the sheet, so the sheet can confirm those properties but never rule a defect out.

Check `uniqueFrameCount` in the JSON before trusting either artifact. Frames that are all identical mean the page never moved or the capture never saw it move, and the sheet then looks like evidence while carrying none.

When the brief names a reference ("like the website", "as smooth as X"), record the reference with the same script, viewport and scroll distance, and read the two contact sheets side by side. A recording that is only consistent with itself proves nothing about matching the thing it was meant to match.

Report the command, the viewport, the frame count, and any console errors next to the verdict. When the browser cannot launch or the target is unreachable, say the motion is unverified and name the blocker. A failed capture is missing evidence, never a verdict in either direction.

## Technical ambition catalogue

The `overdrive` alias loads this catalogue after [bolder.md](bolder.md) settles the direction. Choose by the job, not by novelty.

### Cinematic transitions

- **View Transitions API:** shared-element morphing within a document across current browsers; cross-document transitions still need a Firefox fallback. Use it for a list item expanding into detail or a trigger becoming a dialog.
- **`@starting-style`:** animate entry from `display: none` with CSS, including entry keyframes.
- **Spring physics:** use motion, GSAP, or a small solver when mass, tension, and damping express the material better than a cubic bezier.

### Scroll-coupled motion

- **Scroll-driven animations (`animation-timeline: scroll()`):** CSS-native parallax, progress, and reveal sequences in Chrome, Edge, and Safari. Firefox still needs a static fallback.

### Rendering beyond CSS

- **WebGL:** shader effects, post-processing, particles, and large custom scenes on all major browsers. Three.js, OGL, or regl are options when the project already justifies a library.
- **WebGPU:** GPU compute and rendering where supported. Always provide WebGL2 or a complete static fallback.
- **Canvas 2D and OffscreenCanvas:** pixel work or custom rendering, with heavy rendering moved to a Worker where necessary.
- **SVG filter chains:** displacement, turbulence, and morphology when an authored vector effect is the right material. Keep the region bounded.

### Data and large interfaces

- **Virtual scrolling:** render only visible rows for very large tables and lists. A small implementation can be library-free; complex cases may justify TanStack Virtual.
- **GPU charts:** use Canvas or WebGL when the dataset is too large for SVG or DOM rendering; deck.gl or a regl-based renderer may fit an existing stack.
- **Animated data transitions:** morph states through D3 or View Transitions instead of replacing them without continuity. Force-directed graph layouts may settle naturally when the data relationship, not spectacle, calls for them.

### Complex property animation

- **`@property`:** register typed custom properties so gradients, colors, and other compound values interpolate.
- **Web Animations API:** use composable, cancellable, reversible JavaScript-driven animation when CSS cannot express the sequence or interruption model.

### Performance work

- **Web Workers:** move expensive search, image processing, indexing, and other computation off the main thread.
- **OffscreenCanvas:** keep custom rendering off the main thread when the browser supports it.
- **WASM:** use near-native computation for work such as image processing, physics, or codecs only when profiling shows JavaScript is the bottleneck.

### Device interaction

- **Web Audio API:** audio-reactive work or sonic feedback, started only by a user gesture and with explicit consent.
- **Device APIs:** orientation, ambient light, and geolocation only when the product needs them, with permission and a complete denied-permission path.

The catalogue changes how an existing feature feels; collaboration, offline support, and new backend capability are product changes outside this command.

### Progressive enhancement and performance

Every technique degrades to a complete experience:

```css
@supports (animation-timeline: scroll()) {
  .hero { animation-timeline: scroll(); }
}
```

```javascript
if ('gpu' in navigator) { /* WebGPU */ }
else if (canvas.getContext('webgl2')) { /* WebGL2 fallback */ }
/* The CSS-only result remains complete. */
```

Target 60fps and simplify when the experience drops below 50fps on representative hardware. Lazy-initialize WebGL, WASM, and other heavy resources near the viewport. Pause offscreen rendering. Test on real mid-range devices rather than treating a development machine as the audience.

## Verify

- The focal motion is specific to the selected world and surface.
- Every supporting animation explains feedback, state, or relationship.
- Interruption and repeated use behave correctly.
- Desktop, mobile, and keyboard paths remain usable.
- The `prefers-reduced-motion` path reduces movement without erasing meaningful feedback or state changes.
- Expensive effects stay smooth on the target device.
- Removing an animation would lose meaning or authored character, not merely decoration.

When motion earns its place, hand off to `/melzi polish` for the final pass.
