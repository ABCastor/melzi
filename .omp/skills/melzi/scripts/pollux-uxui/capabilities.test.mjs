import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { capabilities, requireCapabilities } from './capabilities.mjs';

const missingPageErrors = JSON.parse(readFileSync(
  new URL('./fixtures/canary/noscript-missing-cap.json', import.meta.url),
  'utf8',
));

const required = [
  'pageErrors',
  'network',
  'a11yTree',
  'consoleMessages',
  'bbox',
  'screenshot',
];

test('missing injected page-error channel hard-fails by capability name', () => {
  const caps = capabilities({
    pageErrors: missingPageErrors.pageErrorsChannel,
    network: [],
    a11yTree: {},
    consoleMessages: [],
    bbox: {},
    screenshot: '.playwright-mcp/page.png',
  });

  assert.equal(caps.pageErrors, false);
  assert.throws(
    () => requireCapabilities(caps, required),
    /pageErrors/,
  );
});

test('all required capabilities return unchanged', () => {
  const caps = capabilities({
    pageErrors: [],
    network: [],
    a11yTree: {},
    consoleMessages: [],
    bbox: { x: 0, y: 0, w: 1, h: 1 },
    screenshot: '.playwright-mcp/page.png',
  });

  assert.deepEqual(requireCapabilities(caps, required), caps);
  assert.ok(required.every((name) => caps[name]));
});
