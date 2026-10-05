/* Comment mode. This file deliberately keeps its own small fallbacks: it is also
 * concatenated into extension builds where a host page can be unusually hostile. */
(function () {
  'use strict';

  var I = Island;
  var win = typeof window !== 'undefined' ? window : null;
  var doc = win && win.document;
  if (!doc) return;
  var requestFrame = win.requestAnimationFrame ? win.requestAnimationFrame.bind(win) : function (callback) { return win.setTimeout(callback, 16); };
  var cancelFrame = win.cancelAnimationFrame ? win.cancelAnimationFrame.bind(win) : function (id) { if (win.clearTimeout) win.clearTimeout(id); };
  var state = I.state || (I.state = {});
  var dom = I.dom || {};
  var events = I.events || { on: function () {}, off: function () {}, emit: function () {} };
  var el = dom.el || function (tag, className, text) {
    var node = doc.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
  var button = dom.button || function (text, className) {
    var node = el('button', className, text); node.type = 'button'; return node;
  };
  var pathFor = dom.cssPath || function (node) {
    var parts = [];
    while (node && node.nodeType === 1 && node !== doc.body && parts.length < 12) {
      if (node.id) { parts.unshift('#' + node.id); break; }
      var tag = node.tagName.toLowerCase(), count = 1, sibling = node;
      while ((sibling = sibling.previousElementSibling)) if (sibling.tagName === node.tagName) count++;
      parts.unshift(tag + ':nth-of-type(' + count + ')'); node = node.parentElement;
    }
    return parts.join(' > ');
  };
  var firstWords = dom.words || function (node) { return (node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60); };
  var resolve = dom.resolve || function (note) { try { return note.path && doc.querySelector(note.path); } catch (ignore) { return null; } };
  var ours = dom.ours || function (node) { return !!(node && node.closest && node.closest('[data-review-island], .island-comment-box, .island-comment-outline')); };
  var theme = dom.theme || function () { return doc.documentElement.getAttribute('data-theme') || 'light'; };
  var imageData = dom.imageData || downsample;
  var copyText = dom.copyText || function (text) {
    if (win.navigator && win.navigator.clipboard) return win.navigator.clipboard.writeText(text).catch(function () {});
    return Promise.resolve();
  };
  var storage = I.storage || {};
  var page = (win.location && win.location.pathname) || '/';
  var data = state.data || (state.data = { pins: [], pageComment: '', review: {} });
  data.review = data.review || {};
  var pointing = false;
  var outline = null;
  var activeBox = null;
  var activeNote = null;
  var renderedRoot = null;
  var aboutArea = null;
  var styleInstalled = false;
  var markerFrame = 0;
  var markerObserver = null;

  state.notes = Array.isArray(data.pins) ? data.pins : [];
  state.pins = state.notes; // legacy callers use reviewLayer.pins() and state.pins.
  function refreshData() {
    data = state.data || data; data.review = data.review || {};
    state.notes = Array.isArray(data.pins) ? data.pins : []; state.pins = state.notes;
    return data;
  }

  function persist() {
    data.pins = state.notes;
    state.pins = state.notes;
    if (I.persist) state.data = I.persist();
    else if (storage.save) state.data = storage.save(data);
    data = state.data || data;
    state.notes = data.pins || [];
    state.pins = state.notes;
    events.emit('change', { source: 'comment', state: state });
    events.emit('notes:change', state.notes);
  }
  function endpoint() { return (dom.endpoint && dom.endpoint()) || win.REVIEW_ENDPOINT || state.endpoint || ''; }
  function islandMount() { return state.shell && state.shell.shadow || doc.body; }
  function ensureStyle() {
    if (styleInstalled || !state.shell || !state.shell.shadow) return;
    styleInstalled = true;
    var style = el('style'); style.textContent = '.island-about textarea,.island-note-text{display:block;width:100%;min-height:82px;resize:vertical;border:1px solid var(--rule);border-radius:5px;background:var(--raised);color:var(--ink);padding:8px}.island-point,.island-pins-head button,.island-note-controls button{margin-top:8px;border:1px solid var(--rule);border-radius:5px;background:var(--graphite);color:var(--ink);padding:6px 8px}.island-point[aria-pressed="true"]{color:var(--gold);border-color:var(--gold)}.island-element-readout{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px}.island-readout-cell{padding:3px 5px;background:var(--raised);border-radius:3px;font-size:10px}.island-readout-cell code{display:block;color:var(--gold);overflow:hidden;text-overflow:ellipsis;max-width:130px}.island-comment-list{margin-top:10px;border-top:1px solid var(--rule);padding-top:8px}.island-list-head,.island-note-controls{display:flex;gap:6px;align-items:center}.island-list-head select,.island-note-controls select{min-width:0;background:var(--graphite);color:var(--ink);border:1px solid var(--rule);border-radius:4px;padding:4px}.island-comment-list ol,.island-pins-list{list-style:none;margin:6px 0 0;padding:0}.island-note-item,.island-pin-row{display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 8px;padding:7px 0;border-top:1px solid var(--rule);cursor:pointer}.island-note-item:focus-visible,.island-pin-row:focus-visible{outline:2px solid var(--gold);outline-offset:2px}.island-note-item small,.island-pin-row small{grid-column:2;color:var(--muted)}.island-note-kind{color:var(--gold);font-size:10px}.island-note-copy{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.island-comment-box,.island-go-preview{position:fixed;z-index:4;width:min(290px,calc(100vw - 16px));padding:9px;background:var(--lacquer);border:1px solid var(--rule);border-radius:7px;box-shadow:0 16px 36px -12px oklch(0% 0 0 / .7)}.island-go-preview{pointer-events:auto;z-index:2147483005;left:50%;top:50%;transform:translate(-50%,-50%);max-height:calc(100vh - 16px);max-height:calc(100dvh - 16px);display:flex;flex-direction:column;overflow:auto;font:12px/1.4 Albert Sans,Avenir Next,Helvetica Neue,Arial,system-ui,sans-serif;color:var(--ink)}.island-go-words{min-height:0;max-height:min(56vh,440px);overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere}.island-go-actions{flex-shrink:0;display:flex;justify-content:flex-end;gap:6px}.island-go-actions button{min-width:44px;min-height:44px;border:1px solid var(--rule);border-radius:5px;background:var(--graphite);color:var(--ink);padding:6px 10px}.island-comment-outline{position:fixed;z-index:2;pointer-events:none;border:2px dashed var(--gold)}.island-frame-blocker{position:fixed;z-index:3;margin:0;padding:0;border:2px dashed var(--gold);border-radius:0;background:transparent;color:transparent;cursor:not-allowed}.island-pin-marker{position:fixed;z-index:3;width:22px;height:22px;margin:-11px 0 0 -11px;padding:0;border:0;border-radius:50%;background:var(--gold);color:var(--lacquer);box-shadow:0 0 0 2px var(--lacquer),0 2px 8px oklch(0% 0 0 / .5);font:700 11px/22px inherit;text-align:center;pointer-events:auto}.island-pin-marker[data-lost="true"]{background:var(--muted);color:var(--lacquer)}.island-note-preview{display:block;max-width:100%;max-height:130px;margin-top:7px}.island-note-preview[hidden]{display:none}.island-note-help{display:block;color:var(--muted);margin-top:6px}.island-note-controls{margin-top:7px}.island-note-controls button{margin:0}.island-comment-box[data-dropping="1"]{outline:2px solid var(--gold)}';
    state.shell.shadow.appendChild(style);
  }
  function canPost() { return typeof win.fetch === 'function' && (dom.servable ? dom.servable() : !!endpoint() && /^https?:/.test(endpoint())); }
  function makeId() { return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function rememberAbout(value) {
    refreshData();
    value = String(value == null ? '' : value);
    var changed = data.pageComment !== value;
    if (!changed && storage.available !== false) return;
    if (changed) {
      data.pageComment = value; data.review.commentTouched = true;
      data.review.pageCommentId = data.review.pageCommentId || (dom.id ? dom.id('page') : 'page-' + page.replace(/[^a-z0-9]/gi, '-'));
      data.review.pageCommentAt = new Date().toISOString(); data.review.pageCommentReviewer = I.reviewer ? I.reviewer() : reviewer();
    }
    // Drafts stay local. notes:change can redraw another mode's cached root,
    // so typing must use persistence without requesting any DOM replacement.
    if (I.persist) state.data = I.persist();
    else if (storage.save) state.data = storage.save(data);
    refreshData();
    if (changed) events.emit('about:change', data.pageComment);
  }
  function flushAbout() {
    if (aboutArea && aboutArea.isConnected && state.activeMode === 'comment') rememberAbout(aboutArea.value);
  }
  function discardAbout() {
    if (aboutArea) aboutArea.value = '';
  }
  function saveAbout(value) {
    // An intentional replacement owns the value, rather than the old live draft.
    if (aboutArea) aboutArea.value = String(value == null ? '' : value);
    rememberAbout(value); render(null, true);
    events.emit('status:set', data.pageComment ? 'Page note saved.' : 'Page note cleared.');
    postPageComment();
  }
  function noteRecord(note) {
    return {
      id: note.id, page: page, path: note.path, text: note.text, x: note.x, y: note.y,
      width: note.width || note.size || 'full', size: note.width || note.size || 'full', theme: note.theme || theme(),
      note: note.note || '', kind: note.kind || 'Change', state: note.state || note.status || 'open',
      status: note.state || note.status || 'open', image: note.image || '', time: note.time, reviewer: note.reviewer || (I.reviewer ? I.reviewer() : reviewer())
    };
  }
  function post(note) {
    if (!canPost()) return Promise.resolve(null);
    return win.fetch(endpoint(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(noteRecord(note)) })
      .then(function (response) { if (!response.ok) throw new Error('Review server returned ' + response.status); return response.json(); })
      .catch(function () { events.emit('status:set', 'The review server could not save this note. It remains in this browser.'); return null; });
  }
  function postPageComment() {
    if (!canPost()) return Promise.resolve(null);
    var record = {
      id: data.review.pageCommentId, page: page, scope: 'page', note: data.pageComment, text: '',
      kind: 'change', state: 'open', status: 'open', image: '', time: data.review.pageCommentAt,
      reviewer: data.review.pageCommentReviewer
    };
    return win.fetch(endpoint(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(record) })
      .then(function (response) { if (!response.ok) throw new Error('Review server returned ' + response.status); return response.json(); })
      .catch(function () { events.emit('status:set', 'The review server could not save the page comment. It remains in this browser.'); return null; });
  }
  function storeAsset(note, data) {
    if (!canPost()) return Promise.resolve(null);
    return win.fetch(endpoint().replace(/\/$/, '') + '/asset', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ page: page, pinId: note.id, image: data })
    }).then(function (response) { if (!response.ok) throw new Error('Review server returned ' + response.status); return response.json(); }).then(function (result) {
      if (result && result.path) { note.image = result.path; note._preview = result.path; persist(); render(); }
      return result;
    }).catch(function () { events.emit('status:set', 'The review server could not save the image. It remains in this browser.'); return null; });
  }
  function attachData(note, data, preview) {
    if (!/^data:image\/(?:png|jpeg);base64,/i.test(String(data || ''))) return Promise.reject(new Error('The capture did not return a PNG or JPEG.'));
    note.image = data; note._preview = data; persist();
    if (preview) { preview.src = data; preview.hidden = false; }
    render(); return storeAsset(note, data);
  }
  function attach(note, file, preview) {
    if (!file || !/^image\//.test(file.type || '')) return;
    note._upload = imageData(file).then(function (data) {
      return attachData(note, data, preview);
    }).catch(function () { events.emit('status:set', 'The image could not be read. The note is still usable.'); });
    note._upload.then(function () { delete note._upload; });
  }
  function captureScreenshot(note, preview, control) {
    var adapter = state.adapter;
    if (!adapter || typeof adapter.capture !== 'function') return Promise.resolve(null);
    var host = state.shell && state.shell.host, previousVisibility = host && host.style && host.style.visibility || '';
    if (control) control.disabled = true;
    if (host && host.style) host.style.visibility = 'hidden';
    return new Promise(function (resolveFrame) { requestFrame(resolveFrame); }).then(function () {
      return adapter.capture();
    }).then(function (data) {
      return attachData(note, data, preview).then(function () { events.emit('status:set', 'Screenshot attached.'); return data; });
    }).catch(function (error) {
      events.emit('status:set', 'The screenshot could not be captured. ' + String(error && error.message || error || ''));
      return null;
    }).finally(function () {
      if (host && host.style) host.style.visibility = previousVisibility;
      if (control) control.disabled = false;
    });
  }
  function width() {
    if (I.shell && I.shell.currentSize) return I.shell.currentSize();
    return Math.max(1, Math.round(win.innerWidth || state.size || state.width || 1));
  }
  function reviewer() {
    var stored = '';
    try { stored = win.localStorage.getItem('review.reviewer') || win.localStorage.getItem('REVIEW_REVIEWER') || ''; } catch (ignore) {}
    return I.reviewer ? I.reviewer() : state.reviewer || win.REVIEW_REVIEWER || stored || 'local';
  }
  function fraction(value, total) { return total ? Math.round(Math.max(0, Math.min(1, value / total)) * 1000) / 1000 : 0; }
  function makeNote(target, event) {
    refreshData();
    var rect = target.getBoundingClientRect();
    return {
      id: makeId(), path: pathFor(target), text: firstWords(target), x: fraction(event.clientX - rect.left, rect.width),
      y: fraction(event.clientY - rect.top, rect.height), width: width(), size: width(), theme: theme(),
      note: '', kind: 'Change', state: 'open', status: 'open', image: '', reviewer: reviewer(),
      time: new Date().toISOString(), saved: false
    };
  }
  function closeComposer(removeUnsaved) {
    var note = activeNote;
    if (activeBox) activeBox.remove();
    activeBox = activeNote = null;
    if (removeUnsaved && note && !note.saved && !note.note && !note.image) {
      state.notes = state.notes.filter(function (item) { return item !== note; }); state.pins = state.notes; persist(); render();
    }
  }
  function composer(note, left, top) {
    closeComposer(false);
    var box = el('section', 'island-comment-box'); box.setAttribute('data-review-island', '');
    box.style.left = Math.max(8, Math.min(left + 16, win.innerWidth - 296)) + 'px';
    box.style.top = Math.max(8, Math.min(top + 12, win.innerHeight - 160)) + 'px';
    var text = el('textarea', 'island-note-text'); text.placeholder = 'What should change?'; text.value = note.note || '';
    var controls = el('div', 'island-note-controls');
    var kind = doc.createElement('select'); kind.setAttribute('aria-label', 'Note kind');
    ['Change', 'Idea', 'Question', 'Praise'].forEach(function (value) { var option = el('option', '', value); option.value = value; option.selected = (note.kind || 'Change') === value; kind.appendChild(option); });
    var noteState = doc.createElement('select'); noteState.setAttribute('aria-label', 'Note state');
    ['open', 'done'].forEach(function (value) { var option = el('option', '', value); option.value = value; option.selected = (note.state || note.status || 'open') === value; noteState.appendChild(option); });
    var attachButton = button('Image', 'island-note-image'); attachButton.title = 'Command/Ctrl I: attach an image';
    var captureButton = state.adapter && typeof state.adapter.capture === 'function' ? button('Screenshot', 'island-note-capture') : null;
    if (captureButton) captureButton.title = 'Attach a screenshot of the visible page';
    var input = el('input'); input.type = 'file'; input.accept = 'image/*'; input.hidden = true;
    // Assigning src = '' makes the src GETTER return the document URL, so a
    // truthiness test on it never hides an empty preview. Keep the source in a
    // local and drop the attribute entirely when there is no image.
    var previewSrc = note._preview || note.image || '';
    var preview = el('img', 'island-note-preview'); preview.alt = 'Attached reference';
    if (previewSrc) preview.src = previewSrc; else preview.removeAttribute('src');
    preview.hidden = !previewSrc;
    controls.appendChild(kind); controls.appendChild(noteState); controls.appendChild(attachButton); if (captureButton) controls.appendChild(captureButton); controls.appendChild(input);
    box.appendChild(text); box.appendChild(preview); box.appendChild(controls); box.appendChild(el('small', 'island-note-help', 'Enter saves. Shift Enter adds a line. Paste or drop an image.'));
    function save() {
      note.note = text.value.trim(); note.kind = kind.value; note.state = note.status = noteState.value;
      if (!note.note && !note.image && !note.saved && !note._upload) { closeComposer(true); return; }
      note.saved = true; persist();
      events.emit('status:set', 'Review note saved.');
      var upload = note._upload || Promise.resolve(); upload.then(function () { post(note); });
      closeComposer(false); render();
    }
    attachButton.addEventListener('click', function () { input.click(); });
    if (captureButton) captureButton.addEventListener('click', function () { captureScreenshot(note, preview, captureButton); });
    input.addEventListener('change', function () { attach(note, input.files[0], preview); });
    text.addEventListener('keydown', function (event) {
      event.stopPropagation();
      if ((event.metaKey || event.ctrlKey) && String(event.key).toLowerCase() === 'i') { event.preventDefault(); input.click(); return; }
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); save(); }
      if (event.key === 'Escape') { event.preventDefault(); closeComposer(true); }
    });
    box.addEventListener('paste', function (event) { var files = event.clipboardData && event.clipboardData.files; if (files && files[0]) { event.preventDefault(); attach(note, files[0], preview); } });
    box.addEventListener('dragover', function (event) { event.preventDefault(); box.dataset.dropping = '1'; });
    box.addEventListener('dragleave', function () { delete box.dataset.dropping; });
    box.addEventListener('drop', function (event) { event.preventDefault(); delete box.dataset.dropping; attach(note, event.dataTransfer && event.dataTransfer.files[0], preview); });
    islandMount().appendChild(box); activeBox = box; activeNote = note; text.focus();
  }
  function ensureOutline() {
    if (outline) return outline;
    outline = el('div', 'island-comment-outline'); outline.setAttribute('data-review-island', ''); islandMount().appendChild(outline); return outline;
  }
  function elementAt(x, y) {
    var target = doc.elementFromPoint(x, y), inner;
    while (target && target.shadowRoot && target.shadowRoot.elementFromPoint) {
      inner = target.shadowRoot.elementFromPoint(x, y);
      if (!inner || inner === target) break;
      target = inner;
    }
    return target;
  }
  function move(event) {
    if (!pointing) return;
    var target = elementAt(event.clientX, event.clientY), mark = ensureOutline();
    if (!target || ours(target)) { mark.hidden = true; return; }
    var rect = target.getBoundingClientRect(); mark.hidden = false;
    mark.style.left = rect.left + 'px'; mark.style.top = rect.top + 'px'; mark.style.width = Math.max(0, rect.width - 4) + 'px'; mark.style.height = Math.max(0, rect.height - 4) + 'px';
    renderReadout(target);
  }
  function click(event) {
    if (!pointing) return;
    var path = event.composedPath && event.composedPath();
    var target = path && path[0] && path[0].nodeType === 1 ? path[0] : event.target && event.target.nodeType === 1 ? event.target : elementAt(event.clientX, event.clientY);
    if (!target || ours(target)) return;
    if (String(target.tagName).toLowerCase() === 'iframe') {
      events.emit('status:set', 'Frames cannot be pinned. Open the framed page directly.');
      return;
    }
    event.preventDefault(); event.stopPropagation();
    var note = makeNote(target, event); state.notes.push(note); state.pins = state.notes;
    composer(note, event.clientX, event.clientY);
  }
  function customPropertyFor(target, computed, property) {
    var value = computed.getPropertyValue(property).trim(), names = [];
    function readDeclaration(declaration) {
      var match, source = String(declaration && declaration.getPropertyValue(property) || ''), pattern = /var\(\s*(--[\w-]+)/g;
      while ((match = pattern.exec(source))) if (names.indexOf(match[1]) < 0) names.push(match[1]);
    }
    function scan(rules) {
      Array.prototype.forEach.call(rules || [], function (rule) {
        if (rule.cssRules && !rule.selectorText) { scan(rule.cssRules); return; }
        try { if (rule.style && rule.selectorText && target.matches(rule.selectorText)) readDeclaration(rule.style); } catch (ignore) {}
      });
    }
    readDeclaration(target.style);
    Array.prototype.forEach.call(doc.styleSheets || [], function (sheet) { try { scan(sheet.cssRules); } catch (ignore) {} });
    try {
      for (var i = 0; i < computed.length; i++) {
        if (computed[i].indexOf('--') !== 0) continue;
        var candidate = computed.getPropertyValue(computed[i]).trim(), matches = candidate === value;
        if (!matches && /color|background/i.test(property) && I.colors) {
          var wanted = I.colors.parse(value), found = I.colors.parse(candidate);
          matches = !!wanted && !!found && I.colors.rgbToHex(wanted, wanted.a < 1) === I.colors.rgbToHex(found, found.a < 1);
        }
        if (matches && names.indexOf(computed[i]) < 0) names.push(computed[i]);
      }
    } catch (ignore) {}
    return names.slice(0, 2).join(', ');
  }
  function resolvedFace(computed) {
    var faces = computed.fontFamily.split(',').map(function (value) { return value.trim().replace(/^['"]|['"]$/g, ''); });
    if (!doc.fonts || !doc.fonts.check) return faces[0];
    for (var i = 0; i < faces.length; i++) if (doc.fonts.check(computed.fontSize + ' "' + faces[i] + '"')) return faces[i];
    return faces[0];
  }
  function elementValues(target) {
    var computed = win.getComputedStyle(target);
    return [
      ['Face', resolvedFace(computed), customPropertyFor(target, computed, 'font-family')],
      ['Size', computed.fontSize, customPropertyFor(target, computed, 'font-size')],
      ['Line', computed.lineHeight, customPropertyFor(target, computed, 'line-height')],
      ['Weight', computed.fontWeight, customPropertyFor(target, computed, 'font-weight')],
      ['Colour', computed.color, customPropertyFor(target, computed, 'color')],
      ['Background', computed.backgroundColor, customPropertyFor(target, computed, 'background-color')]
    ];
  }
  function renderReadout(target) {
    if (!renderedRoot) return;
    var strip = renderedRoot.querySelector('[data-comment-readout]'); if (!strip) return;
    strip.textContent = '';
    elementValues(target).forEach(function (pair) {
      var cell = el('span', 'island-readout-cell'); cell.appendChild(el('strong', '', pair[0] + ' ')); cell.appendChild(el('span', '', pair[1]));
      if (pair[2]) cell.appendChild(el('code', '', pair[2])); strip.appendChild(cell);
    });
  }
  function setPointing(value) {
    pointing = !!value; data.review.commentPointing = pointing; if (pointing) data.review.commentTouched = true;
    if (!pointing && outline) outline.hidden = true;
    if (renderedRoot && (pointing || data.review.commentTouched) && !renderedRoot.querySelector('[data-comment-readout]')) render();
    if (renderedRoot) { var control = renderedRoot.querySelector('[data-comment-point]'); if (control) { control.setAttribute('aria-pressed', String(pointing)); control.textContent = pointing ? 'Pointing, click an element' : 'Point at something'; } }
  }
  function scrollTo(note) {
    var target = resolve(note);
    if (target && target.scrollIntoView) { target.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    else if (win.alert) win.alert('This note lost its place on the page.');
  }
  function renderMarkers() {
    markerFrame = 0;
    if (!state.shell || !state.shell.shadow) return;
    Array.prototype.forEach.call(state.shell.shadow.querySelectorAll('.island-pin-marker'), function (marker) { marker.remove(); });
    Array.prototype.forEach.call(state.shell.shadow.querySelectorAll('.island-frame-blocker'), function (blocker) { blocker.remove(); });
    state.notes.forEach(function (note, index) {
      if (!note.saved) return;
      var target = resolve(note), marker = button(String(index + 1), 'island-pin-marker');
      marker.setAttribute('data-review-island', ''); marker.dataset.lost = String(!target);
      marker.title = (note.note || 'Review note') + ', click to edit';
      if (target) {
        var rect = target.getBoundingClientRect();
        marker.style.left = Math.round(rect.left + rect.width * (note.x || 0)) + 'px';
        marker.style.top = Math.round(rect.top + rect.height * (note.y || 0)) + 'px';
      } else {
        marker.style.left = '14px'; marker.style.top = 60 + index * 26 + 'px';
      }
      marker.addEventListener('click', function (event) {
        event.stopPropagation();
        var rect = marker.getBoundingClientRect(); composer(note, rect.left, rect.top);
      });
      state.shell.shadow.appendChild(marker);
    });
    var frameRoots = [doc], frames = [];
    for (var rootIndex = 0; rootIndex < frameRoots.length; rootIndex++) {
      Array.prototype.forEach.call(frameRoots[rootIndex].querySelectorAll('*'), function (node) {
        if (node.shadowRoot) frameRoots.push(node.shadowRoot);
        if (String(node.tagName || '').toLowerCase() === 'iframe') frames.push(node);
      });
    }
    if (pointing) frames.forEach(function (frame) {
      var rect = frame.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      var blocker = button('Frame cannot be pinned', 'island-frame-blocker');
      blocker.setAttribute('data-review-island', ''); blocker.setAttribute('aria-label', 'Frame cannot be pinned. Open the framed page directly.');
      blocker.style.left = rect.left + 'px'; blocker.style.top = rect.top + 'px'; blocker.style.width = rect.width + 'px'; blocker.style.height = rect.height + 'px';
      blocker.addEventListener('click', function (event) { event.preventDefault(); event.stopPropagation(); events.emit('status:set', 'Frames cannot be pinned. Open the framed page directly.'); });
      state.shell.shadow.appendChild(blocker);
    });
  }
  function scheduleMarkers() {
    if (!markerFrame) markerFrame = requestFrame(renderMarkers);
  }
  function ensureMarkerObserver() {
    if (markerObserver || !win.MutationObserver || !doc.documentElement) return;
    markerObserver = new win.MutationObserver(scheduleMarkers);
    markerObserver.observe(doc.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
  }
  function renderNotes(root) {
    var filter = data.review.commentFilter || 'all';
    var notes = state.notes.slice().sort(function (a, b) { return String(b.time || '').localeCompare(String(a.time || '')); })
      .filter(function (note) { return filter === 'all' || (note.state || note.status || 'open') === filter; });
    if (!notes.length) return;
    var section = el('section', 'island-comment-list');
    var head = el('div', 'island-list-head'); head.appendChild(el('strong', '', 'Notes'));
    var select = doc.createElement('select'); select.setAttribute('aria-label', 'Filter notes');
    [['all', 'All'], ['open', 'Open'], ['done', 'Done']].forEach(function (pair) { var option = el('option', '', pair[1]); option.value = pair[0]; option.selected = filter === pair[0]; select.appendChild(option); });
    select.addEventListener('change', function () { data.review.commentFilter = select.value; persist(); render(); }); head.appendChild(select); section.appendChild(head);
    var list = el('ol');
    notes.forEach(function (note) {
      var item = el('li', 'island-note-item');
      item.appendChild(el('span', 'island-note-kind', note.kind || 'Change')); item.appendChild(el('span', 'island-note-copy', note.note || '(image only)'));
      item.appendChild(el('small', '', (note.state || note.status || 'open') + (resolve(note) ? '' : ' · lost its place')));
      item.tabIndex = 0; item.setAttribute('role', 'button');
      item.addEventListener('click', function () { scrollTo(note); });
      item.addEventListener('keydown', function (event) { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); scrollTo(note); } }); list.appendChild(item);
    });
    section.appendChild(list); root.appendChild(section);
  }
  function render(root, replaceEditor) {
    flushAbout();
    refreshData();
    if (root) renderedRoot = root;
    root = renderedRoot; if (!root) return;
    var area = aboutArea, about = area && area.parentElement;
    if (replaceEditor !== true && area && area.isConnected && about && about.parentElement === root) {
      // Keep the entire editor branch attached: detaching and refocusing would
      // cancel IME composition even if its bytes and selection were restored.
      Array.prototype.slice.call(root.children).forEach(function (child) { if (child !== about) child.remove(); });
    } else {
      root.textContent = '';
      about = el('section', 'island-about');
      area = el('textarea', 'island-about-text'); area.placeholder = 'About this page'; area.setAttribute('aria-label', 'About this page'); area.value = data.pageComment || '';
      aboutArea = area;
      var composing = false;
      area.addEventListener('input', function () { rememberAbout(area.value); });
      area.addEventListener('change', function () { rememberAbout(area.value); });
      area.addEventListener('blur', function () { rememberAbout(area.value); });
      area.addEventListener('compositionstart', function () { composing = true; });
      area.addEventListener('compositionend', function () { composing = false; rememberAbout(area.value); });
      area.addEventListener('keydown', function (event) { if (event.key === 'Enter' && !event.shiftKey && !composing && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); saveAbout(area.value); } });
      about.appendChild(area); root.appendChild(about);
    }
    var point = button(pointing ? 'Pointing, click an element' : 'Point at something', 'island-point'); point.dataset.commentPoint = ''; point.title = 'P: point at an element'; point.setAttribute('aria-pressed', String(pointing));
    point.addEventListener('click', function () { setPointing(!pointing); }); root.appendChild(point);
    if (pointing || data.review.commentTouched) {
      var strip = el('div', 'island-element-readout'); strip.dataset.commentReadout = ''; strip.setAttribute('aria-live', 'polite'); root.appendChild(strip);
      renderNotes(root);
    }
    scheduleMarkers();
  }
  function keydown(event) {
    if ((dom.isEditingEvent && dom.isEditingEvent(event)) || event.metaKey || event.ctrlKey || event.altKey) return;
    if (String(event.key).toLowerCase() === 'p') { event.preventDefault(); setPointing(!pointing); }
  }
  function activate() { refreshData(); ensureStyle(); ensureMarkerObserver(); doc.addEventListener('pointermove', move, true); doc.addEventListener('click', click, true); doc.addEventListener('keydown', keydown, true); win.addEventListener('scroll', scheduleMarkers, true); win.addEventListener('resize', scheduleMarkers); setPointing(!!data.review.commentPointing); scheduleMarkers(); }
  function deactivate() { flushAbout(); doc.removeEventListener('pointermove', move, true); doc.removeEventListener('click', click, true); doc.removeEventListener('keydown', keydown, true); setPointing(false); closeComposer(true); }
  function downsample(file) {
    return new Promise(function (resolveData, reject) {
      var reader = new FileReader(); reader.onerror = reject; reader.onload = function () {
        var image = new Image(); image.onerror = reject; image.onload = function () {
          var scale = Math.min(1, 1024 / Math.max(image.naturalWidth, image.naturalHeight));
          var canvas = doc.createElement('canvas'), mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
          canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
          canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
          (function encode() {
            var data = canvas.toDataURL(mime, mime === 'image/jpeg' ? 0.86 : undefined);
            if (data.length <= 3.5 * 1024 * 1024 || Math.max(canvas.width, canvas.height) <= 256) { resolveData(data); return; }
            var smaller = doc.createElement('canvas'); smaller.width = Math.max(1, Math.round(canvas.width * 0.8)); smaller.height = Math.max(1, Math.round(canvas.height * 0.8));
            smaller.getContext('2d').drawImage(canvas, 0, 0, smaller.width, smaller.height); canvas = smaller; encode();
          })();
        }; image.src = String(reader.result);
      }; reader.readAsDataURL(file);
    });
  }

  I.comment = { notes: function () { return state.notes.slice(); }, saveAbout: saveAbout, flushAbout: flushAbout, discardAbout: discardAbout, render: render, record: noteRecord, setPointing: setPointing, copy: copyText, captureScreenshot: captureScreenshot, refreshMarkers: scheduleMarkers };
  I.registerMode({ id: 'comment', label: 'Comment', render: render, activate: activate, deactivate: deactivate });
  events.on('comment:open', function (note) { if (note) composer(note, 24, 24); });
  events.on('notes:change', scheduleMarkers);
  events.on('adapter:change', function () { if (renderedRoot) render(); });
  events.on('shell:mounted', function () { ensureStyle(); ensureMarkerObserver(); scheduleMarkers(); });
  events.on('shell:destroy', function () { if (markerFrame) cancelFrame(markerFrame); markerFrame = 0; if (markerObserver) markerObserver.disconnect(); markerObserver = null; styleInstalled = false; outline = null; renderedRoot = null; win.removeEventListener('scroll', scheduleMarkers, true); win.removeEventListener('resize', scheduleMarkers); });
})();
