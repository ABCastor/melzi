import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// The island is evaluated inside a vm realm, so objects it returns carry that
// realm's Object.prototype. node:assert/strict compares prototypes, so a
// structurally identical value still fails on identity alone. Normalise the
// realm boundary away and keep the strict comparison on the values.
const plain = (value) => JSON.parse(JSON.stringify(value));

import { concatenateIsland, ISLAND_SOURCE_ORDER } from '../scripts/build-island.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CORE = fs.readFileSync(path.join(ROOT, 'skill/scripts/island/core.js'), 'utf8');
const SHELL = fs.readFileSync(path.join(ROOT, 'skill/scripts/island/shell.js'), 'utf8');
const temporaryDirectories = [];

afterEach(() => {
  while (temporaryDirectories.length) fs.rmSync(temporaryDirectories.pop(), { recursive: true, force: true });
});

function memoryStorage(seed = new Map()) {
  return {
    values: seed,
    getItem: (key) => seed.has(key) ? seed.get(key) : null,
    setItem: (key, value) => { seed.set(key, String(value)); },
    removeItem: (key) => { seed.delete(key); },
  };
}

function evaluateIsland({ pathname = '/review', storage = memoryStorage(), files = [], globals = {} } = {}) {
  const document = {
    currentScript: null,
    querySelector: () => null,
    addEventListener: () => {},
    documentElement: {},
    styleSheets: [],
  };
  const window = {
    document,
    location: { pathname, protocol: 'file:', search: '', hash: '' },
    localStorage: storage,
    URL,
    setTimeout,
    crypto: { randomUUID: () => '00000000-0000-0000-0000-000000000000' },
  };
  Object.assign(window, globals);
  const context = vm.createContext({ window, console, setTimeout });
  const sources = [CORE, ...files.map((file) => fs.readFileSync(path.join(ROOT, 'skill/scripts/island', file), 'utf8'))];
  vm.runInContext(`${sources.join('\n')}\nwindow.__reviewIslandCore = Island;`, context);
  return window.__reviewIslandCore;
}

function evaluateCore(options = {}) {
  return evaluateIsland(options);
}

// Minimal connected DOM for the actual shell/comment/pins handlers. Capture
// listeners see the shadow host, while composedPath exposes the focused control.
function feedbackHarness({ storage = memoryStorage(), fetch, blockedExports = false } = {}) {
  const windowListeners = new Map();
  const copies = [];
  class Node {
    constructor(tag = '') {
      this.tagName = tag.toUpperCase(); this.nodeType = 1;
      this.children = []; this.dataset = {}; this.attributes = {}; this.listeners = new Map();
      this.style = { setProperty(name, value) { this[name] = value; } };
      this.value = ''; this.disabled = false;
    }
    set textContent(value) {
      this.text = value;
      this.children.forEach((child) => { child.parentElement = null; });
      this.children = [];
    }
    get textContent() { return this.text || this.children.map((child) => child.textContent).join(''); }
    setAttribute(name, value) {
      this.attributes[name] = String(value);
      if (name === 'class') this.className = value;
      if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = String(value);
    }
    getAttribute(name) { return this.attributes[name] ?? null; }
    appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
    remove() {
      if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
      this.parentElement = null;
    }
    get isConnected() { return this === document.documentElement || !!(this.parentElement && this.parentElement.isConnected); }
    getRootNode() { return this.shadowRootOwner || (this.parentElement ? this.parentElement.getRootNode() : document); }
    matches(selector) {
      if (selector.startsWith('.')) return (this.className || '').split(' ').includes(selector.slice(1));
      if (selector.startsWith('[')) {
        const match = selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]/);
        if (!match) return false;
        const value = this.getAttribute(match[1]);
        return value !== null && (match[2] === undefined || value === match[2]) && (!selector.includes(':not') || value !== '-1');
      }
      return this.tagName.toLowerCase() === selector.split(':')[0] && (!selector.includes('[disabled]') || !this.disabled);
    }
    closest(selector) { return this.matches(selector) ? this : this.parentElement && this.parentElement.closest(selector); }
    querySelectorAll(selector) {
      const found = [];
      for (const child of this.children) {
        if (selector.split(',').some((part) => child.matches(part))) found.push(child);
        found.push(...child.querySelectorAll(selector));
      }
      return found;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    addEventListener(type, handler) { const list = this.listeners.get(type) || []; list.push(handler); this.listeners.set(type, list); }
    removeEventListener(type, handler) { this.listeners.set(type, (this.listeners.get(type) || []).filter((entry) => entry !== handler)); }
    attachShadow() { const shadow = new Node(); shadow.parentElement = this; shadow.shadowRootOwner = shadow; shadow.host = this; this.shadowRoot = shadow; return shadow; }
    focus() { document.activeElement = this.getRootNode().host || this; this.getRootNode().activeElement = this; }
    select() {}
    click() { if (blockedExports && this.tagName === 'A') throw new Error('Download blocked'); return this.fire('click'); }
    getBoundingClientRect() { return { width: 390, height: 834, left: 0, top: 0 }; }
    fire(type, properties = {}) {
      const path = []; for (let node = this; node; node = node.parentElement) path.push(node);
      const event = { target: this, defaultPrevented: false, key: '', ...properties,
        composedPath: () => path,
        preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; } };
      const target = event.target;
      event.target = this.getRootNode().host || this;
      for (const handler of windowListeners.get(type) || []) handler(event);
      event.target = target;
      for (const node of path) {
        for (const handler of node.listeners.get(type) || []) handler(event);
        if (event.stopped) break;
      }
      return event;
    }
  }
  const document = {
    currentScript: null, styleSheets: [], activeElement: null,
    documentElement: new Node('html'), body: new Node('body'),
    createElement: (tag) => new Node(tag),
    querySelector: () => null, querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {},
    execCommand: () => !blockedExports,
  };
  document.documentElement.appendChild(document.body);
  const island = evaluateIsland({ storage, files: ['shell.js', 'comment.js', 'pins.js'], globals: {
    document, innerWidth: 390, innerHeight: 834,
    REVIEW_ENDPOINT: fetch ? 'http://127.0.0.1:8795/api/review' : '', fetch,
    location: { pathname: '/review', protocol: 'file:', origin: 'null' },
    getComputedStyle: () => ({ colorScheme: 'light', backgroundColor: '#ffffff' }),
    navigator: { clipboard: { writeText: async (text) => { if (blockedExports) throw new Error('Clipboard blocked'); copies.push(text); } } },
    // Run focus timers immediately; marker/close timers are intentionally inert.
    setTimeout: (callback, delay) => { if (!delay) callback(); return 1; },
    requestAnimationFrame: () => 1,
    addEventListener: (type, handler) => { const list = windowListeners.get(type) || []; list.push(handler); windowListeners.set(type, list); },
    removeEventListener() {},
  } });
  island.shell.mount(); island.shell.open(true);
  return { island, document, storage, copies, windowListeners, area: () => island.state.shell.shadow.querySelector('.island-about-text') };
}

describe('Review Island feedback retention', () => {
  it('persists ordinary typing without replacing focus or posting, including after visiting Pins', () => {
    const posts = [];
    const harness = feedbackHarness({ fetch: async (...args) => { posts.push(args); return { ok: true, json: async () => ({}) }; } });
    const { island } = harness;
    island.shell.renderMode('pins'); island.shell.renderMode('comment');
    const area = harness.area(); area.focus();
    const exact = '  First line\n\nSecond line with café and 日本語.  \n';
    for (let index = 1; index <= exact.length; index++) { area.value = exact.slice(0, index); area.fire('input'); }
    assert.equal(island.state.data.pageComment, exact);
    assert.equal(JSON.parse(harness.storage.values.get('review.island:/review')).pageComment, exact);
    assert.equal(harness.area(), area);
    assert.equal(island.state.shell.shadow.activeElement, area);
    assert.equal(posts.length, 0);
  });

  it('retains composition and multiline text while Enter only submits after composition ends', async () => {
    const posts = [];
    const { island, area: findArea } = feedbackHarness({ fetch: async (_, options) => { posts.push(JSON.parse(options.body)); return { ok: true, json: async () => ({}) }; } });
    const area = findArea(); area.focus(); area.fire('compositionstart');
    area.value = '  日本語\nA second line.  \n'; area.fire('input', { isComposing: true });
    assert.equal(area.fire('keydown', { key: 'Enter', isComposing: true }).defaultPrevented, false);
    assert.equal(area.fire('keydown', { key: 'Enter', keyCode: 229 }).defaultPrevented, false);
    assert.equal(posts.length, 0);
    area.value += 'Final composition'; area.fire('compositionend');
    assert.equal(island.state.data.pageComment, area.value);
    assert.equal(area.fire('keydown', { key: 'Enter', shiftKey: true }).defaultPrevented, false);
    const exact = area.value;
    assert.equal(area.fire('keydown', { key: 'Enter' }).defaultPrevented, true);
    await Promise.resolve();
    assert.equal(posts.length, 1); assert.equal(posts[0].note, exact);
    assert.equal(island.state.data.pageComment, exact);
    assert.equal(findArea().value, exact);
  });

  it('flushes the live editor into Go and export, survives Escape and reopen, and restores from storage', () => {
    const harness = feedbackHarness(); const { island } = harness;
    const exact = '  A note without an input event\n\nLast line.  \n';
    harness.area().value = exact;
    const go = island.state.shell.shadow.querySelector('.go'); go.focus(); go.click();
    const dialog = island.state.shell.shadow.querySelector('.island-go-preview');
    assert.ok(dialog); assert.match(dialog.querySelector('pre').textContent, /A note without an input event\n\nLast line/);
    assert.equal(JSON.parse(island.pins.export()).about, exact);
    dialog.querySelector('.island-go-confirm').fire('keydown', { key: 'Escape' });
    assert.equal(dialog.isConnected, false);
    assert.equal(island.state.shell.root.dataset.open, 'true');
    assert.equal(island.state.shell.shadow.activeElement, go);
    island.shell.open(false); island.shell.open(true);
    assert.equal(harness.area().value, exact);
    assert.equal(feedbackHarness({ storage: harness.storage }).area().value, exact);
    harness.area().value += 'Export boundary';
    assert.equal(JSON.parse(island.pins.export()).about, exact + 'Export boundary');
  });

  it('confirms Go through the rendered control and posts the exact typed note', async () => {
    const posts = [];
    const harness = feedbackHarness({ fetch: async (_, options) => { posts.push(JSON.parse(options.body)); return { ok: true }; } });
    const exact = '  Confirm this note\n\nwith its final newline.\n';
    harness.area().value = exact; harness.area().fire('input');
    harness.island.state.shell.shadow.querySelector('.go').click();
    const confirm = harness.island.state.shell.shadow.querySelector('.island-go-confirm');
    confirm.click(); await new Promise(setImmediate);
    assert.equal(posts.length, 1); assert.equal(posts[0].notes[0].text, exact);
    assert.equal(harness.island.state.data.review.goRecords[0].notes[0].text, exact);
    assert.equal(confirm.textContent, 'Sent');
  });

  it('lets programmatic page-note saves replace the old editor value exactly', () => {
    const harness = feedbackHarness();
    harness.area().value = 'An older draft'; harness.area().fire('input');
    harness.island.comment.saveAbout('  A replacement\nwith whitespace.  ');
    assert.equal(harness.area().value, '  A replacement\nwith whitespace.  ');
    assert.equal(harness.island.state.data.pageComment, harness.area().value);
  });

  it('keeps typed words visible and exportable when storage, server, clipboard, and download fail', async () => {
    const storage = memoryStorage(); storage.setItem = () => { throw new Error('Storage full'); };
    const harness = feedbackHarness({ storage, blockedExports: true, fetch: async () => { throw new Error('Server unavailable'); } });
    const exact = '  Keep these words\nwhen delivery fails.  ';
    harness.area().value = exact; harness.area().fire('input');
    const result = await harness.island.pins.handoff(harness.island.pins.recordGo());
    assert.equal(result.posted, false); assert.equal(result.copied, false); assert.equal(result.downloaded, false);
    assert.equal(result.record.notes[0].text, exact);
    assert.equal(JSON.parse(result.text).notes[0].text, exact);
    harness.island.shell.open(false); harness.island.shell.open(true);
    assert.equal(harness.area().value, exact);
    assert.equal(JSON.parse(harness.island.pins.export()).about, exact);
    assert.equal(harness.island.state.data.review.goRecords[0].notes[0].text, exact);
  });

  it('lets the modal own Tab, Escape, and shell shortcuts across the shadow boundary', () => {
    const { island, windowListeners } = feedbackHarness(); island.pins.go();
    const shadow = island.state.shell.shadow, dialog = shadow.querySelector('.island-go-preview');
    const [cancel, confirm] = dialog.querySelectorAll('button');
    confirm.focus(); assert.equal(confirm.fire('keydown', { key: 'Tab' }).defaultPrevented, true); assert.equal(shadow.activeElement, cancel);
    assert.equal(cancel.fire('keydown', { key: 'Tab', shiftKey: true }).defaultPrevented, true); assert.equal(shadow.activeElement, confirm);
    confirm.fire('keydown', { key: 'g' }); assert.ok(shadow.querySelector('.island-go-preview') === dialog, 'G inside the dialog must not replace it');
    confirm.fire('keydown', { key: '2' }); assert.equal(island.state.activeMode, 'comment');
    // Also exercise the non-composed-path fallback with an actual modal control.
    const fallback = { target: confirm, key: 'Escape', preventDefault() { this.defaultPrevented = true; } };
    for (const listener of windowListeners.get('keydown')) listener(fallback);
    assert.equal(island.state.shell.root.dataset.open, 'true');
    confirm.fire('keydown', { key: 'Escape' });
    assert.equal(dialog.isConnected, false); assert.equal(island.state.shell.root.dataset.open, 'true');
  });

  it('declares an interactive viewport-bounded modal above the review panel with reachable actions', () => {
    const { island } = feedbackHarness(); island.pins.go();
    const styles = island.state.shell.shadow.querySelectorAll('style').map((node) => node.textContent).join('\n');
    const modal = [...styles.matchAll(/\.island-go-preview\{([^}]+)\}/g)].at(-1)?.[1];
    assert.ok(modal, 'the modal must have its own layout rule');
    assert.match(modal, /pointer-events:auto/);
    assert.ok(Number(modal.match(/z-index:(\d+)/)?.[1]) > 2147483004);
    assert.match(modal, /left:50%/); assert.match(modal, /top:50%/); assert.match(modal, /transform:translate\(-50%,-50%\)/);
    assert.match(modal, /max-height:[^;]*(?:100d?vh)/); assert.match(modal, /overflow:auto/);
    assert.match(modal, /display:flex/); assert.match(modal, /flex-direction:column/);
    assert.match(styles, /\.island-go-words\{[^}]*min-height:0/);
    assert.match(styles, /\.island-go-actions\{[^}]*flex-shrink:0/);
    assert.match(styles, /\.island-go-actions button\{[^}]*min-width:44px[^}]*min-height:44px/);
  });
});

describe('Review Island feedback review recovery', () => {
  for (const composing of [false, true]) {
    for (const boundary of ['adapter', 'render']) {
      it(`flushes ${composing ? 'composing' : 'ordinary'} live text before ${boundary} rerenders`, () => {
        const harness = feedbackHarness();
        const exact = '  Current composition\nLast line.  \n';
        if (composing) harness.area().fire('compositionstart');
        harness.area().value = exact;
        if (boundary === 'adapter') harness.island.setAdapter({});
        else harness.island.comment.render();
        assert.equal(harness.area().value, exact);
        assert.equal(harness.island.state.data.pageComment, exact);
        assert.equal(JSON.parse(harness.island.pins.export()).about, exact);
        assert.equal(feedbackHarness({ storage: harness.storage }).area().value, exact);
      });
    }
    it(`lets intentional saveAbout replace ${composing ? 'composing' : 'ordinary'} unsaved live text`, () => {
      const harness = feedbackHarness();
      if (composing) harness.area().fire('compositionstart');
      harness.area().value = 'An unsaved live draft';
      const exact = '  An intentional replacement\nwith whitespace.  \n';
      harness.island.comment.saveAbout(exact);
      assert.equal(harness.area().value, exact);
      assert.equal(harness.island.state.data.pageComment, exact);
      assert.equal(harness.island.pins.recordGo().notes[0].text, exact);
      assert.equal(feedbackHarness({ storage: harness.storage }).area().value, exact);
    });
  }

  it('clears the connected editor so later Go, export, reopen, and cache restore cannot resurrect it', () => {
    const harness = feedbackHarness();
    harness.area().value = 'A cleared note'; harness.area().fire('input');
    harness.island.pins.clear(true);
    assert.equal(harness.area().value, '');
    assert.equal(JSON.parse(harness.island.pins.export()).about, '');
    assert.equal(harness.island.pins.recordGo().notes.length, 0);
    harness.island.shell.open(false); harness.island.shell.open(true);
    assert.equal(harness.area().value, '');
    assert.equal(feedbackHarness({ storage: harness.storage }).area().value, '');
  });

  for (const boundary of ['blur', 'change', 'Go', 'export']) {
    it(`retries unchanged text at ${boundary} after storage becomes available without changing note metadata`, () => {
      const storage = memoryStorage(), put = storage.setItem;
      let full = true;
      storage.setItem = (key, value) => { if (full) throw new Error('Storage full'); put(key, value); };
      const harness = feedbackHarness({ storage });
      const exact = '  Retry this exact note\nwhen storage recovers.  \n';
      const area = harness.area(); area.focus(); area.value = exact; area.fire('input');
      const review = harness.island.state.data.review;
      const metadata = [review.pageCommentId, review.pageCommentAt, review.pageCommentReviewer];
      assert.equal(storage.values.has('review.island:/review'), false);
      full = false;
      if (boundary === 'Go') harness.island.pins.go();
      else if (boundary === 'export') harness.island.pins.export();
      else area.fire(boundary);
      assert.equal(JSON.parse(storage.values.get('review.island:/review') || '{}').pageComment, exact);
      assert.equal(harness.area().value, exact);
      assert.ok(harness.area() === area, 'retry must preserve the existing editor');
      if (boundary !== 'Go') assert.ok(harness.island.state.shell.shadow.activeElement === area, 'retry must preserve focus');
      const after = harness.island.state.data.review;
      assert.deepEqual([after.pageCommentId, after.pageCommentAt, after.pageCommentReviewer], metadata);
      assert.equal(feedbackHarness({ storage }).area().value, exact);
    });
  }
});

describe('Review Island focused draft continuity', () => {
  for (const composing of [false, true]) {
    for (const boundary of ['adapter', 'render']) {
      it(`preserves the attached ${composing ? 'composing' : 'ordinary'} editor, selection, and focus across ${boundary} rerenders`, async () => {
        const posts = [];
        const harness = feedbackHarness({ fetch: async (_, options) => { posts.push(JSON.parse(options.body)); return { ok: true, json: async () => ({}) }; } });
        const area = harness.area(), about = area.parentElement;
        let detachments = 0, valueWrites = 0;
        // Catch detach/reinsert/refocus approaches, including removal of the
        // parent section while the original textarea itself is kept alive.
        for (const node of [area, about]) {
          let parent = node.parentElement;
          Object.defineProperty(node, 'parentElement', {
            get: () => parent,
            set: (next) => { if (parent && parent !== next) detachments++; parent = next; },
          });
        }
        let liveValue = '';
        Object.defineProperty(area, 'value', { get: () => liveValue, set: (next) => { liveValue = next; valueWrites++; } });
        area.focus();
        if (composing) area.fire('compositionstart');
        const exact = '  An active draft\nKeep its selection.  \n';
        area.value = exact; valueWrites = 0;
        area.selectionStart = 4; area.selectionEnd = 15; area.selectionDirection = 'backward';
        for (let iteration = 0; iteration < 2; iteration++) {
          if (boundary === 'adapter') harness.island.setAdapter({});
          else harness.island.comment.render();
        }
        assert.ok(harness.area() === area, 'ordinary rerenders must reuse the textarea');
        assert.ok(area.parentElement === about, 'ordinary rerenders must reuse its attached parent');
        assert.equal(detachments, 0, 'the field and parent must never detach');
        assert.equal(valueWrites, 0, 'rerendering must not rewrite the active field value');
        assert.equal(area.isConnected, true); assert.equal(about.isConnected, true);
        assert.ok(harness.island.state.shell.shadow.activeElement === area, 'focus must stay on the original editor');
        assert.deepEqual([area.selectionStart, area.selectionEnd, area.selectionDirection], [4, 15, 'backward']);
        assert.equal(harness.island.state.data.pageComment, exact);
        assert.equal(posts.length, 0);
        if (composing) {
          assert.equal(area.fire('keydown', { key: 'Enter' }).defaultPrevented, false, 'the existing composition guard must remain active');
          assert.equal(posts.length, 0);
          area.value += '完成'; area.fire('compositionend');
          assert.equal(harness.island.state.data.pageComment, exact + '完成');
        }
        const committed = area.value;
        assert.equal(area.fire('keydown', { key: 'Enter' }).defaultPrevented, true);
        await new Promise(setImmediate);
        assert.equal(posts.length, 1, 'reusing the field must not accumulate input or key listeners');
        assert.equal(posts[0].note, committed);
      });
    }
  }
});

describe('Review Island core colour maths', () => {
  it('matches known WCAG, APCA, and OKLCH reference values', () => {
    const colors = evaluateCore().colors;
    const black = colors.parseHex('#000');
    const white = colors.parseHex('#fff');
    const red = colors.srgbToOklch(colors.parseHex('#ff0000'));

    assert.equal(colors.wcag(black, white), 21);
    assert.ok(Math.abs(colors.apca(black, white) - 105.1) < 0.1);
    assert.ok(Math.abs(colors.apca(white, black) + 107) < 0.1);
    assert.ok(Math.abs(red.l - 0.627955) < 0.000001);
    assert.ok(Math.abs(red.c - 0.257683) < 0.000001);
    assert.ok(Math.abs(red.h - 29.2339) < 0.001);
    assert.equal(
      colors.rgbToHex(colors.oklchToSrgb(colors.srgbToOklch(colors.parseHex('#663399')))),
      '#663399',
    );
    assert.equal(colors.rgbToHex(colors.parse('oklch(62.7955% 0.257683 29.2339)')), '#ff0000');
    assert.equal(colors.rgbToHex(colors.parse('oklab(62.7955% 0.224863 0.125846 / 50%)'), true), '#ff000080');
  });

  it('reduces chroma until an OKLCH colour is inside sRGB', () => {
    const colors = evaluateCore().colors;
    const impossible = { l: 0.6, c: 0.5, h: 300 };
    const fitted = colors.clampOklch(impossible);

    assert.equal(colors.inSrgbGamut(impossible), false);
    assert.equal(colors.inSrgbGamut(fitted), true);
    assert.ok(fitted.c < impossible.c);
    assert.ok(Math.abs(fitted.c - colors.maxSrgbChroma(0.6, 300)) < 0.000001);
    const mapped = colors.mapToSrgb(impossible);
    assert.ok(mapped.r >= 0 && mapped.r <= 255);
    assert.ok(mapped.g >= 0 && mapped.g <= 255);
    assert.ok(mapped.b >= 0 && mapped.b <= 255);
  });

  it('never returns an out-of-gamut interactive chroma maximum', () => {
    const colors = evaluateCore().colors;
    for (const lightness of [0.08, 0.2, 0.4, 0.6, 0.8, 0.92]) {
      for (let hue = 0; hue < 360; hue += 30) {
        const chroma = colors.maxSrgbChroma(lightness, hue);
        assert.equal(
          colors.inSrgbGamut({ l: lightness, c: chroma, h: hue }),
          true,
          `L=${lightness}, H=${hue}, C=${chroma} must stay in sRGB`,
        );
      }
    }
  });

  it('keeps the island lacquer palette itself above WCAG AA', () => {
    const colors = evaluateCore().colors;
    function shellColor(name) {
      const match = SHELL.match(new RegExp(`--${name}:oklch\\(([\\d.]+)%\\s+([\\d.]+)\\s+([\\d.]+)`));
      assert.ok(match, `shell must declare --${name} in OKLCH`);
      return colors.oklchToSrgb({ l: Number(match[1]) / 100, c: Number(match[2]), h: Number(match[3]) });
    }
    const lacquer = shellColor('lacquer');
    const raised = shellColor('raised');
    const graphite = shellColor('graphite');
    assert.ok(colors.wcag(shellColor('muted'), lacquer) >= 4.5);
    assert.ok(colors.wcag(shellColor('ink'), lacquer) >= 4.5);
    assert.ok(colors.wcag(shellColor('gold'), lacquer) >= 4.5);
    assert.ok(colors.wcag(shellColor('muted'), raised) >= 4.5);
    assert.ok(colors.wcag(shellColor('ink'), raised) >= 4.5);
    assert.ok(colors.wcag(shellColor('gold'), graphite) >= 4.5);
  });

  it('reads an unnamed light page from its visible paint instead of the OS preference', () => {
    const documentElement = {
      parentElement: null,
      getAttribute: () => null,
      getRootNode: () => null,
    };
    const body = {
      parentElement: documentElement,
      getRootNode: () => document,
    };
    const document = {
      currentScript: null,
      documentElement,
      body,
      styleSheets: [],
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: () => {},
    };
    const island = evaluateCore({ globals: {
      document,
      getComputedStyle: (node) => ({
        backgroundColor: node === body ? '#f4efe5' : '#00000000',
        colorScheme: 'normal',
      }),
      matchMedia: () => ({ matches: true }),
    } });

    assert.equal(island.dom.theme(), 'light');
  });
});

describe('Review Island specimen coverage', () => {
  it('keeps the synthesis specimen free of custom properties', () => {
    const source = fs.readFileSync(path.join(ROOT, 'skill/scripts/review-layer-demo-no-properties.html'), 'utf8');
    assert.doesNotMatch(source, /--[A-Za-z][\w-]*\s*:/);
    assert.doesNotMatch(source, /var\s*\(/);
    for (const element of ['h1', 'h2', 'p', 'a', 'button', 'input', 'table', 'pre']) {
      assert.match(source, new RegExp(`<${element}(?:\\s|>)`, 'i'));
    }
    assert.match(source, /data-theme=["']dark["']/);
  });
});

describe('Review Island Colour studio', () => {
  it('generates ramps that are monotonic in lightness for each tested hue', () => {
    const island = evaluateIsland({ files: ['colour.js'] });
    for (const seed of ['#ff0000', '#00ff00', '#0000ff', '#ff00ff', '#ffcc00']) {
      const ramp = island.colour.generateRamp(seed, 12);
      assert.equal(ramp.length, 12);
      for (let index = 1; index < ramp.length; index += 1) {
        assert.ok(ramp[index].oklch.l > ramp[index - 1].oklch.l, `${seed} lightness must rise at step ${index + 1}`);
        assert.equal(island.colors.inSrgbGamut(ramp[index].oklch), true);
      }
    }
  });

  it('keeps the three-step display ramp lighter, base, darker', () => {
    const island = evaluateIsland({ files: ['colour.js'] });
    const base = island.colors.srgbToOklch(island.colors.parseHex('#7b5bd6'));
    const ramp = island.colour.displayRamp('#7b5bd6');
    assert.equal(ramp.length, 3);
    assert.ok(ramp[0].oklch.l > base.l);
    assert.ok(Math.abs(ramp[1].oklch.l - base.l) < 0.000001);
    assert.ok(ramp[2].oklch.l < base.l);
  });

  it('makes perceptual-neutral a real strategy instead of analogous under another label', () => {
    const island = evaluateIsland({ files: ['colour.js'] });
    const analogous = island.colour.strategyPalette('analogous', '#315efb');
    const neutral = island.colour.strategyPalette('perceptual-neutral', '#315efb');

    assert.notDeepEqual(plain(neutral), plain(analogous));
    for (const role of ['ground', 'surface', 'ink', 'muted']) {
      assert.ok(neutral[role].c <= 0.005, `${role} must be perceptually neutral`);
    }
    assert.ok(neutral.accent.c > 0.05, 'the accent remains chromatic');
  });

  it('keeps an executable selector and property for a synthesized role', () => {
    const island = evaluateIsland({ files: ['colour.js'] });
    const rules = island.colour.synthesizedRules('ground', {
      usages: [{ path: 'html > body > main:nth-of-type(1)', property: 'backgroundColor' }],
    }, '#f7f5ef');
    assert.deepEqual(Array.from(rules), ['html > body > main:nth-of-type(1){background-color:#f7f5ef !important}']);
  });

  it('emits and verifies a scoped stylesheet for a synthesized role', () => {
    let painted = '#ffffff';
    const attributes = new Map([['data-theme', 'light']]);
    const styleNodes = [];
    const documentElement = {
      style: { getPropertyValue: () => '', setProperty() {}, removeProperty() {} },
      hasAttribute: (name) => attributes.has(name),
      getAttribute: (name) => attributes.get(name) || null,
      setAttribute: (name, value) => attributes.set(name, String(value)),
      removeAttribute: (name) => attributes.delete(name),
    };
    const target = { nodeType: 1, tagName: 'BODY', nodeName: 'BODY', parentElement: documentElement };
    const document = {
      currentScript: null,
      documentElement,
      body: target,
      head: {
        appendChild(node) {
          styleNodes.push(node);
          const match = String(node.textContent || '').match(/background-color:(#[0-9a-f]{6})/i);
          if (match) painted = match[1];
          return node;
        },
      },
      styleSheets: [],
      querySelector: (selector) => selector === 'body' ? target : null,
      querySelectorAll: () => [],
      createElement: () => ({
        setAttribute(name, value) { this[name] = value; },
        remove() { const index = styleNodes.indexOf(this); if (index >= 0) styleNodes.splice(index, 1); },
      }),
      addEventListener: () => {},
    };
    const island = evaluateIsland({ files: ['colour.js'], globals: {
      document,
      getComputedStyle: (node) => ({
        backgroundColor: node === target ? painted : 'rgba(0, 0, 0, 0)',
        colorScheme: 'light',
        getPropertyValue: (name) => name === 'background-color' ? painted : '',
      }),
    } });
    island.tokens.discover = () => ({
      colors: [], faces: [], background: painted,
      painted: [{ hex: painted, count: 1, area: 1000, usages: [{ path: 'body', property: 'backgroundColor' }] }],
    });

    const applied = island.colour.apply('ground', '#314455');
    assert.equal(applied, '#314455');
    assert.equal(painted, '#314455');
    assert.equal(styleNodes.length, 1);
    assert.equal(styleNodes[0]['data-review-island-style'], 'colour-overrides');
    assert.equal(island.history.undo(), true);
    assert.equal(painted, '#ffffff');
    assert.equal(island.history.redo(), true);
    assert.equal(painted, '#314455');
  });

  it('uses the extension adapter when author-level important CSS defeats a synthesized role', () => {
    const attributes = new Map([['data-theme', 'light']]);
    const styleNodes = [];
    const adapterCss = [];
    const documentElement = {
      style: { getPropertyValue: () => '', setProperty() {}, removeProperty() {} },
      hasAttribute: (name) => attributes.has(name),
      getAttribute: (name) => attributes.get(name) || null,
      setAttribute: (name, value) => attributes.set(name, String(value)),
      removeAttribute: (name) => attributes.delete(name),
    };
    const target = { nodeType: 1, tagName: 'BODY', nodeName: 'BODY', parentElement: documentElement };
    const document = {
      currentScript: null, documentElement, body: target, styleSheets: [],
      head: { appendChild(node) { styleNodes.push(node); return node; } },
      querySelector: (selector) => selector === 'body' ? target : null,
      querySelectorAll: () => [],
      createElement: () => ({ setAttribute() {}, remove() {} }),
      addEventListener: () => {},
    };
    const island = evaluateIsland({ files: ['colour.js'], globals: {
      document,
      getComputedStyle: (node) => ({
        backgroundColor: node === target ? '#ffffff' : 'rgba(0, 0, 0, 0)',
        colorScheme: 'light',
        getPropertyValue: (name) => name === 'background-color' ? '#ffffff' : '',
      }),
    } });
    island.tokens.discover = () => ({
      colors: [], faces: [], background: '#ffffff',
      painted: [{ hex: '#ffffff', count: 1, area: 1000, usages: [{ path: 'body', property: 'backgroundColor' }] }],
    });
    island.setAdapter({
      apply(css) { adapterCss.push(css); return Promise.resolve({ ok: true }); },
      remove() { return Promise.resolve({ ok: true }); },
    });

    assert.equal(island.colour.apply('ground', '#314455'), '#314455');
    assert.equal(adapterCss.length, 1);
    assert.match(adapterCss[0], /body\{background-color:#314455 !important\}/);
    assert.deepEqual(Array.from(island.state.data.unresolved), []);
  });

  it('prefers a declared ground token and keeps synthesized roles on matching property usages', () => {
    const island = evaluateIsland({ files: ['colour.js'] });
    island.tokens.discover = () => ({
      colors: [{ name: '--ground', value: '#f4efe5', hex: '#f4efe5', used: false, usages: [] }],
      background: '#f4efe5',
      faces: [],
      painted: [
        { hex: '#1d1d1f', count: 8, area: 1000, usages: [{ path: 'body', property: 'color' }] },
        { hex: '#f4efe5', count: 2, area: 900, usages: [{ path: 'body', property: 'backgroundColor' }] },
        { hex: '#315efb', count: 4, area: 800, usages: [{ path: 'a', property: 'color' }] },
        { hex: '#fffaf0', count: 3, area: 700, usages: [{ path: '.surface', property: 'backgroundColor' }] },
        { hex: '#676762', count: 2, area: 600, usages: [{ path: 'p', property: 'color' }] },
      ],
    });

    const roles = island.colour.roles('light');
    assert.equal(roles.ground.source, 'token');
    assert.equal(roles.ground.name, '--ground');
    assert.deepEqual(plain(roles.ground.usages), [{ path: 'body', property: 'backgroundColor' }]);
    assert.equal(roles.surface.usages.every((usage) => /background/i.test(usage.property)), true);
    assert.equal(roles.ink.usages.every((usage) => usage.property === 'color'), true);
    assert.equal(roles.muted.usages.every((usage) => usage.property === 'color'), true);
    assert.equal(roles.accent.usages.every((usage) => usage.property === 'color'), true);
  });

  it('replays the saved token or selector descriptor instead of rediscovering another target', () => {
    const island = evaluateIsland({ files: ['colour.js'] });
    const descriptor = island.colour.replayDescriptor(
      { name: '--newly-discovered', source: 'token', usages: [] },
      { name: '--review-ground', source: 'painted', was: '#ffffff', usages: [{ path: 'html > body', property: 'backgroundColor' }] },
    );
    assert.equal(descriptor.name, '--review-ground');
    assert.equal(descriptor.source, 'painted');
    assert.equal(descriptor.value, '#ffffff');
    assert.deepEqual(plain(descriptor.usages), [{ path: 'html > body', property: 'backgroundColor' }]);
  });

  it('removes the live light token before exposing the native dark theme', () => {
    const properties = new Map([['--ink', '#222222']]);
    const attributes = new Map([['data-theme', 'light']]);
    const documentElement = {
      style: {
        getPropertyValue: (name) => properties.get(name) || '',
        setProperty: (name, value) => properties.set(name, value),
        removeProperty: (name) => properties.delete(name),
      },
      hasAttribute: (name) => attributes.has(name),
      getAttribute: (name) => attributes.get(name) || null,
      setAttribute: (name, value) => attributes.set(name, String(value)),
      removeAttribute: (name) => attributes.delete(name),
    };
    const document = {
      currentScript: null, documentElement, styleSheets: [],
      querySelector: () => null, querySelectorAll: () => [], addEventListener: () => {},
    };
    const island = evaluateIsland({ files: ['colour.js'], globals: { document } });
    island.state.data.review.colour = { maps: { light: {}, dark: {} }, roles: {}, stateRoles: false, simulation: 0, originalInline: { '--ink': '' } };
    island.colour.showTheme('dark');
    assert.equal(properties.has('--ink'), false);
    assert.equal(attributes.get('data-theme'), 'dark');
  });

  it('stores and renders the computed token value that changed the painted page', () => {
    const base = '#f4efe5';
    const properties = new Map();
    const attributes = new Map([['data-theme', 'light']]);
    const documentElement = {
      style: {
        getPropertyValue: (name) => properties.get(name) || '',
        setProperty: (name, value) => properties.set(name, value),
        removeProperty: (name) => properties.delete(name),
      },
      hasAttribute: (name) => attributes.has(name),
      getAttribute: (name) => attributes.get(name) || null,
      setAttribute: (name, value) => attributes.set(name, String(value)),
      removeAttribute: (name) => attributes.delete(name),
    };
    const target = { nodeType: 1, tagName: 'BODY', nodeName: 'BODY', parentElement: documentElement };
    const document = {
      currentScript: null,
      documentElement,
      body: target,
      styleSheets: [],
      querySelector: (selector) => selector === 'body' ? target : null,
      querySelectorAll: () => [],
      addEventListener: () => {},
    };
    const ground = () => properties.get('--ground') || base;
    const island = evaluateIsland({ files: ['colour.js'], globals: {
      document,
      getComputedStyle: (node) => ({
        backgroundColor: node === target ? ground() : 'rgba(0, 0, 0, 0)',
        colorScheme: 'light',
        getPropertyValue: (name) => name === '--ground' ? ground()
          : name === 'background-color' || name === 'backgroundColor' ? ground() : '',
      }),
    } });
    island.tokens.discover = () => ({
      colors: [{ name: '--ground', value: base, hex: base, used: true, usages: [{ path: 'body', property: 'backgroundColor' }] }],
      faces: [], background: ground(),
      painted: [{ hex: ground(), count: 1, area: 1000, usages: [{ path: 'body', property: 'backgroundColor' }] }],
    });

    const applied = island.colour.apply('ground', '#59554c');
    assert.equal(applied, ground());
    assert.equal(island.colour.roles('light').ground.now, ground());
    assert.equal(island.state.data.overrides.colors['--ground-light'].srgb, '#59554c');
    assert.equal(island.history.undo(), true);
    assert.equal(ground(), base);
    assert.equal(island.history.redo(), true);
    assert.equal(ground(), applied);
  });

  it('undoes an unnamed page even when its own ground write changes the inferred theme', () => {
    const base = '#f4efe5';
    const properties = new Map();
    const documentElement = {
      style: {
        getPropertyValue: (name) => properties.get(name) || '',
        setProperty: (name, value) => properties.set(name, value),
        removeProperty: (name) => properties.delete(name),
      },
      hasAttribute: () => false,
      getAttribute: () => null,
    };
    const target = { nodeType: 1, tagName: 'BODY', nodeName: 'BODY', parentElement: documentElement };
    const document = {
      currentScript: null,
      documentElement,
      body: target,
      styleSheets: [],
      querySelector: (selector) => selector === 'body' ? target : null,
      querySelectorAll: () => [],
      addEventListener: () => {},
    };
    const ground = () => properties.get('--ground') || base;
    const island = evaluateIsland({ files: ['colour.js'], globals: {
      document,
      getComputedStyle: (node) => ({
        backgroundColor: node === target ? ground() : 'rgba(0, 0, 0, 0)',
        colorScheme: 'normal',
        getPropertyValue: (name) => name === '--ground' ? ground()
          : name === 'background-color' || name === 'backgroundColor' ? ground() : '',
      }),
      matchMedia: () => ({ matches: false }),
    } });
    island.tokens.discover = () => ({
      colors: [{ name: '--ground', value: base, hex: base, used: true, usages: [{ path: 'body', property: 'backgroundColor' }] }],
      faces: [], background: ground(),
      painted: [{ hex: ground(), count: 1, area: 1000, usages: [{ path: 'body', property: 'backgroundColor' }] }],
    });
    const item = island.colour.roles('light').ground;

    assert.equal(island.dom.theme(), 'light');
    const applied = island.colour.apply('ground', '#59554c', { theme: 'light', item });
    assert.equal(ground(), applied);
    assert.equal(island.dom.theme(), 'dark');
    assert.equal(island.history.undo(), true);
    assert.equal(ground(), base);
    assert.equal(island.dom.theme(), 'light');
    assert.equal(island.history.redo(), true);
    assert.equal(ground(), applied);
    assert.equal(island.dom.theme(), 'dark');
  });

  it('keeps an unapplied role chip unchanged and records the reason in Go', () => {
    const properties = new Map();
    const attributes = new Map([['data-theme', 'light']]);
    const styleNodes = [];
    const documentElement = {
      style: {
        getPropertyValue: (name) => properties.get(name) || '',
        setProperty: (name, value) => properties.set(name, value),
        removeProperty: (name) => properties.delete(name),
      },
      hasAttribute: (name) => attributes.has(name),
      getAttribute: (name) => attributes.get(name) || null,
      setAttribute: (name, value) => attributes.set(name, String(value)),
      removeAttribute: (name) => attributes.delete(name),
    };
    const target = { nodeType: 1, tagName: 'BODY', nodeName: 'BODY', parentElement: documentElement };
    const document = {
      currentScript: null,
      documentElement,
      body: target,
      head: {
        appendChild(node) { styleNodes.push(node); node.parentNode = this; return node; },
        removeChild(node) { styleNodes.splice(styleNodes.indexOf(node), 1); },
      },
      styleSheets: [],
      querySelector: (selector) => selector === 'body' ? target : null,
      querySelectorAll: () => [],
      createElement: () => ({
        setAttribute(name, value) { this[name] = value; },
        remove() { const index = styleNodes.indexOf(this); if (index >= 0) styleNodes.splice(index, 1); },
      }),
      addEventListener: () => {},
    };
    const island = evaluateIsland({ files: ['colour.js', 'pins.js'], globals: {
      document,
      getComputedStyle: (node) => ({
        backgroundColor: node === target ? '#ffffff' : 'rgba(0, 0, 0, 0)',
        colorScheme: 'light',
        getPropertyValue: (name) => name === 'background-color' || name === 'backgroundColor' ? '#ffffff' : '',
      }),
      innerWidth: 1280,
    } });
    island.tokens.discover = () => ({
      colors: [], faces: [], background: '#ffffff',
      painted: [{ hex: '#ffffff', count: 1, area: 1000, usages: [{ path: 'body', property: 'backgroundColor' }] }],
    });

    island.colour.apply('ground', '#111111');

    assert.equal(island.colour.roles('light').ground.now, '#ffffff');
    assert.deepEqual(Object.keys(island.state.data.overrides.colors), []);
    const record = island.pins.recordGo();
    assert.ok(record.unresolved.some((item) => /ground.*could not be applied/i.test(item)));
  });

  it('keeps equally typeset text on different colours as separate contrast pairs', () => {
    const styleFor = (color, backgroundColor) => ({
      color, backgroundColor, display: 'block', visibility: 'visible', opacity: '1',
      fontFamily: 'Test Sans', fontSize: '16px', lineHeight: '24px', fontWeight: '400',
      borderTopColor: '#00000000', borderTopWidth: '0', borderTopStyle: 'none',
      borderRightColor: '#00000000', borderRightWidth: '0', borderRightStyle: 'none',
      borderBottomColor: '#00000000', borderBottomWidth: '0', borderBottomStyle: 'none',
      borderLeftColor: '#00000000', borderLeftWidth: '0', borderLeftStyle: 'none',
      outlineColor: '#00000000', outlineWidth: '0', outlineStyle: 'none', textDecorationLine: 'none',
      fill: 'none', stroke: 'none', backgroundImage: 'none', boxShadow: 'none',
      getPropertyValue: () => '', [Symbol.iterator]: function* () {},
    });
    const rootStyle = styleFor('#111111', '#ffffff');
    rootStyle.getPropertyValue = (name) => name === '--ink' || name === '--unused-same-colour' ? '#111111' : '';
    const makeNode = (text, style) => ({
      nodeType: 1, tagName: 'P', nodeName: 'P', textContent: text, style: [], parentElement: null, _style: style,
      closest: () => null, getRootNode: () => document, getClientRects: () => [{}],
      getBoundingClientRect: () => ({ width: 200, height: 24 }),
    });
    let document;
    const first = makeNode('First paragraph', styleFor('#111111', '#ffffff'));
    const second = makeNode('Second paragraph', styleFor('#ffffff', '#111111'));
    const body = { ...makeNode('', rootStyle), tagName: 'BODY' };
    const html = { ...makeNode('', rootStyle), tagName: 'HTML', getAttribute: () => null };
    const nodes = [body, first, second];
    const declarations = (values) => {
      const names = Object.keys(values);
      return Object.assign(names, { getPropertyValue: (name) => values[name] || '' });
    };
    document = {
      currentScript: null,
      styleSheets: [{ cssRules: [
        { selectorText: ':root', style: declarations({ '--ink': '#111111', '--unused-same-colour': '#111111' }) },
        { selectorText: 'p', style: declarations({ color: 'var(--ink)' }) },
      ] }], body, documentElement: html,
      querySelector: () => null,
      querySelectorAll: (selector) => selector === '*' || selector === 'body, body *' ? nodes : selector === 'p' ? [first, second] : selector === ':root' ? [html] : [],
      addEventListener: () => {},
    };
    const island = evaluateIsland({ globals: {
      document,
      getComputedStyle: (node) => node._style,
    } });
    const discovery = island.tokens.discover();
    const pairs = discovery.faces;
    assert.equal(pairs.filter((face) => face.font.family === 'Test Sans').length, 2);
    assert.deepEqual(new Set(pairs.map((face) => `${face.foregroundHex}/${face.background}`)).size, 2);
    assert.equal(discovery.colors.find((entry) => entry.name === '--ink').used, true);
    assert.equal(discovery.colors.find((entry) => entry.name === '--unused-same-colour').used, false);
  });
});

describe('Review Island library guards', () => {
  it('filters retired entries out of the palettes available for generation', () => {
    const island = evaluateIsland({
      files: ['colour.js'],
      globals: {
        REVIEW_LIBRARY: {
          palettes: [
            { id: 'active-palette', name: 'Active', roles: { accent: '#315efb' } },
            { id: 'retired-palette', name: 'Retired', roles: { accent: '#cc3355' } },
          ],
          faces: [],
          retired: [{ id: 'retired-palette', reason: 'Already ruled out.' }],
        },
      },
    });

    assert.deepEqual(Array.from(island.colour.availablePalettes(), (entry) => entry.id), ['active-palette']);
  });

  it('gives Colour both declared palettes and a reason-only retired drawer', () => {
    const island = evaluateIsland({
      files: ['colour.js'],
      globals: {
        REVIEW_LIBRARY: {
          project: 'portfolio',
          palettes: [
            { id: 'active-palette', name: 'Project calm', roles: { accent: '#315efb' } },
            { id: 'retired-palette', name: 'Old violet', roles: { accent: '#cc3355' } },
          ],
          faces: [],
          retired: [{ id: 'retired-palette', reason: 'Fought the content.' }],
        },
      },
    });

    const entries = island.colour.libraryEntries();
    assert.deepEqual(Array.from(entries.active, (entry) => entry.id), ['active-palette']);
    assert.deepEqual(Array.from(entries.retired, (entry) => ({ id: entry.id, reason: entry.retiredReason })), [
      { id: 'retired-palette', reason: 'Fought the content.' },
    ]);
    const colourSource = fs.readFileSync(path.join(ROOT, 'skill/scripts/island/colour.js'), 'utf8');
    assert.match(colourSource, /root\.appendChild\(line\); root\.appendChild\(imageDrop\(\)\); root\.appendChild\(paletteLibrary\(\)\)/);
    assert.match(colourSource, /Previously ruled out/);
  });

  it('refuses a personal-use face at the shared licence gate', () => {
    const island = evaluateCore();
    assert.equal(island.library.canApplyFace({ id: 'trial', licence: 'personal' }), false);
    assert.equal(island.library.canApplyFace({ id: 'web', licence: 'web' }), true);
  });
});

describe('Review Island Type studio', () => {
  it('estimates reading measure from element width and half-em character width', () => {
    const island = evaluateIsland({ files: ['type.js'] });
    assert.equal(island.type.estimateMeasure(544, 16), 68);
    assert.equal(island.type.estimateMeasure(0, 16), 0);
  });
});

describe('Review Island Compare memory', () => {
  it('keeps the taste profile silent below its evidence floor', () => {
    const island = evaluateIsland({ files: ['compare.js'] });
    island.state.data.candidates = [
      { id: 'c1', name: 'One' },
      { id: 'c2', name: 'Two' },
      { id: 'c3', name: 'Three' },
    ];
    island.state.data.verdicts = [
      { id: 'v1', candidateId: 'c1', verdict: 'love', at: '2026-08-24T20:00:00.000Z' },
      { id: 'v2', candidateId: 'c2', verdict: 'like', at: '2026-08-24T20:01:00.000Z' },
      { id: 'v3', candidateId: 'c3', verdict: 'no', at: '2026-08-24T20:02:00.000Z' },
    ];

    const profile = island.compare.tasteProfile();
    assert.equal(profile.evidence, 3);
    assert.equal(profile.enough, false);
    assert.deepEqual(Array.from(profile.statements), []);
  });

  it('does not let historical verdicts complete a new blind round', () => {
    const island = evaluateIsland({ files: ['compare.js'] });
    island.state.data.candidates = [
      { id: 'c1', name: 'One', tokens: {}, faces: {}, conventional: false },
      { id: 'c2', name: 'Two', tokens: {}, faces: {}, conventional: true },
    ];
    island.state.data.verdicts = [
      { id: 'old-1', roundId: 'old', candidateId: 'c1', verdict: 'love', at: '2026-08-23T20:00:00.000Z' },
      { id: 'old-2', roundId: 'old', candidateId: 'c2', verdict: 'no', at: '2026-08-23T20:01:00.000Z' },
    ];

    const round = island.compare.beginRound();
    assert.notEqual(round.id, 'old');
    assert.equal(island.compare.keep('Empty'), null);
    island.compare.verdict('c1', 'like');
    assert.equal(island.compare.roundComplete(), false);
    assert.equal(island.state.data.review.compare.conventionalRevealed, false);
    island.compare.verdict('c2', 'love');
    assert.equal(island.compare.roundComplete(), true);
    assert.equal(island.state.data.review.compare.conventionalRevealed, true);
  });

  it('restores host inline token baselines in serialized wide preview clones', () => {
    function previewDocument(initialStyle) {
      const makeStyle = (seed) => {
        const values = new Map(Object.entries(seed));
        return {
          values,
          setProperty: (name, value) => values.set(name, String(value)),
          removeProperty: (name) => values.delete(name),
        };
      };
      const liveStyle = makeStyle(initialStyle);
      const head = { firstChild: null, insertBefore: () => {}, appendChild: () => {} };
      const documentElement = {
        style: liveStyle,
        cloneNode: () => {
          const style = makeStyle(Object.fromEntries(liveStyle.values));
          return {
            style,
            firstChild: head,
            querySelector: (selector) => selector === 'head' ? head : null,
            querySelectorAll: () => [],
            insertBefore: () => {},
            get outerHTML() {
              const declaration = Array.from(style.values, ([name, value]) => `${name}:${value}`).join(';');
              return `<html style="${declaration}"><head></head><body></body></html>`;
            },
          };
        },
      };
      return {
        currentScript: null,
        querySelector: () => null,
        addEventListener: () => {},
        documentElement,
        styleSheets: [],
        createElement: () => ({ setAttribute: () => {}, textContent: '', href: '' }),
      };
    }

    const document = previewDocument({ '--ink': '#222222', '--accent': '#d04b64', color: 'red' });
    const island = evaluateIsland({ files: ['compare.js'], globals: { document } });
    island.state.data.review.colour = { originalInline: { '--ink': '', '--accent': '#315efb' } };
    island.state.data.overrides.colors = {
      '--accent-light': { name: '--accent', theme: 'light', was: '#315efb', now: '#d04b64' },
    };
    assert.deepEqual(new Set(island.compare.liveTokenNames()), new Set(['--ink', '--accent']));
    const serialized = island.compare.serializePreview({ id: 'c1', name: 'One', tokens: {}, faces: {} });
    assert.match(serialized, /--accent:#315efb/);
    assert.doesNotMatch(serialized, /--ink:/);
    assert.doesNotMatch(serialized, /--accent:#d04b64/);
    assert.match(serialized, /color:red/);
  });
});

describe('Review Island undo history', () => {
  it('restores the previous value and can redo the same change', () => {
    const island = evaluateCore();
    let value = 'before';
    island.history.perform({
      label: 'Change test value',
      apply: () => { value = 'after'; },
      revert: () => { value = 'before'; },
    });

    assert.equal(value, 'after');
    assert.equal(island.history.undo(), true);
    assert.equal(value, 'before');
    assert.equal(island.history.redo(), true);
    assert.equal(value, 'after');
  });

  it('keeps a failed undo on the undo stack instead of reporting success', () => {
    const island = evaluateCore();
    island.history.record({
      label: 'Unapplied revert',
      apply: () => true,
      revert: () => false,
    });

    assert.equal(island.history.undo(), false);
    assert.deepEqual(plain(island.history.state()), { undo: 1, redo: 0 });
  });

  it('keeps a failed redo on the redo stack instead of reporting success', () => {
    const island = evaluateCore();
    island.history.record({
      label: 'Unapplied replay',
      apply: () => false,
      revert: () => true,
    });
    assert.equal(island.history.undo(), true);

    assert.equal(island.history.redo(), false);
    assert.deepEqual(plain(island.history.state()), { undo: 0, redo: 1 });
  });
});

describe('Review Island shadow keyboard routing', () => {
  it('recognizes an editable control from the composed path after retargeting', () => {
    const island = evaluateCore();
    const host = { tagName: 'REVIEW-ISLAND' };
    const textarea = { tagName: 'TEXTAREA' };
    const textInput = { tagName: 'INPUT', type: 'text' };
    const rangeInput = { tagName: 'INPUT', type: 'range' };
    assert.equal(island.dom.isEditingEvent({ target: host, composedPath: () => [textarea, host] }), true);
    assert.equal(island.dom.isEditingEvent({ target: host, composedPath: () => [textInput, host] }), true);
    assert.equal(island.dom.isEditingEvent({ target: host, composedPath: () => [rangeInput, host] }), false);
    assert.equal(island.dom.isEditingEvent({ target: host, composedPath: () => [host] }), false);
  });
});

describe('Review Island storage', () => {
  it('derives project identity from explicit value, then library, then serving origin', () => {
    const explicit = evaluateCore({ globals: {
      REVIEW_PROJECT: 'explicit-project',
      REVIEW_LIBRARY: { project: 'library-project', palettes: [], faces: [], retired: [] },
      location: { pathname: '/one', protocol: 'https:', origin: 'https://example.test', href: 'https://example.test/one' },
    } });
    const library = evaluateCore({ globals: {
      REVIEW_LIBRARY: { project: 'library-project', palettes: [], faces: [], retired: [] },
      location: { pathname: '/two', protocol: 'https:', origin: 'https://example.test', href: 'https://example.test/two' },
    } });
    const origin = evaluateCore({ globals: {
      location: { pathname: '/three', protocol: 'https:', origin: 'https://example.test', href: 'https://example.test/three' },
    } });

    assert.equal(explicit.memory.project, 'explicit-project');
    assert.equal(library.memory.project, 'library-project');
    assert.equal(origin.memory.project, 'https://example.test');
  });

  it('round-trips one pathname without leaking into another pathname', () => {
    const values = new Map();
    const storage = memoryStorage(values);
    const first = evaluateCore({ pathname: '/alpha', storage });
    first.state.data.pageComment = 'Keep the hierarchy quiet.';
    first.state.data.pins.push({ id: 'p1', note: 'Move this.', reviewer: 'Ema' });
    first.persist();

    const reloaded = evaluateCore({ pathname: '/alpha', storage });
    const otherPage = evaluateCore({ pathname: '/beta', storage });
    assert.equal(reloaded.storage.key, 'review.island:/alpha');
    assert.equal(reloaded.state.data.pageComment, 'Keep the hierarchy quiet.');
    assert.equal(reloaded.state.data.pins[0].note, 'Move this.');
    assert.equal(otherPage.state.data.pageComment, '');
    assert.deepEqual(Array.from(otherPage.state.data.pins), []);
  });

  it('remembers a judged candidate across pathnames in the same explicit project', () => {
    const values = new Map();
    const storage = memoryStorage(values);
    const first = evaluateIsland({ pathname: '/alpha', storage, files: ['compare.js'], globals: { REVIEW_PROJECT: 'portfolio' } });
    first.state.data.candidates = [{ id: 'quiet', name: 'Quiet', tokens: {}, faces: {}, conventional: false }];
    first.compare.verdict('quiet', 'love', 'Keep this restraint.');

    const second = evaluateCore({ pathname: '/beta', storage, globals: { REVIEW_PROJECT: 'portfolio' } });
    assert.equal(second.memory.project, 'portfolio');
    assert.equal(second.state.data.candidates.find((candidate) => candidate.id === 'quiet').verdict, 'love');
    assert.equal(second.state.data.verdicts.find((verdict) => verdict.candidateId === 'quiet').words, 'Keep this restraint.');
  });

  it('restores a server verdict after the project cache has been cleared', async () => {
    const storage = memoryStorage();
    const calls = [];
    const island = evaluateCore({ pathname: '/beta', storage, globals: {
      REVIEW_PROJECT: 'portfolio',
      REVIEW_ENDPOINT: '/api/review',
      location: { pathname: '/beta', protocol: 'http:', origin: 'http://127.0.0.1:8795', href: 'http://127.0.0.1:8795/beta' },
      fetch: async (url, options = {}) => {
        calls.push({ url: String(url), options });
        return {
          ok: true,
          json: async () => ({
            project: 'portfolio',
            candidates: [{ id: 'quiet', name: 'Quiet', tokens: {}, faces: {}, verdict: 'like', at: '2026-08-25T08:00:00.000Z' }],
            verdicts: [{ id: 'v-server', candidateId: 'quiet', verdict: 'like', words: 'Still right.', at: '2026-08-25T08:00:00.000Z' }],
          }),
        };
      },
    } });

    await island.memory.mount();

    assert.ok(calls.some((call) => /\/api\/review\/memory\?project=portfolio$/.test(call.url)));
    assert.equal(island.state.data.candidates[0].verdict, 'like');
    assert.equal(island.state.data.verdicts[0].words, 'Still right.');
    assert.ok(storage.values.has('review.island.memory:portfolio'));
  });

  it('degrades without a server and tells the user the candidate memory is browser-local', async () => {
    const island = evaluateCore({ pathname: '/offline', globals: { REVIEW_PROJECT: 'portfolio' } });
    const statuses = [];
    island.events.on('status:set', (message) => statuses.push(message));

    const result = await island.memory.mount();

    assert.equal(result.durable, false);
    assert.match(statuses.at(-1), /candidate memory is local to this browser/i);
  });

  it('posts each verdict to the project memory endpoint', async () => {
    const calls = [];
    const island = evaluateIsland({ pathname: '/alpha', files: ['compare.js'], globals: {
      REVIEW_PROJECT: 'portfolio',
      REVIEW_ENDPOINT: 'http://127.0.0.1:8795/api/review',
      location: { pathname: '/tmp/alpha.html', protocol: 'file:', origin: 'null', href: 'file:///tmp/alpha.html' },
      fetch: async (url, options = {}) => {
        calls.push({ url: String(url), options });
        return { ok: true, json: async () => ({ saved: true }) };
      },
    } });
    island.state.data.candidates = [{ id: 'quiet', name: 'Quiet', tokens: {}, faces: {}, conventional: false }];

    island.compare.verdict('quiet', 'no', 'Too restrained.');
    await island.memory.flush();

    const call = calls.find((entry) => /\/api\/review\/memory$/.test(entry.url));
    assert.ok(call, 'the verdict must reach the durable-memory route');
    const payload = JSON.parse(call.options.body);
    assert.equal(payload.project, 'portfolio');
    assert.equal(payload.verdict.verdict, 'no');
    assert.equal(payload.candidate.id, 'quiet');
  });
});

describe('Review Island extension bridge', () => {
  it('attaches a Chrome capture to a comment note', async () => {
    const island = evaluateIsland({ files: ['comment.js'] });
    const note = { id: 'p1', note: 'Compare the fold.', image: '', saved: true };
    let captures = 0;
    island.setAdapter({
      capture: async () => { captures += 1; return 'data:image/png;base64,c2NyZWVuc2hvdA=='; },
    });

    await island.comment.captureScreenshot(note);

    assert.equal(captures, 1);
    assert.equal(note.image, 'data:image/png;base64,c2NyZWVuc2hvdA==');
  });
});

describe('Review Island durable server memory', () => {
  it('appends verdicts and Go rounds beside the taste ledger and loads by project', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'review-memory-home-'));
    temporaryDirectories.push(home);
    const serverPath = path.join(ROOT, 'skill/scripts/review-serve.py');
    const program = `
import importlib.util, io, json, pathlib, contextlib
spec = importlib.util.spec_from_file_location("review_serve", ${JSON.stringify(serverPath)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module.ROOT = pathlib.Path(${JSON.stringify(home)}) / "served"
module.ROOT.mkdir(parents=True)
verdict = {
  "project": "portfolio",
  "candidate": {"id": "quiet", "name": "Quiet", "tokens": {}, "faces": {}, "conventional": False},
  "verdict": {"id": "v1", "candidateId": "quiet", "verdict": "love", "at": "2026-08-25T08:00:00.000Z"},
}
round_record = {
  "version": 1, "page": "/alpha", "at": "2026-08-25T08:01:00.000Z", "reviewer": "Ema",
  "sizes": [], "themes": [], "notes": [], "tokens": {}, "faces": {},
  "candidates": [{"id": "quiet", "name": "Quiet", "tokens": {}, "faces": {}, "verdict": "love", "conventional": False, "at": "2026-08-25T08:00:00.000Z", "previous": None}],
  "chosen": "quiet", "unresolved": [],
}
class Dummy(module.Handler):
  def __init__(self, path, payload=None):
    self.path = path
    self.payload = payload
  def read_json(self):
    return self.payload
  def reply(self, code, payload):
    return {"code": code, "payload": payload}

class OptionsDummy:
  def __init__(self):
    self.code = None
    self.headers = {}
  def send_response(self, code):
    self.code = code
  def send_header(self, name, value):
    self.headers[name] = value
  def end_headers(self):
    pass

with contextlib.redirect_stdout(io.StringIO()):
  verdict_result = Dummy("/api/review/memory", verdict).do_POST()
  round_result = Dummy("/api/review?project=portfolio", round_record).do_POST()
loaded_result = Dummy("/api/review/memory?project=portfolio").do_GET()
options = OptionsDummy()
module.Handler.do_OPTIONS(options)
print(json.dumps({"verdict": verdict_result, "round": round_result, "loaded": loaded_result, "options": {"code": options.code, "headers": options.headers}}))
`;
    const result = spawnSync('python3', ['-c', program], { env: { ...process.env, HOME: home, PYTHONDONTWRITEBYTECODE: '1' }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const response = JSON.parse(result.stdout);
    assert.equal(response.verdict.code, 200);
    assert.equal(response.round.payload.durableSaved, true);
    assert.equal(response.loaded.code, 200);
    assert.equal(response.loaded.payload.candidates[0].id, 'quiet');
    assert.equal(response.loaded.payload.verdicts[0].verdict, 'love');
    assert.equal(response.options.code, 204);
    assert.equal(response.options.headers['Access-Control-Allow-Origin'], '*');
    assert.match(response.options.headers['Access-Control-Allow-Methods'], /POST/);
    const tasteDir = path.join(home, '.impeccable', 'taste');
    const verdictLines = fs.readFileSync(path.join(tasteDir, 'review-verdicts.jsonl'), 'utf8').trim().split('\n');
    const roundLines = fs.readFileSync(path.join(tasteDir, 'review-rounds.jsonl'), 'utf8').trim().split('\n');
    assert.equal(verdictLines.length, 1);
    assert.equal(roundLines.length, 1);
    assert.equal(JSON.parse(verdictLines[0]).project, 'portfolio');
    assert.equal(JSON.parse(roundLines[0]).project, 'portfolio');
  });
});

describe('Review Island Go contract', () => {
  it('posts each Go with the durable project identity', async () => {
    const calls = [];
    const island = evaluateIsland({ files: ['pins.js'], globals: {
      REVIEW_PROJECT: 'portfolio',
      REVIEW_ENDPOINT: 'http://127.0.0.1:8795/api/review',
      location: { pathname: '/tmp/alpha.html', protocol: 'file:', origin: 'null', href: 'file:///tmp/alpha.html' },
      fetch: async (url, options = {}) => {
        calls.push({ url: String(url), options });
        return { ok: true, json: async () => ({ saved: true }) };
      },
    } });

    const result = await island.pins.handoff(island.pins.recordGo());

    assert.equal(result.posted, true);
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/api\/review\?project=portfolio$/);
  });

  it('emits the Section 17.6 object with page and element notes plus was/now diffs', () => {
    const storage = memoryStorage();
    const document = {
      currentScript: null,
      styleSheets: [],
      documentElement: { getAttribute: () => null },
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: () => {},
    };
    const window = {
      document,
      location: { pathname: '/contract', protocol: 'file:', search: '', hash: '' },
      localStorage: storage,
      innerWidth: 1280,
      setTimeout,
      getComputedStyle: () => ({ colorScheme: 'light' }),
      matchMedia: () => ({ matches: false }),
    };
    const sources = ['core.js', 'comment.js', 'pins.js']
      .map((file) => fs.readFileSync(path.join(ROOT, 'skill/scripts/island', file), 'utf8'))
      .join('\n');
    const context = vm.createContext({ window, console, setTimeout });
    vm.runInContext(`${sources}\nwindow.__reviewIslandCore = Island;`, context);
    const island = window.__reviewIslandCore;
    island.state.data.pageComment = 'Keep the page calm.';
    island.state.data.review.pageCommentAt = '2026-08-24T20:00:00.000Z';
    island.state.data.review.pageCommentReviewer = 'Ema';
    island.state.data.pins = [{
      id: 'p1', note: 'Reduce this.', kind: 'Change', state: 'open', path: 'html > body > h1:nth-of-type(1)',
      text: 'A loud heading', x: 0.5, y: 0.25, size: 834, theme: 'dark', reviewer: 'Edo', time: '2026-08-24T20:01:00.000Z',
    }];
    island.state.data.overrides.colors['--ink'] = { was: '#111111', now: '#222222', role: 'ink', space: 'oklch' };
    island.state.data.overrides.type.body = {
      was: { family: 'Old Serif', stack: 'serif' },
      now: { family: 'New Sans', stack: 'sans-serif', source: 'project', licence: 'web' },
      size: 18, line_height: 1.5, measure: 68, axes: { wght: 450 },
    };
    island.state.data.candidates = [{
      id: 'c1', name: 'Quiet', tokens: { '--ink': '#222222' }, faces: {}, reviewer: 'Edo', conventional: true,
      at: '2026-08-24T20:00:00.000Z',
    }, {
      id: 'c-personal', name: 'Trial face', tokens: {},
      faces: { display: { now: { id: 'trial-display', family: 'Trial Display', stack: 'Trial Display, serif', licence: 'personal' } } },
      verdict: 'like', reviewer: 'Ema', conventional: false, at: '2026-08-24T20:03:00.000Z',
    }, {
      id: 'c-unjudged', name: 'Not judged', tokens: {}, faces: {}, conventional: false,
      at: '2026-08-24T20:04:00.000Z',
    }];
    island.state.data.verdicts = [{
      id: 'v1', candidateId: 'c1', verdict: 'like', reviewer: 'Edo', at: '2026-08-24T20:01:00.000Z',
    }, {
      id: 'v2', candidateId: 'c1', verdict: 'love', reviewer: 'Edo', at: '2026-08-24T20:02:00.000Z',
      previous: { verdict: 'like', at: '2026-08-24T20:01:00.000Z', reviewer: 'Edo' },
    }];
    island.state.data.unresolved = ['A blocked font did not load.'];

    const record = island.pins.recordGo();
    assert.deepEqual(Object.keys(record), [
      'version', 'page', 'at', 'reviewer', 'sizes', 'themes', 'notes', 'tokens', 'faces', 'candidates', 'chosen', 'unresolved',
    ]);
    assert.equal(record.version, 1);
    assert.equal(record.notes[0].scope, 'page');
    assert.equal(record.notes[1].scope, 'element');
    assert.equal(record.notes[1].kind, 'change');
    assert.equal(record.notes[1].reviewer, 'Edo');
    assert.equal(record.tokens['--ink'].was, '#111111');
    assert.equal(record.tokens['--ink'].now, '#222222');
    for (const token of Object.values(record.tokens)) {
      assert.deepEqual(Object.keys(token), ['was', 'now', 'role', 'space']);
      assert.equal(Object.hasOwn(token, 'was'), true);
      assert.equal(Object.hasOwn(token, 'now'), true);
    }
    for (const face of Object.values(record.faces)) {
      assert.equal(Object.hasOwn(face, 'was'), true);
      assert.equal(Object.hasOwn(face, 'now'), true);
    }
    assert.equal(record.candidates[0].verdict, 'love');
    assert.equal(record.candidates.length, 1);
    assert.deepEqual(Object.keys(record.candidates[0]), ['id', 'name', 'tokens', 'faces', 'verdict', 'conventional', 'at', 'previous']);
    assert.deepEqual(Object.keys(record.candidates[0].previous), ['verdict', 'at']);
    assert.deepEqual(plain(record.candidates[0].previous), { verdict: 'like', at: '2026-08-24T20:01:00.000Z' });
    assert.equal(record.candidates.some((candidate) => candidate.id === 'c-personal'), false);
    assert.equal(record.candidates.some((candidate) => candidate.id === 'c-unjudged'), false);
    assert.ok(record.unresolved.some((item) => /not licensed for web hand-off/.test(item)));
    assert.ok(record.unresolved.some((item) => /has no verdict and was omitted/.test(item)));
    assert.ok(Array.isArray(record.unresolved));
    const preview = island.pins.previewText(record);
    assert.match(preview, /Page: \/contract\./);
    assert.match(preview, /Prepared at .* by local\./);
    assert.match(preview, /scope element; path "html > body > h1:nth-of-type\(1\)"; text hint "A loud heading"; point 0\.5, 0\.25/);
    assert.match(preview, /--ink \(ink, oklch\): "#111111" -> "#222222"/);
    assert.match(preview, /body: was \{"family":"Old Serif","stack":"serif"\}; now \{"family":"New Sans","stack":"sans-serif","source":"project","licence":"web"\}/);
    assert.match(preview, /size 18; line-height 1\.5; measure 68; axes \{"wght":450\}/);
    assert.match(preview, /Candidate "c1", "Quiet": love by local \[conventional option\]/);
    assert.match(preview, /at "2026-08-24T20:02:00\.000Z"/);
    assert.ok(record.unresolved.includes('A blocked font did not load.'));
  });

  it('generates the twelve-step sRGB fallback ramp only when Go exports live colour work', () => {
    const storage = memoryStorage();
    const document = {
      currentScript: null,
      styleSheets: [],
      documentElement: { getAttribute: () => null },
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: () => {},
    };
    const window = {
      document,
      location: { pathname: '/ramp-contract', protocol: 'file:', search: '', hash: '' },
      localStorage: storage,
      innerWidth: 1280,
      setTimeout,
      getComputedStyle: () => ({ colorScheme: 'light' }),
      matchMedia: () => ({ matches: false }),
    };
    const sources = ['core.js', 'colour.js', 'pins.js']
      .map((file) => fs.readFileSync(path.join(ROOT, 'skill/scripts/island', file), 'utf8'))
      .join('\n');
    const context = vm.createContext({ window, console, setTimeout });
    vm.runInContext(`${sources}\nwindow.__reviewIslandCore = Island;`, context);
    const island = window.__reviewIslandCore;
    island.state.data.overrides.colors['--accent-light'] = { was: 'oklch(56% 0.18 265)', now: 'oklch(60% 0.18 20)', wasSrgb: '#315efb', srgb: '#d04b64', name: '--accent', theme: 'light', role: 'accent', space: 'oklch' };
    island.state.data.review.colour = {
      maps: {
        light: {
          accent: { was: '#315efb', wasOklch: 'oklch(56% 0.18 265)', now: '#d04b64', oklch: 'oklch(60% 0.18 20)', wasSrgb: '#315efb', srgb: '#d04b64', role: 'accent', space: 'oklch', name: '--accent', source: 'token' },
          ground: { was: '#ffffff', wasOklch: 'oklch(100% 0 0)', now: '#f7f5ef', oklch: 'oklch(97% 0.01 90)', wasSrgb: '#ffffff', srgb: '#f7f5ef', role: 'ground', space: 'oklch', name: '--review-ground', source: 'painted', usages: [{ path: 'html > body', property: 'backgroundColor' }] },
        },
        dark: { accent: { was: '#8ea5ff', wasOklch: 'oklch(72% 0.12 265)', now: '#ff8da1', oklch: 'oklch(75% 0.12 20)', wasSrgb: '#8ea5ff', srgb: '#ff8da1', role: 'accent', space: 'oklch', name: '--accent', source: 'token' } },
      },
      roles: {}, stateRoles: false, simulation: 0, originalInline: {},
    };

    assert.equal(Object.keys(island.state.data.overrides.colors).length, 1);
    const record = island.pins.recordGo();
    const ramp = Object.entries(record.tokens).filter(([name]) => /^--accent-light-\d{2}$/.test(name));
    const fallbackRamp = Object.entries(record.tokens).filter(([name]) => /^--accent-light-\d{2}-srgb$/.test(name));
    assert.equal(ramp.length, 12);
    assert.equal(fallbackRamp.length, 12);
    assert.equal(record.tokens['--accent-light'].space, 'oklch');
    assert.equal(record.tokens['--accent-light-srgb'].space, 'srgb');
    assert.equal(record.tokens['--accent-dark'].now, 'oklch(75% 0.12 20)');
    assert.equal(record.tokens['--accent-dark-srgb'].now, '#ff8da1');
    assert.equal(Object.keys(record.tokens).some((name) => name.startsWith('__island_')), false);
    assert.ok(record.unresolved.some((item) => item.includes('html > body') && item.includes('backgroundColor')));
    for (const [, token] of ramp) {
      assert.equal(Object.hasOwn(token, 'was'), true);
      assert.equal(token.was, null);
      assert.match(token.now, /^oklch\(/);
      assert.equal(token.space, 'oklch');
    }
    for (const [, token] of fallbackRamp) {
      assert.match(token.now, /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i);
      assert.equal(token.space, 'srgb');
    }
  });

  it('reports clipboard and download degradation without claiming either succeeded', async () => {
    const storage = memoryStorage();
    function fakeNode() {
      return {
        style: {}, dataset: {}, children: [],
        setAttribute() {}, addEventListener() {}, appendChild(child) { this.children.push(child); return child; },
        select() {}, click() { throw new Error('Downloads blocked.'); }, remove() {},
      };
    }
    const document = {
      currentScript: null,
      styleSheets: [],
      documentElement: { getAttribute: () => null },
      body: { appendChild: (node) => node },
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: fakeNode,
      addEventListener: () => {},
      execCommand: () => { throw new Error('Clipboard blocked.'); },
    };
    const window = {
      document,
      location: { pathname: '/degraded', protocol: 'file:', search: '', hash: '' },
      localStorage: storage,
      innerWidth: 390,
      setTimeout,
      getComputedStyle: () => ({ colorScheme: 'light' }),
      matchMedia: () => ({ matches: false }),
    };
    const sources = ['core.js', 'comment.js', 'pins.js']
      .map((file) => fs.readFileSync(path.join(ROOT, 'skill/scripts/island', file), 'utf8'))
      .join('\n');
    const context = vm.createContext({ window, console, setTimeout, Promise });
    vm.runInContext(`${sources}\nwindow.__reviewIslandCore = Island;`, context);
    const island = window.__reviewIslandCore;
    const result = await island.pins.handoff(island.pins.recordGo());

    assert.equal(result.posted, false);
    assert.equal(result.copied, false);
    assert.equal(result.downloaded, false);
  });
});

describe('Review Island concatenator', () => {
  it('emits present sources in the specification order inside one outer IIFE', () => {
    const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-island-order-'));
    temporaryDirectories.push(sourceDir);
    ISLAND_SOURCE_ORDER.forEach((file) => {
      fs.writeFileSync(path.join(sourceDir, file), `global.__order.push('${file}');\n`);
    });

    const result = concatenateIsland({ sourceDir });
    assert.deepEqual(result.included, ISLAND_SOURCE_ORDER);
    let previous = -1;
    for (const file of ISLAND_SOURCE_ORDER) {
      const index = result.code.indexOf(`/* island:${file} */`);
      assert.ok(index > previous, `${file} must follow the prior source`);
      previous = index;
    }
    assert.match(result.code, /^\/\* review-layer\.js[^\n]+\n\(function \(global\) \{/);
    assert.match(result.code, /\}\)\(typeof window !== 'undefined' \? window : globalThis\);\n$/);
  });
});

describe('Review Island boot', () => {
  it('creates no DOM when neither URL flag nor the keyboard entry is used', () => {
    const sourceDir = path.join(ROOT, 'skill/scripts/island');
    const { code } = concatenateIsland({ sourceDir });
    const listeners = {};
    let created = 0;
    const storage = memoryStorage();
    const document = {
      currentScript: { dataset: { sizes: '1280,834,390' } },
      readyState: 'complete',
      styleSheets: [],
      documentElement: {},
      querySelector: () => null,
      createElement: () => { created += 1; throw new Error('Boot created page DOM without an entry flag.'); },
      addEventListener: (name, listener) => { listeners[`document:${name}`] = listener; },
    };
    const window = {
      document,
      location: { pathname: '/clean', protocol: 'file:', search: '', hash: '' },
      localStorage: storage,
      crypto: { randomUUID: () => '00000000-0000-0000-0000-000000000000' },
      setTimeout,
      addEventListener: (name, listener) => { listeners[`window:${name}`] = listener; },
      removeEventListener: () => {},
    };
    const context = vm.createContext({ window, globalThis: window, console, setTimeout });

    vm.runInContext(code, context);

    assert.equal(created, 0);
    assert.equal(typeof window.reviewLayer.install, 'function');
    assert.equal(typeof window.reviewLayer.undo, 'function');
    assert.equal(typeof window.reviewLayer.redo, 'function');
    assert.equal(window.reviewLayer._state.mounted, false);
    assert.equal(typeof listeners['document:keydown'], 'function');
  });
});
