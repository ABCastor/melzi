/* Colour mode. The page is the specimen: this module only draws the compact
 * controls and writes reversible overrides through the core contract. */
(function () {
  'use strict';

  var I = Island;
  var win = I.global;
  var doc = I.document;
  if (!doc) return;
  var colors = I.colors;
  var dom = I.dom;
  var events = I.events;
  var state = I.state;
  var ROLE_ORDER = ['ground', 'surface', 'ink', 'muted', 'accent'];
  var STATE_ROLES = ['line', 'cta', 'hover', 'pressed', 'error', 'warning', 'success'];
  var mounted = null;
  var expanded = null;
  var showStates = false;
  var writeFrame = 0;
  var budgetFrame = 0;
  var pendingWrite = null;
  var drag = null;
  var releaseOnly = false;
  var warnedSlow = false;
  var eyedropperReported = false;
  var observer = null;
  var reapplies = 0;
  var reapplyFrame = 0;
  var syntheticStyle = null;
  var fallbackRulesByRole = {};
  var adapterCss = '';
  var simulationStyle = null;
  var simulation = 0;
  var tokenSearchOpen = false;
  var utilitiesOpen = false;
  var editingTheme = null;
  var themeBeforeEditing = null;
  var subscriptions = [];

  function data() {
    state.data.overrides = state.data.overrides || { colors: {}, type: {} };
    state.data.overrides.colors = state.data.overrides.colors || {};
    state.data.review = state.data.review || {};
    state.data.review.colour = state.data.review.colour || { maps: {}, roles: {}, stateRoles: false, simulation: 0, originalInline: {} };
    state.data.review.colour.originalInline = state.data.review.colour.originalInline || {};
    return state.data.review.colour;
  }
  function persist() { state.data = I.persist(); return state.data; }
  function clamp(value, low, high) { return Math.max(low, Math.min(high, Number(value) || 0)); }
  function round(value, places) { var unit = Math.pow(10, places == null ? 4 : places); return Math.round(value * unit) / unit; }
  function nowTheme() { return dom.theme ? dom.theme() : 'light'; }
  function switchTheme(theme) {
    theme = theme === 'dark' ? 'dark' : 'light';
    if (!themeBeforeEditing) themeBeforeEditing = {
      hadTheme: doc.documentElement.hasAttribute('data-theme'), theme: doc.documentElement.getAttribute('data-theme'),
      hadScheme: doc.documentElement.hasAttribute('data-color-scheme'), scheme: doc.documentElement.getAttribute('data-color-scheme')
    };
    removeLiveOverrides();
    editingTheme = theme;
    if (themeBeforeEditing.hadScheme && !themeBeforeEditing.hadTheme) doc.documentElement.setAttribute('data-color-scheme', theme);
    else doc.documentElement.setAttribute('data-theme', theme);
    reapplies = 0; applyActiveMap(); events.emit('theme:change', theme); events.emit('status:set', theme + ' palette shown on the page.'); render();
  }
  function mapFor(theme) {
    var colour = data();
    theme = theme || nowTheme();
    colour.maps[theme] = colour.maps[theme] || {};
    return colour.maps[theme];
  }
  function allMaps() { return data().maps; }
  function escapeCss(value) {
    return win.CSS && win.CSS.escape ? win.CSS.escape(value) : String(value).replace(/([^a-zA-Z0-9_-])/g, '\\$1');
  }
  function lchToCss(lch) {
    var rgb = colors.mapToSrgb(lch);
    return colors.rgbToHex(rgb, lch.alpha < 1);
  }
  function oklchText(value) {
    var item = colors.clampOklch(typeof value === 'string' ? lch(value) : value);
    return 'oklch(' + round(item.l * 100, 2) + '% ' + round(item.c, 4) + ' ' + round(item.h, 2) + (item.alpha < 1 ? ' / ' + round(item.alpha, 3) : '') + ')';
  }
  function lch(value) {
    var rgb = colors.parse(value);
    return rgb ? colors.srgbToOklch(rgb) : { l: 0.5, c: 0, h: 0, alpha: 1 };
  }
  function roleName(name) { return String(name || '').replace(/^--/, '').replace(/[-_]+/g, ' '); }
  function roleForName(name) {
    var key = String(name || '').toLowerCase();
    if (/ground|background|page|canvas|base/.test(key)) return 'ground';
    if (/surface|panel|card|raised|layer/.test(key)) return 'surface';
    if (/muted|subtle|faint|secondary|dim/.test(key)) return 'muted';
    if (/accent|brand|primary|link|gold|patina/.test(key)) return 'accent';
    if (/line|border|rule|divider/.test(key)) return 'line';
    if (/hover/.test(key)) return 'hover';
    if (/pressed|active/.test(key)) return 'pressed';
    if (/error|danger|destruct/.test(key)) return 'error';
    if (/warning|warn/.test(key)) return 'warning';
    if (/success|positive|valid/.test(key)) return 'success';
    if (/cta|action/.test(key)) return 'cta';
    return 'ink';
  }
  function roleDefault(role) {
    return {
      ground: '#ffffff', surface: '#f5f5f2', ink: '#181817', muted: '#676762', accent: '#315efb',
      line: '#d5d5d0', cta: '#315efb', hover: '#274dcc', pressed: '#1e3ca1', error: '#b3261e', warning: '#8a5900', success: '#287a45'
    }[role] || '#181817';
  }
  function usageType(usage) {
    var property = String(usage && usage.property || '').replace(/[A-Z]/g, function (letter) { return '-' + letter.toLowerCase(); }).toLowerCase();
    if (property.indexOf('background') === 0) return 'background';
    if (property === 'color' || property === 'fill' || property === 'stroke') return 'foreground';
    if (property.indexOf('border') === 0 || property === 'outline-color' || property === 'text-decoration-color') return 'line';
    return 'other';
  }
  function paintedRoleSources(found) {
    var painted = (found.painted || []).slice();
    function withUsages(entry, accepted) {
      if (!entry) return null;
      var usages = (entry.usages || []).filter(function (usage) { return accepted.indexOf(usageType(usage)) >= 0; });
      if (!usages.length) return null;
      return { value: entry.value || entry.hex, hex: entry.hex, usages: usages, area: entry.area || 0, count: entry.count || 0 };
    }
    function sorted(accepted, excluded) {
      return painted.map(function (entry) { return withUsages(entry, accepted); }).filter(function (entry) {
        return entry && excluded.indexOf(String(entry.hex).toLowerCase()) < 0;
      }).sort(function (a, b) { return b.area - a.area || b.count - a.count; });
    }
    function descriptor(role, entry) {
      var value = entry && entry.hex || roleDefault(role);
      return { role: role, name: '__island_' + role, value: value, hex: value, source: 'painted', used: !!entry, usages: entry && entry.usages || [] };
    }
    var used = [];
    var ground = sorted(['background'], []).find(function (entry) { return String(entry.hex).toLowerCase() === String(found.background || '').toLowerCase(); }) || sorted(['background'], [])[0];
    if (ground) used.push(String(ground.hex).toLowerCase());
    var surface = sorted(['background'], used)[0];
    if (surface) used.push(String(surface.hex).toLowerCase());
    var accent = sorted(['foreground', 'background'], used).filter(function (entry) { return lch(entry.hex).c >= 0.03; }).sort(function (a, b) {
      function score(entry) {
        var interactive = entry.usages.some(function (usage) { return /(?:^|\s|>)(?:a|button)(?:[#:]|\s|>|$)/i.test(String(usage.path || '')); });
        return (interactive ? 1000000000 : 0) + lch(entry.hex).c * 1000000 + entry.area + entry.count;
      }
      return score(b) - score(a);
    })[0];
    if (accent) used.push(String(accent.hex).toLowerCase());
    var foregrounds = sorted(['foreground'], used);
    var ink = foregrounds[0];
    if (ink) used.push(String(ink.hex).toLowerCase());
    var muted = sorted(['foreground'], used)[0];
    if (muted) used.push(String(muted.hex).toLowerCase());
    return {
      ground: descriptor('ground', ground), surface: descriptor('surface', surface), ink: descriptor('ink', ink),
      muted: descriptor('muted', muted), accent: descriptor('accent', accent)
    };
  }
  function sourceRoles() {
    var found = I.tokens.discover();
    var paintedRoles = paintedRoleSources(found);
    var items = found.colors.filter(function (entry) { return entry.used || entry.usages && entry.usages.length; });
    var output = {};
    items.forEach(function (entry) {
      var role = roleForName(entry.name);
      if (!output[role]) output[role] = { role: role, name: entry.name, value: entry.value, hex: entry.hex, source: 'token', used: entry.used, usages: entry.usages || [] };
    });
    ROLE_ORDER.forEach(function (role) {
      if (output[role]) return;
      var painted = paintedRoles[role];
      var declared = found.colors.find(function (entry) {
        return roleForName(entry.name) === role && painted && String(entry.hex).toLowerCase() === String(painted.hex).toLowerCase();
      });
      output[role] = declared ? {
        role: role, name: declared.name, value: declared.value, hex: declared.hex, source: 'token', used: true,
        usages: declared.usages && declared.usages.length ? declared.usages : painted.usages
      } : painted;
    });
    return output;
  }
  function derivedState(role, source) {
    var accent = lch(source.accent.now), ground = lch(source.ground.now), light = ground.l > 0.5;
    var targets = { line: { l: light ? 0.78 : 0.3, c: 0.02, h: accent.h }, cta: { l: light ? 0.5 : 0.72, c: accent.c, h: accent.h }, hover: { l: light ? 0.44 : 0.78, c: accent.c, h: accent.h }, pressed: { l: light ? 0.37 : 0.66, c: accent.c, h: accent.h }, error: { l: light ? 0.5 : 0.7, c: accent.c * 0.9, h: accent.h + 50 }, warning: { l: light ? 0.56 : 0.76, c: accent.c * 0.8, h: accent.h - 38 }, success: { l: light ? 0.48 : 0.7, c: accent.c * 0.8, h: accent.h + 115 } };
    var next = targets[role] || targets.cta; next.c = Math.min(next.c, colors.maxSrgbChroma(next.l, next.h)); return lchToCss(next);
  }
  function replayDescriptor(descriptor, saved) {
    var next = Object.assign({}, descriptor || {});
    if (!saved || typeof saved !== 'object') return next;
    if (saved.name) next.name = saved.name;
    if (saved.source) next.source = saved.source;
    if (Array.isArray(saved.usages)) next.usages = JSON.parse(JSON.stringify(saved.usages));
    if (saved.was != null) next.value = saved.was;
    return next;
  }
  function roles(theme) {
    var source = sourceRoles();
    var map = mapFor(theme);
    Object.keys(map).forEach(function (role) {
      if (!source[role]) source[role] = { role: role, name: '__island_' + role, value: roleDefault(role), hex: roleDefault(role), source: 'derived', usages: [] };
      var saved = map[role];
      source[role] = replayDescriptor(source[role], saved);
      source[role].now = saved.now || saved;
      source[role].lch = lch(source[role].now);
    });
    Object.keys(source).forEach(function (role) {
      source[role].now = source[role].now || source[role].hex || source[role].value || roleDefault(role);
      source[role].lch = source[role].lch || lch(source[role].now);
      source[role].theme = theme || nowTheme();
    });
    if (data().stateRoles) STATE_ROLES.forEach(function (role) {
      if (!source[role]) {
        var value = derivedState(role, source);
        source[role] = { role: role, name: '__island_' + role, value: value, hex: value, now: value, lch: lch(value), theme: theme || nowTheme(), source: 'derived', used: false, usages: [] };
      }
    });
    return source;
  }
  function tokenKey(item, role) { return item.source === 'token' ? item.name : '--review-' + role; }
  function overrideFor(role, theme) {
    var item = roles(theme)[role];
    return item && item.now || roleDefault(role);
  }
  function pureRamp(value, count) {
    var base = colors.clampOklch(lch(value));
    count = Math.max(3, Number(count) || 3);
    return Array.from({ length: count }, function (_, index) {
      var point = count === 1 ? 0.5 : index / (count - 1);
      var lightness = 0.08 + point * 0.84;
      var distance = Math.abs(point - 0.5) * 2;
      var chroma = Math.min(colors.maxSrgbChroma(lightness, base.h), base.c * (1 - 0.6 * distance));
      var step = { l: lightness, c: chroma, h: base.h, alpha: base.alpha };
      return { index: index + 1, oklch: step, hex: lchToCss(step), srgb: colors.rgbToHex(colors.mapToSrgb(step), step.alpha < 1) };
    });
  }
  function uiRamp(value) {
    var base = colors.clampOklch(lch(value));
    return [0.12, 0, -0.12].map(function (delta, index) {
      var lightness = clamp(base.l + delta, 0, 1), step = { l: lightness, c: Math.min(base.c, colors.maxSrgbChroma(lightness, base.h)), h: base.h, alpha: base.alpha };
      return { index: index, oklch: step, hex: lchToCss(step), srgb: colors.rgbToHex(colors.mapToSrgb(step), step.alpha < 1) };
    });
  }
  function rootStyle() { return doc.documentElement && win.getComputedStyle(doc.documentElement); }
  function cssProperty(property) { return String(property || '').replace(/[A-Z]/g, function (letter) { return '-' + letter.toLowerCase(); }); }
  function usageTarget(usage) {
    if (!usage || !usage.path || !usage.property) return null;
    var node = I.dom.resolve ? I.dom.resolve({ path: usage.path }) : typeof usage.path === 'string' ? doc.querySelector(usage.path) : null;
    if (!node) return null;
    var computed = win.getComputedStyle(node), property = cssProperty(usage.property);
    var value = computed.getPropertyValue ? computed.getPropertyValue(property) : computed[usage.property];
    if (!value && computed[usage.property] != null) value = computed[usage.property];
    return { node: node, property: property, authoredProperty: usage.property, value: String(value || '').trim() };
  }
  function fallbackTargets(role, item) {
    var targets = (item.usages || []).map(usageTarget).filter(Boolean);
    if (targets.length) return targets;
    var defaults = role === 'ground' ? [
      { path: 'html', property: 'backgroundColor' }, { path: 'body', property: 'backgroundColor' }
    ] : role === 'ink' || role === 'muted' ? [{ path: 'body', property: 'color' }]
      : role === 'accent' ? [{ path: 'a', property: 'color' }] : [];
    return defaults.map(usageTarget).filter(Boolean);
  }
  function readTarget(target) {
    var computed = win.getComputedStyle(target.node);
    var value = computed.getPropertyValue ? computed.getPropertyValue(target.property) : computed[target.authoredProperty];
    if (!value && computed[target.authoredProperty] != null) value = computed[target.authoredProperty];
    return String(value || '').trim();
  }
  function sameColour(left, right) {
    var a = colors.parse(left), b = colors.parse(right);
    return !!a && !!b && colors.rgbToHex(a, a.a < 1) === colors.rgbToHex(b, b.a < 1);
  }
  function syncAdapterStyle(css) {
    var adapter = state.adapter;
    if (!adapter || typeof adapter.apply !== 'function') return false;
    var previous = adapterCss;
    try {
      var pending = css ? adapter.apply(css, previous) : typeof adapter.remove === 'function' ? adapter.remove(previous) : adapter.apply('', previous);
      adapterCss = css;
      Promise.resolve(pending).catch(function (error) {
        I.unresolved.add('Extension page styles could not be applied: ' + String(error && error.message || error || 'unknown error') + '.');
      });
      return true;
    } catch (error) {
      I.unresolved.add('Extension page styles could not be applied: ' + String(error && error.message || error || 'unknown error') + '.');
      return false;
    }
  }
  function applyFallbackStyle() {
    var css = Object.keys(fallbackRulesByRole).map(function (key) { return fallbackRulesByRole[key].join('\n'); }).filter(Boolean).join('\n');
    if (!css) { I.styles.remove('colour-overrides'); syntheticStyle = null; syncAdapterStyle(''); return null; }
    syntheticStyle = I.styles.apply('colour-overrides', css);
    syncAdapterStyle(css);
    return syntheticStyle;
  }
  function fallbackRules(role, item, css) {
    var declarations = [];
    (item.usages || []).forEach(function (usage) {
      if (!usage || !usage.path || !usage.property) return;
      var selector = typeof usage.path === 'string' ? usage.path : '';
      if (!selector) return;
      declarations.push(selector + '{' + usage.property.replace(/[A-Z]/g, function (letter) { return '-' + letter.toLowerCase(); }) + ':' + css + ' !important}');
    });
    if (!declarations.length) {
      if (role === 'ground') declarations.push('html,body{background-color:' + css + ' !important}');
      else if (role === 'ink' || role === 'muted') declarations.push('body{color:' + css + ' !important}');
      else if (role === 'accent') declarations.push('a{color:' + css + ' !important}');
    }
    return declarations;
  }
  function emitFallbackCss(role, item, value) {
    fallbackRulesByRole[role] = fallbackRules(role, item, value);
    return applyFallbackStyle();
  }
  function applyToPage(role, item, next) {
    var targets = fallbackTargets(role, item);
    if (item.source === 'token') {
      var root = rootStyle(), beforeToken = root && root.getPropertyValue ? root.getPropertyValue(item.name).trim() : '';
      var beforeInline = doc.documentElement.style.getPropertyValue(item.name);
      var before = targets.map(function (target) { return target.value; });
      doc.documentElement.style.setProperty(item.name, next);
      root = rootStyle();
      var appliedToken = root && root.getPropertyValue ? root.getPropertyValue(item.name).trim() : '';
      var changed = targets.some(function (target, index) { return readTarget(target) !== before[index]; });
      var alreadyApplied = sameColour(beforeToken, next) && targets.length > 0;
      if (sameColour(appliedToken, next) && (changed || alreadyApplied)) return { ok: true, value: appliedToken || next, originalInline: beforeInline };
      if (beforeInline) doc.documentElement.style.setProperty(item.name, beforeInline); else doc.documentElement.style.removeProperty(item.name);
      return { ok: false, reason: targets.length ? 'the computed page usages did not change' : 'no painted usage of ' + item.name + ' was found' };
    }
    var rules = fallbackRules(role, item, next), priorRules = fallbackRulesByRole[role] && fallbackRulesByRole[role].slice();
    if (!rules.length || !targets.length) return { ok: false, reason: 'no writable selector and property target was found' };
    emitFallbackCss(role, item, next);
    var matching = targets.map(readTarget).filter(function (value) { return sameColour(value, next); });
    if (matching.length) return { ok: true, value: matching[0] || next };
    if (state.adapter && typeof state.adapter.apply === 'function') return { ok: true, value: next, adapter: true };
    if (priorRules) fallbackRulesByRole[role] = priorRules; else delete fallbackRulesByRole[role];
    applyFallbackStyle();
    return { ok: false, reason: 'the scoped stylesheet produced no computed colour change' };
  }
  function renderSlotValue(role, value, theme) {
    if (!mounted || theme !== editingTheme) return;
    var slot = mounted.querySelector('.colour-slot[data-role="' + role + '"]');
    if (!slot) return;
    var swatch = slot.querySelector('.colour-swatch');
    var label = slot.querySelector('code');
    if (swatch) swatch.style.background = value;
    if (label) label.textContent = value;
  }
  function captureWriteOptions(role, options) {
    options = options || {};
    var theme = options.theme || editingTheme || nowTheme();
    var item = options.item || roles(theme)[role];
    return { theme: theme, item: item ? JSON.parse(JSON.stringify(item)) : null };
  }
  function replayRole(role, value, options) {
    var replay = { theme: options.theme, item: options.item, replay: true };
    if (!writeRole(role, value, replay)) return false;
    persist();
    return true;
  }
  function writeRole(role, value, options) {
    options = options || {};
    var theme = options.theme || editingTheme || nowTheme();
    var item = options.item || roles(theme)[role];
    if (!item) return null;
    var next = typeof value === 'string' ? lchToCss(colors.clampOklch(lch(value))) : lchToCss(colors.clampOklch(value));
    var map = mapFor(theme);
    var key = tokenKey(item, role);
    var original = map[role] && map[role].was || item.value || item.hex;
    var activeTheme = editingTheme || nowTheme();
    var applied = options.replay || theme === activeTheme ? applyToPage(role, item, next) : { ok: false, reason: 'the requested theme is not active on the page' };
    if (!applied.ok) {
      I.unresolved.add('Colour role ' + role + ' could not be applied: ' + applied.reason + '.');
      return null;
    }
    next = applied.value || next;
    var appliedSrgb = lchToCss(lch(next));
    if (item.source === 'token' && !Object.prototype.hasOwnProperty.call(data().originalInline, item.name)) data().originalInline[item.name] = applied.originalInline || '';
    map[role] = {
      now: next, was: original, oklch: oklchText(value), wasOklch: oklchText(original),
      srgb: appliedSrgb, wasSrgb: lchToCss(lch(original)), role: role, space: 'oklch', name: key,
      source: item.source, usages: JSON.parse(JSON.stringify(item.usages || []))
    };
    state.data.overrides.colors[key + '-' + theme] = {
      was: oklchText(original), now: oklchText(next), srgb: appliedSrgb, wasSrgb: lchToCss(lch(original)),
      role: role, space: 'oklch', name: key, theme: theme, source: item.source,
      usages: JSON.parse(JSON.stringify(item.usages || []))
    };
    if (!options.reapply) reapplies = 0;
    renderSlotValue(role, next, theme);
    events.emit('colour:change', { role: role, value: next, theme: theme });
    return next;
  }
  function queueWrite(role, value, options) {
    pendingWrite = { role: role, value: value, options: options || {} };
    if (releaseOnly && drag) return;
    if (writeFrame) return;
    writeFrame = (win.requestAnimationFrame || function (fn) { return win.setTimeout(fn, 16); })(function () {
      writeFrame = 0;
      if (!pendingWrite) return;
      var write = pendingWrite; pendingWrite = null;
      var started = win.performance && win.performance.now ? win.performance.now() : Date.now();
      writeRole(write.role, write.value, write.options);
      if (!budgetFrame) budgetFrame = (win.requestAnimationFrame || function (fn) { return win.setTimeout(fn, 16); })(function () {
        budgetFrame = 0;
        if ((win.performance && win.performance.now ? win.performance.now() : Date.now()) - started > 16) {
          releaseOnly = true;
          if (!warnedSlow) { warnedSlow = true; events.emit('status:set', 'This page repaints slowly. Colour writes now apply on release.'); }
        }
      });
    });
  }
  function apply(role, value, options) {
    var writeOptions = captureWriteOptions(role, options);
    var before = overrideFor(role, writeOptions.theme);
    var after = typeof value === 'string' ? lchToCss(colors.clampOklch(lch(value))) : lchToCss(colors.clampOklch(value));
    if (before === after) return after;
    var applied = writeRole(role, after, writeOptions);
    if (!applied) { render(); return before; }
    persist();
    I.history.record({
      label: 'Change ' + role,
      apply: function () { return replayRole(role, applied, writeOptions); },
      revert: function () { return replayRole(role, before, writeOptions); }
    });
    events.emit('status:set', role + ' changed.');
    render();
    return applied;
  }
  function restore(snapshot) {
    reset(false);
    var maps = snapshot && snapshot.maps || snapshot || {};
    data().maps = JSON.parse(JSON.stringify(maps));
    var active = maps[nowTheme()] || {};
    Object.keys(active).forEach(function (role) { writeRole(role, active[role].now || active[role], { theme: nowTheme(), item: active[role] }); });
    persist(); render();
  }
  function reset(record) {
    var prior = JSON.parse(JSON.stringify(allMaps()));
    function clear() {
      Object.keys(data().originalInline || {}).forEach(function (name) {
        var value = data().originalInline[name];
        if (value) doc.documentElement.style.setProperty(name, value); else doc.documentElement.style.removeProperty(name);
      });
      data().maps = {}; state.data.overrides.colors = {};
      data().originalInline = {};
      fallbackRulesByRole = {}; applyFallbackStyle();
      persist(); events.emit('colour:change', { reset: true }); events.emit('status:set', 'Colour overrides reset.'); render();
    }
    if (record === false) { clear(); return; }
    if (!Object.keys(prior).length) return;
    I.history.perform({ label: 'Reset colours', apply: clear, revert: function () { restore(prior); } });
  }
  function removeLiveOverrides() {
    Object.keys(data().originalInline || {}).forEach(function (name) {
      var value = data().originalInline[name];
      if (value) doc.documentElement.style.setProperty(name, value); else doc.documentElement.style.removeProperty(name);
    });
    fallbackRulesByRole = {}; applyFallbackStyle();
  }
  function contrastPairs() {
    var found = I.tokens.discover();
    var pairs = [];
    (found.faces || []).forEach(function (face) {
      var foreground = colors.parse(face.foreground);
      var background = colors.parse(face.background);
      if (!foreground || !background) return;
      var ratio = colors.wcag(foreground, background);
      var label = (face.label || roleName(face.path) || 'text') + ' ' + colors.rgbToHex(foreground) + ' on ' + colors.rgbToHex(background);
      var size = parseFloat(face.font && face.font.size) || 16, weight = parseInt(face.font && face.font.weight, 10) || 400;
      var large = size >= 24 || size >= 18.6667 && weight >= 700;
      pairs.push({ label: label, foreground: colors.rgbToHex(foreground), background: colors.rgbToHex(background), wcag: ratio, apca: colors.apca(foreground, background), threshold: large ? 3 : 4.5, pass: ratio >= (large ? 3 : 4.5) });
    });
    pairs.sort(function (a, b) { return a.wcag - b.wcag; });
    return pairs;
  }
  function contrastSummary() {
    var pairs = contrastPairs();
    if (!pairs.length) return { text: 'No text and surface pair could be measured.', pairs: pairs, worst: null };
    var worst = pairs[0];
    return { pairs: pairs, worst: worst, text: worst.pass ? 'Every measured pair passes AA. Lowest: ' + worst.label + ', ' + worst.wcag + ':1.' : 'Failing pair: ' + worst.label + ', ' + worst.wcag + ':1.' };
  }
  function matrixFilter(kind) {
    var matrices = [
      null,
      '0.152286 1.052583 -0.204868 0 0,0.114503 0.786281 0.099216 0 0,-0.003882 -0.048116 1.051998 0 0,0 0 0 1 0',
      '0.367322 0.860646 -0.227968 0 0,0.280085 0.672501 0.047413 0 0,-0.011820 0.042940 0.968881 0 0,0 0 0 1 0',
      '1.255528 -0.076749 -0.178779 0 0,-0.078411 0.930809 0.147602 0 0,0.004733 0.691367 0.303900 0 0,0 0 0 1 0'
    ];
    if (!kind || !matrices[kind]) return '';
    var id = 'review-island-machado';
    var svg = '<svg xmlns="http://www.w3.org/2000/svg"><filter id="' + id + '"><feColorMatrix type="matrix" values="' + matrices[kind] + '"/></filter></svg>';
    return 'url("data:image/svg+xml,' + encodeURIComponent(svg).replace(/%0A/g, '') + '#' + id + '")';
  }
  function setSimulation(index) {
    simulation = ((Number(index) || 0) % 4 + 4) % 4;
    data().simulation = simulation;
    if (!simulation) {
      if (simulationStyle) simulationStyle.remove(); simulationStyle = null;
    } else {
      if (!simulationStyle) { simulationStyle = doc.createElement('style'); simulationStyle.setAttribute('data-review-island-simulation', ''); (doc.head || doc.documentElement).appendChild(simulationStyle); }
      simulationStyle.textContent = 'body{filter:' + matrixFilter(simulation) + ' !important}';
    }
    persist();
    var label = ['Normal colour', 'Protan simulation', 'Deutan simulation', 'Tritan simulation'][simulation];
    events.emit('status:set', label + '.');
    render();
    return label;
  }
  function imagePixels(image, limit) {
    limit = limit || 12000;
    var width = image.naturalWidth || image.width, height = image.naturalHeight || image.height;
    if (!width || !height) return [];
    var scale = Math.min(1, Math.sqrt(limit / (width * height)));
    var canvas = doc.createElement('canvas'); canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
    var context = canvas.getContext('2d', { willReadFrequently: true });
    try { context.drawImage(image, 0, 0, canvas.width, canvas.height); } catch (_) { return []; }
    var pixels = context.getImageData(0, 0, canvas.width, canvas.height).data, output = [];
    for (var i = 0; i < pixels.length; i += 16) {
      if (pixels[i + 3] < 128) continue;
      var lab = colors.srgbToOklab({ r: pixels[i], g: pixels[i + 1], b: pixels[i + 2], a: pixels[i + 3] / 255 });
      output.push(lab);
    }
    return output;
  }
  function clusterOklab(samples, count) {
    count = Math.max(1, Math.min(8, Number(count) || 5));
    if (!samples || !samples.length) return [];
    var centres = [], stride = Math.max(1, Math.floor(samples.length / count));
    for (var i = 0; i < count; i++) centres.push(Object.assign({}, samples[Math.min(samples.length - 1, i * stride)]));
    for (var pass = 0; pass < 8; pass++) {
      var buckets = centres.map(function () { return { l: 0, a: 0, b: 0, alpha: 0, count: 0 }; });
      samples.forEach(function (sample) {
        var nearest = 0, distance = Infinity;
        centres.forEach(function (centre, index) { var delta = Math.pow(sample.l - centre.l, 2) + Math.pow(sample.a - centre.a, 2) + Math.pow(sample.b - centre.b, 2); if (delta < distance) { distance = delta; nearest = index; } });
        var bucket = buckets[nearest]; bucket.l += sample.l; bucket.a += sample.a; bucket.b += sample.b; bucket.alpha += sample.alpha; bucket.count += 1;
      });
      buckets.forEach(function (bucket, index) { if (bucket.count) centres[index] = { l: bucket.l / bucket.count, a: bucket.a / bucket.count, b: bucket.b / bucket.count, alpha: bucket.alpha / bucket.count, count: bucket.count }; });
    }
    return centres.sort(function (a, b) { return b.count - a.count; }).map(function (centre) { var value = colors.oklabToOklch(centre); return { oklab: centre, oklch: value, hex: colors.rgbToHex(colors.mapToSrgb(value)), count: centre.count }; });
  }
  function imagePalette(input) {
    if (!input) return Promise.resolve([]);
    if (win.HTMLImageElement && input instanceof win.HTMLImageElement) return Promise.resolve(clusterOklab(imagePixels(input), 5));
    if (!/^image\//.test(input.type || '')) return Promise.resolve([]);
    return new Promise(function (resolve) {
      var reader = new win.FileReader();
      reader.onload = function () { var image = new win.Image(); image.onload = function () { resolve(clusterOklab(imagePixels(image), 5)); }; image.onerror = function () { resolve([]); }; image.src = reader.result; };
      reader.onerror = function () { resolve([]); }; reader.readAsDataURL(input);
    });
  }
  function applyImagePalette(palette) {
    if (!palette || !palette.length) { events.emit('status:set', 'That image could not provide a usable palette.'); return; }
    var ordered = palette.slice().sort(function (a, b) { return a.oklch.l - b.oklch.l; });
    var values = { ground: ordered[0], surface: ordered[Math.min(1, ordered.length - 1)], ink: ordered[ordered.length - 1], muted: ordered[Math.floor(ordered.length / 2)], accent: palette.slice().sort(function (a, b) { return b.oklch.c - a.oklch.c; })[0] };
    ROLE_ORDER.forEach(function (role) { if (values[role]) apply(role, values[role].hex); });
    events.emit('status:set', 'Image colours applied. Undo restores the previous palette.');
  }
  function exportSnapshot() {
    var maps = JSON.parse(JSON.stringify(allMaps()));
    var output = { maps: maps, roles: {}, ramps: {}, srgb: {} };
    Object.keys(maps).forEach(function (theme) {
      output.roles[theme] = {}; output.ramps[theme] = {}; output.srgb[theme] = {};
      Object.keys(maps[theme]).forEach(function (role) {
        var value = maps[theme][role].now || maps[theme][role];
        output.roles[theme][role] = { oklch: lch(value), oklchCss: oklchText(value), srgb: colors.rgbToHex(colors.mapToSrgb(lch(value))), value: value };
        output.ramps[theme][role] = pureRamp(value, 12);
        output.srgb[theme][role] = colors.rgbToHex(colors.mapToSrgb(lch(value)));
      });
    });
    return output;
  }
  function ensureStyle() {
    if (!state.shell || !state.shell.shadow || state.shell.shadow.querySelector('style[data-island-colour]')) return;
    var style = doc.createElement('style'); style.setAttribute('data-island-colour', '');
    style.textContent = '.island-colour{display:grid;gap:8px}.colour-slots{display:grid;gap:5px}.colour-slot{display:grid;grid-template-columns:24px minmax(0,1fr) auto;align-items:center;gap:7px;width:100%;padding:5px;border:1px solid transparent;border-radius:5px;background:transparent;color:var(--ink);text-align:left}.colour-slot:hover,.colour-slot:focus-visible,.colour-slot[aria-expanded="true"]{background:var(--graphite);border-color:var(--rule)}.colour-swatch{width:20px;height:20px;border-radius:3px;border:1px solid oklch(100% 0 0 / .35)}.colour-slot strong{font-size:11px;text-transform:capitalize}.colour-slot code{color:var(--muted);font-size:10px}.colour-lock{color:var(--muted);font-size:11px}.colour-editor,.colour-details{border-top:1px solid var(--rule);padding-top:8px}.colour-fields{display:grid;grid-template-columns:1fr 1fr;gap:6px}.colour-field{display:grid;grid-template-columns:18px 1fr auto;gap:5px;align-items:center;color:var(--muted)}.colour-field input[type="range"]{min-width:0;accent-color:var(--gold)}.colour-field output{width:40px;color:var(--ink);font-variant-numeric:tabular-nums}.colour-hex{width:100%;background:var(--raised);color:var(--ink);border:1px solid var(--rule);border-radius:4px;padding:5px}.colour-actions,.colour-meta{display:flex;flex-wrap:wrap;gap:5px;align-items:center}.colour-actions button,.colour-details button,.colour-library button{border:1px solid var(--rule);border-radius:4px;background:var(--graphite);color:var(--ink);padding:4px 6px}.colour-actions button:hover,.colour-actions button:focus-visible,.colour-details button:hover,.colour-details button:focus-visible,.colour-library button:hover,.colour-library button:focus-visible{color:var(--gold);border-color:var(--gold)}.colour-ramp{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;margin-top:7px}.colour-ramp button{height:25px;border:1px solid var(--rule);border-radius:3px}.colour-summary{display:flex;justify-content:space-between;gap:8px;padding-top:7px;border-top:1px solid var(--rule);color:var(--muted);font-size:10px}.colour-summary button{border:0;background:transparent;color:var(--gold);padding:0;text-align:left}.colour-table{width:100%;border-collapse:collapse;font-size:10px}.colour-table td,.colour-table th{padding:4px;border-top:1px solid var(--rule);text-align:left}.colour-drop{border:1px dashed var(--rule);border-radius:5px;padding:7px;color:var(--muted);font-size:10px}.colour-drop[data-over="true"]{border-color:var(--gold);color:var(--gold)}.colour-gamut{color:var(--muted);font-size:10px}.colour-library{border-top:1px solid var(--rule);padding-top:7px}.colour-library summary{cursor:pointer}.colour-library-list{display:flex;flex-wrap:wrap;gap:5px;margin-top:6px}.colour-retired{display:grid;gap:2px;margin-top:7px;color:var(--muted);font-size:10px}.colour-retired s{color:var(--ink)}.colour-hidden{display:none}';
    state.shell.shadow.appendChild(style);
  }
  function slot(role, item) {
    var locked = !!(data().roles && data().roles[role] && data().roles[role].locked);
    var node = dom.button('', { 'class': 'colour-slot', 'data-role': role, 'aria-expanded': String(expanded === role), title: 'Edit ' + roleName(item.name) });
    node.appendChild(dom.el('span', { 'class': 'colour-swatch', style: { background: item.now } }));
    var label = dom.el('span'); label.appendChild(dom.el('strong', null, role)); label.appendChild(dom.el('code', null, item.now)); node.appendChild(label);
    node.appendChild(dom.el('span', { 'class': 'colour-lock', text: locked ? 'Locked' : '' }));
    node.addEventListener('click', function () { expanded = expanded === role ? null : role; render(); });
    return node;
  }
  function inputRow(letter, property, value, max, factor, onChange, descriptor) {
    var row = dom.el('label', 'colour-field');
    row.appendChild(dom.el('span', null, letter));
    var input = dom.el('input', { type: 'range', min: '0', max: String(max), step: String(factor), value: String(value), 'aria-label': property });
    var output = dom.el('output', null, property === 'Hue' ? Math.round(value) + '°' : property === 'Lightness' ? Math.round(value * 100) + '%' : round(value, 3));
    input.addEventListener('pointerdown', function () { drag = { role: expanded, before: descriptor.now, item: descriptor, changed: false }; });
    input.addEventListener('input', function () { if (!drag) drag = { role: expanded, before: descriptor.now, item: descriptor, changed: false }; onChange(Number(input.value), false); output.textContent = property === 'Hue' ? Math.round(Number(input.value)) + '°' : property === 'Lightness' ? Math.round(Number(input.value) * 100) + '%' : round(Number(input.value), 3); });
    input.addEventListener('change', function () { onChange(Number(input.value), true); });
    row.appendChild(input); row.appendChild(output); return row;
  }
  function commitDrag(role, value, descriptor) {
    var started = drag; drag = null;
    pendingWrite = null;
    if (started && started.changed) {
      var writeOptions = captureWriteOptions(role, { item: started.item || descriptor, theme: (started.item || descriptor).theme });
      var applied = writeRole(role, value, writeOptions);
      if (!applied) { render(); return; }
      persist();
      I.history.record({ label: 'Change ' + role,
        apply: function () { return replayRole(role, applied, writeOptions); },
        revert: function () { return replayRole(role, started.before, writeOptions); }
      });
      events.emit('status:set', role + ' changed.');
      render();
    }
    else if (!started) apply(role, value);
  }
  function editor(role, item) {
    var panel = dom.el('section', { 'class': 'colour-editor', 'aria-label': 'Colour editor for ' + role });
    var current = lch(item.now), max = colors.maxSrgbChroma(current.l, current.h);
    var fields = dom.el('div', 'colour-fields'), chromaControl = null, maxLabel = null;
    function change(part, value, final) {
      var next = { l: current.l, c: current.c, h: current.h, alpha: current.alpha }; next[part] = value;
      max = colors.maxSrgbChroma(next.l, next.h); next.c = Math.min(next.c, max); current = next;
      if (chromaControl) { chromaControl.max = String(max); if (Number(chromaControl.value) > max) chromaControl.value = String(max); }
      if (maxLabel) maxLabel.textContent = 'sRGB, chroma maximum ' + round(max, 3);
      var css = lchToCss(next);
      if (drag) drag.changed = true;
      if (final) commitDrag(role, css, item); else queueWrite(role, css, { item: item, theme: item.theme });
    }
    fields.appendChild(inputRow('L', 'Lightness', current.l, 1, 0.01, function (value, final) { change('l', value, final); }, item));
    var chromaRow = inputRow('C', 'Chroma', current.c, max, 0.001, function (value, final) { change('c', value, final); }, item); chromaControl = chromaRow.querySelector('input'); fields.appendChild(chromaRow);
    fields.appendChild(inputRow('H', 'Hue', current.h, 360, 1, function (value, final) { change('h', value, final); }, item));
    panel.appendChild(fields);
    var hex = dom.el('input', { 'class': 'colour-hex', value: item.now, 'aria-label': role + ' hexadecimal colour', spellcheck: 'false' });
    hex.addEventListener('change', function () { if (colors.parse(hex.value)) apply(role, hex.value, { theme: item.theme, item: item }); else { events.emit('status:set', 'Enter a valid hex colour.'); hex.value = item.now; } }); panel.appendChild(hex);
    var meta = dom.el('div', 'colour-meta'); maxLabel = dom.el('span', { 'class': 'colour-gamut', text: 'sRGB, chroma maximum ' + round(max, 3) }); meta.appendChild(maxLabel);
    if (I.capabilities && I.capabilities.eyedropper) {
      var eyedropper = dom.button('Pick', { title: 'Pick a colour from the page' });
      eyedropper.addEventListener('click', function () { new win.EyeDropper().open().then(function (result) { apply(role, result.sRGBHex); }).catch(function () {}); }); meta.appendChild(eyedropper);
    } else { meta.appendChild(dom.el('span', { 'class': 'colour-gamut', text: 'Eyedropper unavailable. Enter a value.' })); if (!eyedropperReported) { eyedropperReported = true; I.degrade('eyedropper'); } }
    panel.appendChild(meta);
    var ramp = dom.el('div', { 'class': 'colour-ramp', 'aria-label': role + ' three step ramp' });
    uiRamp(item.now).forEach(function (step) { var pick = dom.button('', { title: 'Use ' + step.hex, style: { background: step.hex } }); pick.addEventListener('click', function () { apply(role, step.hex, { theme: item.theme }); }); ramp.appendChild(pick); }); panel.appendChild(ramp);
    var actions = dom.el('div', 'colour-actions');
    var lock = dom.button(data().roles[role] && data().roles[role].locked ? 'Unlock' : 'Lock', { title: 'Lock this role before re-rolling' });
    lock.addEventListener('click', function () { data().roles[role] = { locked: !(data().roles[role] && data().roles[role].locked) }; persist(); render(); }); actions.appendChild(lock);
    panel.appendChild(actions); return panel;
  }
  function strategyPalette(strategy, accent) {
    var anchor = lch(accent), lightness = [0.12, 0.2, 0.88, 0.62, 0.62], output = {};
    ROLE_ORDER.forEach(function (role, index) {
      var hue = strategy === 'perceptual-neutral' ? anchor.h : anchor.h + (strategy === 'complementary' ? 180 : strategy === 'triad' ? index * 120 : (index - 2) * 18);
      var chroma = role === 'accent' ? Math.min(0.18, Math.max(anchor.c, 0.08)) : strategy === 'perceptual-neutral' ? 0.003 : 0.025;
      output[role] = colors.clampOklch({ l: lightness[index], c: Math.min(chroma, colors.maxSrgbChroma(lightness[index], hue)), h: hue, alpha: 1 });
    });
    return output;
  }
  function reroll() {
    var current = roles(editingTheme || nowTheme()), locked = data().roles || {}, strategy = (data().strategy || 'analogous'), generated = strategyPalette(strategy, current.accent.now);
    ROLE_ORDER.forEach(function (role, index) {
      if (locked[role] && locked[role].locked) return;
      apply(role, generated[role], { theme: editingTheme || nowTheme(), item: current[role] });
    });
    events.emit('status:set', strategy + ' palette re-rolled.');
  }
  function details() {
    var section = dom.el('section', 'colour-details');
    var themes = dom.el('div', 'colour-actions');
    ['light', 'dark'].forEach(function (theme) { var choose = dom.button(theme, { 'aria-pressed': String(editingTheme === theme), title: 'Edit the ' + theme + ' palette' }); choose.addEventListener('click', function () { expanded = null; switchTheme(theme); }); themes.appendChild(choose); });
    section.appendChild(themes);
    if (I.advice) I.advice.append(section, 'colour.theme', { darkFirstMissing: !allMaps().dark });
    var states = dom.button(showStates ? 'Hide state roles' : 'State roles', { title: 'Show state roles only when declared or needed' });
    states.addEventListener('click', function () { showStates = !showStates; data().stateRoles = showStates; persist(); render(); }); section.appendChild(states);
    if (I.advice) I.advice.append(section, 'colour.roles', { missingStateRoles: !STATE_ROLES.some(function (role) { return roles(editingTheme)[role] && roles(editingTheme)[role].source === 'token'; }) });
    var simulationButton = dom.button(['Normal', 'Protan', 'Deutan', 'Tritan'][simulation], { title: 'Cycle colour-vision simulation' }); simulationButton.addEventListener('click', function () { setSimulation(simulation + 1); }); section.appendChild(simulationButton);
    var resetButton = dom.button('Reset', { title: 'Reset every live colour override' }); resetButton.addEventListener('click', function () { reset(); }); section.appendChild(resetButton);
    var strategy = dom.el('select', { 'aria-label': 'Palette relationship' });
    ['analogous', 'complementary', 'triad', 'perceptual-neutral'].forEach(function (name) { var option = dom.el('option', { value: name, text: name }); if ((data().strategy || 'analogous') === name) option.selected = true; strategy.appendChild(option); });
    strategy.addEventListener('change', function () { data().strategy = strategy.value; persist(); }); section.appendChild(strategy);
    var searchButton = dom.button(tokenSearchOpen ? 'Hide unused tokens' : 'Search unused tokens', { title: 'Search declared colours that are not painted on this page' });
    searchButton.addEventListener('click', function () { tokenSearchOpen = !tokenSearchOpen; render(); }); section.appendChild(searchButton);
    if (tokenSearchOpen) {
      var search = dom.el('input', { 'class': 'colour-hex', type: 'search', placeholder: 'Token name', 'aria-label': 'Search unused colour tokens' });
      var results = dom.el('div', 'colour-actions');
      function find() {
        results.textContent = '';
        var needle = search.value.toLowerCase();
        var selectedRoles = roles();
        var selectedNames = Object.keys(selectedRoles).map(function (role) { return selectedRoles[role].name; });
        I.tokens.discover().colors.filter(function (entry) { return selectedNames.indexOf(entry.name) < 0 && (!needle || entry.name.toLowerCase().indexOf(needle) >= 0); }).slice(0, 12).forEach(function (entry) {
          var token = dom.button(roleName(entry.name), { title: entry.name + ' ' + entry.hex });
          token.style.borderLeftColor = entry.hex;
          token.addEventListener('click', function () {
            var before = doc.documentElement.style.getPropertyValue(entry.name) || entry.value;
            I.history.perform({ label: 'Change ' + entry.name,
              apply: function () { doc.documentElement.style.setProperty(entry.name, entry.hex); state.data.overrides.colors[entry.name + '-' + nowTheme()] = { was: oklchText(entry.value), now: oklchText(entry.hex), srgb: entry.hex, wasSrgb: lchToCss(lch(entry.value)), name: entry.name, theme: nowTheme(), role: roleForName(entry.name), space: 'oklch', source: 'token', usages: entry.usages || [] }; persist(); },
              revert: function () { doc.documentElement.style.setProperty(entry.name, before); state.data.overrides.colors[entry.name + '-' + nowTheme()] = { was: oklchText(entry.value), now: oklchText(before), srgb: lchToCss(lch(before)), wasSrgb: lchToCss(lch(entry.value)), name: entry.name, theme: nowTheme(), role: roleForName(entry.name), space: 'oklch', source: 'token', usages: entry.usages || [] }; persist(); }
            });
            events.emit('colour:change', { role: roleForName(entry.name), value: entry.hex }); events.emit('status:set', entry.name + ' applied.');
          });
          results.appendChild(token);
        });
        if (!results.childNodes.length) results.appendChild(dom.el('span', { 'class': 'colour-gamut', text: 'No unused colour tokens match.' }));
      }
      search.addEventListener('input', find); section.appendChild(search); section.appendChild(results); find();
    }
    return section;
  }
  function imageDrop() {
    var drop = dom.el('div', { 'class': 'colour-drop', tabindex: '0', text: 'Drop an image to take its palette.' });
    function receive(file) { imagePalette(file).then(applyImagePalette); }
    drop.addEventListener('dragover', function (event) { event.preventDefault(); drop.dataset.over = 'true'; }); drop.addEventListener('dragleave', function () { delete drop.dataset.over; }); drop.addEventListener('drop', function (event) { event.preventDefault(); delete drop.dataset.over; receive(event.dataTransfer.files[0]); });
    drop.addEventListener('keydown', function (event) { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); var input = doc.createElement('input'); input.type = 'file'; input.accept = 'image/*'; input.addEventListener('change', function () { receive(input.files[0]); }); input.click(); } });
    return drop;
  }
  function libraryEntries() {
    return {
      active: I.library && I.library.active ? I.library.active('palettes') : [],
      retired: I.library && I.library.retiredEntries ? I.library.retiredEntries('palettes') : []
    };
  }
  function applyLibraryPalette(palette) {
    var current = roles(editingTheme || nowTheme()), declared = palette && palette.roles || {};
    if (declared.light || declared.dark) declared = declared[editingTheme || nowTheme()] || declared.light || declared.dark || {};
    var names = { background: 'ground', ground: 'ground', surface: 'surface', ink: 'ink', muted: 'muted', accent: 'accent', line: 'line' };
    Object.keys(declared).forEach(function (name) {
      var role = names[name] || name;
      if (current[role] && colors.parse(declared[name])) apply(role, declared[name], { theme: editingTheme || nowTheme(), item: current[role] });
    });
    events.emit('status:set', (palette.name || palette.id || 'Project palette') + ' applied.');
  }
  function paletteLibrary() {
    var entries = libraryEntries(), details = dom.el('details', { 'class': 'colour-library', 'data-colour-library': '' });
    details.appendChild(dom.el('summary', { text: 'Project palettes' }));
    var active = dom.el('div', 'colour-library-list');
    entries.active.forEach(function (palette) {
      var control = dom.button(palette.name || palette.id, { 'data-palette-id': palette.id, title: palette.note || 'Apply this project palette' });
      control.addEventListener('click', function () { applyLibraryPalette(palette); }); active.appendChild(control);
    });
    if (!entries.active.length) active.appendChild(dom.el('span', { 'class': 'colour-gamut', text: 'No active project palettes.' }));
    details.appendChild(active);
    if (entries.retired.length) {
      var retiredDrawer = dom.el('details', 'colour-retired-drawer');
      retiredDrawer.appendChild(dom.el('summary', { text: 'Previously ruled out' }));
      entries.retired.forEach(function (palette) {
        var retired = dom.el('div', { 'class': 'colour-retired', 'data-retired-palette': palette.id });
        retired.appendChild(dom.el('s', { text: palette.name || palette.id }));
        retired.appendChild(dom.el('span', { text: palette.retiredReason || 'Retired from this project.' })); retiredDrawer.appendChild(retired);
      });
      details.appendChild(retiredDrawer);
    }
    return details;
  }
  function render() {
    if (!mounted) return;
    ensureStyle(); mounted.textContent = '';
    var root = dom.el('div', 'island-colour');
    editingTheme = editingTheme || nowTheme();
    var current = roles(editingTheme);
    var slots = dom.el('div', { 'class': 'colour-slots', 'aria-label': 'Colour roles' });
    ROLE_ORDER.forEach(function (role) { slots.appendChild(slot(role, current[role])); });
    var declaredStates = STATE_ROLES.some(function (role) { return current[role] && current[role].source === 'token'; });
    if (showStates || declaredStates) STATE_ROLES.forEach(function (role) { if (current[role]) slots.appendChild(slot(role, current[role])); });
    root.appendChild(slots);
    if (expanded && current[expanded]) root.appendChild(editor(expanded, current[expanded]));
    var actions = dom.el('div', 'colour-actions');
    var rerollButton = dom.button('Re-roll', { title: 'Re-roll unlocked roles, Space' }); rerollButton.addEventListener('click', reroll); actions.appendChild(rerollButton);
    root.appendChild(actions);
    var summary = contrastSummary(), line = dom.el('div', 'colour-summary');
    var summaryButton = dom.button(summary.text, { title: 'Show measured WCAG and APCA pairs' }); line.appendChild(summaryButton); line.appendChild(dom.el('span', null, summary.worst ? summary.worst.wcag + ':1' : ''));
    summaryButton.addEventListener('click', function () { var table = line.querySelector('table'); if (table) { table.remove(); return; } table = dom.el('table', 'colour-table'); table.innerHTML = '<thead><tr><th>Pair</th><th>WCAG</th><th>APCA Lc (advisory)</th></tr></thead>'; var body = dom.el('tbody'); summary.pairs.forEach(function (pair) { var row = dom.el('tr'); row.appendChild(dom.el('td', null, pair.label)); row.appendChild(dom.el('td', null, pair.wcag + ':1 ' + (pair.pass ? 'AA' : 'fail'))); row.appendChild(dom.el('td', null, String(pair.apca))); body.appendChild(row); }); table.appendChild(body); line.appendChild(table); });
    root.appendChild(line); root.appendChild(imageDrop()); root.appendChild(paletteLibrary());
    if (I.advice && summary.worst && !summary.worst.pass) I.advice.append(root, 'colour.contrast', { wcag: summary.worst.wcag });
    var more = dom.button(utilitiesOpen ? 'Less' : 'More', { title: 'Show colour utilities' }); more.addEventListener('click', function () { utilitiesOpen = !utilitiesOpen; render(); }); root.appendChild(more);
    if (utilitiesOpen) root.appendChild(details()); mounted.appendChild(root);
  }
  function liveOverridesPresent() { return Object.keys(state.data.overrides && state.data.overrides.colors || {}).length > 0; }
  function overridesIntact() {
    var active = allMaps()[nowTheme()] || {}, synthetic = false;
    return Object.keys(active).every(function (role) {
      var item = active[role] || {}, expected = item.now || item;
      if (item.source === 'token' && item.name) return doc.documentElement.style.getPropertyValue(item.name).trim() === String(expected).trim();
      synthetic = true; return true;
    }) && (!synthetic || I.capabilities && I.capabilities.adoptedStyleSheets || !!doc.querySelector('style[data-review-island-style="colour-overrides"]'));
  }
  function reapply() {
    if (!liveOverridesPresent() || overridesIntact() || reapplies >= 12 || reapplyFrame) return;
    reapplyFrame = (win.requestAnimationFrame || function (fn) { return win.setTimeout(fn, 16); })(function () {
      reapplyFrame = 0; reapplies += 1;
      var maps = allMaps(); Object.keys(maps).forEach(function (theme) { if (theme === nowTheme()) Object.keys(maps[theme]).forEach(function (role) { writeRole(role, maps[theme][role].now || maps[theme][role], { theme: theme, item: maps[theme][role], reapply: true }); }); });
      if (reapplies === 12) { I.unresolved.add('Colour overrides stopped reapplying after repeated page renders.'); events.emit('status:set', 'Page re-rendering kept removing overrides. Reapply limit reached.'); }
    });
  }
  function applyActiveMap() {
    var active = allMaps()[nowTheme()] || {};
    Object.keys(active).forEach(function (role) { writeRole(role, active[role].now || active[role], { theme: nowTheme(), item: active[role], reapply: true }); });
  }
  function ensureObserver() {
    if (observer || !win.MutationObserver) return;
    observer = new win.MutationObserver(function () { reapply(); });
    observer.observe(doc.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'class', 'data-theme', 'data-color-scheme'] });
  }
  function activate(container) {
    mounted = container; showStates = !!data().stateRoles; simulation = Number(data().simulation) || 0; ensureStyle();
    applyActiveMap(); ensureObserver(); if (simulation) setSimulation(simulation); render();
    subscriptions.push(events.on('key:space', reroll));
    subscriptions.push(events.on('theme:change', function () { reapplies = 0; applyActiveMap(); render(); }));
  }
  function deactivate() {
    subscriptions.forEach(function (off) { off(); }); subscriptions = []; mounted = null; drag = null;
  }
  events.on('shell:mounted', function () { applyActiveMap(); ensureObserver(); });
  events.on('session:disable', function () {
    if (observer) { observer.disconnect(); observer = null; }
    removeLiveOverrides(); if (simulationStyle) { simulationStyle.remove(); simulationStyle = null; }
    if (themeBeforeEditing) {
      if (themeBeforeEditing.hadTheme) doc.documentElement.setAttribute('data-theme', themeBeforeEditing.theme); else doc.documentElement.removeAttribute('data-theme');
      if (themeBeforeEditing.hadScheme) doc.documentElement.setAttribute('data-color-scheme', themeBeforeEditing.scheme); else doc.documentElement.removeAttribute('data-color-scheme');
      themeBeforeEditing = null;
    }
  });
  I.colour = {
    ramp: pureRamp,
    generateRamp: pureRamp,
    displayRamp: uiRamp,
    roles: function (theme) { return JSON.parse(JSON.stringify(roles(theme))); },
    snapshot: exportSnapshot,
    exportSnapshot: exportSnapshot,
    apply: apply,
    restore: restore,
    reset: reset,
    contrast: contrastPairs,
    collectContrast: contrastPairs,
    imagePalette: imagePalette,
    clusterImage: function (samples, count) { return clusterOklab(samples, count); },
    synthesizedRules: fallbackRules,
    strategyPalette: strategyPalette,
    availablePalettes: function () { return I.library.active('palettes'); },
    libraryEntries: libraryEntries,
    applyPalette: applyLibraryPalette,
    simulation: setSimulation,
    showTheme: switchTheme,
    replayDescriptor: replayDescriptor
  };
  I.registerMode({ id: 'colour', label: 'Colour', render: function (container) { mounted = container; render(); }, activate: activate, deactivate: deactivate });
})();
