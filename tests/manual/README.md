# Manual behavioural harness — Design Lab

`design-lab-harness.html` loads the real content scripts into a real page with a stubbed
`chrome.*` API, so the overlay can be exercised as behaviour rather than asserted as source text.

**Why it exists.** `tests/extension-build.test.mjs` checks the Design Lab mostly by matching
strings in the source (`assert.match(worker, /chrome\.tabs\.captureVisibleTab\(/)`). That proves
the text is present, not that anything works. This harness closes the gap for the paths that
matter, and the stub deliberately emulates what the service worker really does with
`chrome.scripting.insertCSS` / `removeCSS` — without that, `applyDesign()` receives `ok: true`
and injects nothing, which reads as a product defect when it is a stub gap.

**Run it**

```bash
cp extension/content/design-lab.js extension/content/design-lab-options.js tests/manual/
cd tests/manual && python3 -m http.server 8814
# open http://127.0.0.1:8814/design-lab-harness.html and drive it from the console
```

**Verified behaviourally on 2026-08-13** (real browser, real shadow root, real computed styles):

| Claim | Result |
|---|---|
| Overlay activates into an isolated shadow root | pass, 8 shadow children |
| Hovering outlines the page element under the cursor | pass |
| Overlay swallows clicks; the host page's own handler does not fire | pass |
| Clicking opens the composer and saving persists per page | pass, key `impeccable-design-lab:page:<url>` |
| The anchor carries several independent signals | pass — selector, textSnippet, rect, tag, id, classes, attributes |
| Selecting a palette and a pairing changes the host page's computed styles | pass — background, ink and font all change, 1,709 chars of CSS |
| Revert restores the original computed styles | pass |
| Repeated applies do not accumulate stylesheets | pass — the worker's `replaceDesignLabCss` removes `previousCss` first |

**Not covered here:** the real `chrome.tabs.captureVisibleTab` screenshot path, cross-navigation
anchor re-resolution, and anything requiring a genuine extension profile.
