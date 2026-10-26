import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const listenerPath = new URL('./pageerror-listener.js', import.meta.url);
const listenerText = readFileSync(listenerPath, 'utf8');

function createFakeWindow() {
  const handlers = new Map();
  const window = {
    addEventListener(type, handler) {
      const listeners = handlers.get(type) ?? [];
      listeners.push(handler);
      handlers.set(type, listeners);
    },
  };

  return { window, handlers };
}

function install(window) {
  new Function('window', listenerText)(window);
}

test('page-error listener captures errors and unhandled rejections', () => {
  const { window, handlers } = createFakeWindow();
  install(window);

  assert.ok(Array.isArray(window.__polluxPageErrors));

  handlers.get('error')[0]({
    message: 'Boom',
    error: { message: 'Boom', stack: 'at x' },
  });
  assert.deepEqual(window.__polluxPageErrors[0], {
    type: 'error',
    message: 'Boom',
    stack: 'at x',
  });

  handlers.get('unhandledrejection')[0]({
    reason: { message: 'Nope', stack: 'at y' },
  });
  assert.deepEqual(window.__polluxPageErrors[1], {
    type: 'unhandledrejection',
    message: 'Nope',
    stack: 'at y',
  });
});

test('page-error listener is idempotent', () => {
  const { window, handlers } = createFakeWindow();
  install(window);
  window.__polluxPageErrors.push({ type: 'sentinel' });

  install(window);

  assert.deepEqual(window.__polluxPageErrors, [{ type: 'sentinel' }]);
  assert.equal(handlers.get('error').length, 1);
  assert.equal(handlers.get('unhandledrejection').length, 1);
});

test('page-error listener source matches the capability-critical hash', () => {
  const hash = createHash('sha256').update(listenerText).digest('hex');

  assert.equal(hash, '0eac4119eb286f299403624143fa61f5145c80623bcd89fca032caf877b8861f');
});
