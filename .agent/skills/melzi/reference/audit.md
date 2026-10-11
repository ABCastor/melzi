Run systematic **technical** quality checks and generate a comprehensive report. Don't fix issues; document them for other commands to address.

This is a code-level audit, not a design critique. Check what's measurable and verifiable in the implementation.

**Web only.** Native platforms (`ios` / `android` / `adaptive`) route to [audit.native.md](audit.native.md) instead; if the project is native, switch to it now.

Read [rigor.md](rigor.md) before scoring. It is mandatory for this command: a scan is not accessibility, a detector hit is evidence of a pattern rather than proof of a problem, and every finding carries the narrowest accurate evidence label.

## Diagnostic Scan

Run comprehensive checks across 5 dimensions. Score each dimension 0-4 using the criteria below.

### 1. Accessibility (A11y)

**Check for**:
- **Contrast issues**: Text contrast ratios < 4.5:1 (or 7:1 for AAA)
- **Motion sensitivity**: `prefers-reduced-motion` needs an intentional alternative that preserves state change and hierarchy; flag a global `0.01ms` kill that destroys useful feedback, flashing above threshold, and motion that blocks focus, reading, or task completion
- **Missing ARIA**: Interactive elements without proper roles, labels, or states
- **Keyboard navigation**: Missing focus indicators, illogical tab order, keyboard traps
- **Semantic HTML**: Improper heading hierarchy, missing landmarks, divs instead of buttons
- **Alt text**: Missing or poor image descriptions
- **Form issues**: Inputs without labels, poor error messaging, missing required indicators

**Score 0-4**: 0=Inaccessible (fails WCAG A), 1=Major gaps (few ARIA labels, no keyboard nav), 2=Partial (some a11y effort, significant gaps), 3=Good (WCAG AA mostly met, minor gaps), 4=Excellent (WCAG AA fully met, approaches AAA)

### 2. Performance

**Check for**:
- **Layout thrashing**: Reading/writing layout properties in loops
- **Expensive animations**: Casual layout-property animation, unbounded blur/filter/shadow effects, or effects that visibly drop frames
- **Missing optimization**: Images without lazy loading, unoptimized assets
- **will-change overuse**: `will-change` applied broadly or left on at rest (it is a targeted hint for known expensive animations, not a baseline requirement)
- **Bundle size**: Unnecessary imports, unused dependencies
- **Render performance**: Unnecessary re-renders, missing memoization

**Score 0-4**: 0=Severe issues (layout thrash, unoptimized everything), 1=Major problems (no lazy loading, expensive animations), 2=Partial (some optimization, gaps remain), 3=Good (mostly optimized, minor improvements possible), 4=Excellent (fast, lean, well-optimized)

### 3. Theming

**Check for**:
- **Hard-coded colors**: Colors not using design tokens
- **Broken dark mode**: Missing dark mode variants, poor contrast in dark theme
- **Inconsistent tokens**: Using wrong tokens, mixing token types
- **Theme switching issues**: Values that don't update on theme change

**Score 0-4**: 0=No theming (hard-coded everything), 1=Minimal tokens (mostly hard-coded), 2=Partial (tokens exist but inconsistently used), 3=Good (tokens used, minor hard-coded values), 4=Excellent (full token system, dark mode works perfectly)

### 4. Responsive Design

**Check for**:
- **Fixed widths**: Hard-coded widths that break on mobile
- **Touch targets**: Interactive elements < 44x44px
- **Broken touch interaction**: Custom sliders, drag surfaces, and scrollable control strips whose primary gesture fails under touch, that swallow page scroll or lose the drag to it, or that stay stuck after an interrupted gesture. Code tells: mouse-only handlers, no `touch-action` on a pointer-event drag surface, drag state that nothing clears on cancel, lost capture, or blur. Exercise the gesture when a browser tool can synthesize touch (a rendered viewport proves layout, not the gesture), then say what produced the evidence (emulated viewport, synthesized touch, which engine, physical device) and what stayed untested
- **Horizontal scroll**: Content overflow on narrow viewports
- **Text scaling**: Layouts that break when text size increases
- **Missing breakpoints**: No mobile/tablet variants

**Score 0-4**: 0=Desktop-only (breaks on mobile), 1=Major issues (some breakpoints, many failures), 2=Partial (works on mobile, rough edges), 3=Good (responsive, minor touch target or overflow issues), 4=Excellent (fluid, all viewports, proper touch targets, gestures work under touch)

### 5. Implementation Integrity (CRITICAL)

Run the bundled detector and verify each finding in context. Look for repeated implementation shortcuts, design-system drift, misleading or decorative content, and structure that is interchangeable with an unrelated product. Keep deterministic findings separate from visual judgment and call out false positives.

**Score 0-4**: 0=systemic drift, 1=major repeated failures, 2=several verified issues, 3=minor isolated issues, 4=coherent and intentional

## Generate Report

### Audit Health Score

| # | Dimension | Score | Key Finding |
|---|-----------|-------|-------------|
| 1 | Accessibility | ? | [most critical a11y issue or "--"] |
| 2 | Performance | ? | |
| 3 | Theming | ? | |
| 4 | Responsive Design | ? | |
| 5 | Implementation Integrity | ? | |
| **Total** | | **??/20** | **[Rating band]** |

**Rating bands**: 18-20 Excellent (minor polish), 14-17 Good (address weak dimensions), 10-13 Acceptable (significant work needed), 6-9 Poor (major overhaul), 0-5 Critical (fundamental issues)

### Implementation Integrity Verdict
**Start here.** Pass/fail: does the implementation express a coherent product-specific system? Cite verified evidence and detector findings.

### Executive Summary
- Audit Health Score: **??/20** ([rating band])
- Total issues found (count by severity: P0/P1/P2/P3)
- Top 3-5 critical issues
- Recommended next steps

### Detailed Findings by Severity

Tag every issue with **P0-P3 severity**:
- **P0 Blocking**: Prevents task completion. Fix immediately
- **P1 Major**: Significant difficulty or WCAG AA violation. Fix before release
- **P2 Minor**: Annoyance, workaround exists. Fix in next pass
- **P3 Polish**: Nice-to-fix, no real user impact. Fix if time permits

For each issue, document:
- **[P?] Issue name**
- **Location**: Component, file, line
- **Category**: Accessibility / Performance / Theming / Responsive / Implementation Integrity
- **Impact**: How it affects users
- **WCAG/Standard**: Which standard it violates (if applicable)
- **Recommendation**: How to fix it
- **Suggested command**: Which command to use (prefer: /melzi animate, /melzi audit, /melzi bolder, /melzi clarify, /melzi colorize, /melzi critique, /melzi document, /melzi explore, /melzi generate, /melzi handdrawn, /melzi harden, /melzi identity, /melzi init, /melzi layout, /melzi live, /melzi polish, /melzi quieter, /melzi shape, /melzi study, /melzi teach, /melzi typeset)

### Patterns & Systemic Issues

Identify recurring problems that indicate systemic gaps rather than one-off mistakes:
- "Hard-coded colors appear in 15+ components, should use design tokens"
- "Touch targets consistently too small (<44px) throughout mobile experience"

### Positive Findings

Note what's working well: good practices to maintain and replicate.

## Recommended Actions

List recommended commands in priority order (P0 first, then P1, then P2):

1. **[P?] `/command-name`**: Brief description (specific context from audit findings)
2. **[P?] `/command-name`**: Brief description (specific context)

**Rules**: Only recommend commands from: /melzi animate, /melzi audit, /melzi bolder, /melzi clarify, /melzi colorize, /melzi critique, /melzi document, /melzi explore, /melzi generate, /melzi handdrawn, /melzi harden, /melzi identity, /melzi init, /melzi layout, /melzi live, /melzi polish, /melzi quieter, /melzi shape, /melzi study, /melzi teach, /melzi typeset. Map findings to the most appropriate command. End with `/melzi polish` as the final step if any fixes were recommended.

After presenting the summary, tell the user:

> You can ask me to run these one at a time, all at once, or in any order you prefer.
>
> Re-run `/melzi audit` after fixes to see your score improve.

**IMPORTANT**: Be thorough but actionable. Too many P3 issues creates noise. Focus on what actually matters.

**NEVER**:
- Report issues without explaining impact (why does this matter?)
- Provide generic recommendations (be specific and actionable)
- Skip positive findings (celebrate what works)
- Forget to prioritize (everything can't be P0)
- Report false positives without verification

## Optimize mode: measure, fix, measure again

A typed `optimize` command enters here. Ordinary `audit` remains report-only. Optimize mode takes the Performance findings, fixes the largest measured bottleneck, and repeats the same measurement. Do not optimize what is not slow.

### Establish the baseline

Capture Core Web Vitals (LCP, INP, CLS), First Contentful Paint, Total Blocking Time, load and interactive timing, JavaScript and CSS bundle sizes, image bytes, request count and waterfall, frame rate, memory, and CPU where they apply. Name whether the bottleneck is initial load, interaction, animation, rendering, or network, how users experience it, and which devices or connections carry it.

Use Chrome DevTools, Lighthouse, WebPageTest, bundle analyzers, and existing real-user monitoring such as Sentry, Datadog, or New Relic. Measure representative mobile hardware and a throttled connection. Desktop Chrome on a fast development machine is not a baseline.

### Loading performance

- Serve correctly sized WebP or AVIF images, use `srcset` and `picture` for resolution and art direction, compress to the quality the asset tolerates, and lazy-load only below the fold.
- Split routes and genuinely heavy components, remove unused dependencies and code, use dynamic import where the wait is acceptable, and verify tree shaking rather than assuming it.
- Remove unused CSS, keep critical CSS available for first render, and use containment for independent regions.
- Use `font-display: swap` or `optional`, load only required weights and glyphs, preload the one critical face, and use a system face where the design permits it.
- Prioritize critical resources, defer noncritical scripts, prefetch only likely next work, and use service workers, caching, compression, CDN delivery, HTTP/2, or HTTP/3 where the deployment controls them.

Keep the implementation methods from the former optimize playbook reachable: lazy-load a genuinely heavy component with dynamic import; subset a custom face with `unicode-range`; combine tiny files only when request overhead dominates; use SVG sprites or inline only small critical assets; and remove unused third-party scripts before squeezing local code.

Never lazy-load the largest above-fold image or hide a font delay behind layout shift. Set image and video dimensions or `aspect-ratio` so late bytes do not move the page.

### Rendering and interaction performance

Batch layout reads before writes. Avoid loops that read `offsetHeight` and immediately change layout on each element. Use `contain` and `content-visibility: auto` for independent or long regions, flatten unnecessary DOM depth, and virtualize genuinely large lists.

```javascript
const heights = elements.map((element) => element.offsetHeight);
elements.forEach((element, index) => {
  element.style.height = `${heights[index] * 2}px`;
});
```

Use transforms and opacity for reliable movement, while allowing bounded blur, filters, masks, clip paths, shadows, and colour when the authored effect earns their cost. Avoid casual animation of `width`, `height`, `top`, `left`, and margins. Apply `will-change` only around a known operation and remove it afterward.

Target a 16ms frame budget at 60fps. Prefer CSS animation when it expresses the behavior; use `requestAnimationFrame` for JavaScript animation, throttle or replace scroll handlers with `IntersectionObserver`, and keep long tasks away from the interaction path. Break up main-thread work to keep INP below 200ms.

### Framework and data work

Profile before adding memoization. In React, use `memo`, `useMemo`, and `useCallback` only around measured expensive work; avoid needless per-render function churn where profiling proves it matters; virtualize long collections; inspect the React DevTools Profiler; and split routes. In any framework, reduce unnecessary renders, memoize expensive computation, debounce repeated input work, and lazy-load routes or components where the interaction can carry it.

Paginate large API results, request only needed fields through REST or GraphQL, compress responses with gzip or Brotli, set correct cache headers, and move static assets to a CDN where appropriate. Use `navigator.connection` only as an adaptive-loading hint, preserve core content through progressive enhancement, prioritize requests deliberately, and keep optimistic UI honest about failure.

### Core Web Vitals targets

- **LCP below 2.5s:** prioritize and size the hero or main content asset, inline or preload critical resources, and use server rendering where it materially shortens the path.
- **INP below 200ms:** break long tasks, defer noncritical JavaScript, move heavy computation to a Worker, and reduce execution time.
- **CLS below 0.1:** reserve media and embed space with dimensions or `aspect-ratio`, avoid inserting content above the current viewport, and animate with transforms rather than layout movement.

### Verify the optimization

Repeat the same measurement on the same device, viewport, data, and network. Report before and after numbers, run the complete user path to catch functional regressions, and keep accessibility intact. Check a low-end Android device, a throttled 3G path, Chrome UX Report or equivalent field data where available, and real-user monitoring. The optimization is complete only when the user-facing number or perceived delay moves.

Never optimize without a baseline, trade accessibility or functionality for a score, spread `will-change` across the page, chase micro-optimizations while a large asset or long task dominates, or declare a desktop result representative of mobile.

## Adaptation evidence on the web

A typed web `adapt` command starts with this audit section, then uses [polish.md](polish.md) to implement the change. Record the source context and its assumptions, the target device or medium, input method, screen and orientation, connection, usage posture, and platform expectations. Name what no longer fits, what depends on unavailable input such as hover, and which source-platform convention becomes inappropriate.

Audit the real feature at content-driven breakpoints, 320px, intermediate tablet widths, wide desktop, landscape, 200% text scaling, coarse and fine pointers, touch and keyboard, safe areas, slow connections, and each supported browser. Include print or email clients when those are the target. Device emulation is layout evidence only; at least one real iPhone, one real Android, and a tablet where relevant provide interaction, keyboard, font-rendering, and performance evidence.

Core functionality, information architecture, and task outcome must remain available in every context. A responsive screenshot that hides the difficult feature is a failure.
