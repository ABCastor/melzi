/* The Review Island type studio. It intentionally has no runtime dependency. */
(function () {
  'use strict';

  var I = Island;
  var global = I.global;
  var doc = I.document;
  var dom = I.dom;
  var ROLE_ORDER = ['display', 'heading', 'body', 'interface', 'mono'];
  var ROLE_SELECTORS = {
    display: 'h1,[data-display],[class*="display"]',
    heading: 'h2,h3,h4,h5,h6,[data-heading],[class*="heading"]',
    body: 'body,p,li,blockquote,figcaption,td,th,dd',
    interface: 'button,input,select,textarea,label,nav,a,[role="button"]',
    mono: 'pre,code,kbd,samp,[class*="mono"]'
  };
  var NEUTRAL_FACES = [
    { id: 'neutral-system', family: 'System UI', stack: 'system-ui, sans-serif', role: 'interface', source: 'installed', licence: 'web', classification: 'sans', note: 'Installed system UI fonts are available without an embedding dependency.' },
    { id: 'neutral-serif', family: 'System Serif', stack: 'ui-serif, Georgia, serif', role: 'body', source: 'installed', licence: 'web', classification: 'serif', note: 'Installed system serif stack, suitable for a readable contrast check.' },
    { id: 'neutral-mono', family: 'System Mono', stack: 'ui-monospace, SFMono-Regular, Consolas, monospace', role: 'mono', source: 'installed', licence: 'web', classification: 'monospace', note: 'Installed monospaced stack for code and tabular text.' }
  ];
  var roleNodes = {};
  var roleBase = {};
  var appliedNodes = [];
  var renderedRoot = null;
  var observer = null;
  var observerTimer = 0;
  var reapplyCount = 0;
  var transient = {};
  var fontChecks = {};
  var fontRenderTimer = 0;
  var appliedCss = '';
  var fallbackStyle = null;
  var panelStyle = null;
  var typeKeysBound = false;

  function clone(value) { return JSON.parse(JSON.stringify(value == null ? null : value)); }
  function cleanFamily(value) { return String(value || '').split(',')[0].trim().replace(/^['"]|['"]$/g, ''); }
  function numeric(value, fallback) { var number = parseFloat(value); return isFinite(number) ? number : fallback; }
  function data() {
    var value = I.state.data;
    value.overrides = value.overrides || { colors: {}, type: {} };
    value.overrides.type = value.overrides.type || {};
    value.unresolved = Array.isArray(value.unresolved) ? value.unresolved : [];
    return value;
  }
  function visible(node) {
    if (!node || dom.ours(node)) return false;
    var style = global.getComputedStyle(node);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }
  function roleName(role) { return role.charAt(0).toUpperCase() + role.slice(1); }
  function nodesFor(role) {
    var found = [];
    try { found = Array.prototype.slice.call(doc.querySelectorAll(ROLE_SELECTORS[role] || '')); } catch (_) {}
    return found.filter(visible);
  }
  function readingElement(nodes) {
    return (nodes || []).filter(function (node) { return node !== doc.body && node !== doc.documentElement; }).sort(function (left, right) {
      return String(right.textContent || '').trim().length - String(left.textContent || '').trim().length;
    })[0] || nodes[0] || doc.body || doc.documentElement;
  }
  function estimateMeasure(width, size) { return size > 0 ? Math.round(Math.max(0, width) / (size * 0.5)) : 0; }
  function captureRole(role, nodes) {
    var node = role === 'body' ? readingElement(nodes) : nodes[0] || doc.body || doc.documentElement;
    var style = global.getComputedStyle(node);
    var size = numeric(style.fontSize, 16);
    var lineHeight = numeric(style.lineHeight, Math.round(size * 1.5));
    var width = node.getBoundingClientRect ? node.getBoundingClientRect().width : 0;
    return {
      role: role,
      family: cleanFamily(style.fontFamily),
      stack: style.fontFamily || 'system-ui, sans-serif',
      size: size,
      lineHeight: lineHeight,
      lineHeightRatio: Math.round((lineHeight / Math.max(1, size)) * 100) / 100,
      weight: style.fontWeight || '400',
      measure: role === 'body' ? estimateMeasure(width, size) : 0,
      colour: style.color || '',
      path: dom.cssPath(node)
    };
  }
  function discoverRoles(refresh) {
    ROLE_ORDER.forEach(function (role) {
      if (!roleNodes[role] || refresh) roleNodes[role] = nodesFor(role);
      if (!roleBase[role] || refresh) roleBase[role] = captureRole(role, roleNodes[role]);
    });
    return clone(roleBase);
  }
  function rememberNode(node, role) {
    if (appliedNodes.some(function (item) { return item.node === node && item.role === role; })) return;
    appliedNodes.push({ node: node, role: role, had: node.hasAttribute('data-review-island-type-role'), before: node.getAttribute('data-review-island-type-role') });
  }
  function markRoleNodes() {
    discoverRoles(false);
    ROLE_ORDER.forEach(function (role) {
      roleNodes[role].forEach(function (node) {
        rememberNode(node, role);
        node.setAttribute('data-review-island-type-role', role);
      });
    });
  }
  function restoreNodeMarks() {
    appliedNodes.forEach(function (item) {
      if (!item.node || !item.node.isConnected) return;
      if (item.had) item.node.setAttribute('data-review-island-type-role', item.before);
      else item.node.removeAttribute('data-review-island-type-role');
    });
    appliedNodes = [];
  }
  function cssValue(value) { return String(value == null ? '' : value).replace(/[{};]/g, ''); }
  function overrideFor(role, all) { return all[role] || null; }
  function cssFor(overrides) {
    var css = ':root{';
    ROLE_ORDER.forEach(function (role) {
      var item = overrideFor(role, overrides);
      if (!item || !item.now) return;
      var now = item.now;
      css += '--review-island-type-' + role + '-family:' + cssValue(now.stack || now.family) + ';';
      if (item.size) css += '--review-island-type-' + role + '-size:' + numeric(item.size, 16) + 'px;';
      if (item.line_height) css += '--review-island-type-' + role + '-line-height:' + numeric(item.line_height, 1.5) + ';';
      if (item.measure) css += '--review-island-type-' + role + '-measure:' + numeric(item.measure, 70) + 'ch;';
      if (item.axes && Object.keys(item.axes).length) css += '--review-island-type-' + role + '-axes:' + Object.keys(item.axes).map(function (tag) { return '\'' + tag.replace(/[^A-Za-z0-9]/g, '') + '\' ' + numeric(item.axes[tag], 0); }).join(', ') + ';';
    });
    css += '}';
    ROLE_ORDER.forEach(function (role) {
      var item = overrideFor(role, overrides);
      if (!item || !item.now) return;
      css += '[data-review-island-type-role="' + role + '"]{font-family:var(--review-island-type-' + role + '-family)!important;';
      if (item.size) css += 'font-size:var(--review-island-type-' + role + '-size)!important;';
      if (item.line_height) css += 'line-height:var(--review-island-type-' + role + '-line-height)!important;';
      if (item.measure && role === 'body') css += 'max-width:var(--review-island-type-' + role + '-measure)!important;';
      if (item.axes && Object.keys(item.axes).length) css += 'font-variation-settings:var(--review-island-type-' + role + '-axes)!important;';
      css += '}';
    });
    return css;
  }
  function removePageCss() {
    if (I.styles && I.styles.remove) I.styles.remove('type');
    if (fallbackStyle) fallbackStyle.remove();
    fallbackStyle = null; appliedCss = '';
  }
  function applyPageCss(css) {
    if (css === appliedCss) return;
    if (!css || css === ':root{}') { removePageCss(); return; }
    if (I.styles && I.styles.apply) I.styles.apply('type', css);
    else {
      if (fallbackStyle) fallbackStyle.remove();
      fallbackStyle = doc.createElement('style');
      fallbackStyle.setAttribute('data-review-island-type-overrides', '');
      fallbackStyle.textContent = css;
      (doc.head || doc.documentElement).appendChild(fallbackStyle);
    }
    appliedCss = css;
  }
  function mergedOverrides() { return Object.assign({}, data().overrides.type, transient); }
  function emitChange() { I.events.emit('type:change', clone(data().overrides.type)); }
  function applyCurrent(options) {
    options = options || {};
    if (!Object.keys(mergedOverrides()).length) { removePageCss(); restoreNodeMarks(); return; }
    markRoleNodes();
    applyPageCss(cssFor(mergedOverrides()));
    if (!options.silent) emitChange();
  }
  function unresolved(message) {
    if (I.unresolved && I.unresolved.add) return I.unresolved.add(message);
    var list = data().unresolved;
    if (list.indexOf(message) < 0) list.push(message);
    I.persist();
    I.events.emit('status:set', message);
  }
  function faceLicence(face) {
    var licence = String(face && (face.licence || face.license) || 'web').toLowerCase();
    return { value: licence, label: licence === 'personal' ? 'Personal use only' : licence === 'paid' ? 'Paid' : 'Free for web', reason: String(face && (face.note || face.licenceReason || face.licenseReason) || (licence === 'personal' ? 'This licence cannot be handed over for web use.' : licence === 'paid' ? 'A commercial licence is required before use.' : 'This face is available for web use.')) };
  }
  function isRetired(face) { return !!(I.library && I.library.isRetired && I.library.isRetired(face)); }
  function catalogue(filters) {
    filters = filters || {};
    var project = I.library ? I.library.active('faces') : [];
    var seen = {};
    return project.concat(NEUTRAL_FACES).filter(function (face) {
      if (!face || !face.id || seen[face.id] || isRetired(face)) return false;
      seen[face.id] = true;
      var licence = faceLicence(face).value;
      var query = String(filters.query || '').trim().toLowerCase();
      return (!query || [face.family, face.id, face.classification, face.note].join(' ').toLowerCase().indexOf(query) >= 0) &&
        (!filters.classification || face.classification === filters.classification) &&
        (!filters.licence || licence === filters.licence) &&
        (!filters.variable || !!(face.axes && Object.keys(face.axes).length));
    });
  }
  function fontSource(face) {
    var source = face && (face.fontSource || face.url || face.source);
    if (!source || source === 'installed' || /^local\(/i.test(source)) return '';
    return /^url\(/i.test(source) ? source : 'url("' + String(source).replace(/"/g, '%22') + '")';
  }
  function fontKey(face) { return String(face && (face.id || [face.family, face.stack, face.source, face.url].join('|')) || ''); }
  function isSystemStack(face) {
    var stack = String(face && (face.stack || face.family) || '');
    return (!face || !fontSource(face)) && (/(^|,)\s*(system-ui|ui-serif|ui-sans-serif|ui-monospace|sans-serif|serif|monospace)\b/i.test(stack) || /^system (ui|serif|mono)$/i.test(stack.trim()));
  }
  function loadFont(face) {
    var family = cleanFamily(face && (face.family || face.stack));
    if (!family) return Promise.resolve({ ok: false, reason: 'A font family was not provided.' });
    if (isSystemStack(face)) return Promise.resolve({ ok: true, family: family, system: true });
    if (!doc.fonts || typeof doc.fonts.check !== 'function') return Promise.resolve({ ok: false, reason: 'This browser cannot check whether ' + family + ' loaded.' });
    var descriptor = '16px "' + family.replace(/"/g, '') + '"';
    var source = fontSource(face);
    var load = Promise.resolve();
    if (source && !global.FontFace) return Promise.resolve({ ok: false, reason: 'This browser cannot load ' + family + '.' });
    if (source && global.FontFace) {
      try {
        var loaded = new global.FontFace(family, source, { style: face.style || 'normal', weight: face.weight || '100 900' });
        load = loaded.load().then(function (result) { doc.fonts.add(result); });
      } catch (error) { return Promise.resolve({ ok: false, reason: family + ' could not be requested.' }); }
    } else if (doc.fonts.load) load = doc.fonts.load(descriptor);
    return load.then(function () {
      return doc.fonts.check(descriptor) ? { ok: true, family: family } : { ok: false, reason: family + ' did not load.' };
    }).catch(function () { return { ok: false, reason: family + ' did not load.' }; });
  }
  function queueFontRender() {
    if (fontRenderTimer || !renderedRoot) return;
    fontRenderTimer = global.setTimeout(function () { fontRenderTimer = 0; if (renderedRoot) render(); }, 0);
  }
  function ensureFont(face) {
    var key = fontKey(face);
    if (fontChecks[key]) return fontChecks[key];
    var entry = { state: 'loading', result: null, promise: null };
    entry.promise = loadFont(face).then(function (result) {
      entry.result = result;
      entry.state = result.ok ? 'ready' : 'failed';
      if (!result.ok) {
        if (I.unresolved && I.unresolved.font) I.unresolved.font(cleanFamily(face.family || face.stack));
        else unresolved(result.reason);
      }
      queueFontRender();
      return result;
    });
    fontChecks[key] = entry;
    return entry;
  }
  function fontState(face) { return fontChecks[fontKey(face)] || ensureFont(face); }
  function baseFor(role) { discoverRoles(false); return clone(roleBase[role] || captureRole(role, [])); }
  function faceNow(face) { return { family: cleanFamily(face.family || face.stack), stack: face.stack || face.family, source: face.source || 'installed', licence: faceLicence(face).value, id: face.id || '' }; }
  function snapshot() { return clone(data().overrides.type); }
  function handoffSafe(next) {
    var safe = clone(next || {});
    Object.keys(safe).forEach(function (role) {
      var item = safe[role];
      if (!item || !item.now || item.now.licence === 'personal' || isRetired({ id: item.now.id })) delete safe[role];
    });
    return safe;
  }
  function replaceSnapshot(next, options) {
    options = options || {};
    data().overrides.type = handoffSafe(next);
    if (options.clearTransient) transient = {};
    applyCurrent({ silent: true });
    if (!options.transient) I.persist();
    emitChange();
  }
  function liveState() { return { durable: snapshot(), transient: clone(transient) }; }
  function replaceLiveState(next, persistState) {
    next = next || {};
    data().overrides.type = handoffSafe(next.durable || {});
    transient = clone(next.transient || {});
    applyCurrent({ silent: true });
    if (persistState) I.persist();
    emitChange();
  }
  function resetReapplyCeiling() { reapplyCount = 0; }
  function announceCommit(label) {
    var message = String(label || 'Type change').replace(/^Change\s+/i, '') + ' applied.';
    I.events.emit('status:set', message.charAt(0).toUpperCase() + message.slice(1));
  }
  function commit(next, label) {
    var before = snapshot();
    var after = clone(next);
    if (JSON.stringify(before) === JSON.stringify(after)) return false;
    I.history.perform({
      label: label,
      apply: function () { replaceSnapshot(after, { clearTransient: true }); },
      revert: function () { replaceSnapshot(before, { clearTransient: true }); }
    });
    resetReapplyCeiling();
    announceCommit(label);
    return true;
  }
  function apply(role, face, options) {
    options = options || {};
    if (ROLE_ORDER.indexOf(role) < 0) return Promise.resolve({ ok: false, reason: 'Unknown type role.' });
    if (!face || isRetired(face)) return Promise.resolve({ ok: false, reason: 'This retired face is not available.' });
    return ensureFont(face).promise.then(function (result) {
      if (!result.ok) return result;
      var item = { was: baseFor(role), now: faceNow(face), size: options.size, line_height: options.line_height, measure: options.measure, axes: clone(options.axes || face.axesValues || {}) };
      if (faceLicence(face).value === 'personal') {
        var before = liveState();
        var after = liveState(); after.transient[role] = item;
        I.history.perform({
          label: 'Preview ' + role + ' face',
          apply: function () { replaceLiveState(after); },
          revert: function () { replaceLiveState(before); }
        });
        resetReapplyCeiling();
        I.events.emit('status:set', 'Preview only: ' + faceNow(face).family + ' cannot be kept or handed over.');
        return { ok: true, preview: true, item: clone(item) };
      }
      var next = snapshot(); next[role] = item;
      commit(next, 'Change ' + role + ' face');
      return { ok: true, item: clone(item) };
    });
  }
  function setMetric(role, property, value) {
    if (ROLE_ORDER.indexOf(role) < 0) return false;
    var next = snapshot();
    if (!next[role]) next[role] = { was: baseFor(role), now: { family: baseFor(role).family, stack: baseFor(role).stack, source: 'page', licence: 'web' }, axes: {} };
    next[role][property] = value;
    return commit(next, 'Change ' + role + ' ' + property.replace('_', ' '));
  }
  function setAxis(role, axis, value) {
    if (!/^[A-Za-z0-9]{4}$/.test(axis || '')) return false;
    var next = snapshot();
    if (!next[role]) next[role] = { was: baseFor(role), now: { family: baseFor(role).family, stack: baseFor(role).stack, source: 'page', licence: 'web' }, axes: {} };
    next[role].axes = next[role].axes || {}; next[role].axes[axis] = numeric(value, 0);
    return commit(next, 'Change ' + role + ' ' + axis + ' axis');
  }
  function restore(role) {
    var next = snapshot();
    if (role) delete next[role]; else next = {};
    return commit(next, role ? 'Restore ' + role + ' type' : 'Restore type');
  }
  function reset() {
    var before = liveState();
    if (!Object.keys(before.durable).length && !Object.keys(before.transient).length) { removePageCss(); restoreNodeMarks(); return false; }
    I.history.perform({ label: 'Reset type', apply: function () { replaceLiveState({ durable: {}, transient: {} }, true); removePageCss(); restoreNodeMarks(); }, revert: function () { replaceLiveState(before, true); } });
    resetReapplyCeiling();
    return true;
  }
  function canKeep() {
    return Object.keys(mergedOverrides()).every(function (role) {
      var item = mergedOverrides()[role];
      return item && item.now && item.now.licence !== 'personal' && !isRetired({ id: item.now.id });
    }) && !Object.keys(transient).length;
  }

  function axisEntries(face) {
    var axes = face && face.axes, entries = [];
    if (Array.isArray(axes)) entries = axes.map(function (axis) { return axis && { tag: axis.tag || axis.name, min: axis.min, max: axis.max, value: axis.value == null ? axis.default : axis.value, label: axis.label || axis.name || axis.tag }; });
    else if (axes && typeof axes === 'object') entries = Object.keys(axes).map(function (tag) { var axis = axes[tag]; return Array.isArray(axis) ? { tag: tag, min: axis[0], max: axis[1], value: axis[2], label: tag } : typeof axis === 'object' ? { tag: axis.tag || tag, min: axis.min, max: axis.max, value: axis.value == null ? axis.default : axis.value, label: axis.label || tag } : null; });
    return entries.filter(function (axis) { return axis && /^[A-Za-z0-9]{4}$/.test(axis.tag || '') && isFinite(Number(axis.min)) && isFinite(Number(axis.max)); });
  }
  function axisDefaults(face) {
    return axisEntries(face).reduce(function (all, axis) { all[axis.tag] = numeric(axis.value, numeric(axis.min, 0)); return all; }, {});
  }
  function ensurePanelStyle() {
    if (panelStyle || !I.state.shell || !I.state.shell.shadow) return;
    panelStyle = dom.el('style', { 'data-review-island-type-style': '' });
    panelStyle.textContent = '.type-studio{display:grid;gap:10px}.type-studio button,.type-studio input,.type-studio select,.type-studio textarea{font:inherit}.type-studio label{display:grid;gap:3px;color:var(--muted)}.type-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap}.type-row>*{min-width:0}.type-role{display:flex;gap:3px;overflow:auto;padding-bottom:2px}.type-role button{border:1px solid var(--rule);border-radius:4px;background:var(--raised);color:var(--muted);padding:4px 6px}.type-role button[aria-pressed="true"]{color:var(--gold);border-color:color-mix(in oklab,var(--gold),transparent 58%)}.type-studio select,.type-studio input,.type-studio textarea{border:1px solid var(--rule);border-radius:4px;background:var(--raised);color:var(--ink);padding:5px}.type-studio textarea{width:100%;min-height:58px;resize:vertical}.type-primary{border:0;border-radius:5px;background:var(--gold);color:var(--lacquer);font-weight:700;padding:6px 9px}.type-secondary{border:1px solid var(--rule);border-radius:5px;background:transparent;color:var(--ink);padding:5px 8px}.type-verdict,.type-note{margin:0;color:var(--muted);font-size:11px}.type-face{border-left:3px solid var(--rule);padding:5px 7px;display:grid;gap:3px}.type-face[data-personal="true"],.type-pair[data-personal="true"]{border-color:oklch(62% .21 28)}.type-badge{width:max-content;border:1px solid var(--rule);border-radius:999px;padding:1px 5px;font-size:10px;color:var(--muted)}.type-badge[data-personal="true"]{color:oklch(75% .18 28);border-color:oklch(62% .21 28)}.type-specimens{display:grid;gap:8px}.type-specimen{border:1px solid var(--rule);border-radius:5px;padding:8px;overflow:hidden}.type-specimen-row{display:flex;gap:9px;align-items:flex-start}.type-specimen p{margin:5px 0 0;width:min(var(--type-width,360px),100%);color:var(--type-colour,var(--ink));font-family:var(--type-family,inherit);font-size:var(--type-size,16px);line-height:var(--type-line-height,1.5)}.type-glyphs{margin-top:5px;font-family:var(--type-family,inherit);font-size:18px;letter-spacing:.07em;color:var(--gold);white-space:nowrap}.type-controls{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}.type-controls input{width:100%;padding:0}.type-pairings{display:grid;gap:5px}.type-pair{border:1px solid var(--rule);border-radius:4px;padding:5px}.type-retired{text-decoration:line-through;opacity:.6}.type-studio details{border-top:1px solid var(--rule);padding-top:7px}.type-studio summary{cursor:pointer;color:var(--ink)}';
    I.state.shell.shadow.appendChild(panelStyle);
  }
  function selectedRole() { return (data().review.typeRole && ROLE_ORDER.indexOf(data().review.typeRole) >= 0) ? data().review.typeRole : 'body'; }
  function selectedFace(faces) {
    var selected = data().review.typeFace;
    return faces.filter(function (face) { return face.id === selected; })[0] || faces[0] || null;
  }
  function setSelected(role, face) {
    data().review.typeRole = role;
    if (face) data().review.typeFace = face.id;
    I.persist();
  }
  function readingVerdict(role) {
    var item = mergedOverrides()[role] || {};
    var base = baseFor(role);
    var size = numeric(item.size, base.size);
    var lineHeight = numeric(item.line_height, base.lineHeightRatio);
    var measure = numeric(item.measure, role === 'body' ? base.measure : 0);
    if (role !== 'body') return 'Page values: ' + Math.round(size) + 'px at ' + lineHeight.toFixed(2) + ' line height.';
    var issues = [];
    if (size < 16) issues.push('body is below 16px');
    if (lineHeight < 1.4) issues.push('line height is below 1.4');
    if (measure && (measure < 60 || measure > 80)) issues.push('measure is outside 60-80ch');
    return issues.length ? issues.join('; ') + '.' : 'Reading floor is met.';
  }
  function readingFloorFailed() {
    var item = mergedOverrides().body || {}, base = baseFor('body');
    var size = numeric(item.size, base.size), lineHeight = numeric(item.line_height, base.lineHeightRatio), measure = numeric(item.measure, base.measure);
    return size < 16 || lineHeight < 1.4 || !!measure && (measure < 60 || measure > 80);
  }
  function genericSpecimen() {
    return !data().review.typeSpecimen && !(doc.body && String(doc.body.innerText || '').replace(/\s+/g, ' ').trim());
  }
  function effectiveSpecimenText() {
    var text = data().review.typeSpecimen;
    if (text) return text;
    var source = (doc.body && doc.body.innerText || '').replace(/\s+/g, ' ').trim();
    return source.slice(0, 360) || 'Write the words you need to judge: your headline, paragraph, numbers, punctuation, and brand names.';
  }
  function previewSnapshot(next) {
    data().overrides.type = clone(next);
    applyCurrent({ silent: true });
    I.persist();
    resetReapplyCeiling();
  }
  function finishPreview(before, label) {
    var after = snapshot();
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    I.history.record({ label: label, apply: function () { replaceSnapshot(after, { clearTransient: true }); }, revert: function () { replaceSnapshot(before, { clearTransient: true }); } });
    resetReapplyCeiling();
    announceCommit(label);
  }
  function metricControl(root, role, property, label, min, max, step, value) {
    var wrap = dom.el('label', { text: label });
    var input = dom.el('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value), 'aria-label': label });
    var output = dom.el('span', { text: property === 'measure' ? value + 'ch' : property === 'size' ? value + 'px' : Number(value).toFixed(2) });
    var before = null;
    function nextValue() {
      var next = snapshot();
      if (!next[role]) next[role] = { was: baseFor(role), now: { family: baseFor(role).family, stack: baseFor(role).stack, source: 'page', licence: 'web' }, axes: {} };
      next[role][property] = numeric(input.value, value);
      return next;
    }
    input.addEventListener('focus', function () { before = snapshot(); });
    input.addEventListener('pointerdown', function () { before = snapshot(); });
    input.addEventListener('input', function () { if (!before) before = snapshot(); previewSnapshot(nextValue()); output.textContent = property === 'measure' ? input.value + 'ch' : property === 'size' ? input.value + 'px' : Number(input.value).toFixed(2); });
    input.addEventListener('change', function () { finishPreview(before || snapshot(), 'Change ' + role + ' ' + property.replace('_', ' ')); before = null; render(); });
    wrap.appendChild(input); wrap.appendChild(output); root.appendChild(wrap);
  }
  function axesControls(root, role, face, current) {
    var axes = axisEntries(face);
    if (!axes.length) return;
    var group = dom.el('div', 'type-controls');
    axes.forEach(function (axis) {
      var value = current.axes && current.axes[axis.tag] != null ? current.axes[axis.tag] : numeric(axis.value, axis.min);
      var wrap = dom.el('label', { text: axis.label + ' (' + axis.tag + ')' });
      var input = dom.el('input', { type: 'range', min: String(axis.min), max: String(axis.max), step: String(axis.step || 1), value: String(value), 'aria-label': axis.label + ' axis' });
      var output = dom.el('span', { text: String(value) });
      var before = null;
      function nextValue() {
        var next = snapshot();
        if (!next[role]) return next;
        next[role].axes = next[role].axes || {}; next[role].axes[axis.tag] = numeric(input.value, value); return next;
      }
      input.addEventListener('focus', function () { before = snapshot(); });
      input.addEventListener('pointerdown', function () { before = snapshot(); });
      input.addEventListener('input', function () { if (!before) before = snapshot(); previewSnapshot(nextValue()); output.textContent = input.value; });
      input.addEventListener('change', function () { finishPreview(before || snapshot(), 'Change ' + role + ' ' + axis.tag + ' axis'); before = null; render(); });
      wrap.appendChild(input); wrap.appendChild(output); group.appendChild(wrap);
    });
    root.appendChild(group);
  }
  function faceCard(face, role, text, selected) {
    var licence = faceLicence(face);
    var state = fontState(face);
    var card = dom.el('article', 'type-face');
    card.dataset.personal = String(licence.value === 'personal');
    card.dataset.font = state.state;
    card.appendChild(dom.el('strong', { text: face.family || face.id }));
    card.appendChild(dom.el('span', { 'class': 'type-badge', 'data-personal': String(licence.value === 'personal'), text: licence.label }));
    card.appendChild(dom.el('small', { text: licence.reason }));
    if (state.state === 'loading') card.appendChild(dom.el('small', { text: 'Checking this face before it can be judged.' }));
    if (state.state === 'failed') card.appendChild(dom.el('small', { text: 'Unavailable: ' + (state.result && state.result.reason || 'font did not load') }));
    if (state.state !== 'ready') {
      if (selected) card.setAttribute('aria-current', 'true');
      return card;
    }
    var sample = dom.el('div', { text: text.slice(0, 150) });
    sample.style.fontFamily = face.stack || face.family;
    sample.style.fontSize = Math.round(baseFor(role).size) + 'px';
    sample.style.lineHeight = String(baseFor(role).lineHeightRatio);
    card.appendChild(sample);
    if (selected) card.setAttribute('aria-current', 'true');
    return card;
  }
  function pairingReason(face, role) {
    var classification = String(face.classification || '').toLowerCase();
    if (classification === 'monospace') return 'A separate monospace voice keeps code and numerals distinct.';
    if (role === 'body' && classification === 'serif') return 'A serif body gives the interface face a clear role contrast.';
    if (role === 'display' && classification === 'sans') return 'A sans display keeps the contrast in scale and weight rather than decoration.';
    return 'This is a starting point with a different role, not a verdict.';
  }
  function renderPairings(root, role, face) {
    var details = dom.el('details'); details.appendChild(dom.el('summary', { text: 'Pairing starting points' }));
    var filter = dom.el('select', { 'aria-label': 'Filter pairing starting points' });
    [['all', 'Any contrast'], ['serif', 'Serif'], ['sans', 'Sans'], ['monospace', 'Mono']].forEach(function (pair) { var option = dom.el('option', { value: pair[0], text: pair[1] }); filter.appendChild(option); });
    var list = dom.el('div', 'type-pairings');
    function fill() {
      list.textContent = '';
      catalogue({ classification: filter.value === 'all' ? '' : filter.value }).filter(function (candidate) { return !face || candidate.id !== face.id; }).forEach(function (candidate) {
        var licence = faceLicence(candidate), state = fontState(candidate);
        var item = dom.el('div', 'type-pair'); item.dataset.personal = String(licence.value === 'personal'); item.dataset.font = state.state;
        item.appendChild(dom.el('strong', { text: candidate.family }));
        item.appendChild(dom.el('span', { 'class': 'type-badge', 'data-personal': String(licence.value === 'personal'), text: licence.label }));
        item.appendChild(dom.el('small', { text: licence.reason }));
        item.appendChild(dom.el('small', { text: pairingReason(candidate, role) }));
        if (state.state === 'loading') item.appendChild(dom.el('small', { text: 'Checking this face before it can be judged.' }));
        if (state.state === 'failed') item.appendChild(dom.el('small', { text: 'Unavailable: ' + (state.result && state.result.reason || 'font did not load') }));
        list.appendChild(item);
      });
      if (!list.children.length) list.appendChild(dom.el('p', 'type-note', 'No active faces match this filter.'));
    }
    filter.addEventListener('change', fill); details.appendChild(filter); details.appendChild(list); fill(); root.appendChild(details);
  }
  function render(root) {
    if (root) renderedRoot = root;
    root = renderedRoot; if (!root) return;
    ensurePanelStyle(); discoverRoles(false);
    root.textContent = '';
    var studio = dom.el('section', 'type-studio'); studio.setAttribute('aria-label', 'Type studio');
    var role = selectedRole();
    var faces = catalogue();
    faces.forEach(ensureFont);
    var face = selectedFace(faces);
    var current = mergedOverrides()[role] || { was: baseFor(role), now: baseFor(role), axes: {} };
    var roleRow = dom.el('div', 'type-role');
    ROLE_ORDER.forEach(function (name) {
      var button = dom.button(roleName(name), { 'aria-pressed': String(name === role), title: roleName(name) + ' role, Alt Shift Left or Right changes role' });
      button.setAttribute('data-type-role', name);
      button.addEventListener('click', function () { setSelected(name); render(); }); roleRow.appendChild(button);
    });
    studio.appendChild(roleRow);
    var picker = dom.el('div', 'type-row');
    var select = dom.el('select', { 'aria-label': 'Choose a face for ' + role, 'data-type-face-select': '', title: 'Choose a face, Alt Shift F focuses this control' });
    faces.forEach(function (entry) { var option = dom.el('option', { value: entry.id, text: entry.family + ' · ' + faceLicence(entry).label }); option.selected = face && entry.id === face.id; select.appendChild(option); });
    select.addEventListener('change', function () { setSelected(role, faces.filter(function (entry) { return entry.id === select.value; })[0]); render(); });
    picker.appendChild(select);
    if (face) {
      var licence = faceLicence(face);
      var applyButton = dom.button(licence.value === 'personal' ? 'Preview only' : 'Apply to ' + role, { 'class': 'type-primary', title: licence.value === 'personal' ? 'Preview this personal-use face without adding it to Go' : 'Apply this face to the page' });
      applyButton.addEventListener('click', function () { apply(role, face, { axes: axisDefaults(face) }).then(function (result) { if (result.ok) render(); }); });
      picker.appendChild(applyButton);
    }
    studio.appendChild(picker);
    if (!face) studio.appendChild(dom.el('p', 'type-note', 'No active faces are available. Add a project face or use the neutral catalogue.'));
    else studio.appendChild(faceCard(face, role, effectiveSpecimenText(), true));
    var floorVerdict = readingVerdict('body');
    studio.appendChild(dom.el('p', 'type-verdict', floorVerdict));
    if (I.advice && face && faceLicence(face).value === 'personal') I.advice.append(studio, 'type.licence', { personalUse: true });
    else if (I.advice && readingFloorFailed()) I.advice.append(studio, 'type.reading', { readingFloorFailed: true });
    var details = dom.el('details'); details.appendChild(dom.el('summary', { text: 'Specimen and adjustments' }));
    var text = dom.el('textarea', { 'aria-label': 'Your specimen text', 'data-type-specimen': '', title: 'Your specimen text, Alt Shift S focuses this field' }); text.value = effectiveSpecimenText();
    text.addEventListener('input', function () { data().review.typeSpecimen = text.value; I.persist(); });
    text.addEventListener('change', render); details.appendChild(text);
    if (I.advice && I.advice.append) I.advice.append(details, 'type.specimen', { genericSpecimen: genericSpecimen() });
    var controls = dom.el('div', 'type-controls');
    metricControl(controls, role, 'size', 'Size', 10, 96, 1, Math.round(numeric(current.size, baseFor(role).size)));
    metricControl(controls, role, 'line_height', 'Line height', 1, 2.4, 0.05, numeric(current.line_height, baseFor(role).lineHeightRatio));
    if (role === 'body') metricControl(controls, role, 'measure', 'Measure', 35, 100, 1, Math.max(35, Math.min(100, Math.round(numeric(current.measure, baseFor(role).measure)))));
    details.appendChild(controls);
    axesControls(details, role, face, current);
    var specimens = dom.el('div', 'type-specimens');
    faces.slice(0, 6).forEach(function (candidate) {
      var specimen = dom.el('article', 'type-specimen'); specimen.appendChild(dom.el('strong', { text: candidate.family }));
      var state = fontState(candidate);
      if (state.state !== 'ready') {
        specimen.dataset.font = state.state;
        specimen.appendChild(dom.el('small', { text: state.state === 'failed' ? 'Unavailable: ' + (state.result && state.result.reason || 'font did not load') : 'Checking this face before it can be judged.' }));
        specimens.appendChild(specimen);
        return;
      }
      var paragraph = dom.el('p', { text: effectiveSpecimenText() });
      paragraph.style.setProperty('--type-family', candidate.stack || candidate.family);
      paragraph.style.setProperty('--type-size', Math.round(numeric(current.size, baseFor(role).size)) + 'px');
      paragraph.style.setProperty('--type-line-height', String(numeric(current.line_height, baseFor(role).lineHeightRatio)));
      paragraph.style.setProperty('--type-width', Math.round(Math.max(280, Math.min(680, (readingElement(roleNodes.body).getBoundingClientRect().width) || 560))) + 'px');
      paragraph.style.setProperty('--type-colour', baseFor(role).colour);
      var row = dom.el('div', 'type-specimen-row'); row.appendChild(paragraph);
      var glyphs = dom.el('div', 'type-glyphs', 'a g e R Q 1 l I 0 O'); glyphs.style.setProperty('--type-family', candidate.stack || candidate.family); row.appendChild(glyphs); specimen.appendChild(row);
      specimens.appendChild(specimen);
    });
    details.appendChild(specimens); studio.appendChild(details);
    renderPairings(studio, role, face);
    var library = dom.el('details'); library.appendChild(dom.el('summary', { text: 'Catalogue and previously ruled out' }));
    var search = dom.el('input', { type: 'search', placeholder: 'Search active faces', 'aria-label': 'Search active faces' });
    var classification = dom.el('select', { 'aria-label': 'Filter by classification' });
    var variable = dom.el('select', { 'aria-label': 'Filter by variable support' });
    var licenceFilter = dom.el('select', { 'aria-label': 'Filter by licence' });
    [['', 'Any classification'], ['sans', 'Sans'], ['serif', 'Serif'], ['monospace', 'Monospace']].forEach(function (pair) { classification.appendChild(dom.el('option', { value: pair[0], text: pair[1] })); });
    [['', 'Variable or static'], ['yes', 'Variable only']].forEach(function (pair) { variable.appendChild(dom.el('option', { value: pair[0], text: pair[1] })); });
    [['', 'Any licence'], ['web', 'Free for web'], ['paid', 'Paid'], ['personal', 'Personal use only']].forEach(function (pair) { licenceFilter.appendChild(dom.el('option', { value: pair[0], text: pair[1] })); });
    var result = dom.el('div');
    function fillCatalogue() { result.textContent = ''; catalogue({ query: search.value, classification: classification.value, variable: variable.value === 'yes', licence: licenceFilter.value }).forEach(function (entry) { result.appendChild(faceCard(entry, role, effectiveSpecimenText(), face && entry.id === face.id)); }); if (!result.children.length) result.appendChild(dom.el('p', 'type-note', 'No active faces match. Retired faces are not offered.')); }
    search.addEventListener('input', fillCatalogue); classification.addEventListener('change', fillCatalogue); variable.addEventListener('change', fillCatalogue); licenceFilter.addEventListener('change', fillCatalogue);
    library.appendChild(search); library.appendChild(classification); library.appendChild(variable); library.appendChild(licenceFilter); library.appendChild(result); fillCatalogue();
    var retired = I.library && I.library.retiredEntries ? I.library.retiredEntries('faces') : [];
    if (retired.length) { var drawer = dom.el('div'); drawer.appendChild(dom.el('small', { text: 'Previously ruled out' })); retired.forEach(function (entry) { var item = faceCard(entry, role, '', false); item.classList.add('type-retired'); item.appendChild(dom.el('small', { text: entry.retiredReason || 'Retired from this project.' })); drawer.appendChild(item); }); library.appendChild(drawer); }
    studio.appendChild(library);
    var restoreButton = dom.button('Reset type overrides', { 'class': 'type-secondary', title: 'Remove all live type overrides, Alt Shift R' }); restoreButton.setAttribute('data-type-reset', ''); restoreButton.addEventListener('click', function () { reset(); render(); }); studio.appendChild(restoreButton);
    root.appendChild(studio);
  }
  function refreshNodesAndReapply() {
    observerTimer = 0;
    if (!Object.keys(mergedOverrides()).length || reapplyCount >= 8) return;
    ROLE_ORDER.forEach(function (role) { roleNodes[role] = nodesFor(role); });
    applyCurrent({ silent: true }); reapplyCount += 1;
    if (reapplyCount === 8) I.events.emit('status:set', 'Type overrides stopped reapplying after repeated page changes.');
  }
  function ensureObserver() {
    if (observer || !global.MutationObserver || !doc.documentElement) return;
    observer = new global.MutationObserver(function () {
      if (observerTimer || !Object.keys(mergedOverrides()).length) return;
      observerTimer = global.setTimeout(refreshNodesAndReapply, 80);
    });
    observer.observe(doc.documentElement, { childList: true, subtree: true });
  }
  function startPersistentOverrides() {
    discoverRoles(false);
    if (Object.keys(data().overrides.type).length) applyCurrent({ silent: true });
    ensureObserver();
  }
  function typeKeydown(event) {
    if (I.state.activeMode !== 'type' || dom.isEditingEvent(event) || !event.altKey || !event.shiftKey || event.metaKey || event.ctrlKey) return;
    var key = String(event.key || '').toLowerCase();
    var role = selectedRole(), index = ROLE_ORDER.indexOf(role), next;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault(); next = ROLE_ORDER[(index + (event.key === 'ArrowRight' ? 1 : -1) + ROLE_ORDER.length) % ROLE_ORDER.length]; setSelected(next); render(); I.events.emit('status:set', roleName(next) + ' role selected.'); return;
    }
    if (key === 'r') { event.preventDefault(); reset(); render(); I.events.emit('status:set', 'Type overrides reset.'); return; }
    if (key === 's' && renderedRoot) { event.preventDefault(); var specimen = renderedRoot.querySelector('[data-type-specimen]'); if (specimen) specimen.focus(); return; }
    if (key === 'f' && renderedRoot) { event.preventDefault(); var face = renderedRoot.querySelector('[data-type-face-select]'); if (face) face.focus(); }
  }
  function activate() {
    ensurePanelStyle(); startPersistentOverrides();
    if (!typeKeysBound) { doc.addEventListener('keydown', typeKeydown, true); typeKeysBound = true; }
    I.library.load().then(function () { if (renderedRoot) render(); });
  }
  function deactivate() { if (typeKeysBound) { doc.removeEventListener('keydown', typeKeydown, true); typeKeysBound = false; } /* Live overrides deliberately remain while the island is open in another mode. */ }
  function disable() {
    transient = {}; removePageCss(); restoreNodeMarks();
    if (observer) observer.disconnect(); observer = null;
    if (observerTimer) global.clearTimeout(observerTimer); observerTimer = 0; reapplyCount = 0;
    if (typeKeysBound) { doc.removeEventListener('keydown', typeKeydown, true); typeKeysBound = false; }
  }

  I.type = {
    roles: function () { return discoverRoles(false); },
    roleSnapshot: function (role) { discoverRoles(false); return role ? clone(roleBase[role] || null) : discoverRoles(false); },
    catalogue: catalogue,
    loadFont: loadFont,
    canKeep: canKeep,
    apply: apply,
    applySnapshot: function (next) { return commit(next || {}, 'Apply type snapshot'); },
    restore: restore,
    reset: reset,
    setMetric: setMetric,
    setAxis: setAxis,
    estimateMeasure: estimateMeasure
  };
  I.registerMode({ id: 'type', label: 'Type', render: render, activate: activate, deactivate: deactivate });
  I.events.on('session:disable', disable);
  I.events.on('shell:mounted', startPersistentOverrides);
  I.events.on('shell:destroy', function () { renderedRoot = null; panelStyle = null; });
  I.events.on('library:change', function () { if (renderedRoot) render(); });
})();
