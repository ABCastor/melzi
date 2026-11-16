import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildObservations, parseStream } from './runner.mjs';

const streamText = readFileSync(
  new URL('./fixtures/canary/explorer-stream.jsonl', import.meta.url),
  'utf8',
);

const prefix = 'mcp__playwright__browser_';

test('parseStream pairs the real Playwright calls and results in call order', () => {
  const steps = parseStream(streamText);

  assert.deepEqual(steps.map(({ tool }) => tool.slice(prefix.length)), [
    'navigate',
    'snapshot',
    'click',
    'network_requests',
    'console_messages',
    'evaluate',
    'take_screenshot',
    'evaluate',
    'evaluate',
  ]);
  assert.ok(steps.every(({ resultText }) => typeof resultText === 'string'));
  assert.equal(steps.some(({ resultText }) => resultText.startsWith('iVBOR')), false);
});

test('buildObservations assembles every recorded evidence channel and coverage', () => {
  const result = buildObservations(parseStream(streamText));

  assert.ok(result.observations.length >= 1);
  const observation = result.observations[0];
  assert.equal(observation.url, 'http://localhost:8798/fixture-sanitized.html');
  assert.equal(observation.title, 'Acme Account Settings');
  assert.ok(Object.keys(observation.a11yTree).length >= 12);
  assert.equal(observation.network.length, 3);
  assert.equal(observation.consoleMessages.length, 4);
  assert.equal(observation.pageErrors.length, 2);
  assert.match(observation.screenshot, /\.png$/);
  assert.equal(typeof observation.bbox.x, 'number');
  assert.equal(result.coverage.nodeCount, 1);
  assert.deepEqual(result.stop, { stop: false, reason: null });
});

test('network cursor emits an empty delta when the since-load log repeats', () => {
  const steps = parseStream(streamText);
  const snapshot = steps.find(({ tool }) => tool.endsWith('browser_snapshot'));
  const network = steps.find(({ tool }) => tool.endsWith('browser_network_requests'));

  const result = buildObservations([snapshot, network, snapshot, network]);

  assert.equal(result.observations.length, 2);
  assert.equal(result.observations[0].network.length, 3);
  assert.deepEqual(result.observations[1].network, []);
});

test('a non-conforming evaluate result is skipped, not fatal (real-stream robustness)', () => {
  // regression: a live Explorer issues many browser_evaluate calls; one whose source mentions
  // getBoundingClientRect but returns a scalar must NOT crash buildObservations (found via the E5
  // real-app run against a Vite/React fixture).
  const snapshotText = '### Page\n- Page URL: http://x.test/\n- Page Title: T\n### Snapshot\n```yaml\n- button "Go" [ref=e1]\n```';
  const steps = [
    { tool: 'mcp__playwright__browser_navigate', input: {}, resultText: 'ok' },
    { tool: 'mcp__playwright__browser_snapshot', input: {}, resultText: snapshotText },
    { tool: 'mcp__playwright__browser_evaluate', input: { function: '() => el.getBoundingClientRect().top' }, resultText: '### Result\n42' },
  ];
  const result = buildObservations(steps);
  assert.equal(result.observations.length, 1);
  assert.equal(result.observations[0].bbox, undefined);
});
