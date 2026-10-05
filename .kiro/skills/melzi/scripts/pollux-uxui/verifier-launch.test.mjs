import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { buildBundleManifest } from './verifier-bundle.mjs';
import {
  PLAYWRIGHT_MCP_PACKAGE,
  buildPlaywrightServerSpec,
  toCodexMcpOverrides,
} from './verifier-mcp.mjs';
import {
  CLAUDE_ENV_POLICY,
  CODEX_ENV_POLICY,
  buildLaunchPlan,
  buildVerifierPrompt,
  resolveLaunchEnv,
  runVerifier,
} from './verifier-launch.mjs';

const claudeFixture = readFileSync(
  new URL('./fixtures/streams/claude-verifier.stream.jsonl', import.meta.url),
  'utf8',
);
const codexFixture = readFileSync(
  new URL('./fixtures/streams/codex-verifier.stream.jsonl', import.meta.url),
  'utf8',
);

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

function makeBundle(overrides = {}) {
  return buildBundleManifest({
    flawId: 'flaw-1',
    capsule: {
      baseUrl: 'http://localhost:4321/',
      viewport: { w: 1280, h: 800 },
    },
    actionLog: [{ op: 'click', ref: 'e17', selector: '#save' }],
    assertion: 'Save persists the form',
    budget: { stepsMax: 20 },
    ...overrides,
  });
}

function makeServerSpec() {
  return buildPlaywrightServerSpec({
    initScriptPath: '/workspace/config/pageerror-listener.js',
    storageStatePath: '/workspace/input/storage-state.json',
    outputDir: '/workspace/runtime',
    capsule: {
      baseUrl: 'http://localhost:4321/',
      viewport: { w: 1280, h: 800 },
    },
  });
}

function fakeSpawn(streamText, { code = 0, stderr = '' } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {};

  setImmediate(() => {
    child.stdout.emit('data', Buffer.from(streamText));
    if (stderr) child.stderr.emit('data', Buffer.from(stderr));
    child.emit('close', code);
  });

  return child;
}

function buildPlan(lane) {
  return buildLaunchPlan({
    lane,
    workspaceDir: '/workspace',
    model: lane === 'claude' ? 'claude-sonnet-4-6' : 'gpt-5.5',
    serverSpec: makeServerSpec(),
    mcpConfigPath: '/workspace/config/mcp.json',
    verdictSchemaInline: '{"type":"object"}',
    verdictSchemaPath: '/workspace/input/verdict.schema.json',
    prompt: 'Verify the assertion',
  });
}

test('buildLaunchPlan creates a tool-isolated Claude invocation', () => {
  const workspaceDir = '/workspace';
  const mcpPath = '/workspace/config/mcp.json';
  const schemaInline = '{"type":"object"}';
  const plan = buildLaunchPlan({
    lane: 'claude',
    workspaceDir,
    model: 'claude-sonnet-4-6',
    serverSpec: makeServerSpec(),
    mcpConfigPath: mcpPath,
    verdictSchemaInline: schemaInline,
    prompt: 'Verify the assertion',
  });

  assert.equal(plan.command, 'claude');
  assert.ok(plan.args.includes('--allowed-tools'));
  const allowed = plan.args[plan.args.indexOf('--allowed-tools') + 1];
  assert.ok(allowed.includes('mcp__playwright__browser_navigate')); // specific safe tools
  assert.equal(allowed.split(' ').includes('mcp__playwright'), false); // NEVER the whole server
  assert.equal(allowed.includes('run_code'), false); // NEVER the RCE tool
  assert.ok(plan.args.includes('--setting-sources')); // do not inherit user allow-rules
  assert.equal(plan.args[plan.args.indexOf('--setting-sources') + 1], '');
  assert.ok(plan.args.includes('--mcp-config'));
  assert.ok(plan.args.includes(mcpPath));
  assert.ok(plan.args.includes('--json-schema'));
  assert.ok(plan.args.includes(schemaInline));
  assert.ok(plan.args.includes('--output-format'));
  assert.ok(plan.args.includes('stream-json'));
  assert.equal(plan.args.join(' ').includes('bypassPermissions'), false);
  assert.equal(plan.stdin, 'ignore');
  assert.equal(plan.cwd, workspaceDir);
  assert.equal(plan.envPolicy, CLAUDE_ENV_POLICY);
});

test('buildLaunchPlan creates a shell-disabled Codex invocation', () => {
  const workspaceDir = '/workspace';
  const schemaPath = '/workspace/input/verdict.schema.json';
  const serverSpec = makeServerSpec();
  const plan = buildLaunchPlan({
    lane: 'codex',
    workspaceDir,
    model: 'gpt-5.5',
    serverSpec,
    verdictSchemaPath: schemaPath,
    prompt: 'Verify the assertion',
  });

  assert.equal(plan.command, 'codex');
  assert.ok(plan.args.includes('--dangerously-bypass-approvals-and-sandbox'));
  assert.ok(plan.args.includes('-c'));
  assert.ok(plan.args.includes('features.shell_tool=false'));
  assert.ok(plan.args.includes('--output-schema'));
  assert.ok(plan.args.includes(schemaPath));
  assert.ok(plan.args.includes('--cd'));
  assert.ok(plan.args.includes(workspaceDir));
  for (const arg of toCodexMcpOverrides(serverSpec)) {
    assert.ok(plan.args.includes(arg));
  }
  assert.equal(plan.stdin, 'ignore');
  assert.equal(plan.envPolicy, CODEX_ENV_POLICY);
});

test('buildLaunchPlan rejects invalid lane, inputs, and unpinned server specs', () => {
  const inputs = {
    lane: 'claude',
    workspaceDir: '/workspace',
    model: 'claude-sonnet-4-6',
    serverSpec: makeServerSpec(),
    mcpConfigPath: '/workspace/config/mcp.json',
    verdictSchemaInline: '{"type":"object"}',
    prompt: 'Verify the assertion',
  };

  assert.throws(() => buildLaunchPlan({ ...inputs, lane: 'other' }), TypeError);
  assert.throws(() => buildLaunchPlan({ ...inputs, model: '' }), TypeError);
  assert.throws(() => buildLaunchPlan({ ...inputs, prompt: '' }), TypeError);
  assert.throws(() => buildLaunchPlan({
    ...inputs,
    serverSpec: {
      ...inputs.serverSpec,
      args: ['@playwright/mcp@latest', ...inputs.serverSpec.args.slice(1)],
    },
  }), /serverSpec must be the pinned Playwright MCP spec/);
  assert.equal(inputs.serverSpec.args[0], PLAYWRIGHT_MCP_PACKAGE);
});

test('resolveLaunchEnv keeps only policy keys present in the host environment', () => {
  assert.deepEqual(
    resolveLaunchEnv(['PATH', 'HOME'], { PATH: '/x', SECRET: 'y' }),
    { PATH: '/x' },
  );
});

test('resolveLaunchEnv forwards a provider namespace prefix but strips unrelated secrets', () => {
  assert.deepEqual(
    resolveLaunchEnv(['PATH', 'ANTHROPIC_*'], {
      PATH: '/x',
      ANTHROPIC_API_KEY: 'k',
      ANTHROPIC_BASE_URL: 'u',
      AWS_SECRET_ACCESS_KEY: 'nope',
    }),
    { PATH: '/x', ANTHROPIC_API_KEY: 'k', ANTHROPIC_BASE_URL: 'u' },
  );
});

test('runVerifier resolves a validated Claude verdict and tool events', async () => {
  const result = await runVerifier(buildPlan('claude'), {
    spawnImpl: () => fakeSpawn(claudeFixture),
    hostEnv: { PATH: '/x', SECRET: 'not-forwarded' },
  });

  assert.deepEqual(result.verdict, expectedVerdict);
  assert.equal(result.exitCode, 0);
  assert.ok(result.toolEvents.some(
    ({ tool }) => tool === 'mcp__playwright__browser_navigate',
  ));
});

test('runVerifier resolves the same validated Codex verdict', async () => {
  const result = await runVerifier(buildPlan('codex'), {
    spawnImpl: () => fakeSpawn(codexFixture),
    hostEnv: { PATH: '/x' },
  });

  assert.deepEqual(result.verdict, expectedVerdict);
  assert.equal(result.exitCode, 0);
});

test('runVerifier rejects a non-zero verifier exit with stderr context', async () => {
  await assert.rejects(
    runVerifier(buildPlan('claude'), {
      spawnImpl: () => fakeSpawn('', { code: 1, stderr: 'provider failed' }),
      hostEnv: { PATH: '/x' },
    }),
    /verifier exited 1: provider failed/,
  );
});

test('runVerifier rejects a stream without a valid verdict', async () => {
  await assert.rejects(
    runVerifier(buildPlan('claude'), {
      spawnImpl: () => fakeSpawn('{"type":"system"}'),
      hostEnv: { PATH: '/x' },
    }),
    /result event/,
  );
});

test('buildVerifierPrompt contains only sanitized replay inputs', () => {
  const bundle = makeBundle({
    actionLog: [{
      op: 'click',
      ref: 'e17',
      selector: '#save',
      note: 'diagnosis',
    }],
  });
  const prompt = buildVerifierPrompt(bundle);

  assert.ok(prompt.includes('Save persists the form'));
  assert.ok(prompt.includes('#save'));
  assert.equal(prompt.includes('diagnosis'), false);
});
