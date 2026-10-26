export const PLAYWRIGHT_MCP_PACKAGE = '@playwright/mcp@0.0.78';

export const BROWSER_TOOL_ALLOWLIST = Object.freeze([
  'browser_navigate',
  'browser_snapshot',
  'browser_click',
  'browser_type',
  'browser_press_key',
  'browser_hover',
  'browser_select_option',
  'browser_take_screenshot',
  'browser_console_messages',
  'browser_network_requests',
  'browser_evaluate',
  'browser_wait_for',
]);

function nonEmptyString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${name} must be a non-empty string`);
  }
}

function validateCapsule(capsule) {
  if (!capsule || typeof capsule !== 'object' || Array.isArray(capsule)) {
    throw new TypeError('capsule must be an object');
  }
  if (!capsule.viewport || typeof capsule.viewport !== 'object' || Array.isArray(capsule.viewport)) {
    throw new TypeError('capsule.viewport must be an object');
  }
  for (const dimension of ['w', 'h']) {
    if (typeof capsule.viewport[dimension] !== 'number' || !Number.isFinite(capsule.viewport[dimension])) {
      throw new TypeError(`capsule.viewport.${dimension} must be a number`);
    }
  }
  nonEmptyString(capsule.baseUrl, 'capsule.baseUrl');

  try {
    return new URL(capsule.baseUrl).origin;
  } catch {
    throw new TypeError('capsule.baseUrl must be a parseable URL');
  }
}

export function buildPlaywrightServerSpec({
  initScriptPath,
  storageStatePath,
  outputDir,
  capsule,
} = {}) {
  nonEmptyString(initScriptPath, 'initScriptPath');
  nonEmptyString(storageStatePath, 'storageStatePath');
  nonEmptyString(outputDir, 'outputDir');
  const origin = validateCapsule(capsule);
  const args = Object.freeze([
    PLAYWRIGHT_MCP_PACKAGE,
    '--isolated',
    '--headless',
    '--init-script',
    initScriptPath,
    '--storage-state',
    storageStatePath,
    '--output-dir',
    outputDir,
    '--viewport-size',
    `${capsule.viewport.w},${capsule.viewport.h}`,
    '--allowed-origins',
    origin,
  ]);

  return Object.freeze({
    command: 'npx',
    args,
    enabledTools: BROWSER_TOOL_ALLOWLIST,
  });
}

function assertPinnedSpec(spec) {
  if (!spec || spec.command !== 'npx' || !Array.isArray(spec.args) || spec.args[0] !== PLAYWRIGHT_MCP_PACKAGE) {
    throw new TypeError('spec must use the pinned Playwright MCP package with npx');
  }
}

export function toClaudeMcpConfig(spec) {
  return {
    mcpServers: {
      playwright: {
        command: spec.command,
        args: [...spec.args],
      },
    },
  };
}

// The SPECIFIC per-tool allowlist for `claude --allowed-tools`. NEVER pass the bare `mcp__playwright`
// server: that grants EVERY tool the MCP exposes, including `browser_run_code_unsafe`, which runs
// arbitrary JS in the Node server process (RCE-equivalent, `vm` is not a sandbox) and would let the
// Verifier read an answer key regardless of the cwd or permission mode. Listing only the safe browser
// tools (BROWSER_TOOL_ALLOWLIST) excludes it and the 30+ other tools (cookies, storage, file_upload,
// routing, tracing). Space-joined for the --allowed-tools value.
export function claudeAllowedTools(spec) {
  assertPinnedSpec(spec);
  return spec.enabledTools.map((tool) => `mcp__playwright__${tool}`).join(' ');
}

export function toCodexMcpOverrides(spec) {
  assertPinnedSpec(spec);

  return [
    '-c',
    `mcp_servers.playwright.command=${JSON.stringify(spec.command)}`,
    '-c',
    `mcp_servers.playwright.args=${JSON.stringify(spec.args)}`,
    '-c',
    'mcp_servers.playwright.required=true',
    // restrict codex to the same safe browser tools, excluding browser_run_code_unsafe (RCE).
    '-c',
    `mcp_servers.playwright.enabled_tools=${JSON.stringify(spec.enabledTools)}`,
  ];
}
