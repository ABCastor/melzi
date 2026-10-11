//! Overlays that are not the page, other than consent managers: product tours
//! a script starts on load, and preloaders still covering the page when it is
//! captured. Like [`crate::consent`], the URL engine hides them before the
//! reveal sweep and again around the capture, with an injected style or an
//! inline `display: none`; nothing is clicked and no tour state is saved.
//!
//! Each kind is recognized only where the markup leaves no doubt, and a page
//! that matches neither is scanned exactly as before:
//!
//! - **Tours** by the library's own markup ([`TOUR_LIBRARIES`]). Corpus run 35
//!   found one: gamer.com.tw starts a five-step driver.js 1.3.1 tour on every
//!   load, a full-screen `svg.driver-overlay` dimming the first screen and a
//!   `div.driver-popover` (`role=dialog`) over the header, with
//!   `driver-active` on `<body>`. driver.js's stylesheet sets
//!   `pointer-events: none` on everything under `.driver-active` but the
//!   highlighted element, which also takes the page out of every hit test, so
//!   the body classes go too. No other tour library (Shepherd, Intro.js,
//!   Appcues, UserGuiding, Pendo guides, Chameleon, React Joyride, Userpilot)
//!   showed its markup in any of the corpus's 8,800 captures, and their
//!   markup could not be confirmed here, so none is listed.
//! - **Preloaders** by structure ([`preloader_js`]): a `position: fixed`
//!   layer, not `html` or `body`, that covers at least 90% of the first
//!   screen, is on top of it at the center and the four inset points the
//!   engine probes, paints an opaque fill (alpha 0.9 or more) on itself or on
//!   a descendant that covers the same area, carries at most 60 characters of
//!   text and no link, button, form control, frame or dialog role, and whose
//!   own id or one of its classes names a loader ([`LOADER_WORDS`]:
//!   `preloader`, `pre-loader`, `page_loader_bg`, `loader-wrapper`,
//!   `is-loading`, `spinner`; not `lazyloading`). The engine first waits up to [`PRELOADER_WAIT_MS`] for such a
//!   layer to go on its own, and hides it only if it is still there. Corpus
//!   run 35: epcco.com.sa's `div#preloader` (fixed, 100% by 100%, white,
//!   `z-index: 9999999`, a spinner and no text) never cleared on its home
//!   page, so three of six captures were a white first screen.
//!
//! - **Builder badges** by the builder's own markup ([`BUILDER_BADGES`]): the
//!   "Edit with" badge a site builder pins over pages it hosts. Corpus run 42:
//!   Lovable's `aside#lovable-badge` (`aria-label="Edit with Lovable"`, a
//!   fixed 148 by 24 pill at the bottom right, `z-index: 1000000`) on every
//!   capture of mialight.app, over the copy at the foot of the first screen.
//!   The badge is the builder's, not the site's design.
//!
//! Left alone on purpose: a gate the visitor has to answer (a state or
//! region picker, an age gate, a sign-in wall) and a site's own interstitial
//! (a welcome dialog, a newsletter modal) carry text and controls, so no
//! structural test here matches them, and the Pristine rule that reports an
//! interstitial at load still sees them.

use serde_json::{json, Value};

/// One product-tour library: the elements to hide and the classes it puts on
/// the page while a tour runs.
#[derive(Debug, Clone, Copy)]
pub struct TourLibrary {
    pub name: &'static str,
    /// The tour's popover or step roots.
    pub roots: &'static [&'static str],
    /// The dimming layer behind the popover.
    pub backdrops: &'static [&'static str],
    /// Classes the library puts on `<body>` while a tour runs.
    pub body_classes: &'static [&'static str],
    /// Classes the library puts on the highlighted element.
    pub highlight_classes: &'static [&'static str],
    /// `aria-controls` value the library puts on the highlighted element,
    /// beside `aria-haspopup` and `aria-expanded`; those three are removed
    /// from an element that carries exactly this value.
    pub highlight_aria_controls: Option<&'static str>,
}

/// Every known tour library, in the order a report names them.
pub const TOUR_LIBRARIES: &[TourLibrary] = &[TourLibrary {
    name: "driver.js",
    roots: &[".driver-popover"],
    backdrops: &["svg.driver-overlay"],
    body_classes: &["driver-active", "driver-fade", "driver-simple"],
    highlight_classes: &["driver-active-element", "driver-no-interaction"],
    highlight_aria_controls: Some("driver-popover-content"),
}];

/// One site builder's badge: the elements to hide.
#[derive(Debug, Clone, Copy)]
pub struct BuilderBadge {
    pub name: &'static str,
    pub roots: &'static [&'static str],
}

/// Every known builder badge, in the order a report names them.
pub const BUILDER_BADGES: &[BuilderBadge] = &[BuilderBadge { name: "Lovable", roots: &["#lovable-badge"] }];

/// The id of the style element the tour and badge hide step injects.
pub const HIDE_STYLE_ID: &str = "impeccable-overlay-hide";

/// The attribute the preloader hide step puts on a layer it hid, naming it,
/// so a later pass reports it again without hiding twice.
pub const PRELOADER_MARK: &str = "data-impeccable-hidden";

/// How long the engine waits for a preloader to go on its own before hiding
/// it, and how often it looks.
pub const PRELOADER_WAIT_MS: u64 = 5000;
pub const PRELOADER_POLL_MS: u64 = 250;

/// Id and class words that name a loader: an id or class token names one
/// when, after any trailing [`WRAPPER_WORDS`], its last hyphen- or
/// underscore-separated word is one of these (`preloader`, `pre-loader`,
/// `page_loader_bg`, `loader-wrapper`, `is-loading`; not `lazyloading`).
pub const LOADER_WORDS: &[&str] =
    &["preloader", "preload", "preloading", "loader", "loading", "pageloader", "siteloader", "loadingscreen", "spinner"];
pub const WRAPPER_WORDS: &[&str] = &[
    "wrap", "wrapper", "container", "overlay", "screen", "area", "bg", "background", "mask", "page", "box",
    "holder", "inner", "outer", "layer", "main",
];

/// Most visible characters a preloader may carry ("Loading...", "75%", a
/// brand word).
pub const PRELOADER_MAX_TEXT: usize = 60;
/// Least share of the first screen a preloader covers.
pub const PRELOADER_MIN_COVER: f64 = 0.9;

/// Page JS that defines `preloaders()`: the layers that pass every test in
/// the module doc, each as `{ el, name }`.
pub fn preloader_js() -> String {
    format!(
        r#"const loaderWords = {words};
  const wrapperWords = {wrappers};
  // A token names a loader when, after any trailing wrapper words
  // (`-wrapper`, `_bg`), its last word is a loader word: `preloader`,
  // `pre-loader`, `page_loader_bg`, `loader-wrapper`, `is-loading`.
  const namesLoader = token => {{
    const parts = String(token).toLowerCase().split(/[-_]+/).filter(Boolean);
    while (parts.length > 1 && wrapperWords.includes(parts[parts.length - 1])) parts.pop();
    return parts.length > 0 && loaderWords.includes(parts[parts.length - 1]);
  }};
  const alpha = c => {{
    const m = /rgba?\(([^)]*)\)/.exec(c || '');
    if (!m) return 0;
    const p = m[1].split(/[\s,/]+/).filter(Boolean);
    return p.length >= 4 ? parseFloat(p[3]) : 1;
  }};
  const preloaders = () => {{
    const vw = window.innerWidth || 0, vh = window.innerHeight || 0;
    if (!vw || !vh) return [];
    const covers = r => {{
      const w = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
      const h = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
      return (w * h) / (vw * vh) >= {cover};
    }};
    const points = [[0.5, 0.5], [0.2, 0.2], [0.8, 0.2], [0.2, 0.8], [0.8, 0.8]].map(([x, y]) => [Math.floor(vw * x), Math.floor(vh * y)]);
    const found = [];
    const all = document.body ? document.body.querySelectorAll('*') : [];
    for (let i = 0; i < all.length && i < 20000; i++) {{
      const el = all[i];
      const tokens = [el.id].concat(Array.from(el.classList || [])).filter(Boolean);
      if (!tokens.some(namesLoader)) continue;
      let cs;
      try {{ cs = getComputedStyle(el); }} catch (e) {{ continue; }}
      if (cs.position !== 'fixed' || cs.display === 'none' || cs.visibility !== 'visible' || parseFloat(cs.opacity) <= 0.05) continue;
      try {{ if (el.checkVisibility && !el.checkVisibility({{ opacityProperty: true, visibilityProperty: true }})) continue; }} catch (e) {{}}
      if (!covers(el.getBoundingClientRect())) continue;
      // Opaque on itself, or on a descendant that covers the screen too.
      let opaque = alpha(cs.backgroundColor) >= 0.9;
      if (!opaque) {{
        const kids = el.querySelectorAll('*');
        for (let k = 0; k < kids.length && k < 200 && !opaque; k++) {{
          try {{ opaque = alpha(getComputedStyle(kids[k]).backgroundColor) >= 0.9 && covers(kids[k].getBoundingClientRect()); }} catch (e) {{}}
        }}
      }}
      if (!opaque) continue;
      // On top: every probe point lands on the layer or inside it. Hit
      // testing skips a layer with `pointer-events: none` (clicks pass
      // through while it paints), so it is made hit-testable for the probe
      // and put back in the same task, before anything paints.
      const passThrough = cs.pointerEvents === 'none';
      const pe = [el.style.getPropertyValue('pointer-events'), el.style.getPropertyPriority('pointer-events')];
      if (passThrough) el.style.setProperty('pointer-events', 'auto', 'important');
      let onTop;
      try {{
        onTop = points.every(([x, y]) => {{ const hit = document.elementFromPoint(x, y); return !!hit && (hit === el || el.contains(hit)); }});
      }} finally {{
        if (passThrough) {{
          if (pe[0]) el.style.setProperty('pointer-events', pe[0], pe[1]);
          else el.style.removeProperty('pointer-events');
        }}
      }}
      if (!onTop) continue;
      // Not a gate or a dialog: no control, link, frame or dialog inside.
      if (el.matches('[role=dialog], [role=alertdialog], [aria-modal=true], dialog')) continue;
      if (el.querySelector('a[href], button, input:not([type=hidden]), select, textarea, iframe, [role=button], [role=dialog], [role=alertdialog], [aria-modal=true], dialog, [contenteditable=""], [contenteditable=true]')) continue;
      if ((el.innerText || '').replace(/\s+/g, ' ').trim().length > {max_text}) continue;
      // The outermost match stands for the ones inside it.
      if (found.some(f => f.el.contains(el))) continue;
      const cls = Array.from(el.classList || []).find(namesLoader);
      const name = el.tagName.toLowerCase() + (el.id && namesLoader(el.id) ? '#' + el.id : cls ? '.' + cls : el.id ? '#' + el.id : '');
      found.push({{ el, name }});
    }}
    return found;
  }};"#,
        words = json!(LOADER_WORDS),
        wrappers = json!(WRAPPER_WORDS),
        cover = PRELOADER_MIN_COVER,
        max_text = PRELOADER_MAX_TEXT,
    )
}

/// The wait probe: the names of the preloaders covering the page now.
pub fn preloader_probe_js() -> String {
    format!("(() => {{\n  {}\n  return preloaders().map(p => p.name);\n}})()", preloader_js())
}

fn tours_json() -> Value {
    let badges = BUILDER_BADGES.iter().map(|b| {
        json!({
            "kind": "badge",
            "name": b.name,
            "roots": b.roots,
            "backdrops": [],
            "bodyClasses": [],
            "highlightClasses": [],
            "ariaControls": null,
        })
    });
    Value::Array(
        TOUR_LIBRARIES
            .iter()
            .map(|t| {
                json!({
                    "kind": "tour",
                    "name": t.name,
                    "roots": t.roots,
                    "backdrops": t.backdrops,
                    "bodyClasses": t.body_classes,
                    "highlightClasses": t.highlight_classes,
                    "ariaControls": t.highlight_aria_controls,
                })
            })
            .chain(badges)
            .collect(),
    )
}

/// The hide step. Idempotent, like [`crate::consent::hide_js`]. Returns
/// `{ hidden: [{ kind, name }], matched: { name: [selector] }, unlocked:
/// [what], changed }` for the tours, builder badges and preloaders it found
/// showing this time.
pub fn hide_js() -> String {
    format!(
        r#"(() => {{
  const tours = {tours};
  const STYLE_ID = {style_id};
  const MARK = {mark};
  const q = s => {{ try {{ return Array.from(document.querySelectorAll(s)); }} catch (e) {{ return []; }} }};
  const boxShows = el => {{
    try {{
      if (el.checkVisibility && !el.checkVisibility({{ opacityProperty: true, visibilityProperty: true }})) return false;
      const r = el.getBoundingClientRect();
      return r.width >= 1 && r.height >= 1;
    }} catch (e) {{ return false; }}
  }};
  {preloader}
  const out = {{ hidden: [], matched: {{}}, unlocked: [], changed: false }};
  const body = document.body;
  // Tours and builder badges: their own roots and backdrops, measured with
  // the hide rule off so one already hidden is still reported.
  const present = [];
  for (const t of tours) {{
    const sels = t.roots.concat(t.backdrops).filter(s => q(s).length > 0);
    if (sels.length) present.push({{ t, sels }});
  }}
  let style = document.getElementById(STYLE_ID);
  if (present.length) {{
    if (style) style.disabled = true;
    for (const {{ t, sels }} of present) {{
      const on = sels.filter(s => q(s).some(boxShows));
      if (on.length) {{ out.hidden.push({{ kind: t.kind, name: t.name }}); out.matched[t.name] = on; }}
    }}
    if (!style) {{
      style = document.createElement('style');
      style.id = STYLE_ID;
      (document.head || document.documentElement).appendChild(style);
    }}
    style.disabled = false;
    const text = present.flatMap(({{ sels }}) => sels.map(s => s + ' {{ display: none !important; }}')).join('\n');
    if (style.textContent !== text) {{ style.textContent = text; out.changed = true; }}
    for (const {{ t }} of present) {{
      if (!out.hidden.some(h => h.name === t.name)) continue;
      if (body) for (const c of t.bodyClasses) if (body.classList.contains(c)) {{ body.classList.remove(c); out.unlocked.push('body.' + c); }}
      for (const c of t.highlightClasses) for (const el of q('.' + c)) {{
        el.classList.remove(c);
        if (!out.unlocked.includes('highlight .' + c)) out.unlocked.push('highlight .' + c);
      }}
      if (t.ariaControls) for (const el of q('[aria-controls="' + t.ariaControls + '"]')) {{
        for (const a of ['aria-controls', 'aria-haspopup', 'aria-expanded']) el.removeAttribute(a);
        if (!out.unlocked.includes('highlight aria')) out.unlocked.push('highlight aria');
      }}
    }}
  }}
  // Preloaders: hidden ones (marked) are reported again; new ones hidden.
  for (const el of q('[' + MARK + ']')) {{
    const name = el.getAttribute(MARK);
    if (name && !out.hidden.some(h => h.kind === 'preloader' && h.name === name)) out.hidden.push({{ kind: 'preloader', name }});
  }}
  let hidLoader = false;
  for (const {{ el, name }} of preloaders()) {{
    el.setAttribute(MARK, name);
    el.style.setProperty('display', 'none', 'important');
    out.changed = true;
    hidLoader = true;
    if (!out.hidden.some(h => h.kind === 'preloader' && h.name === name)) out.hidden.push({{ kind: 'preloader', name }});
  }}
  // The page's own script would clear the loader and the scroll lock it
  // keeps with it; hiding the loader does not run that script. Undo the
  // lock: a loader-named class on <html> or <body> (`is-loading`) and an
  // inline overflow: hidden on either.
  // The inline overflow stays where something else may hold it: an open
  // modal of the site's own, or an app shell that scrolls inside itself.
  const lockHeldElsewhere = () => {{
    const vh = window.innerHeight || 0;
    const shows = el => {{
      try {{ if (el.checkVisibility && !el.checkVisibility({{ opacityProperty: true, visibilityProperty: true }})) return false; }} catch (e) {{}}
      const r = el.getBoundingClientRect();
      return r.width >= 1 && r.height >= 1;
    }};
    if (q('dialog[open], [aria-modal="true"], [role="dialog"], [role="alertdialog"]').some(el => !el.closest('[' + MARK + ']') && shows(el))) return true;
    const all = document.body ? document.body.querySelectorAll('*') : [];
    for (let i = 0; i < all.length && i < 5000; i++) {{
      const el = all[i];
      if (el.clientHeight < vh * 0.5 || el.scrollHeight <= el.clientHeight + 1 || el.closest('[' + MARK + ']')) continue;
      const oy = getComputedStyle(el).overflowY;
      if (oy === 'auto' || oy === 'scroll') return true;
    }}
    return false;
  }};
  if (hidLoader) {{
    const keepInline = lockHeldElsewhere();
    for (const [node, tag] of [[document.documentElement, 'html'], [document.body, 'body']]) {{
      if (!node) continue;
      for (const c of Array.from(node.classList)) if (namesLoader(c)) {{ node.classList.remove(c); out.unlocked.push(tag + '.' + c); }}
      if (keepInline) continue;
      for (const p of ['overflow', 'overflow-y']) {{
        if (node.style.getPropertyValue(p) === 'hidden') {{ node.style.removeProperty(p); out.unlocked.push(tag + ' style ' + p); }}
      }}
    }}
  }}
  if (out.unlocked.length) out.changed = true;
  return out;
}})()"#,
        tours = tours_json(),
        style_id = json!(HIDE_STYLE_ID),
        mark = json!(PRELOADER_MARK),
        preloader = preloader_js(),
    )
}

/// One overlay the scan hid.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HiddenOverlay {
    /// `tour`, `badge` or `preloader`.
    pub kind: String,
    /// The library (`driver.js`) for a tour, the builder (`Lovable`) for a
    /// badge; the layer's tag and the id or class that names it
    /// (`div#preloader`) for a preloader.
    pub name: String,
}

impl HiddenOverlay {
    pub fn to_value(&self) -> Value {
        json!({ "kind": self.kind, "name": self.name })
    }
}

/// What the overlay hide step did over a scan.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct OverlayReport {
    /// Tours, builder badges and preloaders that were showing and were
    /// hidden, in that order, each kind in first-seen order.
    pub hidden: Vec<HiddenOverlay>,
    /// Per hidden tour or badge, the selectors that matched a showing element.
    pub matched: Vec<(String, Vec<String>)>,
    /// What was undone on the page (`body.driver-active`,
    /// `highlight .driver-active-element`, `highlight aria`).
    pub unlocked: Vec<String>,
    /// How long the scan waited for a preloader to go on its own; 0 when none
    /// was covering the page.
    pub waited_ms: u64,
}

impl OverlayReport {
    /// Fold one hide-step result into the report.
    pub fn merge(&mut self, v: &Value) {
        let strs = |v: Option<&Value>| -> Vec<String> {
            v.and_then(Value::as_array)
                .map(|a| a.iter().filter_map(Value::as_str).map(String::from).collect())
                .unwrap_or_default()
        };
        for h in v.get("hidden").and_then(Value::as_array).into_iter().flatten() {
            let (Some(kind), Some(name)) = (h.get("kind").and_then(Value::as_str), h.get("name").and_then(Value::as_str))
            else {
                continue;
            };
            let item = HiddenOverlay { kind: kind.to_string(), name: name.to_string() };
            if !self.hidden.contains(&item) {
                self.hidden.push(item);
            }
            if kind != "preloader" {
                let sels = strs(v.get("matched").and_then(|m| m.get(name)));
                match self.matched.iter_mut().find(|(n, _)| n == name) {
                    Some((_, have)) => {
                        for s in sels {
                            if !have.contains(&s) {
                                have.push(s);
                            }
                        }
                    }
                    None => self.matched.push((name.to_string(), sels)),
                }
            }
        }
        for u in strs(v.get("unlocked")) {
            if !self.unlocked.contains(&u) {
                self.unlocked.push(u);
            }
        }
        // Tours, then builder badges, then preloaders, a stable sort keeping
        // first-seen order.
        self.hidden.sort_by_key(|h| match h.kind.as_str() {
            "tour" => 0,
            "badge" => 1,
            _ => 2,
        });
    }

    /// The `overlaysHidden` value findings carry.
    pub fn hidden_value(&self) -> Value {
        Value::Array(self.hidden.iter().map(HiddenOverlay::to_value).collect())
    }

    pub fn to_value(&self) -> Value {
        let matched: serde_json::Map<String, Value> =
            self.matched.iter().map(|(n, s)| (n.clone(), json!(s))).collect();
        json!({
            "hidden": self.hidden_value(),
            "matched": matched,
            "unlocked": self.unlocked,
            "waitedMs": self.waited_ms,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tour_selectors_name_their_library() {
        for t in TOUR_LIBRARIES {
            for s in t.roots.iter().chain(t.backdrops) {
                assert!(s.contains("driver-"), "{}: {s}", t.name);
            }
        }
    }

    #[test]
    fn report_merges_and_orders_tours_first() {
        let mut r = OverlayReport::default();
        r.merge(&json!({ "hidden": [{ "kind": "preloader", "name": "div#preloader" }], "matched": {}, "unlocked": [] }));
        r.merge(&json!({
            "hidden": [{ "kind": "tour", "name": "driver.js" }, { "kind": "preloader", "name": "div#preloader" }],
            "matched": { "driver.js": [".driver-popover", "svg.driver-overlay"] },
            "unlocked": ["body.driver-active"],
        }));
        assert_eq!(
            r.to_value(),
            json!({
                "hidden": [{ "kind": "tour", "name": "driver.js" }, { "kind": "preloader", "name": "div#preloader" }],
                "matched": { "driver.js": [".driver-popover", "svg.driver-overlay"] },
                "unlocked": ["body.driver-active"],
                "waitedMs": 0,
            })
        );
    }

    #[test]
    fn badge_selectors_name_their_builder() {
        for b in BUILDER_BADGES {
            for s in b.roots {
                assert!(s.to_ascii_lowercase().contains(&b.name.to_ascii_lowercase()), "{}: {s}", b.name);
            }
        }
    }

    #[test]
    fn report_orders_badges_between_tours_and_preloaders() {
        let mut r = OverlayReport::default();
        r.merge(&json!({
            "hidden": [{ "kind": "preloader", "name": "div#preloader" }, { "kind": "badge", "name": "Lovable" }],
            "matched": { "Lovable": ["#lovable-badge"] },
            "unlocked": [],
        }));
        r.merge(&json!({ "hidden": [{ "kind": "tour", "name": "driver.js" }], "matched": { "driver.js": [".driver-popover"] }, "unlocked": [] }));
        let kinds: Vec<&str> = r.hidden.iter().map(|h| h.kind.as_str()).collect();
        assert_eq!(kinds, vec!["tour", "badge", "preloader"]);
        assert_eq!(r.matched[0], ("Lovable".to_string(), vec!["#lovable-badge".to_string()]));
    }

    #[test]
    fn scripts_embed_every_selector_and_word() {
        let hide = hide_js();
        for t in TOUR_LIBRARIES {
            for s in t.roots.iter().chain(t.backdrops) {
                assert!(hide.contains(&serde_json::to_string(s).unwrap()), "{s}");
            }
        }
        for b in BUILDER_BADGES {
            for s in b.roots {
                assert!(hide.contains(&serde_json::to_string(s).unwrap()), "{s}");
            }
        }
        let probe = preloader_probe_js();
        for w in LOADER_WORDS {
            assert!(probe.contains(&serde_json::to_string(w).unwrap()), "{w}");
        }
    }
}
