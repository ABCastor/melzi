> **Additional context needed**: quality bar and shipping constraints.

Polish is refinement, never concealed redesign. Preserve the incumbent visual world, content, behavior, and everything outside scope. If the concept itself is wrong, say so and recommend redesign or `bolder` instead of smuggling in a replacement.

A detector result is defect evidence, not proof of quality. Inspect the rendered experience and real interaction path.

## 1. Establish the system

Read DESIGN.md and representative tokens, shared components, patterns, and neighboring flows. If no formal system exists, use coherent project conventions.

Classify each drift before fixing it:

- **missing token:** the system needs a reusable value;
- **one-off implementation:** an existing shared component or pattern should replace it;
- **conceptual mismatch:** the flow, information architecture, or hierarchy differs from comparable product areas;
- **local defect:** the implementation is simply incomplete or inconsistent.

Fix the cause at the narrowest correct level. Ask when a binding system principle cannot be inferred.

## 2. Gather the evidence

Use the feature yourself at the surface's representative sizes: desktop and mobile on the web; on a native platform (`ios` / `android` / `adaptive`), the shipped device classes on the simulator, emulator, or hardware, captured per the platform reference's Verifying the build section. Determine:

- whether the path is functionally complete;
- the intended quality bar and time available;
- known constraints or deliberately unfinished work;
- the states, content lengths, roles, and input methods users will actually encounter.

If a prior critique exists, use it as one input:

```bash
.qoder/skills/melzi/scripts/impeccable critique-storage latest "<resolved target>" --json
```

Exit 0 returns JSON with the latest snapshot's `body` and an exact `snapshot_file` identity. Retain `snapshot_file` until the end of the pass. For a local file target, the helper compares the file's exact current content fingerprint with the fingerprint captured by critique. Unchanged staged, unstaged, or untracked content remains current; any byte change, deletion, or replacement with a non-file closes the backlog it identified while preserving its trend history and exits 2. A URL target has no local fingerprint and remains current until explicitly closed. When current, incorporate relevant P0/P1 findings from `body` and name the snapshot read. Exit 2 means none exists or the target changed. Perform an independent pass either way.

## 3. Triage

Separate functional defects from cosmetic ones and fix in this order:

1. broken or blocked tasks, data loss, misleading state, and inaccessible paths;
2. missing loading, empty, error, success, disabled, and permission states;
3. flow, hierarchy, responsive, and design-system drift;
4. visual and motion inconsistencies;
5. code and asset cleanup.

Do not perfect one corner while leaving the rest below the same quality bar.

## 4. Polish the whole path

### Flow and hierarchy

- Match neighboring mental models, terminology, disclosure, routing, save behavior, and optimistic or pessimistic patterns.
- Make the primary task and current state obvious without flattening every element to equal weight.
- Ensure arrival, transition, empty, and recovery paths connect instead of behaving as isolated screens.

### Layout and type

- Align to the project's grid and spacing scale; fix optical as well as mathematical alignment.
- Group related content tightly and separate distinct groups generously.
- Keep same-role typography consistent; test measure, wrapping, localization expansion, zoom, and font loading.
- Verify every supported viewport rather than correcting only the current screenshot.

### Color, imagery, and icons

- Use semantic tokens and stable color meanings across themes.
- Verify text, control, and focus contrast in every state.
- Keep icon families, stroke/weight, sizing, and optical alignment coherent.
- Prevent image layout shift; use correct aspect ratios, responsive sources, and useful alt text.

### Interaction and state

- Every control needs appropriate default, hover, focus, active, disabled, loading, error, and success behavior.
- Preserve visible keyboard focus, logical tab order, labels, and platform-appropriate touch targets.
- Keep motion coherent, interruptible, and performant. Do not add animation merely to make polish visible.
- Validate long, missing, localized, offline, slow, and permission-limited content where the product can encounter it.

### Content and code

- Keep terminology, capitalization, punctuation, and factual copy consistent. Ask before changing claims.
- Remove debug output, dead code, unused imports, obsolete styles, and polish-created duplication.
- Replace custom implementations with shared components where the system owns the pattern.
- Promote genuinely reusable values to tokens; do not create a system abstraction for one local exception.

## 5. Verify and finish

Walk the complete path again with mouse, keyboard, and touch where applicable. Check:

- mobile, intermediate, and wide layouts on the web; phone and tablet size classes in both supported orientations on native;
- loading, empty, error, success, disabled, long-content, and missing-content states;
- zoom, contrast, focus, semantics, and screen-reader names;
- console errors, layout shift, interaction latency, and image loading everywhere; supported browsers on the web; supported OS versions, runtime warnings, and dropped frames on native;
- agreement with DESIGN.md, neighboring features, and the user's scope.

Follow the quality guidance supplied by `impeccable context` and hooks, then run any other relevant QA commands. Context requests a manual scan only when no automatic detector is active; never add another detector pass. Fix real defects and document only narrow intentional exceptions. A clean scan does not replace visual judgment.

Finish with a source diff: remove accidental churn, orphaned code, redundant values, and temporary artifacts. Ship only when the feature is functionally complete and consistently finished across the path.

When this pass clears every Priority Issue it took from a snapshot, close that snapshot:

```bash
.qoder/skills/melzi/scripts/impeccable critique-storage close "<resolved target>" "<snapshot_file returned by latest>"
```

This closes only the snapshot this pass actually processed; if a newer critique landed meanwhile, its backlog stays live. Do not close when no snapshot was read, when `snapshot_file` was not retained, or when Priority Issues remain.

## Web adaptation implementation

A typed web `adapt` command runs [audit.md](audit.md)'s adaptation evidence pass first, then implements here. Adaptation rethinks the experience for the target context. It does not scale pixels.

### Choose the structure for the context

**Desktop to mobile:** move to a clear single-column or deliberately stacked structure; make components fluid; transform navigation only where the information architecture stays recognizable; prioritize primary content; put secondary content behind progressive disclosure; use concise copy, persistent context, breadcrumbs, or a back path where the task needs them; keep text at a readable 16px baseline; and make every touch target at least 44x44px without relying on hover. Swipe, bottom sheets, drawers, and bottom navigation are available when the interaction and platform expectations justify them, never as automatic mobile substitutions.

**Tablet:** support touch and pointer, portrait and landscape, and intermediate widths. Use two-column, side-panel, master-detail, or multi-column form layouts when they make the task clearer. Do not ship either a stretched phone or a cramped desktop.

**Mobile to desktop:** use horizontal space for side navigation, multiple information panes, rich tables, and detail that benefits from simultaneous visibility. Add keyboard shortcuts, hover detail, context menus, drag and drop, and multi-select only where they remain discoverable and accessible. Keep a max width so a 4K screen does not stretch reading and controls into empty geography.

**Print:** remove interactive chrome, choose logical page breaks, use print-safe colour, set margins, expand hidden or abbreviated content, print full URLs where useful, add page metadata and numbers, and convert interactive charts into readable static forms.

**Email:** keep the layout single-column and about 600px wide, inline styles, use compatibility-safe table layout where clients demand it, make CTAs obvious, avoid hover-dependent behavior, and deep-link complex interaction back to the product.

### Implement with content-driven conditions

Write mobile-first base styles and add complexity with `min-width` queries. Stretch the content until it breaks, then add a breakpoint. Common 640px, 768px, and 1024px points are starting probes, not device truth. Use Grid, Flexbox, container queries, `clamp()`, media queries, and selective display changes according to the actual component.

Detect input capability separately from width:

```css
@media (pointer: fine) {
  .button { padding: 8px 16px; }
}

@media (pointer: coarse) {
  .button { min-width: 44px; min-height: 44px; padding: 12px 20px; }
}

@media (hover: hover) {
  .card:hover { transform: translateY(-2px); }
}
```

No required action may depend on hover. Provide touch feedback and place frequent controls within practical reach without forcing a platform-specific mobile-app pattern onto a website.

Handle notches, rounded corners, and home indicators:

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
```

```css
body {
  padding-top: env(safe-area-inset-top);
  padding-right: env(safe-area-inset-right);
  padding-bottom: env(safe-area-inset-bottom);
  padding-left: env(safe-area-inset-left);
}

.footer {
  padding-bottom: max(1rem, env(safe-area-inset-bottom));
}
```

Use `srcset` width descriptors and `sizes` for resolution selection:

```html
<img
  src="hero-800.jpg"
  srcset="hero-400.jpg 400w, hero-800.jpg 800w, hero-1200.jpg 1200w"
  sizes="(max-width: 768px) 100vw, 50vw"
  alt="..."
>
```

Use `picture` when the composition itself needs a different crop:

```html
<picture>
  <source media="(min-width: 768px)" srcset="wide.jpg">
  <source media="(max-width: 767px)" srcset="tall.jpg">
  <img src="fallback.jpg" alt="...">
</picture>
```

Transform navigation in stages only when the target needs it: drawer on narrow screens, compact horizontal form on intermediate widths, full labels on wide screens. Tables may become labelled record blocks when columns cannot remain legible. `<details>` and `<summary>` are useful for secondary content that can truthfully collapse. Hiding content still downloads it; use selective loading for expensive secondary assets.

### Protect the product across contexts

Core functionality stays available on small screens. Keep one information architecture even when its presentation changes. Support touch on desktop hardware, landscape on phones and tablets, older devices, slow connections, and both fine and coarse pointers. Prefer feature detection to device-model detection. Keep one codebase unless the product itself is different.

DevTools proves layout, not touch, keyboard appearance, real CPU and memory pressure, network behavior, or platform font rendering. Test at least one real iPhone, one real Android device, and a tablet when the product ships there. Include Safari, Chrome, Firefox, and Edge across the supported iOS, Android, Windows, and macOS paths; portrait and landscape; keyboard, mouse, touch, and zoom; 320px through large desktop; and a throttled network.

**Custom controls** (sliders, drag surfaces, scrollable control strips): a before/after slider can pass every width check above and still refuse to drag on iOS, so exercise each one in scope in the same batched round as the checks above:

- **Primary gesture**: Tap it and confirm it responds as designed, then drag it with the target input method; the drag must complete, not just start
- **Scroll across it**: A swipe along the page's scroll axis across the control scrolls the page or container without activating it; a drag that starts on the control along its axis moves the control, not the page. Neither failure throws an error, so try both
- **Evidence**: Say what produced the evidence: an emulated viewport, synthesized touch input through a browser tool, which engine ran it (Chromium is not Safari), or a physical device. Screenshots and resized viewports verify layout, never a gesture. Name what stayed untested and move on; unreachable hardware is a reported gap, not a blocker
