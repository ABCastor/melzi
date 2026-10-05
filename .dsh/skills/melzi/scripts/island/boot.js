/* Entry points and the backwards-compatible public reviewLayer facade. */
(function () {
  'use strict';

  var global = Island.global;
  var doc = Island.document;
  var installed = false;
  var enabled = false;

  function urlFlag() {
    var search = global.location && global.location.search || '';
    var hash = global.location && global.location.hash || '';
    return /(?:^|[?&])review(?:=|&|$)/i.test(search) || /(?:^#|[&#])review(?:=|&|$)/i.test(hash);
  }
  function mount() {
    var host = Island.shell.mount();
    Island.shell.open(true);
    enabled = true;
    Island.state.enabled = true;
    if (Island.memory && Island.memory.mount) Island.memory.mount();
    return host;
  }
  function setEnabled(next) {
    if (next) return mount();
    if (Island.state.mounted) {
      Island.events.emit('session:disable');
      Island.history.clear();
      Island.shell.destroy();
    }
    enabled = false;
    Island.state.enabled = false;
    return false;
  }
  function keydown(event) {
    if (!(event.metaKey || event.ctrlKey)) return;
    var key = String(event.key).toLowerCase();
    if (key === 'z' && Island.state.mounted && !Island.dom.isEditingEvent(event)) {
      event.preventDefault();
      var before = Island.history.state();
      var changed = event.shiftKey ? Island.history.redo() : Island.history.undo();
      var hadEntry = event.shiftKey ? before.redo > 0 : before.undo > 0;
      Island.shell.status(changed ? (event.shiftKey ? 'Redone' : 'Undone') : hadEntry ? (event.shiftKey ? 'Redo could not be applied' : 'Undo could not be applied') : (event.shiftKey ? 'Nothing to redo' : 'Nothing to undo'));
      return;
    }
    if (!event.shiftKey || key !== 'r') return;
    event.preventDefault(); setEnabled(!Island.state.mounted);
  }
  function routeChanged() {
    if (urlFlag() && !Island.state.mounted) mount();
  }
  function install() {
    if (!installed) {
      installed = true;
      doc.addEventListener('keydown', keydown, true);
      global.addEventListener('hashchange', routeChanged);
      global.addEventListener('popstate', routeChanged);
    }
    if (urlFlag()) mount();
    return publicApi;
  }
  function toggle(pointing) {
    mount();
    Island.shell.renderMode('comment');
    var current = !!Island.state.data.review.commentPointing;
    var next = pointing == null ? !current : !!pointing;
    if (Island.comment && Island.comment.setPointing) Island.comment.setPointing(next);
    return next;
  }
  function pins() {
    return Island.pins ? Island.pins() : (Island.state.data.pins || []).slice();
  }
  function clear() {
    return Island.pins && Island.pins.clear ? Island.pins.clear(true) : undefined;
  }
  function exportPins() {
    return Island.pins && Island.pins.export ? Island.pins.export() : JSON.stringify({ page: Island.state.page, pins: pins() }, null, 2);
  }
  function openInfo() {
    mount();
    Island.shell.renderMode('colour');
    return Island.tokens.discover();
  }
  function undo() { return Island.history.undo(); }
  function redo() { return Island.history.redo(); }
  function contentState() {
    return {
      enabled: enabled,
      mounted: Island.state.mounted,
      notes: pins(),
      design: {
        tokens: Island.state.data.overrides && Island.state.data.overrides.colors || {},
        faces: Island.state.data.overrides && Island.state.data.overrides.type || {},
        candidates: Island.state.data.candidates || [],
        chosen: Island.state.data.chosenCandidate || null,
        unresolved: Island.state.data.unresolved || []
      }
    };
  }

  var publicApi = {
    install: install,
    toggle: toggle,
    pins: pins,
    clear: clear,
    exportPins: exportPins,
    openInfo: openInfo,
    undo: undo,
    redo: redo,
    setAdapter: Island.setAdapter,
    _setAdapter: Island.setAdapter,
    _setEnabled: setEnabled,
    _getContentState: contentState,
    _state: Island.state
  };
  global.reviewLayer = publicApi;

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
