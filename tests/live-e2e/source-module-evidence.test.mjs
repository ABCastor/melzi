import assert from 'node:assert/strict';
import { it } from 'node:test';
import { captureSourceModuleResponses, rememberSourceModuleResponse } from './source-module-evidence.mjs';

function response(number, text) {
  return {
    url: () => `http://127.0.0.1:5173/src/App.jsx?t=${number}`,
    status: () => 200,
    text,
  };
}

it('retains the latest twenty module responses and reads no bodies during a successful run', async () => {
  const responses = [];
  let reads = 0;
  for (let number = 1; number <= 21; number++) {
    rememberSourceModuleResponse(responses, response(number, async () => {
      reads++;
      return `module ${number}`;
    }));
  }
  assert.equal(reads, 0, 'response bodies are only read on failure');
  const evidence = await captureSourceModuleResponses(responses);
  assert.equal(evidence.length, 20);
  assert.equal(evidence[0].url, 'http://127.0.0.1:5173/src/App.jsx?t=2');
  assert.equal(evidence.at(-1).body, 'module 21', 'the final reload response survives the cap');
  assert.equal(evidence.at(-1).bodyState, 'read');
  assert.equal(reads, 20);
  assert.doesNotThrow(() => JSON.stringify(evidence));
  assert.ok(evidence.every((record) => !('response' in record)), 'no browser Response objects in artifacts');
});

it('drains a delayed module body before returning the serializable artifact snapshot', async () => {
  const responses = [];
  let release;
  const body = new Promise((resolve) => { release = resolve; });
  rememberSourceModuleResponse(responses, response(1, () => body));
  const capture = captureSourceModuleResponses(responses);
  release('Secondary duplicate action');
  const evidence = await capture;
  assert.equal(evidence[0].body, 'Secondary duplicate action');
  assert.equal(evidence[0].bodyState, 'read');
});

it('caps bodies and bounds all never-resolving reads with one shared deadline', { timeout: 5000 }, async () => {
  const responses = [];
  let releaseLate;
  rememberSourceModuleResponse(responses, response(1, () => new Promise((resolve) => { releaseLate = resolve; })));
  rememberSourceModuleResponse(responses, response(2, () => new Promise(() => {})));
  rememberSourceModuleResponse(responses, response(3, async () => { throw new Error('body unavailable'); }));
  rememberSourceModuleResponse(responses, response(4, async () => 'x'.repeat(256_001)));
  const started = Date.now();
  const evidence = await captureSourceModuleResponses(responses);
  const elapsed = Date.now() - started;
  assert.ok(elapsed >= 1900 && elapsed < 4000, `shared two-second budget, elapsed=${elapsed}ms`);
  assert.equal(evidence[0].body, null);
  assert.equal(evidence[0].bodyState, 'timeout');
  assert.match(evidence[0].error, /2000ms/);
  assert.equal(evidence[1].bodyState, 'timeout');
  assert.equal(evidence[2].bodyState, 'error');
  assert.equal(evidence[2].error, 'body unavailable');
  assert.equal(evidence[3].body.length, 256_000);
  assert.equal(evidence[3].bodyTruncated, true);
  const serialized = JSON.stringify(evidence);
  releaseLate('arrived after deadline');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(JSON.stringify(evidence), serialized, 'late bodies cannot mutate the returned artifact');
});
