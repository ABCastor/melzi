import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { validateVerdict } from './verifier-bundle.mjs';
import {
  extractClaudeVerdict,
  extractCodexVerdict,
  parseClaudeStream,
  parseCodexStream,
} from './verifier-stream.mjs';

const claudeFixture = readFileSync(
  new URL('./fixtures/streams/claude-verifier.stream.jsonl', import.meta.url),
  'utf8',
);
const codexFixture = readFileSync(
  new URL('./fixtures/streams/codex-verifier.stream.jsonl', import.meta.url),
  'utf8',
);

const expectedTools = [
  'mcp__playwright__browser_navigate',
  'mcp__playwright__browser_press_key',
];
const expectedVerdict = {
  verdict: 'confirmed',
  rationale: 'Escape did not close the dialog on an independent replay',
  decisiveEvidence: 'role=dialog still present after Escape',
  independence: {
    coldContext: true,
    ownSession: true,
    replayedFromReset: true,
  },
};

test('parseClaudeStream normalizes the Claude Playwright tool stream', () => {
  const events = parseClaudeStream(claudeFixture);

  assert.ok(events.length >= 2);
  assert.ok(expectedTools.every((tool) => events.some((event) => event.tool === tool)));
  assert.ok(events.every(({ resultText }) => typeof resultText === 'string'));
});

test('parseCodexStream tolerates preamble and error items and normalizes tool calls', () => {
  const events = parseCodexStream(codexFixture);

  assert.deepEqual(events.map(({ tool }) => tool), expectedTools);
  assert.ok(events.every(({ resultText }) => typeof resultText === 'string'));
});

test('extractClaudeVerdict returns a valid Contract-1 verdict', () => {
  const verdict = extractClaudeVerdict(claudeFixture);

  assert.deepEqual(verdict, expectedVerdict);
  assert.equal(validateVerdict(verdict).valid, true);
});

test('extractCodexVerdict returns the same valid Contract-1 verdict', () => {
  const verdict = extractCodexVerdict(codexFixture);

  assert.deepEqual(verdict, expectedVerdict);
  assert.equal(validateVerdict(verdict).valid, true);
});

test('both verifier lanes yield an identical Contract-1 verdict', () => {
  assert.deepEqual(
    extractClaudeVerdict(claudeFixture),
    extractCodexVerdict(codexFixture),
  );
});

test('extractClaudeVerdict rejects a stream without a result event', () => {
  assert.throws(
    () => extractClaudeVerdict('{"type":"system","subtype":"init"}\n'),
    /exactly one result event/,
  );
});

test('extractCodexVerdict rejects a stream without an agent message', () => {
  assert.throws(
    () => extractCodexVerdict('Reading additional input from stdin...\n{"type":"turn.completed"}\n'),
    /no agent_message/,
  );
});

test('extractCodexVerdict rejects invalid JSON in the last agent message', () => {
  const stream = [
    '{"type":"item.completed","item":{"type":"agent_message","text":"{\\"verdict\\":\\"confirmed\\"}"}}',
    '{"type":"item.completed","item":{"type":"agent_message","text":"not JSON"}}',
  ].join('\n');

  assert.throws(() => extractCodexVerdict(stream), /not valid JSON/);
});
