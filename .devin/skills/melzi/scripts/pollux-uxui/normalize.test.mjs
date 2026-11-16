import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  bboxFromEvaluate,
  pageErrorsFromEvaluate,
  parseConsole,
  parseNetwork,
  parseSnapshot,
  screenshotPath,
} from './normalize.mjs';

const streamPath = new URL('./fixtures/canary/explorer-stream.jsonl', import.meta.url);
const streamText = readFileSync(streamPath, 'utf8');

function recordedPlaywrightSteps() {
  const calls = [];
  const byId = new Map();

  for (const line of streamText.trim().split('\n')) {
    const event = JSON.parse(line);
    for (const item of event.message?.content ?? []) {
      if (item.type === 'tool_use' && item.name.startsWith('mcp__playwright__browser_')) {
        const call = { id: item.id, tool: item.name, input: item.input, resultText: null };
        calls.push(call);
        byId.set(item.id, call);
      }
      if (item.type === 'tool_result' && byId.has(item.tool_use_id)) {
        byId.get(item.tool_use_id).resultText = item.content
          .filter(({ type }) => type === 'text')
          .map(({ text }) => text)
          .join('\n');
      }
    }
  }

  return calls;
}

const steps = recordedPlaywrightSteps();

function step(toolSuffix, inputIncludes = '') {
  return steps.find(({ tool, input }) => (
    tool.endsWith(toolSuffix)
    && JSON.stringify(input).includes(inputIncludes)
  ));
}

test('parseSnapshot normalizes the real Playwright accessibility snapshot', () => {
  const snapshot = parseSnapshot(step('browser_snapshot').resultText);

  assert.equal(snapshot.url, 'http://localhost:8798/fixture-sanitized.html');
  assert.equal(snapshot.title, 'Acme Account Settings');
  assert.ok(Object.keys(snapshot.a11yTree).length >= 12);
  assert.deepEqual(snapshot.a11yTree.e17, {
    role: 'button',
    name: 'Save changes',
    state: { cursor: 'pointer' },
  });
  assert.equal(snapshot.a11yTree.e25.name, 'Subscribe');
  assert.equal(snapshot.a11yTree.e25.state.disabled, true);
});

test('parseNetwork and parseConsole normalize the real since-load logs', () => {
  const network = parseNetwork(step('browser_network_requests').resultText);
  assert.equal(network.length, 3);
  assert.deepEqual(network.find(({ url }) => url.endsWith('/api/save')), {
    method: 'POST',
    url: 'http://localhost:8798/api/save',
    status: 501,
  });

  const consoleMessages = parseConsole(step('browser_console_messages').resultText);
  assert.equal(consoleMessages.length, 4);
  assert.match(consoleMessages.at(-1), /ReferenceError: reportAnalyticsBoot is not defined/);
  assert.match(consoleMessages.at(-1), /fixture-sanitized\.html:155:3/);
});

test('evaluate and screenshot normalizers extract the recorded evidence values', () => {
  const pageErrors = pageErrorsFromEvaluate(
    step('browser_evaluate', '__polluxPageErrors').resultText,
  );
  assert.equal(pageErrors.length, 2);
  assert.match(pageErrors[0].message, /reportAnalyticsBoot/);

  assert.deepEqual(
    bboxFromEvaluate(step('browser_evaluate', 'getBoundingClientRect').resultText),
    { x: 363, y: 381, w: 120.734375, h: 34 },
  );
  assert.match(
    screenshotPath(step('browser_take_screenshot').resultText),
    /^\.playwright-mcp\/page-.*\.png$/,
  );
});
