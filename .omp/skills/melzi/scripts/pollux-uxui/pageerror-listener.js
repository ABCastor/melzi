(function () {
  if ('__polluxPageErrors' in window) return;

  window.__polluxPageErrors = [];
  window.addEventListener('error', (ev) => {
    window.__polluxPageErrors.push({
      type: 'error',
      message: String(ev.message || ev.error && ev.error.message || ''),
      stack: ev.error && ev.error.stack ? String(ev.error.stack) : undefined,
    });
  });
  window.addEventListener('unhandledrejection', (ev) => {
    window.__polluxPageErrors.push({
      type: 'unhandledrejection',
      message: String((ev.reason && ev.reason.message) || ev.reason || ''),
      stack: ev.reason && ev.reason.stack ? String(ev.reason.stack) : undefined,
    });
  });
})();
