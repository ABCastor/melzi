/* Compare is a small judgement loop, not a second design studio. Candidates
 * only contain the snapshots the Colour and Type studios already understand. */
(function () {
  'use strict';

  var I = Island;
  var win = I.global;
  var doc = I.document;
  if (!doc) return;
  var dom = I.dom;
  var state = I.state;
  var root = null;
  var pageStage = null;
  var off = [];
  var EVIDENCE_FLOOR = 4;

  function clone(value) { return JSON.parse(JSON.stringify(value == null ? null : value)); }
  function now() { return new Date().toISOString(); }
  function compareData() {
    state.data.review = state.data.review || {};
    state.data.review.compare = state.data.review.compare || { active: 0, judgingIds: [], conventionalRevealed: false };
    state.data.candidates = Array.isArray(state.data.candidates) ? state.data.candidates : [];
    state.data.verdicts = Array.isArray(state.data.verdicts) ? state.data.verdicts : [];
    return state.data.review.compare;
  }
  function persist() { state.data = I.persist(); return state.data; }
  function candidates() { compareData(); return state.data.candidates; }
  function retired(item) { return !!(I.library && I.library.isRetired && I.library.isRetired(item)); }
  function filterRetired(entries) { return (entries || []).filter(function (entry) { return entry && !retired(entry); }); }
  function activeCandidates() { return filterRetired(candidates()); }
  function colourSnapshot() { return I.colour && I.colour.exportSnapshot ? clone(I.colour.exportSnapshot()) : { maps: {} }; }
  function typeSnapshot() { return clone(state.data.overrides && state.data.overrides.type || {}); }
  function tokenSnapshot() { return clone(state.data.overrides && state.data.overrides.colors || {}); }
  function snapshot() { return { colour: colourSnapshot(), type: typeSnapshot(), tokens: tokenSnapshot(), faces: typeSnapshot() }; }
  function changedOverride(item) {
    if (!item || typeof item !== 'object') return false;
    if (item.now !== undefined && JSON.stringify(item.now) !== JSON.stringify(item.was)) return true;
    return ['size', 'line_height', 'lineHeight', 'measure'].some(function (key) { return item[key] != null; }) || !!(item.axes && Object.keys(item.axes).length);
  }
  function hasMeaningfulOverrides() {
    var overrides = state.data.overrides || {}, colours = overrides.colors || {}, type = overrides.type || {};
    return Object.keys(colours).some(function (name) { return changedOverride(colours[name]); }) || Object.keys(type).some(function (role) { return changedOverride(type[role]); });
  }
  function facesAllowed(faces) {
    return Object.keys(faces || {}).every(function (role) {
      var face = faces[role] && (faces[role].now || faces[role]);
      return !face || (!retired(face) && (!I.library || !I.library.canApplyFace || I.library.canApplyFace(face)) && String(face.licence || face.license || 'web').toLowerCase() !== 'personal');
    });
  }
  function canKeep() {
    return hasMeaningfulOverrides() && (!I.type || !I.type.canKeep || I.type.canKeep()) && facesAllowed(typeSnapshot());
  }
  function nameFor() { return 'Candidate ' + (candidates().length + 1); }
  function modeSelection(entries, width, liveAB) {
    var count = (entries || activeCandidates()).length;
    var available = Number(width || (I.shell && I.shell.currentSize && I.shell.currentSize()) || win.innerWidth || 0);
    return count >= 2 && available >= 960 && !liveAB ? 'side-by-side' : count ? 'ab' : 'empty';
  }
  function candidateById(id) { return activeCandidates().filter(function (entry) { return entry.id === id; })[0] || null; }
  function startRound(entries, force) {
    var selected = (entries || activeCandidates()).map(function (candidate) { return candidate.id; });
    var current = compareData().round;
    if (!force && current && JSON.stringify(current.candidateIds || []) === JSON.stringify(selected)) return current;
    var round = { id: dom.id('round'), at: now(), candidateIds: selected };
    compareData().round = round; compareData().conventionalRevealed = false;
    return round;
  }
  function currentRound() { return compareData().round || startRound(activeCandidates()); }
  function keep(name, options) {
    options = options || {};
    if (!canKeep()) {
      I.events.emit('status:set', hasMeaningfulOverrides() ? 'This live set contains a retired or personal-use face and cannot be kept.' : 'Make a colour or type change before keeping a candidate.');
      return null;
    }
    var current = snapshot();
    var candidate = {
      id: dom.id('candidate'), name: String(name || nameFor()).trim() || nameFor(),
      snapshot: current, tokens: current.tokens, faces: current.faces,
      conventional: options.conventional === true, source: options.source || 'live',
      at: now(), reviewer: I.reviewer ? I.reviewer() : 'local'
    };
    candidates().push(candidate); startRound(activeCandidates()); persist(); I.events.emit('compare:change', { action: 'keep', candidate: clone(candidate) }); I.events.emit('status:set', candidate.name + ' kept for comparison.'); render();
    return clone(candidate);
  }
  function applyCandidate(candidate) {
    if (!candidate || retired(candidate) || !facesAllowed(candidate.faces || candidate.snapshot && candidate.snapshot.type)) return false;
    var saved = candidate.snapshot || { colour: candidate.colour || {}, type: candidate.faces || {} };
    if (I.colour && I.colour.restore) I.colour.restore(saved.colour || saved.colors || {});
    if (I.type && I.type.applySnapshot) I.type.applySnapshot(saved.type || candidate.faces || {});
    state.data.chosenCandidate = candidate.id; persist();
    I.events.emit('compare:change', { action: 'recall', candidate: clone(candidate) });
    return true;
  }
  function recall(id) {
    var candidate = typeof id === 'object' ? id : candidateById(id);
    if (!applyCandidate(candidate)) { I.events.emit('status:set', 'That candidate is unavailable or cannot be applied.'); return false; }
    var position = activeCandidates().indexOf(candidate); if (position >= 0) compareData().active = position;
    compareData().liveAB = true; removeStage(); persist();
    I.events.emit('status:set', candidate.name + ' is live on the page.'); render(); return true;
  }
  function edit(id) {
    var candidate = typeof id === 'object' ? id : candidateById(id);
    if (!recall(candidate)) return false;
    var studio = candidate.faces && Object.keys(candidate.faces).length ? 'type' : 'colour';
    win.setTimeout(function () { if (I.shell && I.shell.renderMode) I.shell.renderMode(studio); }, 0);
    return true;
  }
  function duplicate(id, name) {
    var original = typeof id === 'object' ? id : candidateById(id);
    if (!original) return null;
    var copy = clone(original); copy.id = dom.id('candidate'); copy.name = String(name || original.name + ' copy'); copy.at = now();
    delete copy.verdict; delete copy.previous; candidates().push(copy); startRound(activeCandidates()); persist(); I.events.emit('compare:change', { action: 'duplicate', candidate: clone(copy) }); I.events.emit('status:set', copy.name + ' duplicated.'); render(); return clone(copy);
  }
  function remove(id) {
    var candidate = typeof id === 'object' ? id : candidateById(id);
    if (!candidate) return false;
    state.data.candidates = candidates().filter(function (entry) { return entry.id !== candidate.id; });
    state.data.verdicts = (state.data.verdicts || []).filter(function (entry) { return entry.candidateId !== candidate.id; });
    if (state.data.chosenCandidate === candidate.id) state.data.chosenCandidate = null;
    compareData().judgingIds = (compareData().judgingIds || []).filter(function (entry) { return entry !== candidate.id; }); startRound(activeCandidates());
    persist(); I.events.emit('compare:change', { action: 'remove', candidate: clone(candidate) }); I.events.emit('status:set', candidate.name + ' deleted.'); render(); return true;
  }
  function latestVerdict(id) {
    return (state.data.verdicts || []).filter(function (entry) { return entry && entry.candidateId === id; }).sort(function (a, b) { return String(b.at || '').localeCompare(String(a.at || '')); })[0] || null;
  }
  function allJudged() {
    var round = currentRound();
    return round.candidateIds.length > 0 && round.candidateIds.every(function (id) {
      return (state.data.verdicts || []).some(function (entry) { return entry && entry.roundId === round.id && entry.candidateId === id; });
    });
  }
  function verdict(id, value, words, reviewer) {
    var candidate = typeof id === 'object' ? id : candidateById(id);
    value = String(value || '').toLowerCase();
    if (!candidate || ['love', 'like', 'no'].indexOf(value) < 0) return null;
    var previous = latestVerdict(candidate.id);
    var item = { id: dom.id('verdict'), roundId: currentRound().id, candidateId: candidate.id, name: candidate.name, verdict: value, words: String(words || '').trim(), reviewer: reviewer || (I.reviewer ? I.reviewer() : 'local'), at: now(), conventional: candidate.conventional === true };
    if (previous) item.previous = { verdict: previous.verdict, at: previous.at };
    state.data.verdicts.push(item); candidate.verdict = value; candidate.words = item.words; candidate.reviewer = item.reviewer; candidate.at = item.at;
    if (item.previous) candidate.previous = item.previous;
    if (allJudged()) compareData().conventionalRevealed = true;
    persist();
    if (I.memory && I.memory.recordVerdict) I.memory.recordVerdict(candidate, item);
    I.events.emit('compare:change', { action: 'verdict', candidate: clone(candidate), verdict: clone(item) }); I.events.emit('status:set', 'Recorded ' + value + ' for ' + candidate.name + '.'); render(); return clone(item);
  }
  function paletteSnapshot(palette) {
    var current = snapshot(), maps = current.colour.maps || (current.colour.maps = {}), theme = dom.theme ? dom.theme() : 'light';
    maps[theme] = maps[theme] || {};
    var roles = palette.roles || {}, names = { background: 'ground', ground: 'ground', surface: 'surface', ink: 'ink', muted: 'muted', accent: 'accent', line: 'line' };
    Object.keys(roles).forEach(function (name) { var role = names[name] || name; maps[theme][role] = { now: roles[name], role: role, space: 'srgb' }; });
    Object.keys(maps[theme]).forEach(function (role) { var name = '--review-' + role + '-' + theme; if (!current.tokens[name] && maps[theme][role] && maps[theme][role].now) current.tokens[name] = { was: null, now: maps[theme][role].now, role: role, space: 'srgb' }; });
    return current;
  }
  function compareAgainstConventional() {
    var active = I.colour && I.colour.availablePalettes ? I.colour.availablePalettes() : I.library && I.library.active('palettes') || [];
    var additions = filterRetired(active).slice(0, 2).map(function (palette) {
      var current = paletteSnapshot(palette);
      return { id: dom.id('candidate'), name: palette.name || 'Conventional option', snapshot: current, tokens: current.tokens, faces: current.faces, conventional: true, source: 'conventional', at: now(), reviewer: I.reviewer ? I.reviewer() : 'local' };
    }).filter(function (candidate) { return !candidates().some(function (existing) { return existing.source === 'conventional' && existing.name === candidate.name; }); });
    if (!additions.length) { I.events.emit('status:set', 'No new conventional options are available.'); return []; }
    Array.prototype.push.apply(candidates(), additions);
    compareData().judgingIds = activeCandidates().map(function (candidate) { return candidate.id; }); startRound(activeCandidates());
    persist(); I.events.emit('compare:change', { action: 'mixed', candidates: clone(additions) }); I.events.emit('status:set', 'Added ' + additions.length + ' conventional option' + (additions.length === 1 ? '' : 's') + ' to this round.'); render(); return clone(additions);
  }
  function valuesFor(candidate) {
    var output = [], maps = candidate && candidate.snapshot && candidate.snapshot.colour && candidate.snapshot.colour.maps || {};
    Object.keys(maps).forEach(function (theme) { Object.keys(maps[theme] || {}).forEach(function (role) { var item = maps[theme][role]; var rgb = I.colors && I.colors.parse(item && (item.now || item)); if (rgb) output.push({ role: role, lch: I.colors.srgbToOklch(rgb) }); }); });
    return output;
  }
  function tasteProfile() {
    var judged = (state.data.verdicts || []).filter(function (entry) { return entry && ['love', 'like', 'no'].indexOf(entry.verdict) >= 0 && candidateById(entry.candidateId); });
    if (judged.length < EVIDENCE_FLOOR) return { evidence: judged.length, floor: EVIDENCE_FLOOR, enough: false, statements: [] };
    var loved = judged.filter(function (entry) { return entry.verdict === 'love'; }), rejected = judged.filter(function (entry) { return entry.verdict === 'no'; }), lovedColours = [];
    loved.forEach(function (entry) { lovedColours = lovedColours.concat(valuesFor(candidateById(entry.candidateId))); });
    var statements = [];
    if (lovedColours.length) {
      var chroma = lovedColours.reduce(function (sum, entry) { return sum + entry.lch.c; }, 0) / lovedColours.length;
      statements.push('Across ' + judged.length + ' verdicts, loved candidates average ' + chroma.toFixed(2) + ' chroma.');
    }
    if (loved.length && rejected.length) statements.push('Across ' + judged.length + ' verdicts, you loved ' + loved.length + ' and rejected ' + rejected.length + ' candidate' + (rejected.length === 1 ? '' : 's') + '.');
    return { evidence: judged.length, floor: EVIDENCE_FLOOR, enough: true, statements: statements };
  }
  function cssValue(value) { return String(value == null ? '' : value).replace(/[{};<>]/g, ''); }
  function candidatePreviewCss(candidate) {
    var snapshot = candidate.snapshot || {}, tokens = candidate.tokens || snapshot.tokens || {}, colour = snapshot.colour || {}, maps = colour.maps || {}, type = snapshot.type || candidate.faces || {};
    var rules = [], values = [];
    Object.keys(tokens).forEach(function (name) {
      var item = tokens[name], value = item && (item.now != null ? item.now : item.value);
      if (/^--[A-Za-z0-9_-]+$/.test(name) && value != null) values.push(name + ':' + cssValue(value) + ' !important');
    });
    if (values.length) rules.push(':root{' + values.join(';') + '}');
    var selectedTheme = dom.theme ? dom.theme() : 'light', selectedMap = maps[selectedTheme] || maps[Object.keys(maps)[0]] || {};
    Object.keys(selectedMap).forEach(function (role) {
        var item = selectedMap[role], value = cssValue(item && (item.now || item));
        if (!value) return;
        if (item && item.source === 'token' && /^--[A-Za-z0-9_-]+$/.test(item.name || '')) rules.push(':root{' + item.name + ':' + value + ' !important}');
        var mapped = false;
        (item && item.usages || []).forEach(function (usage) {
          if (!usage || typeof usage.path !== 'string' || !usage.property) return;
          mapped = true; rules.push(usage.path + '{' + String(usage.property).replace(/[A-Z]/g, function (letter) { return '-' + letter.toLowerCase(); }) + ':' + value + ' !important}');
        });
        if (mapped) return;
        if (role === 'ground') rules.push('html,body{background-color:' + value + ' !important}');
        else if (role === 'surface') rules.push('main,section,article,aside,header,footer{background-color:' + value + ' !important}');
        else if (role === 'ink') rules.push('body,p,h1,h2,h3,h4,h5,h6,li,td,th,label{color:' + value + ' !important}');
        else if (role === 'muted') rules.push('small,figcaption,caption,[class*="muted"],[class*="secondary"]{color:' + value + ' !important}');
        else if (role === 'accent') rules.push('a,button,[role="button"]{color:' + value + ' !important}');
        else if (role === 'line') rules.push('hr,table,td,th{border-color:' + value + ' !important}');
    });
    var selectors = {
      display: 'h1,[data-display],[class*="display"]', heading: 'h2,h3,h4,h5,h6,[data-heading],[class*="heading"]',
      body: 'body,p,li,blockquote,figcaption,td,th,dd', interface: 'button,input,select,textarea,label,nav,a,[role="button"]', mono: 'pre,code,kbd,samp,[class*="mono"]'
    };
    Object.keys(type).forEach(function (role) {
      var item = type[role], face = item && (item.now || item), declarations = [];
      if (!selectors[role] || !face) return;
      if (face.stack || face.family) declarations.push('font-family:' + cssValue(face.stack || face.family) + ' !important');
      if (item.size) declarations.push('font-size:' + Number(item.size) + 'px !important');
      if (item.line_height) declarations.push('line-height:' + Number(item.line_height) + ' !important');
      if (item.measure && role === 'body') declarations.push('max-width:' + Number(item.measure) + 'ch !important');
      if (item.axes && Object.keys(item.axes).length) declarations.push('font-variation-settings:' + Object.keys(item.axes).map(function (tag) { return "'" + String(tag).replace(/[^A-Za-z0-9]/g, '') + "' " + Number(item.axes[tag]); }).join(',') + ' !important');
      if (declarations.length) rules.push(selectors[role] + '{' + declarations.join(';') + '}');
    });
    return rules.join('\n');
  }
  function liveTokenBaselines() {
    var original = state.data.review && state.data.review.colour && state.data.review.colour.originalInline || {};
    var baselines = {};
    Object.keys(original).forEach(function (name) { baselines[name] = original[name] || ''; });
    Object.keys(state.data.overrides && state.data.overrides.colors || {}).forEach(function (key) {
      var detail = state.data.overrides.colors[key], name = detail && detail.name || key;
      if (/^--[A-Za-z0-9_-]+$/.test(name) && !Object.prototype.hasOwnProperty.call(baselines, name)) baselines[name] = '';
    });
    return baselines;
  }
  function liveTokenNames() {
    return Object.keys(liveTokenBaselines());
  }
  function restoreCloneTokens(style) {
    var baselines = liveTokenBaselines();
    Object.keys(baselines).forEach(function (name) {
      if (baselines[name]) style.setProperty(name, baselines[name]);
      else style.removeProperty(name);
    });
  }
  function cloneDocument(candidate) {
    var page = doc.documentElement.cloneNode(true), head = page.querySelector('head');
    var nodes = page.querySelectorAll('script,review-island,[data-review-island-host],[data-review-island-style],[data-review-island-type-overrides],[data-review-island-simulation]');
    Array.prototype.forEach.call(nodes, function (node) { node.remove(); });
    restoreCloneTokens(page.style);
    Array.prototype.forEach.call(page.querySelectorAll('[data-review-island-type-role]'), function (node) { node.removeAttribute('data-review-island-type-role'); });
    if (!head) { head = doc.createElement('head'); page.insertBefore(head, page.firstChild); }
    var base = doc.createElement('base'); base.href = win.location.href; head.insertBefore(base, head.firstChild);
    var style = doc.createElement('style'); style.setAttribute('data-review-island-compare-preview', ''); style.textContent = candidatePreviewCss(candidate); head.appendChild(style);
    return '<!doctype html>\n' + page.outerHTML;
  }
  function removeStage() {
    if (pageStage && pageStage.remove) pageStage.remove();
    pageStage = null;
  }
  function preview(candidate, label) {
    var pane = dom.el('section', 'compare-page-pane'), viewport = dom.el('div', 'compare-page-viewport');
    var frame = dom.el('iframe', { sandbox: 'allow-same-origin', tabindex: '-1', 'aria-label': label + ': ' + candidate.name, title: label + ': ' + candidate.name });
    frame.srcdoc = cloneDocument(candidate); viewport.appendChild(frame); pane.appendChild(viewport);
    pane.appendChild(dom.el('span', { 'class': 'compare-page-label', text: label + ' · ' + candidate.name })); return pane;
  }
  function renderStage(entries) {
    removeStage();
    if (!state.shell || !state.shell.shadow || entries.length < 2) return;
    pageStage = dom.el('section', { 'class': 'compare-page-stage', 'aria-label': 'Side-by-side candidate previews' });
    pageStage.appendChild(preview(entries[0], 'A')); pageStage.appendChild(preview(entries[1], 'B'));
    state.shell.shadow.appendChild(pageStage);
  }
  function ensureStyle() {
    if (!state.shell || !state.shell.shadow || state.shell.shadow.querySelector('style[data-island-compare]')) return;
    var style = dom.el('style', { 'data-island-compare': '' });
    style.textContent = '.island-compare{display:grid;gap:9px}.compare-live,.compare-candidate{border:1px solid var(--rule);border-radius:5px;padding:8px;display:grid;gap:6px}.compare-live{border-color:color-mix(in oklab,var(--gold),transparent 55%)}.compare-row,.compare-actions,.compare-verdicts{display:flex;gap:5px;align-items:center;flex-wrap:wrap}.compare-actions button,.compare-verdicts button,.compare-live button,.compare-mixed{border:1px solid var(--rule);border-radius:4px;background:var(--graphite);color:var(--ink);padding:4px 6px}.compare-actions button:hover,.compare-verdicts button:hover,.compare-live button:hover,.compare-mixed:hover{border-color:var(--gold);color:var(--gold)}.compare-verdicts button[data-choice="love"]{color:var(--gold)}.compare-stage{display:grid;gap:7px}.compare-stage[data-mode="side-by-side"]{grid-template-columns:repeat(2,minmax(0,1fr))}.compare-stage[data-mode="ab"] .compare-candidate:not([data-active="true"]){display:none}.compare-candidate h3,.compare-candidate p{margin:0}.compare-candidate h3{font-size:12px}.compare-meta{color:var(--muted);font-size:10px}.compare-conventional{color:var(--gold);font-size:10px}.compare-profile{border-top:1px solid var(--rule);padding-top:7px}.compare-profile p{margin:5px 0 0;color:var(--muted);font-size:11px}.compare-previous{color:var(--muted);font-size:10px}.compare-empty{margin:0;color:var(--muted)}.compare-page-stage{position:fixed;inset:0;z-index:0;display:grid;grid-template-columns:1fr 1fr;gap:2px;padding:0;background:var(--lacquer);pointer-events:none}.compare-page-pane{position:relative;overflow:hidden;background:#fff}.compare-page-viewport{width:200%;height:200%;transform:scale(.5);transform-origin:top left}.compare-page-viewport iframe{display:block;width:100%;height:100%;border:0;background:#fff}.compare-page-label{position:absolute;top:12px;left:12px;border:1px solid oklch(100% 0 0 / .22);border-radius:4px;background:oklch(4% .004 95 / .92);color:var(--gold);padding:5px 7px;font:600 11px/1.2 Albert Sans,Avenir Next,Arial,sans-serif;box-shadow:0 4px 16px oklch(0% 0 0 / .45)}';
    state.shell.shadow.appendChild(style);
  }
  function priorText(candidate) {
    var prior = candidate.previous;
    if (!prior) return '';
    var drift = candidate.verdict && candidate.verdict !== prior.verdict ? ' Drift: ' + prior.verdict + ' to ' + candidate.verdict + '.' : '';
    return 'Previous: ' + prior.verdict + ' on ' + String(prior.at || '').slice(0, 10) + '.' + drift;
  }
  function hasVerdictDrift(candidate) { return !!(candidate && candidate.previous && candidate.verdict && candidate.previous.verdict !== candidate.verdict); }
  function keepWithPrompt() {
    if (!hasMeaningfulOverrides()) { I.events.emit('status:set', 'Make a colour or type change before keeping a candidate.'); return null; }
    var name = win.prompt ? win.prompt('Name this candidate', nameFor()) : nameFor();
    return name === null ? null : keep(name);
  }
  function promptVerdict(candidate, value) {
    var words = win.prompt ? win.prompt('Optional words about ' + candidate.name, '') : '';
    return verdict(candidate, value, words == null ? '' : words);
  }
  function candidateCard(candidate, selected) {
    var card = dom.el('article', { 'class': 'compare-candidate', 'data-active': String(selected) });
    card.appendChild(dom.el('h3', { text: candidate.name }));
    card.appendChild(dom.el('p', { 'class': 'compare-meta', text: candidate.source === 'live' ? 'Saved from live overrides.' : 'A complete colour and type set.' }));
    if (compareData().conventionalRevealed && candidate.conventional) card.appendChild(dom.el('p', { 'class': 'compare-conventional', text: 'Conventional option' }));
    var judgedThisRound = (state.data.verdicts || []).some(function (item) { return item && item.roundId === currentRound().id && item.candidateId === candidate.id; });
    var prior = judgedThisRound ? priorText(candidate) : ''; if (prior) card.appendChild(dom.el('p', { 'class': 'compare-previous', text: prior }));
    if (I.advice && judgedThisRound && hasVerdictDrift(candidate)) I.advice.append(card, 'compare.memory', { verdictDrift: true });
    var actions = dom.el('div', 'compare-actions');
    var view = dom.button('View on page', { title: 'Apply this candidate to the real page' }); view.addEventListener('click', function () { recall(candidate); }); actions.appendChild(view);
    var editButton = dom.button('Edit', { title: 'Apply this candidate, then open its studio' }); editButton.addEventListener('click', function () { edit(candidate); }); actions.appendChild(editButton);
    var copy = dom.button('Duplicate', { title: 'Duplicate this candidate' }); copy.addEventListener('click', function () { duplicate(candidate); }); actions.appendChild(copy);
    var removeButton = dom.button('Delete', { title: 'Delete this candidate' }); removeButton.addEventListener('click', function () { remove(candidate); }); actions.appendChild(removeButton); card.appendChild(actions);
    var judge = dom.el('div', 'compare-verdicts'); ['love', 'like', 'no'].forEach(function (value) { var control = dom.button(value, { 'data-choice': value, title: 'Record ' + value + ' for ' + candidate.name }); control.addEventListener('click', function () { promptVerdict(candidate, value); }); judge.appendChild(control); }); card.appendChild(judge);
    return card;
  }
  function render() {
    if (!root) return;
    ensureStyle(); removeStage(); root.textContent = '';
    var wrap = dom.el('section', 'island-compare'); wrap.setAttribute('aria-label', 'Compare candidates');
    var meaningful = hasMeaningfulOverrides(), live = dom.el('section', 'compare-live'); live.appendChild(dom.el('strong', { text: meaningful ? 'Live overrides · unsaved' : 'No live colour or type overrides' }));
    var save = dom.button('Keep', { title: meaningful ? 'Save the live colour and type set as a candidate, K' : 'Make a colour or type change before keeping a candidate', disabled: !meaningful }); save.addEventListener('click', keepWithPrompt); live.appendChild(save); wrap.appendChild(live);
    var entries = activeCandidates();
    if (!entries.length) wrap.appendChild(dom.el('p', { 'class': 'compare-empty', text: 'Keep the live set to compare it with another complete direction.' }));
    else {
      var settings = compareData(), selection = modeSelection(entries, null, settings.liveAB), previousMode = settings.mode; startRound(entries); settings.mode = selection;
      if (previousMode && previousMode !== selection) { persist(); I.events.emit('status:set', selection === 'side-by-side' ? 'Compare switched to side-by-side previews.' : 'Compare switched to live A/B.'); }
      var stage = dom.el('div', { 'class': 'compare-stage', 'data-mode': selection });
      var active = Math.max(0, Math.min(Number(settings.active) || 0, entries.length - 1)); settings.active = active;
      var visible = entries;
      visible.forEach(function (candidate, index) { stage.appendChild(candidateCard(candidate, selection === 'side-by-side' ? index === 0 : index === active)); }); wrap.appendChild(stage);
      if (selection === 'side-by-side') renderStage(entries); else removeStage();
      if (selection === 'ab') { var toggle = dom.button('Switch A/B', { title: 'Switch A/B, V' }); toggle.addEventListener('click', switchAB); wrap.appendChild(toggle); }
      if (selection === 'ab' && settings.liveAB && modeSelection(entries) === 'side-by-side') { var sideBySide = dom.button('Side by side', { title: 'Return to two full-layout page previews, S' }); sideBySide.addEventListener('click', function () { settings.liveAB = false; persist(); I.events.emit('status:set', 'Compare switched to side-by-side previews.'); render(); }); wrap.appendChild(sideBySide); }
      var mixed = dom.button('Compare against conventional options', { 'class': 'compare-mixed', title: 'Add named conventional options to this comparison' }); mixed.addEventListener('click', compareAgainstConventional); wrap.appendChild(mixed);
      if (I.advice && entries.some(function (candidate) { return candidate.conventional; })) I.advice.append(wrap, 'compare.mixed', { mixedSet: true });
    }
    var profile = tasteProfile();
    if (profile.enough) { var details = dom.el('details', 'compare-profile'); details.appendChild(dom.el('summary', { text: 'Profile' })); profile.statements.forEach(function (statement) { details.appendChild(dom.el('p', { text: statement })); }); wrap.appendChild(details); }
    root.appendChild(wrap);
  }
  function switchAB() {
    var entries = activeCandidates(); if (entries.length < 2) return false;
    var settings = compareData(); settings.active = ((Number(settings.active) || 0) + 1) % entries.length; settings.liveAB = true; removeStage();
    if (!recall(entries[settings.active])) return false;
    I.events.emit('status:set', 'A/B switched to ' + entries[settings.active].name + '.'); return true;
  }
  function recallAt(index) {
    var entries = activeCandidates(), candidate = entries[index];
    if (!candidate) return false;
    compareData().active = index; return recall(candidate);
  }
  function recordActive(value) {
    var entries = activeCandidates(), index = Math.max(0, Math.min(Number(compareData().active) || 0, entries.length - 1));
    return entries[index] ? promptVerdict(entries[index], value) : null;
  }
  function activate(container) {
    root = container; ensureStyle();
    var entries = activeCandidates(), width = Number((I.shell && I.shell.currentSize && I.shell.currentSize()) || win.innerWidth || 0);
    startRound(entries, true);
    if (entries.length && width < 960) { compareData().active = 0; recall(entries[0]); }
    else render();
    function keyboard(event) {
      if (dom.isEditingEvent(event) || event.metaKey || event.ctrlKey || event.altKey) return;
      var key = String(event.key).toLowerCase();
      if (key === 'v') { event.preventDefault(); switchAB(); }
      else if (key === 'k') { event.preventDefault(); keepWithPrompt(); }
      else if (key === 'a') { event.preventDefault(); recallAt(0); }
      else if (key === 'b') { event.preventDefault(); recallAt(1); }
      else if (key === 'l') { event.preventDefault(); recordActive('love'); }
      else if (key === 'i') { event.preventDefault(); recordActive('like'); }
      else if (key === 'n') { event.preventDefault(); recordActive('no'); }
      else if (key === 's' && activeCandidates().length > 1 && modeSelection(activeCandidates()) === 'side-by-side') {
        event.preventDefault(); compareData().liveAB = false; persist(); I.events.emit('status:set', 'Compare switched to side-by-side previews.'); render();
      }
    }
    win.addEventListener('keydown', keyboard, true); off.push(function () { win.removeEventListener('keydown', keyboard, true); });
    off.push(I.events.on('library:change', render)); off.push(I.events.on('size:change', render));
  }
  function deactivate() { removeStage(); off.forEach(function (stop) { stop(); }); off = []; root = null; }

  I.compare = { snapshots: function () { return clone(activeCandidates()); }, snapshot: snapshot, keep: keep, recall: recall, duplicate: duplicate, remove: remove, verdict: verdict, filterRetired: filterRetired, tasteProfile: tasteProfile, evidenceFloor: EVIDENCE_FLOOR, modeSelection: modeSelection, conventional: compareAgainstConventional, edit: edit, switchAB: switchAB, beginRound: function () { return clone(startRound(activeCandidates(), true)); }, roundComplete: allJudged, liveTokenNames: liveTokenNames, serializePreview: cloneDocument };
  I.registerMode({ id: 'compare', label: 'Compare', render: function (container) { root = container; render(); }, activate: activate, deactivate: deactivate });
  I.events.on('session:disable', removeStage);
})();
