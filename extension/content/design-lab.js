/**
 * Extension door for the Review Island.
 *
 * `design-lab-options.js` is generated from the same built island that script
 * tags use.  This hand-authored file only supplies the extension capabilities
 * that a normal page cannot have: Chrome screenshots and reversible USER CSS.
 */
(function () {
  if (window.__IMPECCABLE_DESIGN_LAB_LOADED__) return;
  window.__IMPECCABLE_DESIGN_LAB_LOADED__ = true;

  let enabled = false;
  let activeCss = '';

  function runtimeMessage(message) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          const error = chrome.runtime.lastError;
          if (error) reject(new Error(error.message));
          else resolve(response || { ok: false, error: 'No response from Melzi.' });
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  async function capture() {
    const response = await runtimeMessage({ action: 'capture-design-lab' });
    if (!response?.ok) throw new Error(response?.error || 'Chrome could not capture this tab.');
    return response.dataUrl;
  }

  async function apply(css, previousCss = activeCss) {
    const response = await runtimeMessage({
      action: 'apply-design-lab-theme',
      css: css || '',
      previousCss: previousCss || '',
    });
    if (!response?.ok) throw new Error(response?.error || 'Could not apply page styles.');
    activeCss = css || '';
    return response;
  }

  async function remove(css = activeCss) {
    const response = await runtimeMessage({
      action: 'remove-design-lab-theme',
      css: css || '',
    });
    if (!response?.ok) throw new Error(response?.error || 'Could not remove page styles.');
    if (!css || css === activeCss) activeCss = '';
    return response;
  }

  const adapter = Object.freeze({ capture, apply, remove });

  function island() {
    return window.reviewLayer || window.Island || null;
  }

  function bindAdapter() {
    const candidate = island();
    if (!candidate) return null;

    // A content script has no <script data-sizes> element. Supply the same
    // useful review widths without changing the script-tag door's opt-in rule.
    const sourceState = candidate._state || candidate.state;
    if (sourceState && Array.isArray(sourceState.sizes) && sourceState.sizes.length === 0) {
      sourceState.sizes = [1280, 834, 390];
    }

    // The public facade delegates to the source-level private API. Keep the
    // fallbacks for generated builds spanning a source/build version boundary.
    if (typeof candidate.setAdapter === 'function') candidate.setAdapter(adapter);
    else if (typeof candidate._setAdapter === 'function') candidate._setAdapter(adapter);
    else if (typeof candidate._setExtensionBridge === 'function') candidate._setExtensionBridge(adapter);
    else candidate._adapter = adapter;
    return candidate;
  }

  async function setIslandEnabled(nextEnabled) {
    const candidate = bindAdapter();
    if (!candidate) throw new Error('The Review Island did not load.');

    const setter = candidate._setEnabled || candidate.setEnabled || candidate._extensionSetEnabled;
    if (typeof setter === 'function') {
      await setter.call(candidate, nextEnabled);
      return;
    }

    // The old built island only exposes toggle(). Retain that narrow fallback
    // so a cached extension never loses its on/off control during an update.
    if (typeof candidate.toggle === 'function') {
      await candidate.toggle(nextEnabled);
      return;
    }
    throw new Error('The Review Island has no enable control.');
  }

  function contentState() {
    const candidate = bindAdapter();
    const reported = typeof candidate?._getContentState === 'function'
      ? candidate._getContentState()
      : typeof candidate?.getContentState === 'function'
        ? candidate.getContentState()
        : null;
    const state = reported && typeof reported === 'object'
      ? reported
      : candidate?._state || candidate?.state || {};
    const notes = state.notes || state.comments || state.pins || [];
    return {
      ok: true,
      enabled: typeof reported?.enabled === 'boolean' ? reported.enabled : enabled,
      commentCount: Array.isArray(notes) ? notes.length : 0,
      design: state.design || state.studio || {},
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.action === 'design-lab-set-enabled') {
      (async () => {
        const nextEnabled = Boolean(message.enabled);
        try {
          if (!nextEnabled) await remove();
          await setIslandEnabled(nextEnabled);
          enabled = nextEnabled;
          sendResponse({ ok: true, enabled });
        } catch (error) {
          if (nextEnabled) {
            enabled = false;
            await remove().catch(() => {});
          }
          sendResponse({ ok: false, error: error?.message || String(error) });
        }
      })();
      return true;
    }

    if (message.action === 'design-lab-get-content-state') {
      sendResponse(contentState());
      return true;
    }

    return false;
  });

  // The service worker answers with the remembered per-tab state. Delaying the
  // bind by one microtask permits a generated island finishing boot to publish
  // its private API without making activation race injection order.
  Promise.resolve().then(bindAdapter);
  chrome.runtime.sendMessage({ action: 'design-lab-ready' }, (response) => {
    if (chrome.runtime.lastError || !response?.enabled) return;
    setIslandEnabled(true).then(() => { enabled = true; }).catch(() => {});
  });
})();
