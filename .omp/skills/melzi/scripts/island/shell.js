/* The Review Island shell. It only mounts when boot calls Island.shell.mount(). */
(function () {
  'use strict';

  var global = Island.global;
  var doc = Island.document;
  var dom = Island.dom;
  var MODE_ORDER = [
    ['comment', 'Comment'], ['colour', 'Colour'], ['type', 'Type'], ['compare', 'Compare'], ['pins', 'Pins']
  ];
  var refs = {};
  var active = null;
  var previewRestore = null;
  var subscriptions = [];
  var viewportFrame = 0;

  function markSvg(size) {
    return '<svg width="' + (size || 18) + '" height="' + (size || 18) + '" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M5 2.5 L13.5 2.5 L5.5 21.5 L5 21.5 Q2.5 21.5 2.5 19 L2.5 5 Q2.5 2.5 5 2.5 Z"/><path d="M16.5 2.5 L19 2.5 Q21.5 2.5 21.5 5 L21.5 19 Q21.5 21.5 19 21.5 L8.5 21.5 Z"/></svg>';
  }
  function css() {
    return ':host{all:initial;color-scheme:dark;--lacquer:oklch(4% .004 95);--raised:oklch(11% .006 95);--graphite:oklch(19% .008 95);--ink:oklch(88% 0 0);--muted:oklch(62% 0 0);--rule:oklch(92% 0 0 / .13);--gold:oklch(84% .19 80.46)}*{box-sizing:border-box}.island{font:12px/1.4 Albert Sans,Avenir Next,Helvetica Neue,Arial,system-ui,sans-serif;color:var(--ink);pointer-events:auto;position:fixed;z-index:2147483004;bottom:12px;right:12px;max-width:calc(100vw - 24px)}button,textarea,select,input{font:inherit}button{cursor:pointer}button:focus-visible,textarea:focus-visible,select:focus-visible,input:focus-visible,summary:focus-visible,.header:focus-visible,.resize:focus-visible,[tabindex]:focus-visible{outline:2px solid var(--gold);outline-offset:2px}.tab,.panel{background:var(--lacquer);border:1px solid var(--rule);border-radius:8px;box-shadow:0 16px 36px -12px oklch(0% 0 0 / .6)}.tab{margin-left:auto;color:var(--ink);display:flex;align-items:center;gap:7px;padding:7px 9px}.tab .mark{color:var(--gold);display:flex}.tab:hover{color:var(--gold)}.panel{position:relative;width:min(var(--panel-width,420px),calc(100vw - 24px));min-width:280px;max-height:min(70vh,620px);overflow:hidden}.island[data-open="false"] .panel{display:none}.island[data-open="true"] .tab{display:none}.header{display:flex;align-items:center;gap:6px;padding:7px 8px 6px;border-bottom:1px solid var(--rule);cursor:grab;user-select:none}.modes{display:flex;gap:2px;min-width:0;overflow:auto;flex:1 1 auto}.mode,.go{border:0;border-radius:5px;background:transparent;color:var(--muted);padding:5px 6px;white-space:nowrap}.mode{flex:0 0 auto}.mode:hover,.mode:focus-visible{color:var(--ink);background:var(--graphite)}.mode[aria-selected="true"]{background:oklch(27% 0 0);color:var(--gold)}.go{flex:0 0 auto;background:var(--gold);color:oklch(4% .004 95);font-weight:700}.go:hover,.go:focus-visible{background:oklch(86% .07 84)}.body{min-height:112px;max-height:min(54vh,470px);overflow:auto;padding:12px}.placeholder{margin:0;color:var(--muted);line-height:1.5}.status{display:flex;align-items:center;gap:5px;min-height:29px;border-top:1px solid var(--rule);padding:4px 8px;color:var(--muted);font:500 10px/1.2 SFMono-Regular,Roboto Mono,Consolas,monospace;letter-spacing:.04em}.status-message{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}.sizes{display:flex;gap:2px}.status button{border:0;border-radius:4px;padding:3px 5px;background:transparent;color:var(--muted)}.status button:hover,.status button:focus-visible,.status button[aria-pressed="true"]{background:var(--graphite);color:var(--gold)}.resize{position:absolute;top:0;bottom:0;width:8px;cursor:ew-resize}.island[data-dock="right"] .resize{left:-4px}.island[data-dock="left"] .resize{right:-4px}.panel:focus{outline:none}@media(max-width:520px){.island{left:8px!important;right:8px!important;bottom:8px}.panel{width:calc(100vw - 16px);min-width:0}.resize{display:none}.mode{padding-inline:5px}.status-message{display:none}}';
  }
  function modeDefinition(id, label) {
    var registered = Island.getMode(id);
    if (registered) return registered;
    if (id === 'comment') return {
      id: id,
      label: label,
      render: function (container) {
        var box = dom.el('textarea', { placeholder: 'About this page', 'aria-label': 'About this page', rows: '4', title: 'About this page, Enter saves' });
        box.value = Island.state.data.pageComment || '';
        box.addEventListener('keydown', function (event) {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault(); Island.state.data.pageComment = box.value.trim(); Island.persist(); Island.events.emit('comment:save', Island.state.data.pageComment);
          }
        });
        var point = dom.button('Point at something', { title: 'Point at something, P' });
        point.addEventListener('click', function () { Island.events.emit('point:toggle'); });
        container.appendChild(box); container.appendChild(point);
      }
    };
    return {
      id: id,
      label: label,
      render: function (container) {
        container.appendChild(dom.el('p', 'placeholder', label + ' is not available in this build yet. Choose another mode or return when it is installed.'));
      }
    };
  }
  function effectiveWidth() {
    var requested = Number(Island.state.data.review.size) || 0;
    var rendered = 0;
    try { rendered = doc.documentElement.getBoundingClientRect().width; } catch (_) {}
    return Math.max(1, Math.round(rendered || (requested ? Math.min(requested, global.innerWidth) : global.innerWidth)));
  }
  function recordViewed() {
    var data = Island.state.data;
    var size = effectiveWidth();
    if (data.lookedAt.sizes.indexOf(size) < 0) data.lookedAt.sizes.push(size);
    var theme = dom.theme();
    if (data.lookedAt.themes.indexOf(theme) < 0) data.lookedAt.themes.push(theme);
  }
  function recordResize() {
    viewportFrame = 0; recordViewed(); Island.persist(); Island.events.emit('size:change', effectiveWidth());
  }
  function scheduleResizeRecord() {
    if (viewportFrame) return;
    var request = global.requestAnimationFrame || function (callback) { return global.setTimeout(callback, 16); };
    viewportFrame = request(recordResize);
  }
  function status(text) { if (refs.statusMessage) refs.statusMessage.textContent = text || ''; }
  function setDock(dock, preservePosition) {
    dock = dock === 'left' ? 'left' : 'right';
    Island.state.data.review.dock = dock;
    if (!preservePosition) Island.state.data.review.position = null;
    if (!refs.root) return;
    refs.root.dataset.dock = dock;
    refs.root.style.left = dock === 'left' ? '12px' : 'auto';
    refs.root.style.right = dock === 'right' ? '12px' : 'auto';
    if (!preservePosition) { refs.root.style.top = 'auto'; refs.root.style.bottom = '12px'; }
    Island.persist();
    if (!preservePosition) status('Docked to the ' + dock + '.');
  }
  function setWidth(width, announce) {
    var value = Math.max(280, Math.min(Math.round(width), Math.max(280, global.innerWidth - 24)));
    Island.state.data.review.width = value;
    if (refs.root) refs.root.style.setProperty('--panel-width', value + 'px');
    if (refs.resize) {
      refs.resize.setAttribute('aria-valuenow', String(value));
      refs.resize.setAttribute('aria-valuemax', String(Math.max(280, global.innerWidth - 24)));
    }
    Island.persist();
    if (announce) status('Panel width ' + value + 'px.');
  }
  function restorePreview() {
    if (!previewRestore) return;
    var root = doc.documentElement;
    root.style.maxWidth = previewRestore.maxWidth;
    root.style.marginInline = previewRestore.marginInline;
    previewRestore = null;
  }
  function setSize(size) {
    size = Number(size) || 0;
    restorePreview();
    if (size) {
      var root = doc.documentElement;
      previewRestore = { maxWidth: root.style.maxWidth, marginInline: root.style.marginInline };
      root.style.maxWidth = size + 'px';
      root.style.marginInline = 'auto';
    }
    Island.state.data.review.size = size;
    if (refs.sizes) Array.prototype.forEach.call(refs.sizes.children, function (control) { control.setAttribute('aria-pressed', String(Number(control.dataset.size) === size)); });
    recordViewed();
    Island.persist();
    Island.events.emit('size:change', effectiveWidth());
    status(size ? 'Canvas constrained to ' + effectiveWidth() + 'px. Media queries still use the window width.' : 'Full window width.');
  }
  function renderMode(modeId) {
    var requested = MODE_ORDER.filter(function (pair) { return pair[0] === modeId; })[0] || MODE_ORDER[0];
    var mode = modeDefinition(requested[0], requested[1]);
    if (active && typeof active.deactivate === 'function') active.deactivate(refs.body);
    active = mode;
    Island.state.activeMode = mode.id;
    Island.state.data.review.mode = mode.id;
    refs.body.textContent = '';
    mode.render(refs.body, Island);
    if (typeof mode.activate === 'function') mode.activate(refs.body, Island);
    Array.prototype.forEach.call(refs.modeRow.children, function (button) { var selected = button.dataset.mode === mode.id; button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1; });
    refs.body.setAttribute('aria-labelledby', 'review-island-tab-' + mode.id);
    recordViewed();
    Island.persist();
    status(mode.id === 'comment' ? '' : mode.label + ' mode selected.');
  }
  function open(opened) {
    if (!refs.root) return;
    if (!opened && active && typeof active.deactivate === 'function') { active.deactivate(refs.body, Island); active = null; }
    refs.root.dataset.open = String(opened);
    refs.tab.setAttribute('aria-expanded', String(opened));
    Island.state.data.review.open = !!opened;
    if (opened) {
      recordViewed(); renderMode(Island.state.activeMode || 'comment');
      global.setTimeout(function () {
        var first = refs.body && refs.body.querySelector('textarea,button,select,input,[tabindex]:not([tabindex="-1"])');
        if (first && first.focus) first.focus();
      }, 0);
    } else if (refs.tab && refs.tab.focus) refs.tab.focus();
    Island.persist();
  }
  function toggle(force) { open(force == null ? refs.root && refs.root.dataset.open !== 'true' : !!force); }
  function startDrag(event) {
    if (event.button !== 0 || event.target.closest('button')) return;
    var rect = refs.root.getBoundingClientRect();
    var dx = event.clientX - rect.left, dy = event.clientY - rect.top;
    function move(next) {
      refs.root.style.left = Math.max(8, Math.min(next.clientX - dx, global.innerWidth - rect.width - 8)) + 'px';
      refs.root.style.top = Math.max(8, Math.min(next.clientY - dy, global.innerHeight - rect.height - 8)) + 'px';
      refs.root.style.right = 'auto'; refs.root.style.bottom = 'auto';
    }
    function done() {
      global.removeEventListener('pointermove', move);
      Island.state.data.review.position = { left: parseInt(refs.root.style.left, 10), top: parseInt(refs.root.style.top, 10) };
      Island.persist();
    }
    global.addEventListener('pointermove', move); global.addEventListener('pointerup', done, { once: true });
  }
  function startResize(event) {
    event.preventDefault();
    var start = event.clientX, initial = Island.state.data.review.width || 420, dock = Island.state.data.review.dock || 'right';
    function move(next) { setWidth(initial + (dock === 'right' ? start - next.clientX : next.clientX - start)); }
    function done() { global.removeEventListener('pointermove', move); }
    global.addEventListener('pointermove', move); global.addEventListener('pointerup', done, { once: true });
  }
  function movePanel(dx, dy) {
    var rect = refs.root.getBoundingClientRect();
    var left = Math.max(8, Math.min(rect.left + dx, global.innerWidth - rect.width - 8));
    var top = Math.max(8, Math.min(rect.top + dy, global.innerHeight - rect.height - 8));
    refs.root.style.left = left + 'px'; refs.root.style.top = top + 'px'; refs.root.style.right = 'auto'; refs.root.style.bottom = 'auto';
    Island.state.data.review.position = { left: Math.round(left), top: Math.round(top) };
    Island.persist();
    status('Review island moved to ' + Math.round(left) + ', ' + Math.round(top) + '.');
  }
  function headerKey(event) {
    if (event.target !== event.currentTarget || !/^Arrow/.test(event.key)) return;
    event.preventDefault();
    var step = event.shiftKey ? 48 : 12;
    movePanel(event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0, event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0);
  }
  function resizeKey(event) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    setWidth((Island.state.data.review.width || 420) + (event.key === 'ArrowLeft' ? -24 : 24), true);
  }
  function key(event) {
    var path = event.composedPath ? event.composedPath() : [event.target];
    if (path.some(function (node) { return node && node.closest && node.closest('.island-go-preview'); })) return;
    if (!refs.root || refs.root.dataset.open !== 'true' || dom.isEditingEvent(event)) return;
    var index = Number(event.key);
    if (index >= 1 && index <= MODE_ORDER.length) { event.preventDefault(); renderMode(MODE_ORDER[index - 1][0]); return; }
    if (event.key === 'Escape') { event.preventDefault(); open(false); return; }
    if (event.key.toLowerCase() === 'g') { event.preventDefault(); Island.events.emit('go'); return; }
    if (event.key.toLowerCase() === 'd') { event.preventDefault(); setDock(Island.state.data.review.dock === 'left' ? 'right' : 'left'); return; }
    if (event.key.toLowerCase() === 'f') { event.preventDefault(); setSize(0); return; }
    if (event.key === ',' || event.key === '.') { event.preventDefault(); setWidth((Island.state.data.review.width || 420) + (event.key === ',' ? -24 : 24), true); return; }
    if (event.key === '[' || event.key === ']') {
      var sizes = Island.state.sizes, current = Island.state.data.review.size || 0, at = sizes.indexOf(current), next = event.key === '[' ? sizes[Math.max(0, at - 1)] : sizes[Math.min(sizes.length - 1, at + 1)];
      if (next) { event.preventDefault(); setSize(next); } return;
    }
    if (event.key === ' ') { event.preventDefault(); Island.events.emit('key:space'); }
  }
  function modeRowKey(event) {
    var controls = Array.prototype.slice.call(refs.modeRow.children), current = controls.indexOf(event.target), next = current;
    if (event.key === 'ArrowRight') next = (current + 1 + controls.length) % controls.length;
    else if (event.key === 'ArrowLeft') next = (current - 1 + controls.length) % controls.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = controls.length - 1;
    else return;
    event.preventDefault(); controls[next].focus(); renderMode(controls[next].dataset.mode);
  }
  function mount() {
    if (refs.host) return refs.host;
    var host = doc.createElement('review-island');
    host.setAttribute('data-review-island-host', '');
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483004;pointer-events:none;';
    var shadow = host.attachShadow({ mode: 'open' });
    shadow.appendChild(dom.el('style', null, css()));
    var root = dom.el('div', { 'class': 'island', 'data-open': 'false', 'data-dock': 'right' });
    root.style.pointerEvents = 'auto';
    var tab = dom.button('', { 'class': 'tab', 'aria-expanded': 'false', 'aria-controls': 'review-island-panel', title: 'Open review island, Command/Ctrl Shift R' });
    tab.innerHTML = '<span class="mark">' + markSvg(16) + '</span><span>Review</span>';
    var panel = dom.el('section', { 'class': 'panel', id: 'review-island-panel', tabindex: '-1', 'aria-label': 'Review island' });
    var header = dom.el('header', { 'class': 'header', tabindex: '0', title: 'Drag the island, or use arrow keys while this bar is focused', 'aria-label': 'Move review island', 'aria-keyshortcuts': 'ArrowLeft ArrowRight ArrowUp ArrowDown' });
    var modeRow = dom.el('nav', { 'class': 'modes', 'aria-label': 'Review modes', role: 'tablist', 'aria-orientation': 'horizontal' });
    MODE_ORDER.forEach(function (pair, index) {
      var selected = pair[0] === Island.state.activeMode;
      var control = dom.button(pair[1], { 'class': 'mode', id: 'review-island-tab-' + pair[0], 'data-mode': pair[0], role: 'tab', 'aria-controls': 'review-island-mode', 'aria-selected': String(selected), tabindex: selected ? '0' : '-1', title: pair[1] + ', ' + (index + 1) });
      control.addEventListener('click', function () { renderMode(pair[0]); });
      modeRow.appendChild(control);
    });
    var go = dom.button('Go', { 'class': 'go', title: 'Hand this review over, G' });
    go.addEventListener('click', function () { Island.events.emit('go'); });
    header.appendChild(modeRow); header.appendChild(go);
    modeRow.addEventListener('keydown', modeRowKey);
    var body = dom.el('main', { 'class': 'body', id: 'review-island-mode', role: 'tabpanel', 'aria-labelledby': 'review-island-tab-' + Island.state.activeMode });
    var statusStrip = dom.el('footer', 'status');
    var statusMessage = dom.el('span', { 'class': 'status-message', role: 'status', 'aria-live': 'polite' });
    statusStrip.appendChild(statusMessage);
    var sizes = dom.el('span', { 'class': 'sizes', 'aria-label': 'Review width' });
    Island.state.sizes.concat([0]).forEach(function (size) {
      var label = size ? String(size) : 'Full', shortcut = size ? '[: previous width, ]: next width' : 'F: full width';
      var control = dom.button(label, { 'data-size': String(size), title: label + ' page width, ' + shortcut });
      control.addEventListener('click', function () { setSize(size); }); sizes.appendChild(control);
    });
    if (Island.state.sizes.length) statusStrip.appendChild(sizes);
    var dock = dom.button('Dock', { title: 'D: dock left or right' });
    dock.addEventListener('click', function () { setDock(Island.state.data.review.dock === 'left' ? 'right' : 'left'); });
    statusStrip.appendChild(dock);
    var resize = dom.el('div', { 'class': 'resize', title: 'Resize panel, arrow keys or comma narrower and period wider', role: 'separator', tabindex: '0', 'aria-label': 'Review panel width', 'aria-orientation': 'vertical', 'aria-valuemin': '280', 'aria-valuenow': '420' });
    resize.addEventListener('pointerdown', startResize);
    resize.addEventListener('keydown', resizeKey);
    panel.appendChild(header); panel.appendChild(body); panel.appendChild(statusStrip); panel.appendChild(resize);
    root.appendChild(tab); root.appendChild(panel); shadow.appendChild(root); doc.documentElement.appendChild(host);
    refs = { host: host, shadow: shadow, root: root, tab: tab, panel: panel, modeRow: modeRow, body: body, status: statusStrip, statusMessage: statusMessage, sizes: sizes, resize: resize };
    Island.state.shell = refs; Island.state.mounted = true;
    subscriptions.push(Island.events.on('mode:register', function () { if (refs.root && refs.root.dataset.open === 'true') renderMode(Island.state.activeMode); }));
    subscriptions.push(Island.events.on('status:set', status));
    Island.events.emit('shell:mounted', refs);
    tab.addEventListener('click', function () { open(true); });
    header.addEventListener('pointerdown', startDrag);
    header.addEventListener('keydown', headerKey);
    var saved = Island.state.data.review;
    setDock(saved.dock || 'right', true); setWidth(saved.width || 420);
    setSize(saved.size || 0);
    if (saved.position && global.innerWidth > 700) { root.style.left = saved.position.left + 'px'; root.style.top = saved.position.top + 'px'; root.style.right = 'auto'; root.style.bottom = 'auto'; }
    global.addEventListener('keydown', key, true);
    global.addEventListener('resize', scheduleResizeRecord);
    return host;
  }
  function destroy() {
    if (!refs.host) return;
    if (active && typeof active.deactivate === 'function') active.deactivate(refs.body, Island);
    restorePreview(); global.removeEventListener('keydown', key, true); global.removeEventListener('resize', scheduleResizeRecord);
    if (viewportFrame) { if (global.cancelAnimationFrame) global.cancelAnimationFrame(viewportFrame); else if (global.clearTimeout) global.clearTimeout(viewportFrame); viewportFrame = 0; }
    Island.events.emit('shell:destroy', refs); subscriptions.forEach(function (off) { off(); }); subscriptions = []; refs.host.remove();
    Island.state.mounted = false; Island.state.shell = null; refs = {}; active = null;
  }
  Island.shell = { mount: mount, destroy: destroy, open: open, toggle: toggle, renderMode: renderMode, setDock: setDock, setWidth: setWidth, setSize: setSize, currentSize: effectiveWidth, status: status, markSvg: markSvg };
})();
