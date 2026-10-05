import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('extension DevTools packaging', () => {
  it('uses extension-root paths for DevTools panel pages', () => {
    const source = readFileSync(path.join(ROOT, 'extension/devtools/devtools.js'), 'utf-8');

    // The panel name is pinned here as well as in scripts/rebrand.mjs's IDENTITY_RULES:
    // this assertion is the only reader of it (brand-user-visible.test.mjs skips it, as a
    // space-free literal reads as an identifier there). tests/ is outside the transform, so
    // a rename edits both in one pass or the suite goes red.
    assert.match(
      source,
      /chrome\.devtools\.panels\.create\(\s*['"]Melzi['"],\s*['"]\/icons\/icon-32\.png['"],\s*['"]\/devtools\/panel\.html['"]\s*\)/s,
      'Firefox resolves DevTools URLs relative to devtools.html unless they start at the extension root',
    );
    assert.match(source, /sidebar\.setPage\(['"]\/devtools\/sidebar\.html['"]\)/);
    assert.doesNotMatch(source, /['"]devtools\/(?:panel|sidebar)\.html['"]/);
    assert.doesNotMatch(source, /['"]icons\/icon-32\.png['"]/);
  });

  it('ships Design Lab through the existing on-demand MV3 extension', () => {
    const worker = readFileSync(path.join(ROOT, 'extension/background/service-worker.js'), 'utf-8');
    const overlay = readFileSync(path.join(ROOT, 'extension/content/design-lab.js'), 'utf-8');
    const island = readFileSync(path.join(ROOT, 'extension/content/design-lab-options.js'), 'utf-8');
    const popup = readFileSync(path.join(ROOT, 'extension/popup/popup.html'), 'utf-8');
    const manifest = JSON.parse(readFileSync(path.join(ROOT, 'extension/manifest.json'), 'utf-8'));

    assert.match(
      worker,
      /files:\s*\['content\/design-lab-options\.js', 'content\/design-lab\.js'\]/,
      'Design Lab must remain part of this extension and load only on explicit activation',
    );
    assert.match(worker, /chrome\.tabs\.captureVisibleTab\(/);
    assert.match(worker, /chrome\.scripting\.insertCSS\(/);
    assert.match(worker, /chrome\.scripting\.removeCSS\(/);
    assert.match(worker, /chrome\.storage\.session/);
    assert.match(overlay, /window\.__IMPECCABLE_DESIGN_LAB_LOADED__/);
    assert.match(overlay, /design-lab-set-enabled/);
    assert.match(overlay, /design-lab-get-content-state/);
    assert.match(overlay, /capture-design-lab/);
    assert.match(overlay, /apply-design-lab-theme/);
    assert.match(overlay, /remove-design-lab-theme/);
    assert.match(overlay, /window\.reviewLayer/);
    assert.match(island, /\(function \(global\) \{/);
    assert.match(popup, /id="btn-design-lab"/);
    assert.deepEqual(manifest.permissions, ['activeTab', 'scripting', 'storage', 'webNavigation', 'offscreen']);
    assert.equal(manifest.manifest_version, 3);
  });

  it('injects the byte-identical built island before the Chrome bridge', () => {
    const extensionIsland = readFileSync(
      path.join(ROOT, 'extension/content/design-lab-options.js'),
      'utf-8',
    );
    const scriptIsland = readFileSync(path.join(ROOT, 'skill/scripts/review-layer.js'), 'utf-8');
    assert.equal(extensionIsland, scriptIsland);
    assert.doesNotMatch(extensionIsland, /^\s*(?:import|export)\s/m);
  });

  it('reports island-owned enable state and refuses a false-off CSS cleanup', async () => {
    const source = readFileSync(path.join(ROOT, 'extension/content/design-lab.js'), 'utf-8');
    const listeners = [];
    const enabledCalls = [];
    let contentEnabled = false;
    let adapter = null;
    const islandState = { sizes: [] };
    const reviewLayer = {
      _state: islandState,
      setAdapter: (value) => { adapter = value; },
      _setEnabled: async (value) => { enabledCalls.push(value); contentEnabled = value; },
      _getContentState: () => ({ enabled: contentEnabled, notes: [], design: {} }),
    };
    const chrome = {
      runtime: {
        lastError: null,
        onMessage: { addListener: (listener) => listeners.push(listener) },
        sendMessage: (message, callback) => {
          if (message.action === 'design-lab-ready') callback({ ok: true, enabled: true });
          else if (message.action === 'remove-design-lab-theme') callback({ ok: false, error: 'CSS remained installed.' });
          else callback({ ok: true });
        },
      },
    };
    const window = { reviewLayer };
    vm.runInNewContext(source, { window, chrome, console, Promise, Error, Object, setTimeout });
    await Promise.resolve();
    await Promise.resolve();
    assert.ok(adapter, 'the bridge must bind capture/apply/remove capabilities');
    assert.deepEqual(Array.from(islandState.sizes), [1280, 834, 390], 'the extension door must supply widths because it has no data-sizes script tag');
    assert.deepEqual(enabledCalls, [true]);

    contentEnabled = false; // Simulate the island's own Command/Ctrl-Shift-R entry.
    let stateResponse;
    listeners[0]({ action: 'design-lab-get-content-state' }, {}, (response) => { stateResponse = response; });
    assert.equal(stateResponse.enabled, false);

    const disableResponse = await new Promise((resolve) => {
      listeners[0]({ action: 'design-lab-set-enabled', enabled: false }, {}, resolve);
    });
    assert.equal(disableResponse.ok, false);
    assert.match(disableResponse.error, /CSS remained installed/);
    assert.deepEqual(enabledCalls, [true], 'the island must stay enabled when host CSS could not be removed');
  });

  it('routes Design Lab activation, capture, and reversible CSS through the worker', async () => {
    const source = readFileSync(
      path.join(ROOT, 'extension/background/service-worker.js'),
      'utf-8',
    );
    const runtimeListeners = [];
    const executedFiles = [];
    const insertedCss = [];
    const removedCss = [];
    const session = {};

    const chrome = {
      action: {
        setBadgeText: async () => {},
        setBadgeBackgroundColor: async () => {},
      },
      runtime: {
        onMessage: { addListener: (listener) => runtimeListeners.push(listener) },
        onConnect: { addListener: () => {} },
        sendMessage: async () => {},
      },
      scripting: {
        executeScript: async ({ files }) => { executedFiles.push(...files); },
        insertCSS: async ({ css }) => { insertedCss.push(css); },
        removeCSS: async ({ css }) => { removedCss.push(css); },
      },
      storage: {
        sync: { get: async (defaults) => defaults },
        session: {
          get: async (key) => ({ [key]: session[key] }),
          set: async (value) => { Object.assign(session, value); },
          remove: async (key) => { delete session[key]; },
        },
      },
      tabs: {
        captureVisibleTab: async () => 'data:image/png;base64,dGVzdA==',
        get: async () => ({ url: 'https://example.test/products' }),
        onRemoved: { addListener: () => {} },
        sendMessage: async (tabId, message) => {
          if (message.action === 'design-lab-get-content-state') {
            return { ok: true, enabled: true };
          }
          return { ok: true };
        },
      },
      webNavigation: {
        onCompleted: { addListener: () => {} },
      },
    };
    vm.runInNewContext(source, { chrome, console, Map, Set, setTimeout });
    assert.equal(runtimeListeners.length, 1);
    const listener = runtimeListeners[0];

    async function send(message, sender = {}) {
      return new Promise((resolve) => listener(message, sender, resolve));
    }

    const enabled = await send({ action: 'toggle-design-lab', tabId: 17, enabled: true });
    assert.equal(enabled.ok, true);
    assert.deepEqual(executedFiles, [
      'content/design-lab-options.js',
      'content/design-lab.js',
    ]);
    assert.equal(session['impeccable-design-lab:tab:17'], true);

    const captured = await send({ action: 'capture-design-lab' }, { tab: { id: 17, windowId: 3 } });
    assert.equal(captured.dataUrl, 'data:image/png;base64,dGVzdA==');

    const css = ':root { --impeccable-design-lab-background: #000 !important; }';
    await send({ action: 'apply-design-lab-theme', tabId: 17, previousCss: '', css });
    assert.deepEqual(insertedCss, [css]);
    await send({ action: 'remove-design-lab-theme', tabId: 17, css });
    assert.deepEqual(removedCss, [css]);

    const state = await send({ action: 'get-state', tabId: 17 });
    assert.equal(state.designLabEnabled, true);
    assert.equal(state.designLabInjected, true);
  });

});

describe('extension badge colors', () => {
  // Optional-call syntax on a method a browser does not implement returns
  // undefined, and .catch on undefined throws: updateBadge would abort before
  // it set the badge at all. Firefox's action API has no setBadgeTextColor,
  // so the call has to be guarded by an existence check, not by `?.`.
  it('guards setBadgeTextColor instead of chaining .catch onto an optional call', () => {
    const source = readFileSync(path.join(ROOT, 'extension/background/service-worker.js'), 'utf-8');

    assert.doesNotMatch(
      source,
      /setBadgeTextColor\?\.\([^)]*\)\s*\.catch/s,
      'setBadgeTextColor?.(...).catch(...) throws wherever the method is missing',
    );
    assert.match(
      source,
      /typeof chrome\.action\.setBadgeTextColor === 'function'/,
      'the call needs an existence check around it',
    );
    assert.match(
      source,
      /typeof pending\.catch === 'function'/,
      'the return value needs a promise check before .catch',
    );
  });

  it('paints the badge in kinpaku gold with ink text', () => {
    const source = readFileSync(path.join(ROOT, 'extension/background/service-worker.js'), 'utf-8');

    assert.match(source, /setBadgeBackgroundColor\(\{ color: '#ffba00'/);
    assert.match(source, /setBadgeTextColor\(\{ color: '#0b0903'/);
    assert.doesNotMatch(source, /#d6336c/, 'the magenta badge is retired');
  });
});
