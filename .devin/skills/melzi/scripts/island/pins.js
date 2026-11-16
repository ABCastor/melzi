/* Pins is the durable hand-off drawer. It intentionally reads state written by
 * every other mode rather than taking ownership of colour/type/compare state. */
(function () {
  'use strict';

  var I = Island;
  var win = typeof window !== 'undefined' ? window : null;
  var doc = win && win.document;
  if (!doc) return;
  var state = I.state || (I.state = {});
  var dom = I.dom || {};
  var events = I.events || { on: function () {}, off: function () {}, emit: function () {} };
  var el = dom.el || function (tag, className, text) { var node = doc.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = text; return node; };
  var button = dom.button || function (text, className) { var node = el('button', className, text); node.type = 'button'; return node; };
  var resolve = dom.resolve || function (note) { try { return note.path && doc.querySelector(note.path); } catch (ignore) { return null; } };
  var theme = dom.theme || function () { return doc.documentElement.getAttribute('data-theme') || 'light'; };
  function fallbackCopy(text) {
    var area = el('textarea'), copied = false;
    area.value = text; area.style.cssText = 'position:fixed;left:-9999px'; doc.body.appendChild(area); area.select();
    try { copied = doc.execCommand('copy') !== false; } catch (ignore) { copied = false; }
    area.remove(); return copied;
  }
  var copyText = function (text) {
    if (win.navigator && win.navigator.clipboard && win.navigator.clipboard.writeText) {
      return win.navigator.clipboard.writeText(text).then(function () { return true; }).catch(function () { return fallbackCopy(text); });
    }
    return Promise.resolve(fallbackCopy(text));
  };
  var storage = I.storage || {};
  var comment = I.comment || {};
  var page = (win.location && win.location.pathname) || '/';
  var data = state.data || (state.data = { pins: [], pageComment: '', overrides: {}, verdicts: [], candidates: [], review: {}, lookedAt: {} });
  data.review = data.review || {};
  data.lookedAt = data.lookedAt || {};
  data.lookedAt.sizes = Array.isArray(data.lookedAt.sizes) ? data.lookedAt.sizes : [];
  data.lookedAt.themes = Array.isArray(data.lookedAt.themes) ? data.lookedAt.themes : [];
  var root = null;

  state.notes = Array.isArray(data.pins) ? data.pins : [];
  state.pins = state.notes;
  data.review.goRecords = Array.isArray(data.review.goRecords) ? data.review.goRecords : [];
  function refreshData() {
    data = state.data || data; data.review = data.review || {}; data.lookedAt = data.lookedAt || {};
    data.lookedAt.sizes = Array.isArray(data.lookedAt.sizes) ? data.lookedAt.sizes : [];
    data.lookedAt.themes = Array.isArray(data.lookedAt.themes) ? data.lookedAt.themes : [];
    data.review.goRecords = Array.isArray(data.review.goRecords) ? data.review.goRecords : [];
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
    events.emit('change', { source: 'pins', state: state });
  }
  function record(note) {
    if (comment.record) return comment.record(note);
    return {
      id: note.id, page: page, path: note.path, text: note.text, x: note.x, y: note.y,
      width: note.width || note.size || 'full', size: note.width || note.size || 'full', theme: note.theme || theme(),
      note: note.note || '', kind: note.kind || 'Change', state: note.state || note.status || 'open',
      status: note.state || note.status || 'open', image: note.image || '', time: note.time, reviewer: note.reviewer || ''
    };
  }
  function currentEndpoint() { return (dom.endpoint && dom.endpoint()) || win.REVIEW_ENDPOINT || state.endpoint || ''; }
  function canPost() { return typeof win.fetch === 'function' && (dom.servable ? dom.servable() : !!currentEndpoint() && /^https?:/.test(currentEndpoint())); }
  function noteTime(note) { return String(note.time || ''); }
  function sortedNotes() { return state.notes.slice().sort(function (a, b) { return noteTime(b).localeCompare(noteTime(a)); }); }
  function displayNotes() {
    var notes = sortedNotes();
    if (data.pageComment) notes.unshift({
      id: data.review.pageCommentId || 'page', scope: 'page', note: data.pageComment, kind: 'Page', state: 'open',
      reviewer: data.review.pageCommentReviewer || reviewer(), time: data.review.pageCommentAt || ''
    });
    return notes;
  }
  function reviewer() {
    var stored = '';
    try { stored = win.localStorage.getItem('review.reviewer') || win.localStorage.getItem('REVIEW_REVIEWER') || ''; } catch (ignore) {}
    return I.reviewer ? I.reviewer() : state.reviewer || win.REVIEW_REVIEWER || stored || 'local';
  }
  function download(name, value) {
    try {
      var link = el('a'), url = URL.createObjectURL(new Blob([value], { type: 'application/json' }));
      link.href = url; link.download = name; link.click(); win.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      return true;
    } catch (ignore) { return false; }
  }
  function slug() { return page.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'index'; }
  function exportPins() {
    if (comment.flushAbout) comment.flushAbout();
    refreshData();
    var payload = { page: page, exported: new Date().toISOString(), about: data.pageComment || '', pins: sortedNotes().map(record) };
    var text = JSON.stringify(payload, null, 2); copyText(text); download('review-' + slug() + '.json', text); return text;
  }
  function clear(force) {
    refreshData();
    if (force === true || !win.confirm || win.confirm('Remove every review note on this page?')) {
      if (comment.discardAbout) comment.discardAbout();
      state.notes = []; state.pins = state.notes; data.pageComment = '';
      delete data.review.pageCommentAt; delete data.review.pageCommentReviewer;
      persist(); events.emit('notes:change', state.notes); render();
    }
  }
  function exactNote(note) {
    return {
      id: note.id || null, scope: 'element', kind: String(note.kind || 'change').toLowerCase(),
      state: note.state || note.status || 'open', text: note.note || '', image: note.image || '',
      path: note.path || null, text_hint: note.text || '', x: note.x == null ? null : note.x, y: note.y == null ? null : note.y,
      size: note.width || note.size || 'full', theme: note.theme || theme(), reviewer: note.reviewer || reviewer(), at: note.time || new Date().toISOString()
    };
  }
  function pageNote() {
    if (!data.pageComment) return null;
    return {
      id: data.review.pageCommentId || ('page-' + page.replace(/[^a-z0-9]/gi, '-')),
      scope: 'page', kind: 'change', state: 'open', text: data.pageComment, image: '', path: null, text_hint: '', x: null, y: null,
      size: null, theme: null, reviewer: data.review.pageCommentReviewer || reviewer(), at: data.review.pageCommentAt || new Date().toISOString()
    };
  }
  function addUnresolved(list, message) {
    if (message && list.indexOf(message) < 0) list.push(message);
  }
  function tokenDiffs(unresolved) {
    var overrides = data.overrides && data.overrides.colors || data.tokenOverrides || state.tokenDiffs || state.colorOverrides || {};
    var original = data.originalTokens || state.originalTokens || {};
    return Object.keys(overrides || {}).reduce(function (diffs, name) {
      var entry = overrides[name], detail = entry && typeof entry === 'object' && !Array.isArray(entry) ? entry : { now: entry };
      var was = detail.was !== undefined ? detail.was : detail.original !== undefined ? detail.original : original[name] !== undefined ? original[name] : null;
      var now = detail.now !== undefined ? detail.now : detail.value !== undefined ? detail.value : entry;
      if (was == null) addUnresolved(unresolved, 'Colour token ' + name + ' could not record the value it replaced.');
      if (now == null) addUnresolved(unresolved, 'Colour token ' + name + ' could not record the value it chose.');
      var exportName = detail.name || name;
      if (detail.theme) exportName += '-' + detail.theme;
      if (exportName.indexOf('--') !== 0) exportName = '--review-' + (detail.role || 'colour') + (detail.theme ? '-' + detail.theme : '');
      diffs[exportName] = {
        was: was, now: now,
        role: detail.role || '', space: detail.space || 'oklch'
      };
      if (detail.srgb != null) diffs[exportName + '-srgb'] = {
        was: detail.wasSrgb == null ? null : detail.wasSrgb, now: detail.srgb,
        role: detail.role || '', space: 'srgb'
      };
      return diffs;
    }, {});
  }
  function oklchText(value) {
    if (!value || typeof value !== 'object') return value;
    return 'oklch(' + Math.round(Number(value.l) * 10000) / 100 + '% ' + Math.round(Number(value.c) * 10000) / 10000 + ' ' + Math.round(Number(value.h) * 100) / 100 + (value.alpha < 1 ? ' / ' + Math.round(Number(value.alpha) * 1000) / 1000 : '') + ')';
  }
  function tokenExport(unresolved) {
    var diffs = tokenDiffs(unresolved);
    if (!I.colour || typeof I.colour.exportSnapshot !== 'function') return diffs;
    var snapshot = I.colour.exportSnapshot(), ramps = snapshot && snapshot.ramps || {}, maps = snapshot && snapshot.maps || {};
    Object.keys(maps).forEach(function (theme) {
      Object.keys(maps[theme] || {}).forEach(function (role) {
        var map = maps[theme][role] || {};
        var base = map.name || '--review-' + role;
        if (base.indexOf('--') !== 0) base = '--review-' + role;
        base += '-' + theme;
        diffs[base] = { was: map.wasOklch || map.was, now: map.oklch || map.now, role: role, space: 'oklch' };
        diffs[base + '-srgb'] = { was: map.wasSrgb == null ? map.was : map.wasSrgb, now: map.srgb == null ? map.now : map.srgb, role: role, space: 'srgb' };
        if (map.source !== 'token') addUnresolved(unresolved, 'Synthetic colour token ' + base + ' used this selector/property map: ' + JSON.stringify(Array.isArray(map.usages) ? map.usages : []) + '.');
        (ramps[theme][role] || []).forEach(function (step, index) {
          var name = base + '-' + String(index + 1).padStart(2, '0');
          diffs[name] = { was: null, now: oklchText(step.oklch), role: role, space: 'oklch' };
          diffs[name + '-srgb'] = { was: null, now: step.srgb || step.hex, role: role, space: 'srgb' };
        });
      });
    });
    return diffs;
  }
  function verdicts() {
    var list = data.verdicts || state.verdicts || (state.compare && state.compare.verdicts) || state.candidateVerdicts || [];
    return Array.isArray(list) ? list.map(function (verdict) {
      return verdict && verdict.reviewer ? verdict : Object.assign({}, verdict, { reviewer: reviewer() });
    }) : [];
  }
  function chosenCandidate() { return data.chosenCandidate || state.chosenCandidate || (state.compare && state.compare.chosenCandidate) || state.candidate || null; }
  function faceDiffs(unresolved) {
    var overrides = data.overrides && data.overrides.type || data.faceOverrides || state.faceOverrides || {};
    return Object.keys(overrides || {}).reduce(function (diffs, role) {
      var entry = overrides[role] || {}, hasWas = entry.was !== undefined || entry.original !== undefined;
      var hasNow = entry.now !== undefined || entry.value !== undefined || entry.family !== undefined || entry.stack !== undefined;
      var previous = entry.was || entry.original || {};
      var next = entry.now || entry.value || entry;
      if (!hasWas) addUnresolved(unresolved, 'Type role ' + role + ' could not record the face it replaced.');
      if (!hasNow) addUnresolved(unresolved, 'Type role ' + role + ' could not record the face it chose.');
      diffs[role] = {
        was: { family: previous.family || '', stack: previous.stack || '' },
        now: { family: next.family || '', stack: next.stack || '', source: next.source || '', licence: next.licence || next.license || '' },
        size: entry.size || null, line_height: entry.line_height || entry.lineHeight || null, measure: entry.measure || null, axes: entry.axes || {}
      };
      return diffs;
    }, {});
  }
  function exactCandidates(allVerdicts, unresolved) {
    var entries = Array.isArray(data.candidates) ? data.candidates : [], usedVerdicts = [];
    var output = entries.reduce(function (output, candidate) {
      var faces = candidate.faces || {}, blocked = Object.keys(faces).some(function (role) {
        var face = faces[role] && (faces[role].now || faces[role]);
        return face && (face.licence === 'personal' || face.license === 'personal' || (I.library && !I.library.canApplyFace(face)));
      });
      if (blocked) { unresolved.push('Candidate ' + (candidate.name || candidate.id || 'unnamed') + ' uses a face that is not licensed for web hand-off.'); return output; }
      var matches = allVerdicts.filter(function (item) { return item && (item.candidateId === candidate.id || item.id === candidate.id); });
      if (!matches.length && ['love', 'like', 'no'].indexOf(candidate.verdict) >= 0) matches = [candidate];
      if (!matches.length) {
        addUnresolved(unresolved, 'Candidate ' + (candidate.name || candidate.id || 'unnamed') + ' has no verdict and was omitted from candidate judgements.');
        return output;
      }
      matches = matches.filter(function (verdict) { return ['love', 'like', 'no'].indexOf(verdict.verdict) >= 0; })
        .sort(function (left, right) { return String(left.at || left.time || '').localeCompare(String(right.at || right.time || '')); });
      if (!matches.length) return output;
      matches.forEach(function (verdict) { if (verdict !== candidate) usedVerdicts.push(verdict); });
      var verdict = matches[matches.length - 1], prior = verdict.previous;
      if (!prior && matches.length > 1) {
        var earlier = matches[matches.length - 2]; prior = { verdict: earlier.verdict, at: earlier.at || earlier.time || null };
      }
      output.push({
        id: candidate.id || null, name: candidate.name || '', tokens: candidate.tokens || {}, faces: faces,
        verdict: verdict.verdict, conventional: candidate.conventional === true,
        at: verdict.at || verdict.time || candidate.at || null,
        previous: prior ? { verdict: prior.verdict, at: prior.at || null } : null
      });
      return output;
    }, []);
    allVerdicts.forEach(function (verdict) {
      if (!verdict || usedVerdicts.indexOf(verdict) >= 0 || ['love', 'like', 'no'].indexOf(verdict.verdict) < 0) return;
      addUnresolved(unresolved, 'Verdict for unavailable candidate ' + (verdict.candidateId || verdict.id || 'unknown') + ' was omitted.');
    });
    return output;
  }
  function rememberContext() {
    var size = I.shell && I.shell.currentSize ? I.shell.currentSize() : Math.max(1, Math.round(win.innerWidth || 1)), currentTheme = theme();
    if (data.lookedAt.sizes.indexOf(size) < 0) data.lookedAt.sizes.push(size);
    if (data.lookedAt.themes.indexOf(currentTheme) < 0) data.lookedAt.themes.push(currentTheme);
  }
  function reviewerGroups(notes) {
    return notes.reduce(function (groups, note) {
      var name = note.reviewer || 'local'; (groups[name] || (groups[name] = [])).push(note); return groups;
    }, {});
  }
  function goRecord() {
    if (comment.flushAbout) comment.flushAbout();
    refreshData();
    rememberContext();
    var noteEntries = sortedNotes().map(exactNote), about = pageNote(), allVerdicts = verdicts(), unresolved = (data.unresolved || state.unresolved || []).slice();
    if (about) noteEntries.unshift(about);
    var candidates = exactCandidates(allVerdicts, unresolved), chosen = chosenCandidate(), chosenId = chosen && (chosen.id || chosen);
    if (chosenId && !candidates.some(function (candidate) { return candidate.id === chosenId; })) {
      addUnresolved(unresolved, 'Chosen candidate ' + chosenId + ' is unavailable for hand-off.'); chosenId = null;
    }
    return {
      version: 1, page: page, at: new Date().toISOString(), reviewer: reviewer(),
      sizes: data.lookedAt.sizes.map(Number).filter(function (size, index, all) { return size > 0 && all.indexOf(size) === index; }),
      themes: data.lookedAt.themes.slice(), notes: noteEntries, tokens: tokenExport(unresolved), faces: faceDiffs(unresolved),
      candidates: candidates, chosen: chosenId || null, unresolved: unresolved
    };
  }
  function plainPreview(recordData) {
    function shown(value) { return value == null ? 'null' : typeof value === 'string' ? JSON.stringify(value) : JSON.stringify(value); }
    var lines = [
      'Record version: ' + recordData.version + '.',
      'Page: ' + recordData.page + '.',
      'Prepared at ' + recordData.at + ' by ' + recordData.reviewer + '.',
      'This hand-off covers ' + (recordData.notes.length ? recordData.notes.length + ' note' + (recordData.notes.length === 1 ? '' : 's') : 'no notes') + '.'
    ];
    var groups = reviewerGroups(recordData.notes);
    Object.keys(groups).forEach(function (name) {
      lines.push(name + ': ' + groups[name].length + ' note' + (groups[name].length === 1 ? '' : 's') + '.');
      groups[name].forEach(function (note) {
        var context = note.scope === 'page' ? 'page' : (note.size || 'full') + ', ' + (note.theme || 'theme unknown');
        lines.push('Note ' + shown(note.id) + ': ' + note.kind + ', ' + note.state + ', ' + context + ': ' + (note.text || '(image only)') + (note.image ? ' [image attached]' : ''));
        lines.push('  scope ' + note.scope + '; path ' + shown(note.path) + '; text hint ' + shown(note.text_hint) + '; point ' + shown(note.x) + ', ' + shown(note.y) + '; image ' + shown(note.image) + '; reviewer ' + shown(note.reviewer) + '; at ' + shown(note.at) + '.');
      });
    });
    var tokenCount = Object.keys(recordData.tokens).length, faceCount = Object.keys(recordData.faces).length;
    if (tokenCount) {
      lines.push(tokenCount + ' colour token change' + (tokenCount === 1 ? '' : 's') + ':');
      Object.keys(recordData.tokens).forEach(function (name) { var token = recordData.tokens[name]; lines.push(name + ' (' + (token.role || 'unassigned') + ', ' + (token.space || 'unknown space') + '): ' + shown(token.was) + ' -> ' + shown(token.now)); });
    }
    if (faceCount) {
      lines.push(faceCount + ' type change' + (faceCount === 1 ? '' : 's') + ':');
      Object.keys(recordData.faces).forEach(function (role) {
        var face = recordData.faces[role];
        lines.push(role + ': was ' + shown(face.was) + '; now ' + shown(face.now) + '.');
        lines.push('  size ' + String(face.size) + '; line-height ' + String(face.line_height) + '; measure ' + String(face.measure) + '; axes ' + JSON.stringify(face.axes || {}) + '.');
      });
    }
    if (recordData.candidates.length) {
      lines.push(recordData.candidates.length + ' candidate judgement' + (recordData.candidates.length === 1 ? '' : 's') + ':');
      recordData.candidates.forEach(function (candidate) {
        lines.push('Candidate ' + shown(candidate.id) + ', ' + shown(candidate.name) + ': ' + (candidate.verdict || 'not judged') + ' by ' + (candidate.reviewer || recordData.reviewer) + (candidate.conventional ? ' [conventional option]' : '') + '; at ' + shown(candidate.at) + '; previous ' + shown(candidate.previous) + '.');
        lines.push('  tokens ' + shown(candidate.tokens || {}) + '; faces ' + shown(candidate.faces || {}) + '.');
      });
    }
    lines.push('Chosen candidate: ' + shown(recordData.chosen) + '.');
    if (recordData.unresolved.length) recordData.unresolved.forEach(function (item) { lines.push('Unresolved: ' + item); });
    else lines.push('Unresolved: none.');
    lines.push('Looked at ' + (recordData.sizes.length ? recordData.sizes.join(', ') : 'the current size') + ' in ' + (recordData.themes.length ? recordData.themes.join(', ') : 'the current theme') + '.');
    return lines.join('\n');
  }
  function handoff(previewedRecord) {
    refreshData();
    var recordData = previewedRecord || goRecord(), text = JSON.stringify(recordData, null, 2);
    state.data.review.goRecords.push(recordData); persist(); events.emit('go:saved', recordData);
    if (canPost()) {
      var target = I.memory && I.memory.goUrl ? I.memory.goUrl(currentEndpoint()) : currentEndpoint();
      return win.fetch(target, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: text })
        .then(function (response) { if (!response.ok) throw new Error('Review server returned ' + response.status); return { record: recordData, posted: true, text: text }; })
        .catch(function () {
          var downloaded = download('review-go-' + slug() + '.json', text);
          return copyText(text).then(function (copied) {
            var message = copied && downloaded ? 'The server failed. The record was copied and a download started.' : copied ? 'The server failed. The record was copied, but download could not start.' : downloaded ? 'The server failed. A download started, but the clipboard was unavailable.' : 'The server, clipboard, and download were unavailable. The record remains in this browser.';
            events.emit('status:set', message);
            return { record: recordData, posted: false, copied: copied, downloaded: downloaded, text: text };
          });
        });
    }
    var downloaded = download('review-go-' + slug() + '.json', text);
    return copyText(text).then(function (copied) { return { record: recordData, posted: false, copied: copied, downloaded: downloaded, text: text }; });
  }
  function showGo() {
    var previous = state.shell && state.shell.shadow && state.shell.shadow.querySelector('.island-go-preview'); if (previous) previous.remove();
    var data = goRecord(), text = plainPreview(data);
    var returnFocus = state.shell && state.shell.shadow && state.shell.shadow.activeElement || doc.activeElement;
    var dialog = el('section', 'island-go-preview'); dialog.setAttribute('data-review-island', ''); dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-label', 'Review hand-off');
    function closeDialog() { dialog.remove(); if (returnFocus && returnFocus.focus) returnFocus.focus(); }
    dialog.appendChild(el('h2', '', 'Ready to hand over'));
    var preview = el('pre', 'island-go-words'); preview.textContent = text; dialog.appendChild(preview);
    var actions = el('div', 'island-go-actions'), cancel = button('Cancel'), confirm = button('Go', 'island-go-confirm');
    cancel.addEventListener('click', closeDialog);
    confirm.addEventListener('click', function () {
      confirm.disabled = true; confirm.textContent = 'Writing…';
      handoff(data).then(function (result) {
        confirm.textContent = result.posted ? 'Sent' : result.copied && result.downloaded ? 'Copied; download started' : result.copied ? 'Copied' : result.downloaded ? 'Download started' : 'Saved locally';
        win.setTimeout(closeDialog, 750);
      });
    });
    actions.appendChild(cancel); actions.appendChild(confirm); dialog.appendChild(actions); (state.shell && state.shell.shadow || doc.body).appendChild(dialog); confirm.focus();
    dialog.addEventListener('keydown', function (event) {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); closeDialog(); return; }
      if (event.key !== 'Tab') return;
      var controls = Array.prototype.slice.call(dialog.querySelectorAll('button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'));
      if (!controls.length) return;
      var first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && (doc.activeElement === first || state.shell && state.shell.shadow.activeElement === first)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (doc.activeElement === last || state.shell && state.shell.shadow.activeElement === last)) { event.preventDefault(); first.focus(); }
    });
    return data;
  }
  function scrollTo(note) {
    if (note.scope === 'page') {
      if (I.shell) I.shell.renderMode('comment');
      var area = state.shell && state.shell.shadow && state.shell.shadow.querySelector('.island-about-text'); if (area) area.focus();
      return;
    }
    var target = resolve(note);
    if (target && target.scrollIntoView) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    else if (win.alert) win.alert('This note lost its place on the page.');
  }
  function render(target) {
    refreshData();
    if (target) root = target;
    if (!root) return;
    root.textContent = '';
    var total = state.notes.length + (data.pageComment ? 1 : 0);
    var head = el('div', 'island-pins-head'); head.appendChild(el('strong', '', total ? total + (total === 1 ? ' note' : ' notes') : 'Add a page comment or point at an element to start a review.'));
    var exportButton = button('Export'); exportButton.title = 'E: export notes'; exportButton.addEventListener('click', exportPins); head.appendChild(exportButton);
    var clearButton = button('Clear'); clearButton.title = 'Delete: clear notes'; clearButton.disabled = !total; clearButton.addEventListener('click', clear); head.appendChild(clearButton);
    root.appendChild(head);
    var list = el('ol', 'island-pins-list'), visibleNotes = displayNotes();
    var stateFilter = data.review.pinStateFilter || 'all', reviewerFilter = data.review.pinReviewerFilter || 'all';
    if (visibleNotes.length) {
      var filters = el('div', 'island-pins-filters'), filterState = doc.createElement('select'), filterReviewer = doc.createElement('select');
      filterState.title = 'Filter note state'; filterReviewer.title = 'Filter reviewer';
      [['all', 'All states'], ['open', 'Open'], ['done', 'Done']].forEach(function (pair) { var option = el('option', '', pair[1]); option.value = pair[0]; option.selected = stateFilter === pair[0]; filterState.appendChild(option); });
      var reviewers = Object.keys(reviewerGroups(visibleNotes));
      [['all', 'All reviewers']].concat(reviewers.map(function (name) { return [name, name]; })).forEach(function (pair) { var option = el('option', '', pair[1]); option.value = pair[0]; option.selected = reviewerFilter === pair[0]; filterReviewer.appendChild(option); });
      function applyFilters() { data.review.pinStateFilter = filterState.value; data.review.pinReviewerFilter = filterReviewer.value; persist(); render(); }
      filterState.addEventListener('change', applyFilters); filterReviewer.addEventListener('change', applyFilters); filters.appendChild(filterState); filters.appendChild(filterReviewer); root.appendChild(filters);
    }
    visibleNotes.filter(function (note) { return (stateFilter === 'all' || (note.state || note.status || 'open') === stateFilter) && (reviewerFilter === 'all' || (note.reviewer || 'local') === reviewerFilter); }).forEach(function (note) {
      var item = el('li', 'island-pin-row');
      item.appendChild(el('span', 'island-note-kind', note.kind || 'Change'));
      item.appendChild(el('span', 'island-note-copy', note.note || '(image only)'));
      item.appendChild(el('small', '', note.scope === 'page' ? 'page · ' + (note.reviewer || 'local') : (note.state || note.status || 'open') + (resolve(note) ? '' : ' · lost its place')));
      item.tabIndex = 0; item.setAttribute('role', 'button');
      item.addEventListener('click', function () { scrollTo(note); });
      item.addEventListener('keydown', function (event) { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); scrollTo(note); } }); list.appendChild(item);
    });
    root.appendChild(list);
  }
  function keydown(event) {
    if ((dom.isEditingEvent && dom.isEditingEvent(event)) || event.metaKey || event.ctrlKey || event.altKey) return;
    if (String(event.key).toLowerCase() === 'e') { event.preventDefault(); exportPins(); }
    if (event.key === 'Delete') { event.preventDefault(); clear(); }
  }
  function activate() { refreshData(); doc.addEventListener('keydown', keydown, true); render(); }
  function deactivate() { doc.removeEventListener('keydown', keydown, true); }

  // Keep the old function-shaped API, with the new operations available on it.
  function pins() { return state.notes.slice(); }
  pins.record = record; pins.recordGo = goRecord; pins.previewText = plainPreview; pins.export = exportPins; pins.clear = clear; pins.go = showGo; pins.handoff = handoff;
  I.pins = pins;
  I.go = showGo;
  I.registerMode({ id: 'pins', label: 'Pins', render: render, activate: activate, deactivate: deactivate });
  events.on('go', showGo);
  events.on('size:change', function (size) { if (data.lookedAt.sizes.indexOf(size) < 0) { data.lookedAt.sizes.push(size); persist(); } });
  events.on('theme:change', function (nextTheme) { if (data.lookedAt.themes.indexOf(nextTheme) < 0) { data.lookedAt.themes.push(nextTheme); persist(); } });
  events.on('notes:change', function () { render(); });
  events.on('pins:open', showGo);
})();
