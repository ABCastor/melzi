/* Shared, closure-local primitives for the Review Island build. */
var Island = (function () {
  'use strict';

  var global = typeof window !== 'undefined' ? window : globalThis;
  var doc = global.document;
  var script = doc && (doc.currentScript || doc.querySelector('script[data-sizes][src*="review-layer"]'));
  var data = script && script.dataset ? script.dataset : {};
  var page = global.location && global.location.pathname ? global.location.pathname : '/';
  var key = 'review.island:' + page;
  var loadedLibrary = null;
  var listeners = Object.create(null);
  var modes = Object.create(null);
  var undoStack = [];
  var redoStack = [];
  var scopedStyles = Object.create(null);
  var degradationSeen = Object.create(null);

  function projectFromContext() {
    var explicit = String(global.REVIEW_PROJECT || '').trim();
    if (explicit) return explicit;
    var source = loadedLibrary || global.REVIEW_LIBRARY;
    var declared = String(source && source.project || '').trim();
    if (declared) return declared;
    var origin = String(global.location && global.location.origin || '').trim();
    if (origin && origin !== 'null') return origin;
    return global.location && global.location.protocol === 'file:' ? 'file://' : 'local';
  }

  function safeGet(name) { try { return global.localStorage.getItem(name); } catch (_) { return null; } }
  function safeSet(name, value) { try { global.localStorage.setItem(name, value); return true; } catch (_) { return false; } }
  function safeDelete(name) { try { global.localStorage.removeItem(name); return true; } catch (_) { return false; } }
  function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
  function numberList(value) {
    return String(value || '').split(',').map(function (part) { return Number(part.trim()); })
      .filter(function (value, index, all) { return Number.isFinite(value) && value > 0 && all.indexOf(value) === index; });
  }
  function makeId(prefix) {
    var random = global.crypto && global.crypto.randomUUID ? global.crypto.randomUUID().replace(/-/g, '').slice(0, 10) : Math.random().toString(36).slice(2, 12);
    return (prefix || 'r') + Date.now().toString(36) + random;
  }
  function reviewerKey() { return 'review.reviewer:' + page; }
  function reviewer(value) {
    if (value != null && String(value).trim()) safeSet(reviewerKey(), String(value).trim());
    return String(global.REVIEW_REVIEWER || safeGet(reviewerKey()) || safeGet('review.reviewer') || safeGet('REVIEW_REVIEWER') || 'local').trim() || 'local';
  }
  function defaults() {
    return {
      version: 2,
      pins: [],
      pageComment: '',
      overrides: { colors: {}, type: {} },
      candidates: [],
      verdicts: [],
      chosenCandidate: null,
      unresolved: [],
      review: { mode: 'comment', dock: 'right', width: 420, position: null, size: 0, open: false },
      lookedAt: { sizes: [], themes: [] }
    };
  }
  function migrate(value) {
    var next = defaults();
    if (!value || typeof value !== 'object') return next;
    if (Array.isArray(value)) { next.pins = value; return next; }
    Object.keys(next).forEach(function (name) {
      if (value[name] !== undefined) next[name] = value[name];
    });
    next.review = Object.assign(defaults().review, value.review || {});
    next.overrides = Object.assign(defaults().overrides, value.overrides || {});
    next.lookedAt = Object.assign(defaults().lookedAt, value.lookedAt || {});
    next.pins = Array.isArray(value.pins) ? value.pins : [];
    next.candidates = Array.isArray(value.candidates) ? value.candidates : [];
    next.verdicts = Array.isArray(value.verdicts) ? value.verdicts : [];
    next.unresolved = Array.isArray(value.unresolved) ? value.unresolved : [];
    next.pins = next.pins.filter(function (pin) { return pin && (pin.saved !== false || pin.note || pin.image); });
    next.pins.forEach(function (pin) { if (!pin.reviewer) pin.reviewer = reviewer(); if (pin.saved == null || pin.note || pin.image) pin.saved = true; });
    next.verdicts.forEach(function (verdict) { if (verdict && !verdict.reviewer) verdict.reviewer = reviewer(); });
    next.version = 2;
    return next;
  }
  function legacy() {
    var pins = [];
    var raw = safeGet('review.pins:' + page);
    try { pins = Array.isArray(JSON.parse(raw || '[]')) ? JSON.parse(raw || '[]') : []; } catch (_) {}
    var size = Number(safeGet('review.size:' + page)) || 0;
    var position = null;
    try { position = JSON.parse(safeGet('review.position') || 'null'); } catch (_) {}
    return migrate({ pins: pins, review: { size: size, position: position } });
  }
  var storage = {
    key: key,
    load: function (fallback) {
      var raw = safeGet(key);
      if (!raw) return fallback ? Object.assign(migrate(legacy()), fallback) : legacy();
      try { return migrate(JSON.parse(raw)); } catch (_) { return fallback ? Object.assign(defaults(), fallback) : defaults(); }
    },
    save: function (value) {
      var next = migrate(value || state.data || defaults());
      storage.available = safeSet(key, JSON.stringify(next));
      return next;
    },
    clear: function () { return safeDelete(key); },
    get: safeGet,
    set: safeSet,
    remove: safeDelete,
    available: true
  };
  var state = {
    page: page,
    project: projectFromContext(),
    data: storage.load(),
    sizes: numberList(data.sizes),
    endpoint: data.endpoint || global.REVIEW_ENDPOINT || '',
    mounted: false,
    enabled: false,
    activeMode: 'comment',
    adapter: null,
    shell: null
  };
  state.activeMode = state.data.review.mode || state.activeMode;

  var events = {
    on: function (name, callback) {
      if (typeof callback !== 'function') return function () {};
      (listeners[name] || (listeners[name] = [])).push(callback);
      return function () { events.off(name, callback); };
    },
    off: function (name, callback) {
      if (!listeners[name]) return;
      listeners[name] = listeners[name].filter(function (fn) { return fn !== callback; });
    },
    emit: function (name, detail) {
      (listeners[name] || []).slice().forEach(function (callback) {
        try { callback(detail); } catch (error) { global.setTimeout(function () { throw error; }, 0); }
      });
    }
  };
  function historyChange(action, change) {
    events.emit('history:change', { action: action, change: change || null, undo: undoStack.length, redo: redoStack.length });
  }
  var history = {
    limit: 100,
    perform: function (change) {
      if (!change || typeof change.apply !== 'function' || typeof change.revert !== 'function') throw new TypeError('An undoable change needs apply() and revert().');
      change.apply(); undoStack.push(change); if (undoStack.length > history.limit) undoStack.shift(); redoStack = []; historyChange('perform', change); return change;
    },
    record: function (change) {
      if (!change || typeof change.apply !== 'function' || typeof change.revert !== 'function') throw new TypeError('An undoable change needs apply() and revert().');
      undoStack.push(change); if (undoStack.length > history.limit) undoStack.shift(); redoStack = []; historyChange('record', change); return change;
    },
    undo: function () {
      var change = undoStack[undoStack.length - 1]; if (!change) return false;
      if (change.revert() === false) { historyChange('undo-failed', change); return false; }
      undoStack.pop(); redoStack.push(change); historyChange('undo', change); return true;
    },
    redo: function () {
      var change = redoStack[redoStack.length - 1]; if (!change) return false;
      if (change.apply() === false) { historyChange('redo-failed', change); return false; }
      redoStack.pop(); undoStack.push(change); historyChange('redo', change); return true;
    },
    clear: function () { undoStack = []; redoStack = []; historyChange('clear'); },
    state: function () { return { undo: undoStack.length, redo: redoStack.length }; }
  };
  function persist() {
    state.data.review.mode = state.activeMode;
    state.data = storage.save(state.data);
    state.storageAvailable = storage.available;
    if (!storage.available) degrade('storage');
    events.emit('state:change', clone(state.data));
    return state.data;
  }
  function unresolved(reason, announce) {
    var message = String(reason || '').trim();
    if (!message) return false;
    var list = state.data.unresolved || (state.data.unresolved = []);
    var added = list.indexOf(message) < 0;
    if (added) { list.push(message); persist(); }
    if (announce !== false) events.emit('status:set', message);
    return added;
  }
  var degradationMessages = {
    storage: 'This browser could not save locally. Export before closing.',
    memoryLocal: 'Candidate memory is local to this browser. Configure the review server to keep it on disk.',
    memoryServer: 'Durable candidate memory is unavailable. This browser cache is still active.',
    eyedropper: 'The eyedropper is unavailable here. Enter a colour value instead.',
    scopedStyle: 'Constructable stylesheets are unavailable. Page overrides use a removable scoped style.',
    font: 'This font could not load. You are seeing its fallback stack.',
    server: 'The review server could not save this record. It remains in this browser.'
  };
  function degrade(kind, detail) {
    var message = degradationMessages[kind] || String(detail || kind || 'A review capability is unavailable.');
    if (detail && degradationMessages[kind]) message += ' ' + String(detail);
    if (kind === 'font') unresolved(message, false);
    var notice = String(kind || 'other') + ':' + message;
    if (!degradationSeen[notice]) { degradationSeen[notice] = true; events.emit('status:set', message); }
    return message;
  }
  function scopedStyle(name, css) {
    var id = String(name || 'override'), entry = scopedStyles[id];
    if (entry && entry.css === String(css || '')) return entry;
    if (entry && entry.remove) entry.remove();
    entry = { css: String(css || ''), sheet: null, node: null, remove: function () {} };
    try {
      if (global.CSSStyleSheet && doc && 'adoptedStyleSheets' in doc) {
        var sheet = new global.CSSStyleSheet();
        sheet.replaceSync(entry.css);
        var sheets = Array.prototype.slice.call(doc.adoptedStyleSheets || []);
        sheets.push(sheet); doc.adoptedStyleSheets = sheets;
        entry.sheet = sheet;
        entry.remove = function () {
          try { doc.adoptedStyleSheets = Array.prototype.filter.call(doc.adoptedStyleSheets || [], function (item) { return item !== sheet; }); } catch (_) {}
        };
      } else {
        degrade('scopedStyle');
        var node = doc.createElement('style');
        node.setAttribute('data-review-island-style', id); node.textContent = entry.css;
        (doc.head || doc.documentElement).appendChild(node); entry.node = node;
        entry.remove = function () { if (node.remove) node.remove(); else if (node.parentNode) node.parentNode.removeChild(node); };
      }
    } catch (_) {
      degrade('scopedStyle');
      var fallback = doc.createElement('style');
      fallback.setAttribute('data-review-island-style', id); fallback.textContent = entry.css;
      (doc.head || doc.documentElement).appendChild(fallback); entry.node = fallback;
      entry.remove = function () { if (fallback.remove) fallback.remove(); else if (fallback.parentNode) fallback.parentNode.removeChild(fallback); };
    }
    scopedStyles[id] = entry;
    return entry;
  }
  function removeScopedStyle(name) {
    var id = String(name || '');
    if (!id) { Object.keys(scopedStyles).forEach(removeScopedStyle); return; }
    if (scopedStyles[id] && scopedStyles[id].remove) scopedStyles[id].remove();
    delete scopedStyles[id];
  }
  function setAdapter(adapter) {
    state.adapter = adapter && typeof adapter === 'object' ? adapter : null;
    events.emit('adapter:change', state.adapter);
    return state.adapter;
  }

  function el(tag, attributes, content) {
    var node = doc.createElement(tag);
    if (typeof attributes === 'string') node.className = attributes;
    else if (attributes) Object.keys(attributes).forEach(function (name) {
      var value = attributes[name];
      if (value == null) return;
      if (name === 'style' && typeof value === 'object') Object.assign(node.style, value);
      else if (name === 'text') node.textContent = value;
      else if (name.indexOf('on') === 0 && typeof value === 'function') node.addEventListener(name.slice(2), value);
      else node.setAttribute(name, value === true ? '' : String(value));
    });
    if (content != null) node.textContent = content;
    return node;
  }
  function button(label, attributes) {
    var node = el('button', attributes, label);
    node.type = 'button';
    return node;
  }
  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>'"]/g, function (character) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character];
    });
  }
  function pathInside(node, boundary) {
    if (!node || node.nodeType !== 1) return '';
    var parts = [];
    while (node && node.nodeType === 1 && node !== boundary && node !== doc.documentElement) {
      var part = node.nodeName.toLowerCase();
      if (node.id) {
        var escaped = global.CSS && global.CSS.escape ? global.CSS.escape(node.id) : String(node.id).replace(/([^a-zA-Z0-9_-])/g, '\\$1');
        parts.unshift(part + '#' + escaped); break;
      }
      var sibling = node, index = 1;
      while ((sibling = sibling.previousElementSibling)) if (sibling.nodeName === node.nodeName) index += 1;
      parts.unshift(part + ':nth-of-type(' + index + ')');
      node = node.parentElement;
    }
    return (boundary ? '' : 'html' + (parts.length ? ' > ' : '')) + parts.join(' > ');
  }
  function cssPath(node) {
    if (!node || node.nodeType !== 1) return '';
    var root = node.getRootNode && node.getRootNode();
    if (root && root.host) return { host: cssPath(root.host), inner: pathInside(node, root) };
    return pathInside(node, null);
  }
  function words(node) { return String(node && node.textContent || '').replace(/\s+/g, ' ').trim().split(' ').slice(0, 12).join(' '); }
  function queryPath(path) {
    if (!path) return null;
    if (typeof path === 'string') return doc.querySelector(path);
    if (!path.host || !path.inner) return null;
    var host = queryPath(path.host);
    return host && host.shadowRoot ? host.shadowRoot.querySelector(path.inner) : null;
  }
  function searchableRoots() {
    var roots = [doc];
    for (var index = 0; index < roots.length; index++) {
      Array.prototype.forEach.call(roots[index].querySelectorAll('*'), function (node) { if (node.shadowRoot) roots.push(node.shadowRoot); });
    }
    return roots;
  }
  function resolve(pin) {
    var hit = null;
    try { hit = pin && pin.path ? queryPath(pin.path) : null; } catch (_) {}
    if (hit && ours(hit)) hit = null;
    if (!pin || !pin.text) return hit;
    if (hit && words(hit).slice(0, 24) === String(pin.text).slice(0, 24)) return hit;
    var selector = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,td,th,a,button,img,span,div,section,aside';
    var roots = searchableRoots();
    for (var r = 0; r < roots.length; r++) {
      var all = roots[r].querySelectorAll(selector);
      for (var i = 0; i < all.length; i++) if (!ours(all[i]) && words(all[i]) === pin.text) return all[i];
    }
    return hit && words(hit).slice(0, 10) === String(pin.text).slice(0, 10) ? hit : null;
  }
  function ours(node) {
    if (!node) return false;
    var root = node.getRootNode && node.getRootNode();
    return !!((node.closest && node.closest('[data-review-island-host]')) || (state.shell && (root === state.shell.shadow || state.shell.host.contains(node))));
  }
  function isEditingEvent(event) {
    var path = event && event.composedPath ? event.composedPath() : [event && event.target];
    return path.some(function (node) {
      if (!node) return false;
      var tag = String(node.tagName || '').toLowerCase();
      if (tag === 'textarea' || tag === 'select' || node.isContentEditable) return true;
      if (tag !== 'input') return false;
      return !/^(button|checkbox|color|file|hidden|image|radio|range|reset|submit)$/i.test(node.type || 'text');
    });
  }
  function theme() {
    try {
      var named = doc.documentElement.getAttribute('data-theme') || doc.documentElement.getAttribute('data-color-scheme');
      if (named) return named;
      var root = global.getComputedStyle(doc.documentElement);
      var painted = doc.body && parseColor(global.getComputedStyle(doc.body).backgroundColor);
      if (!painted || painted.a === 0) painted = parseColor(root.backgroundColor);
      if (painted && painted.a > 0) return luminance(composite(painted, parseColor('#ffffff'))) < 0.35 ? 'dark' : 'light';
      var scheme = String(root.colorScheme || '').toLowerCase();
      if (scheme.indexOf('dark') >= 0 && scheme.indexOf('light') < 0) return 'dark';
      if (scheme.indexOf('light') >= 0 && scheme.indexOf('dark') < 0) return 'light';
      return global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch (_) { return 'light'; }
  }
  function endpoint() { return state.endpoint || global.REVIEW_ENDPOINT || ''; }
  function servable() {
    if (!endpoint() || !global.location || !global.URL) return false;
    try { return /^https?:$/.test(new global.URL(endpoint(), global.location.href).protocol); } catch (_) { return false; }
  }
  function fraction(value, length) { return length ? Math.round(Math.min(1, Math.max(0, value / length)) * 1000) / 1000 : 0; }

  function clamp(value, min, max) { return Math.min(max == null ? 1 : max, Math.max(min == null ? 0 : min, Number(value) || 0)); }
  function channel(value) { return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4); }
  function srgb(value) { return value <= 0.0031308 ? value * 12.92 : 1.055 * Math.pow(value, 1 / 2.4) - 0.055; }
  function rgbObject(value) {
    if (Array.isArray(value)) return { r: value[0], g: value[1], b: value[2], a: value.length > 3 ? value[3] : 1 };
    return value || { r: 0, g: 0, b: 0, a: 1 };
  }
  function parseHex(value) {
    var hex = String(value || '').trim().replace(/^#/, '');
    if (!/^[0-9a-f]{3,4}$|^[0-9a-f]{6}$|^[0-9a-f]{8}$/i.test(hex)) return null;
    if (hex.length < 5) hex = hex.split('').map(function (part) { return part + part; }).join('');
    return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16), a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1 };
  }
  function parseColor(value) {
    if (typeof value === 'object' && value && value.r != null) return rgbObject(value);
    var hex = parseHex(value);
    if (hex) return hex;
    var source = String(value || '').trim(), match;
    function alpha(number, percent) { return clamp(Number(number) * (percent ? 0.01 : 1)); }
    function angle(number, unit) {
      var result = Number(number) || 0;
      if (unit === 'turn') result *= 360;
      else if (unit === 'rad') result *= 180 / Math.PI;
      else if (unit === 'grad') result *= 0.9;
      return result;
    }
    match = source.match(/^oklch\(\s*([+-]?[\d.]+)(%)?\s+([+-]?[\d.]+)(%)?\s+([+-]?[\d.]+)(deg|grad|rad|turn)?(?:\s*\/\s*([\d.]+)(%)?)?\s*\)$/i);
    if (match) return oklchToSrgb({ l: Number(match[1]) * (match[2] ? 0.01 : 1), c: Number(match[3]) * (match[4] ? 0.004 : 1), h: angle(match[5], (match[6] || '').toLowerCase()), alpha: match[7] == null ? 1 : alpha(match[7], match[8]) });
    match = source.match(/^oklab\(\s*([+-]?[\d.]+)(%)?\s+([+-]?[\d.]+)(%)?\s+([+-]?[\d.]+)(%)?(?:\s*\/\s*([\d.]+)(%)?)?\s*\)$/i);
    if (match) return oklabToSrgb({ l: Number(match[1]) * (match[2] ? 0.01 : 1), a: Number(match[3]) * (match[4] ? 0.004 : 1), b: Number(match[5]) * (match[6] ? 0.004 : 1), alpha: match[7] == null ? 1 : alpha(match[7], match[8]) });
    if (doc) try {
      var canvas = doc.createElement('canvas'), context = canvas.getContext && canvas.getContext('2d', { willReadFrequently: true });
      if (context) {
        canvas.width = canvas.height = 1; context.fillStyle = '#010203'; context.fillStyle = source;
        var supported = global.CSS && global.CSS.supports ? global.CSS.supports('color', source) : context.fillStyle !== '#010203' || /^#0?10203$/i.test(source);
        if (supported) {
          context.clearRect(0, 0, 1, 1); context.fillRect(0, 0, 1, 1);
          var pixel = context.getImageData(0, 0, 1, 1).data;
          return { r: pixel[0], g: pixel[1], b: pixel[2], a: pixel[3] / 255 };
        }
      }
    } catch (_) {}
    if (!doc || !doc.body) return null;
    var probe = doc.createElement('i');
    probe.style.cssText = 'position:fixed;left:-9999px;';
    probe.style.color = source;
    if (!probe.style.color) return null;
    var probeRoot = state.shell && state.shell.shadow || doc.body;
    probeRoot.appendChild(probe);
    var match = (global.getComputedStyle(probe).color || '').match(/[\d.]+/g);
    probe.remove();
    if (!match || match.length < 3) return null;
    return { r: Number(match[0]), g: Number(match[1]), b: Number(match[2]), a: match.length > 3 ? Number(match[3]) : 1 };
  }
  function rgbToHex(value, includeAlpha) {
    var rgb = rgbObject(value);
    var output = [rgb.r, rgb.g, rgb.b].map(function (part) { return Math.round(clamp(part, 0, 255)).toString(16).padStart(2, '0'); }).join('');
    if (includeAlpha || rgb.a < 1) output += Math.round(clamp(rgb.a, 0, 1) * 255).toString(16).padStart(2, '0');
    return '#' + output;
  }
  function srgbToOklab(value) {
    var rgb = rgbObject(value), r = channel(clamp(rgb.r / 255)), g = channel(clamp(rgb.g / 255)), b = channel(clamp(rgb.b / 255));
    var l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    var m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    var s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return { l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s, alpha: rgb.a };
  }
  function oklabToSrgb(value, clampOutput) {
    var lab = value || {}, l = Math.pow((lab.l || 0) + 0.3963377774 * (lab.a || 0) + 0.2158037573 * (lab.b || 0), 3);
    var m = Math.pow((lab.l || 0) - 0.1055613458 * (lab.a || 0) - 0.0638541728 * (lab.b || 0), 3);
    var s = Math.pow((lab.l || 0) - 0.0894841775 * (lab.a || 0) - 1.291485548 * (lab.b || 0), 3);
    var rgb = { r: 255 * srgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), g: 255 * srgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s), b: 255 * srgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s), a: lab.alpha == null ? 1 : lab.alpha };
    return clampOutput === false ? rgb : clampSrgb(rgb);
  }
  function oklabToOklch(value) {
    var lab = value || {}, chroma = Math.hypot(lab.a || 0, lab.b || 0);
    return { l: lab.l || 0, c: chroma, h: chroma < 0.000001 ? 0 : (Math.atan2(lab.b || 0, lab.a || 0) * 180 / Math.PI + 360) % 360, alpha: lab.alpha == null ? 1 : lab.alpha };
  }
  function oklchToOklab(value) {
    var lch = value || {}, hue = (Number(lch.h) || 0) * Math.PI / 180;
    return { l: Number(lch.l) || 0, a: (Number(lch.c) || 0) * Math.cos(hue), b: (Number(lch.c) || 0) * Math.sin(hue), alpha: lch.alpha == null ? 1 : lch.alpha };
  }
  function clampSrgb(value) {
    var rgb = rgbObject(value);
    return { r: clamp(rgb.r, 0, 255), g: clamp(rgb.g, 0, 255), b: clamp(rgb.b, 0, 255), a: clamp(rgb.a == null ? 1 : rgb.a, 0, 1) };
  }
  function oklchToSrgb(value, clampOutput) { return oklabToSrgb(oklchToOklab(value), clampOutput); }
  function srgbToOklch(value) { return oklabToOklch(srgbToOklab(value)); }
  function inSrgbGamut(value, epsilon) {
    var rgb = oklchToSrgb(value, false), edge = epsilon == null ? 0.0001 : Math.abs(epsilon);
    return rgb.r >= -edge && rgb.r <= 255 + edge && rgb.g >= -edge && rgb.g <= 255 + edge && rgb.b >= -edge && rgb.b <= 255 + edge;
  }
  function maxSrgbChroma(lightness, hue) {
    var low = 0, high = 0.5;
    while (inSrgbGamut({ l: lightness, c: high, h: hue }) && high < 2) high *= 2;
    for (var i = 0; i < 24; i++) {
      var middle = (low + high) / 2;
      if (inSrgbGamut({ l: lightness, c: middle, h: hue })) low = middle;
      else high = middle;
    }
    return low;
  }
  function clampOklch(value) {
    var lch = value || {}, lightness = clamp(lch.l), hue = ((Number(lch.h) || 0) % 360 + 360) % 360;
    return { l: lightness, c: Math.min(Math.max(0, Number(lch.c) || 0), maxSrgbChroma(lightness, hue)), h: hue, alpha: clamp(lch.alpha == null ? 1 : lch.alpha) };
  }
  /*
   * mapToSrgb() is adapted from Culori's toGamut() and differenceEuclidean()
   * for this dependency-free, OKLCH-to-sRGB-only build.
   * Source: https://github.com/Evercoder/culori/blob/main/src/clamp.js
   *
   * MIT License
   * Copyright (c) 2018 Dan Burzo
   * Permission is hereby granted, free of charge, to any person obtaining a copy
   * of this software and associated documentation files (the "Software"), to deal
   * in the Software without restriction, including without limitation the rights
   * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
   * copies of the Software, and to permit persons to whom the Software is
   * furnished to do so, subject to the following conditions:
   * The above copyright notice and this permission notice shall be included in all
   * copies or substantial portions of the Software.
   * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
   * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
   * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
   * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
   * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
   * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
   * SOFTWARE.
   */
  function oklchDifference(standard, sample) {
    var h1 = ((Number(standard.h) || 0) % 360 + 360) % 360, h2 = ((Number(sample.h) || 0) % 360 + 360) % 360;
    var deltaHue = !standard.c || !sample.c ? 0 : 2 * Math.sqrt(standard.c * sample.c) * Math.sin(((h2 - h1 + 360) / 2) * Math.PI / 180);
    return Math.sqrt(Math.pow(standard.l - sample.l, 2) + Math.pow(standard.c - sample.c, 2) + Math.pow(deltaHue, 2));
  }
  function mapToSrgb(value, justNoticeableDifference) {
    var source = value || {}, candidate = {
      l: Number(source.l) || 0, c: Math.max(0, Number(source.c) || 0),
      h: ((Number(source.h) || 0) % 360 + 360) % 360, alpha: source.alpha == null ? 1 : clamp(source.alpha)
    };
    var jnd = justNoticeableDifference == null ? 0.02 : Math.max(0, Number(justNoticeableDifference) || 0);
    if (candidate.l >= 1) return { r: 255, g: 255, b: 255, a: candidate.alpha };
    if (candidate.l <= 0) return { r: 0, g: 0, b: 0, a: candidate.alpha };
    if (inSrgbGamut(candidate)) return oklchToSrgb(candidate, false);
    var start = 0, end = candidate.c, clipped = clampSrgb(oklchToSrgb(candidate, false));
    while (end - start > 0.0001) {
      candidate.c = (start + end) * 0.5;
      clipped = clampSrgb(oklchToSrgb(candidate, false));
      if (inSrgbGamut(candidate) || jnd > 0 && oklchDifference(candidate, srgbToOklch(clipped)) <= jnd) start = candidate.c;
      else end = candidate.c;
    }
    return inSrgbGamut(candidate) ? oklchToSrgb(candidate, false) : clipped;
  }
  function composite(foreground, background) {
    var fg = rgbObject(foreground), bg = rgbObject(background), alpha = clamp(fg.a == null ? 1 : fg.a);
    return { r: fg.r * alpha + bg.r * (1 - alpha), g: fg.g * alpha + bg.g * (1 - alpha), b: fg.b * alpha + bg.b * (1 - alpha), a: 1 };
  }
  function luminance(value) {
    var rgb = rgbObject(value);
    return 0.2126 * channel(clamp(rgb.r / 255)) + 0.7152 * channel(clamp(rgb.g / 255)) + 0.0722 * channel(clamp(rgb.b / 255));
  }
  function wcag(foreground, background) {
    var bg = rgbObject(background), fg = composite(rgbObject(foreground), bg), a = luminance(fg), b = luminance(bg);
    return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100;
  }
  function apcaY(value) {
    var rgb = rgbObject(value), y = 0.2126729 * Math.pow(clamp(rgb.r / 255), 2.4) + 0.7151522 * Math.pow(clamp(rgb.g / 255), 2.4) + 0.072175 * Math.pow(clamp(rgb.b / 255), 2.4);
    return y < 0.022 ? y + Math.pow(0.022 - y, 1.414) : y;
  }
  function apca(foreground, background) {
    var bg = rgbObject(background), txt = composite(rgbObject(foreground), bg), yTxt = apcaY(txt), yBg = apcaY(bg), sapc;
    if (Math.abs(yBg - yTxt) < 0.0005) return 0;
    if (yBg > yTxt) { sapc = (Math.pow(yBg, 0.56) - Math.pow(yTxt, 0.57)) * 1.14; return sapc < 0.001 ? 0 : Math.round((sapc - 0.035991) * 1000) / 10; }
    sapc = (Math.pow(yBg, 0.65) - Math.pow(yTxt, 0.62)) * 1.14;
    return sapc > -0.001 ? 0 : Math.round((sapc + 0.035991) * 1000) / 10;
  }

  function rootCustomProperties() {
    var names = Object.create(null);
    function scan(rules) {
      Array.prototype.forEach.call(rules || [], function (rule) {
        if (rule.cssRules && !rule.selectorText) scan(rule.cssRules);
        if (!rule.style || !rule.selectorText || !/(^|,)\s*(?:html|:root)(?:\b|\s|[.:#\[])/.test(rule.selectorText)) return;
        Array.prototype.forEach.call(rule.style, function (name) { if (name.indexOf('--') === 0) names[name] = true; });
      });
    }
    Array.prototype.forEach.call(doc.styleSheets || [], function (sheet) { try { scan(sheet.cssRules); } catch (_) {} });
    try {
      var computed = global.getComputedStyle(doc.documentElement);
      Array.prototype.forEach.call(computed, function (name) { if (name.indexOf('--') === 0) names[name] = true; });
    } catch (_) {}
    try { doc.documentElement.computedStyleMap().forEach(function (_, name) { if (name.indexOf('--') === 0) names[name] = true; }); } catch (_) {}
    return Object.keys(names).sort();
  }
  function paintedBackground(node) {
    var layers = [];
    for (var current = node; current;) {
      var color = parseColor(global.getComputedStyle(current).backgroundColor);
      if (color && color.a > 0) { layers.push(color); if (color.a >= 1) break; }
      var root = current.getRootNode && current.getRootNode();
      current = current.parentElement || root && root.host || null;
    }
    var result = parseColor('#ffffff');
    for (var index = layers.length - 1; index >= 0; index--) result = composite(layers[index], result);
    return result;
  }
  function face(node, label) {
    if (!node) return null;
    var style = global.getComputedStyle(node), background = paintedBackground(node);
    var families = String(style.fontFamily || '').split(',').map(function (name) { return name.trim().replace(/^['"]|['"]$/g, ''); });
    var resolved = families[0] || '';
    if (doc.fonts && doc.fonts.check) for (var i = 0; i < families.length; i++) if (doc.fonts.check(style.fontSize + ' "' + families[i] + '"')) { resolved = families[i]; break; }
    return { label: label || node.tagName.toLowerCase(), path: cssPath(node), element: node, foreground: style.color, foregroundHex: rgbToHex(parseColor(style.color) || {}), background: rgbToHex(background), border: rgbToHex(parseColor(style.borderTopColor) || {}), font: { family: style.fontFamily, resolved: resolved, size: style.fontSize, lineHeight: style.lineHeight, weight: style.fontWeight } };
  }
  function paintedElements() {
    var all = [];
    searchableRoots().forEach(function (root) {
      var selector = root === doc ? 'body, body *' : '*';
      all = all.concat(Array.prototype.slice.call(root.querySelectorAll(selector)));
    });
    return all.filter(function (node) {
      if (ours(node) || /^(script|style|link|meta|template|noscript)$/i.test(node.tagName || '')) return false;
      var style = global.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
      try { return !node.getClientRects || node.getClientRects().length > 0; } catch (_) { return true; }
    });
  }
  function paintedColours(elements) {
    var found = Object.create(null);
    function add(value, property, node) {
      var parsed = parseColor(value);
      if (!parsed || parsed.a === 0) return;
      var hex = rgbToHex(parsed, parsed.a < 1), entry = found[hex] || (found[hex] = { value: value, hex: hex, count: 0, area: 0, usages: [] });
      entry.count += 1;
      try { var rect = node.getBoundingClientRect(); entry.area += Math.max(0, rect.width) * Math.max(0, rect.height); } catch (_) {}
      if (entry.usages.length < 8) entry.usages.push({ property: property, path: cssPath(node) });
    }
    function addTokens(value, property, node) {
      var matches = String(value || '').match(/#[0-9a-f]{3,8}\b|(?:rgba?|hsla?|hwb|oklch|oklab|lab|lch|color)\([^)]*\)/gi) || [];
      matches.forEach(function (match) { add(match, property, node); });
    }
    elements.forEach(function (node) {
      var style = global.getComputedStyle(node);
      if (String(node.textContent || '').trim()) add(style.color, 'color', node);
      add(style.backgroundColor, 'backgroundColor', node);
      ['Top', 'Right', 'Bottom', 'Left'].forEach(function (side) {
        if (parseFloat(style['border' + side + 'Width']) > 0 && style['border' + side + 'Style'] !== 'none') add(style['border' + side + 'Color'], 'border' + side + 'Color', node);
      });
      if (parseFloat(style.outlineWidth) > 0 && style.outlineStyle !== 'none') add(style.outlineColor, 'outlineColor', node);
      if (style.textDecorationLine && style.textDecorationLine !== 'none') add(style.textDecorationColor, 'textDecorationColor', node);
      if (/^(svg|path|circle|rect|line|polyline|polygon|ellipse|text)$/i.test(node.tagName || '')) {
        if (style.fill && style.fill !== 'none') add(style.fill, 'fill', node);
        if (style.stroke && style.stroke !== 'none') add(style.stroke, 'stroke', node);
      }
      addTokens(style.backgroundImage, 'backgroundImage', node);
      addTokens(style.boxShadow, 'boxShadow', node);
    });
    return Object.keys(found).map(function (hex) { return found[hex]; });
  }
  function resolvedFaces(elements) {
    var found = Object.create(null), output = [];
    elements.forEach(function (node) {
      if (!String(node.textContent || '').trim()) return;
      var item = face(node), font = item && item.font;
      if (!font) return;
      var key = [font.resolved, font.size, font.lineHeight, font.weight, item.foregroundHex, item.background].join('|');
      if (found[key]) return;
      found[key] = true; output.push(item);
    });
    return output;
  }
  function consumedTokenUsages(elements) {
    var usages = Object.create(null);
    function remember(value, property, node) {
      var matches = String(value || '').match(/var\(\s*(--[\w-]+)/g) || [];
      matches.forEach(function (match) {
        var name = match.replace(/^var\(\s*/, ''), list = usages[name] || (usages[name] = []);
        var usage = { property: property, path: cssPath(node) };
        if (!list.some(function (item) { return item.property === usage.property && item.path === usage.path; })) list.push(usage);
      });
    }
    elements.forEach(function (node) {
      Array.prototype.forEach.call(node.style || [], function (property) { remember(node.style.getPropertyValue(property), property, node); });
    });
    function scan(rules, root) {
      Array.prototype.forEach.call(rules || [], function (rule) {
        if (rule.cssRules) scan(rule.cssRules, root);
        if (!rule.style || !rule.selectorText) return;
        var nodes = [];
        try { nodes = Array.prototype.slice.call(root.querySelectorAll(rule.selectorText)); } catch (_) { return; }
        nodes = nodes.filter(function (node) { return elements.indexOf(node) >= 0; });
        if (!nodes.length) return;
        Array.prototype.forEach.call(rule.style, function (property) {
          var value = rule.style.getPropertyValue(property);
          if (String(value).indexOf('var(') < 0) return;
          nodes.forEach(function (node) { remember(value, property, node); });
        });
      });
    }
    searchableRoots().forEach(function (root) {
      Array.prototype.forEach.call(root.styleSheets || [], function (sheet) { try { scan(sheet.cssRules, root); } catch (_) {} });
    });
    return usages;
  }
  var tokens = {
    rootProperties: rootCustomProperties,
    pageBackground: function () { return rgbToHex(paintedBackground(doc.body || doc.documentElement)); },
    face: face,
    discover: function () {
      var style = global.getComputedStyle(doc.documentElement);
      var elements = paintedElements(), painted = paintedColours(elements), consumed = consumedTokenUsages(elements);
      var colors = rootCustomProperties().map(function (name) {
        var value = style.getPropertyValue(name).trim(), parsed = parseColor(value);
        if (!parsed) return null;
        var hex = rgbToHex(parsed, parsed.a < 1), tokenUsages = consumed[name] || [];
        return { name: name, value: value, hex: hex, rgb: parsed, used: tokenUsages.length > 0, usages: tokenUsages };
      }).filter(Boolean);
      return { colors: colors, painted: painted, faces: resolvedFaces(elements), background: tokens.pageBackground() };
    }
  };
  var starterLibrary = {
    palettes: [
      { id: 'starter-light', name: 'Neutral light', roles: { background: '#f7f7f5', surface: '#ffffff', ink: '#171715', muted: '#686863', line: '#d7d7d1', accent: '#315efb' }, note: 'A neutral starting point, not a verdict.' },
      { id: 'starter-dark', name: 'Neutral dark', roles: { background: '#11110f', surface: '#1b1b18', ink: '#f1f1eb', muted: '#aaa9a1', line: '#3b3b36', accent: '#8eabff' }, note: 'A dark-first neutral starting point.' }
    ],
    faces: [
      { id: 'starter-system', family: 'System UI', role: 'body', stack: 'system-ui, sans-serif', source: 'installed', licence: 'web', note: 'Uses the reader\'s installed system face.' },
      { id: 'starter-mono', family: 'System Mono', role: 'mono', stack: 'ui-monospace, monospace', source: 'installed', licence: 'web', note: 'Uses the reader\'s installed monospace face.' }
    ],
    retired: []
  };
  function normalizeLibrary(source) {
    return {
      project: typeof (source && source.project) === 'string' ? source.project : '',
      palettes: Array.isArray(source && source.palettes) ? source.palettes : starterLibrary.palettes,
      faces: Array.isArray(source && source.faces) ? source.faces : starterLibrary.faces,
      retired: Array.isArray(source && source.retired) ? source.retired : []
    };
  }
  function librarySource() {
    var source = loadedLibrary || global.REVIEW_LIBRARY;
    return source && typeof source === 'object' ? normalizeLibrary(source) : starterLibrary;
  }
  var library = {
    get: function () { return clone(librarySource()); },
    load: function () {
      if (global.REVIEW_LIBRARY && typeof global.REVIEW_LIBRARY === 'object') return Promise.resolve(library.get());
      if (loadedLibrary || typeof global.fetch !== 'function' || !global.location) return Promise.resolve(library.get());
      var url;
      try { url = new global.URL('review-library.json', global.location.href); } catch (_) { return Promise.resolve(library.get()); }
      return global.fetch(url.href).then(function (response) { return response.ok ? response.json() : null; }).then(function (source) {
        if (source && typeof source === 'object') { loadedLibrary = normalizeLibrary(source); events.emit('library:change', library.get()); }
        return library.get();
      }).catch(function () { return library.get(); });
    },
    retired: function () { return (librarySource().retired || []).slice(); },
    isRetired: function (item) {
      var id = typeof item === 'string' ? item : item && item.id;
      return !!id && library.retired().some(function (entry) { return (typeof entry === 'string' ? entry : entry && entry.id) === id; });
    },
    active: function (kind) {
      var entries = Array.isArray(librarySource()[kind]) ? librarySource()[kind] : [];
      return entries.filter(function (entry) { return entry && !library.isRetired(entry); });
    },
    retiredEntries: function (kind) {
      var entries = Array.isArray(librarySource()[kind]) ? librarySource()[kind] : [];
      return entries.filter(function (entry) { return entry && library.isRetired(entry); }).map(function (entry) {
        var retired = library.retired().filter(function (item) { return (typeof item === 'string' ? item : item && item.id) === entry.id; })[0] || {};
        return Object.assign({}, entry, { retired: true, retiredReason: typeof retired === 'string' ? '' : retired.reason || '' });
      });
    },
    canApplyFace: function (face) { return !!face && !library.isRetired(face) && (face.licence || face.license) !== 'personal'; }
  };
  function memoryDefaults(project) { return { version: 1, project: project, candidates: [], verdicts: [] }; }
  function timestamp(value) {
    var parsed = Date.parse(String(value || ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  function latestByCandidate(rows) {
    var found = Object.create(null);
    (Array.isArray(rows) ? rows : []).forEach(function (row) {
      var id = row && row.candidateId;
      if (!id) return;
      if (!found[id] || timestamp(row.at) >= timestamp(found[id].at)) found[id] = clone(row);
    });
    return Object.keys(found).map(function (id) { return found[id]; }).sort(function (a, b) { return timestamp(a.at) - timestamp(b.at); });
  }
  function normalizeMemory(value, project) {
    var next = memoryDefaults(project);
    if (!value || typeof value !== 'object' || value.project && value.project !== project) return next;
    next.verdicts = latestByCandidate(value.verdicts);
    var verdicts = Object.create(null);
    next.verdicts.forEach(function (verdict) { verdicts[verdict.candidateId] = verdict; });
    var candidates = Object.create(null);
    (Array.isArray(value.candidates) ? value.candidates : []).forEach(function (candidate) {
      if (!candidate || !candidate.id || !verdicts[candidate.id]) return;
      var verdict = verdicts[candidate.id];
      var item = Object.assign({}, clone(candidate), {
        verdict: verdict.verdict,
        words: verdict.words || '',
        reviewer: verdict.reviewer || candidate.reviewer || '',
        at: verdict.at || candidate.at || ''
      });
      if (verdict.previous) item.previous = clone(verdict.previous);
      candidates[item.id] = item;
    });
    next.candidates = Object.keys(candidates).map(function (id) { return candidates[id]; });
    return next;
  }
  function memoryFromPage(project) {
    var verdicts = latestByCandidate(state.data.verdicts);
    var ids = Object.create(null);
    verdicts.forEach(function (verdict) { ids[verdict.candidateId] = verdict; });
    var candidates = (state.data.candidates || []).filter(function (candidate) { return candidate && ids[candidate.id]; }).map(function (candidate) {
      var verdict = ids[candidate.id];
      var item = Object.assign({}, clone(candidate), { verdict: verdict.verdict, words: verdict.words || '', reviewer: verdict.reviewer || candidate.reviewer || '', at: verdict.at || candidate.at || '' });
      if (verdict.previous) item.previous = clone(verdict.previous);
      return item;
    });
    return normalizeMemory({ project: project, candidates: candidates, verdicts: verdicts }, project);
  }
  function mergeMemories(left, right, project) {
    left = normalizeMemory(left, project); right = normalizeMemory(right, project);
    var verdicts = latestByCandidate(left.verdicts.concat(right.verdicts));
    var candidateSources = Object.create(null);
    left.candidates.concat(right.candidates).forEach(function (candidate) {
      if (!candidate || !candidate.id) return;
      if (!candidateSources[candidate.id] || timestamp(candidate.at) >= timestamp(candidateSources[candidate.id].at)) candidateSources[candidate.id] = clone(candidate);
    });
    return normalizeMemory({ project: project, candidates: Object.keys(candidateSources).map(function (id) { return candidateSources[id]; }), verdicts: verdicts }, project);
  }
  function mergeMemoryIntoState(value) {
    var memoryValue = normalizeMemory(value, state.project);
    var candidates = Object.create(null);
    (state.data.candidates || []).forEach(function (candidate) { if (candidate && candidate.id) candidates[candidate.id] = clone(candidate); });
    memoryValue.candidates.forEach(function (candidate) {
      var existing = candidates[candidate.id];
      if (!existing || timestamp(candidate.at) >= timestamp(existing.at)) candidates[candidate.id] = clone(candidate);
      else Object.assign(existing, { verdict: candidate.verdict, words: candidate.words, reviewer: candidate.reviewer, previous: candidate.previous });
    });
    state.data.candidates = Object.keys(candidates).map(function (id) { return candidates[id]; });
    state.data.verdicts = latestByCandidate((state.data.verdicts || []).concat(memoryValue.verdicts));
    return memoryValue;
  }
  var memoryQueue = Promise.resolve();
  var memory = {
    project: state.project,
    key: 'review.island.memory:' + state.project,
    loadLocal: function () {
      var raw = safeGet(memory.key);
      try { return normalizeMemory(JSON.parse(raw || 'null'), state.project); } catch (_) { return memoryDefaults(state.project); }
    },
    saveLocal: function (value) {
      var next = normalizeMemory(value, state.project);
      if (!safeSet(memory.key, JSON.stringify(next))) degrade('storage');
      return next;
    },
    rekey: function () {
      var next = projectFromContext();
      if (next !== state.project) {
        state.project = next; memory.project = next; memory.key = 'review.island.memory:' + next;
      }
      var combined = mergeMemories(memory.loadLocal(), memoryFromPage(state.project), state.project);
      memory.saveLocal(combined); mergeMemoryIntoState(combined);
      return combined;
    },
    url: function () {
      if (!endpoint() || !global.location) return '';
      try {
        var url = new global.URL(endpoint(), global.location.href);
        if (!/^https?:$/.test(url.protocol)) return '';
        url.pathname = url.pathname.replace(/\/$/, '') + '/memory'; url.search = ''; url.searchParams.set('project', state.project);
        return url.href;
      } catch (_) { return ''; }
    },
    goUrl: function (base) {
      try {
        var url = new global.URL(base || endpoint(), global.location.href);
        if (!/^https?:$/.test(url.protocol)) return base || endpoint();
        url.searchParams.set('project', state.project); return url.href;
      } catch (_) { return base || endpoint(); }
    },
    mount: function () {
      return Promise.resolve(library.load()).then(function () {
        var local = memory.rekey(), url = memory.url();
        if (!url || typeof global.fetch !== 'function') { degrade('memoryLocal'); return { durable: false, memory: clone(local) }; }
        return global.fetch(url).then(function (response) {
          if (!response.ok) throw new Error('Review memory returned ' + response.status);
          return response.json();
        }).then(function (remote) {
          var combined = mergeMemories(local, remote, state.project);
          memory.saveLocal(combined); mergeMemoryIntoState(combined); state.data = storage.save(state.data);
          events.emit('memory:loaded', clone(combined));
          return { durable: true, memory: clone(combined) };
        }).catch(function () { degrade('memoryServer'); return { durable: false, memory: clone(local) }; });
      });
    },
    recordVerdict: function (candidate, verdict) {
      if (!candidate || !candidate.id || !verdict || !verdict.candidateId) return null;
      var judged = Object.assign({}, clone(candidate), { verdict: verdict.verdict, words: verdict.words || '', reviewer: verdict.reviewer || candidate.reviewer || '', at: verdict.at || candidate.at || '' });
      if (verdict.previous) judged.previous = clone(verdict.previous);
      var local = mergeMemories(memory.loadLocal(), { project: state.project, candidates: [judged], verdicts: [verdict] }, state.project);
      memory.saveLocal(local);
      var url = memory.url();
      if (!url || typeof global.fetch !== 'function') return clone(verdict);
      memoryQueue = memoryQueue.catch(function () {}).then(function () {
        return global.fetch(url.replace(/\?project=.*$/, ''), {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ project: state.project, candidate: judged, verdict: verdict })
        }).then(function (response) { if (!response.ok) throw new Error('Review memory returned ' + response.status); return true; });
      }).catch(function () { degrade('memoryServer'); return false; });
      return clone(verdict);
    },
    flush: function () { return memoryQueue.catch(function () { return false; }); }
  };
  memory.rekey();
  function registerMode(definition) {
    if (!definition || !definition.id || typeof definition.render !== 'function') throw new TypeError('A Review Island mode needs an id and render(container).');
    var mode = Object.assign({ label: definition.id }, definition);
    modes[mode.id] = mode;
    events.emit('mode:register', mode);
    return mode;
  }
  function getMode(id) { return modes[id] || null; }
  var capabilities = {
    eyedropper: !!global.EyeDropper,
    adoptedStyleSheets: !!(doc && global.CSSStyleSheet && 'adoptedStyleSheets' in doc)
  };
  function reportFontFailure(face) {
    return degrade('font', face ? 'Face: ' + String(face) + '.' : '');
  }
  events.on('session:disable', function () { removeScopedStyle(); });

  return {
    global: global, document: doc, state: state, storage: storage, memory: memory, persist: persist, setAdapter: setAdapter, reviewer: reviewer, library: library,
    dom: { el: el, button: button, escapeHtml: escapeHtml, cssPath: cssPath, words: words, resolve: resolve, ours: ours, isEditingEvent: isEditingEvent, theme: theme, endpoint: endpoint, servable: servable, fraction: fraction, id: makeId },
    events: events,
    history: history,
    capabilities: capabilities,
    degrade: degrade,
    unresolved: { add: unresolved, font: reportFontFailure },
    styles: { apply: scopedStyle, remove: removeScopedStyle },
    colors: { clamp: clamp, parseHex: parseHex, parse: parseColor, rgbToHex: rgbToHex, composite: composite, luminance: luminance, wcag: wcag, contrast: wcag, apca: apca, srgbToOklab: srgbToOklab, oklabToSrgb: oklabToSrgb, srgbToOklch: srgbToOklch, oklchToSrgb: oklchToSrgb, oklabToOklch: oklabToOklch, oklchToOklab: oklchToOklab, clampSrgb: clampSrgb, inSrgbGamut: inSrgbGamut, maxSrgbChroma: maxSrgbChroma, clampOklch: clampOklch, mapToSrgb: mapToSrgb },
    tokens: tokens,
    registerMode: registerMode,
    getMode: getMode
  };
})();
