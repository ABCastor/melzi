import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BROWSER_TOOL_ALLOWLIST,
  PLAYWRIGHT_MCP_PACKAGE,
  buildPlaywrightServerSpec,
  claudeAllowedTools,
  toClaudeMcpConfig,
  toCodexMcpOverrides,
} from './verifier-mcp.mjs';

const capsule = {
  baseUrl: 'http://localhost:4321/',
  viewport: { w: 1280, h: 800 },
};

function buildSpec(overrides = {}) {
  return buildPlaywrightServerSpec({
    initScriptPath: '/tmp/pageerror-listener.js',
    storageStatePath: '/tmp/storage-state.json',
    outputDir: '/tmp/output',
    capsule,
    ...overrides,
  });
}

test('buildPlaywrightServerSpec returns the pinned server arguments in exact order', () => {
  const spec = buildSpec();

  assert.equal(spec.command, 'npx');
  assert.deepEqual(spec.args, [
    PLAYWRIGHT_MCP_PACKAGE,
    '--isolated',
    '--headless',
    '--init-script',
    '/tmp/pageerror-listener.js',
    '--storage-state',
    '/tmp/storage-state.json',
    '--output-dir',
    '/tmp/output',
    '--viewport-size',
    '1280,800',
    '--allowed-origins',
    'http://localhost:4321',
  ]);
});

test('buildPlaywrightServerSpec derives allowed origins from capsule.baseUrl', () => {
  const spec = buildSpec({
    capsule: {
      baseUrl: 'http://localhost:4321/app?x=1',
      viewport: { w: 1280, h: 800 },
    },
  });
  const index = spec.args.indexOf('--allowed-origins');

  assert.equal(spec.args[index + 1], 'http://localhost:4321');
});

test('buildPlaywrightServerSpec formats the viewport size', () => {
  const spec = buildSpec();
  const index = spec.args.indexOf('--viewport-size');

  assert.equal(spec.args[index + 1], '1280,800');
});

test('buildPlaywrightServerSpec rejects missing required inputs', () => {
  assert.throws(() => buildSpec({ initScriptPath: undefined }), TypeError);
  assert.throws(() => buildSpec({ storageStatePath: undefined }), TypeError);
  assert.throws(() => buildSpec({ outputDir: undefined }), TypeError);
  assert.throws(() => buildSpec({ capsule: { baseUrl: capsule.baseUrl } }), TypeError);
  assert.throws(() => buildSpec({ capsule: { ...capsule, baseUrl: 'not a URL' } }), TypeError);
});

test('toClaudeMcpConfig renders exactly one playwright server', () => {
  const spec = buildSpec();

  assert.deepEqual(toClaudeMcpConfig(spec), {
    mcpServers: {
      playwright: {
        command: spec.command,
        args: [...spec.args],
      },
    },
  });
});

test('toCodexMcpOverrides defines only the required playwright server, tool-restricted', () => {
  const spec = buildSpec();

  assert.deepEqual(toCodexMcpOverrides(spec), [
    '-c',
    'mcp_servers.playwright.command="npx"',
    '-c',
    `mcp_servers.playwright.args=${JSON.stringify(spec.args)}`,
    '-c',
    'mcp_servers.playwright.required=true',
    '-c',
    `mcp_servers.playwright.enabled_tools=${JSON.stringify(BROWSER_TOOL_ALLOWLIST)}`,
  ]);
  // the RCE tool is never enabled
  assert.equal(BROWSER_TOOL_ALLOWLIST.includes('browser_run_code_unsafe'), false);
});

test('claudeAllowedTools lists specific safe tools, never the whole server or the RCE tool', () => {
  const value = claudeAllowedTools(buildSpec());

  assert.ok(value.includes('mcp__playwright__browser_navigate'));
  assert.ok(value.includes('mcp__playwright__browser_evaluate'));
  // NEVER the bare whole-server grant, and NEVER the RCE tool
  assert.equal(value.split(' ').includes('mcp__playwright'), false);
  assert.equal(value.includes('run_code'), false);
  assert.equal(value.includes('browser_run_code_unsafe'), false);
});

test('toCodexMcpOverrides rejects an unpinned Playwright MCP package', () => {
  const spec = buildSpec();
  const tampered = {
    ...spec,
    args: ['@playwright/mcp@latest', ...spec.args.slice(1)],
  };

  assert.throws(() => toCodexMcpOverrides(tampered), TypeError);
});
