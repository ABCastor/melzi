/**
 * bind-verify: mechanical proof that a project's DESIGN.md actually binds.
 *
 * Row-3 contract under test:
 *   - exit 0 only when the canary proves BOTH directions: an off-system value
 *     is flagged by the real engine AND an on-system declared value is silent.
 *   - exit 3, one-line reason, when the project has no DESIGN.md.
 *   - exit 1, failing direction or reason named, for everything else.
 *   - no DESIGN.md mutation, no leftover canary files, never throws.
 *
 * Run with: node --test tests/bind-verify.test.mjs
 */

import { describe, it, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  verifyBinding,
  pickCanaryValues,
} from '../skill/scripts/melzi/bind-verify.mjs';
import { loadEngine } from '../skill/scripts/melzi/engine.mjs';
import { findEngineBinary, engineEnv, ENGINE_MISSING_MESSAGE } from './lib/engine-bin.mjs';

const ENGINE = findEngineBinary();
const isolatedHome = fs.mkdtempSync(path.join(os.tmpdir(), 'bind-home-'));
Object.assign(process.env, engineEnv(ENGINE, { HOME: isolatedHome, USERPROFILE: isolatedHome }));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, 'fixtures', 'bind-verify');
const BIN = path.join(__dirname, '..', 'skill', 'scripts', 'melzi', 'bind-verify.mjs');

const tempDirs = [];
after(() => fs.rmSync(isolatedHome, { recursive: true, force: true }));

// Copy a fixture project into a temp dir so canary writes never touch the
// committed fixtures, and so resolution runs from a neutral parent.
function materialize(fixtureName) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-bind-verify-'));
  tempDirs.push(dir);
  const project = path.join(dir, fixtureName);
  fs.cpSync(path.join(FIXTURES, fixtureName), project, { recursive: true });
  return project;
}

afterEach(() => {
  while (tempDirs.length) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe('await pickCanaryValues()', { skip: !ENGINE && ENGINE_MISSING_MESSAGE }, () => {
  it('picks off-system values the engine rejects and on-system values it allows', async () => {
    const project = materialize('bound-project');
    const engine = loadEngine();
    const designSystem = engine.describeDesign(project, project).designSystem;
    assert.ok(designSystem, 'fixture DESIGN.md must load');

    const picks = await pickCanaryValues(designSystem);
    assert.ok(picks.offColor, 'an off-system color is found');

    assert.ok(picks.onColor, 'an on-system color is found');

    assert.ok(picks.offFontSize, 'an off-system font size is found');

    assert.ok(picks.onFontSize, 'an on-system font size is found');
    for (const direction of ['off', 'on']) {
      const canary = path.join(project, `${direction}.css`);
      fs.writeFileSync(canary, `.probe { color: ${picks[`${direction}Color`]}; font-size: ${picks[`${direction}FontSize`]}; }`);
      const findings = engine.detect(canary, project);
      for (const rule of ['design-system-color', 'design-system-font-size']) {
        assert.equal(findings.some(f => f.antipattern === rule), direction === 'off', `${direction} ${rule}`);
      }
    }
  });

  it('abstains per axis when the design system does not enumerate it', async () => {
    const project = materialize('colors-only-project');
    const engine = loadEngine();
    const designSystem = engine.describeDesign(project, project).designSystem;
    assert.ok(designSystem);
    assert.equal(designSystem.hasFontSizes, false, 'fluid-only ramp must not enumerate');

    const picks = await pickCanaryValues(designSystem);
    assert.ok(picks.offColor);
    assert.ok(picks.onColor);
    assert.equal(picks.offFontSize, null);
    assert.equal(picks.onFontSize, null);
  });
});

describe('await verifyBinding()', { skip: !ENGINE && ENGINE_MISSING_MESSAGE }, () => {
  it('proves binding both ways on a token-carrying project (exit 0)', async () => {
    const project = materialize('bound-project');
    const result = await verifyBinding(project);

    assert.equal(result.exitCode, 0, result.lines.join('\n'));
    assert.equal(result.status, 'bound');
    assert.ok(result.designPath.endsWith('DESIGN.md'));

    const off = result.checks.filter(c => c.direction === 'off-system');
    const on = result.checks.filter(c => c.direction === 'on-system');
    assert.equal(off.length, 2, 'color + font-size off-system checks');
    assert.equal(on.length, 2, 'color + font-size on-system checks');
    assert.ok(off.every(c => c.ok), 'every off-system canary is flagged');
    assert.ok(on.every(c => c.ok), 'every on-system canary is silent');

    const offColor = off.find(c => c.axis === 'color');
    assert.match(offColor.detail, /design-system-color/);
    const offSize = off.find(c => c.axis === 'font-size');
    assert.match(offSize.detail, /design-system-font-size/);

    const text = result.lines.join('\n');
    assert.match(text, /BOUND/);
  });

  it('leaves no canary files behind', async () => {
    const project = materialize('bound-project');
    const result = await verifyBinding(project);
    assert.equal(result.exitCode, 0);

    const tmpDir = path.join(project, '.impeccable', 'tmp');
    if (fs.existsSync(tmpDir)) {
      assert.deepEqual(fs.readdirSync(tmpDir), [], 'tmp space is empty after the run');
    }
    // The module proves, it does not write: DESIGN.md is untouched.
    const original = fs.readFileSync(path.join(FIXTURES, 'bound-project', 'DESIGN.md'), 'utf-8');
    const after = fs.readFileSync(path.join(project, 'DESIGN.md'), 'utf-8');
    assert.equal(after, original);
  });

  it('still proves the color axis when the type ramp is fluid-only, and says font-size abstained', async () => {
    const project = materialize('colors-only-project');
    const result = await verifyBinding(project);

    assert.equal(result.exitCode, 0, result.lines.join('\n'));
    assert.equal(result.status, 'bound');
    assert.ok(result.checks.some(c => c.axis === 'color' && c.direction === 'off-system' && c.ok));
    assert.ok(!result.checks.some(c => c.axis === 'font-size'), 'no font-size checks ran');
    assert.match(result.lines.join('\n'), /font-size/i);
    assert.match(result.lines.join('\n'), /abstain/i);
  });

  it('exits 3 with a one-line reason when the project has no DESIGN.md', async () => {
    const project = materialize('no-design-project');
    const result = await verifyBinding(project);

    assert.equal(result.exitCode, 3);
    assert.equal(result.status, 'no-design');
    assert.equal(result.lines.length, 1);
    assert.match(result.lines[0], /DESIGN\.md/);
  });

  it('exits 1 when DESIGN.md exists but declares no enforceable tokens', async () => {
    const project = materialize('tokenless-project');
    const result = await verifyBinding(project);

    assert.equal(result.exitCode, 1);
    assert.equal(result.status, 'unbound');
    assert.match(result.lines.join('\n'), /token/i);
  });

  it('does not inherit a parent design across an unrelated project boundary', async () => {
    const parent = materialize('bound-project');
    const child = path.join(parent, 'unrelated');
    fs.mkdirSync(child);
    fs.writeFileSync(path.join(child, 'package.json'), '{"name":"unrelated"}');
    const result = await verifyBinding(child);
    assert.equal(result.exitCode, 3, result.lines.join('\n'));
    assert.equal(result.status, 'no-design');
  });

  it('distinguishes unparseable DESIGN.md from no DESIGN.md', async () => {
    const project = materialize('bound-project');
    fs.writeFileSync(path.join(project, 'DESIGN.md'), '# Design\nNo frontmatter.\n');
    const result = await verifyBinding(project);
    assert.equal(result.exitCode, 1);
    assert.equal(result.status, 'unbound');
    assert.match(result.lines.join('\n'), /no parseable frontmatter/);
  });

  it('proves a font-size-only system and abstains on color', async () => {
    const project = materialize('bound-project');
    fs.writeFileSync(path.join(project, 'DESIGN.md'), '---\ntypography:\n  body:\n    fontSize: 16px\n---\n');
    const result = await verifyBinding(project);
    assert.equal(result.exitCode, 0, result.lines.join('\n'));
    assert.deepEqual(result.checks.map(check => check.axis), ['font-size', 'font-size']);
    assert.match(result.lines.join('\n'), /color axis abstains/);
  });

  it('refuses a binding proof when project config disables enforcement and preserves existing tmp files', async () => {
    const project = materialize('bound-project');
    const tmp = path.join(project, '.impeccable', 'tmp');
    fs.mkdirSync(tmp, { recursive: true });
    fs.writeFileSync(path.join(tmp, 'keep.txt'), 'keep');
    fs.writeFileSync(path.join(project, '.impeccable', 'config.json'), JSON.stringify({ detector: { designSystem: { enabled: false } } }));
    const result = await verifyBinding(project);
    assert.equal(result.exitCode, 1, result.lines.join('\n'));
    assert.equal(result.status, 'unbound');
    assert.ok(result.checks.some(check => check.direction === 'off-system' && !check.ok));
    assert.deepEqual(fs.readdirSync(tmp), ['keep.txt']);
  });

  it('missing engine fails proof even if a fallback binary is installed', async () => {
    const project = materialize('bound-project');
    const saved = process.env.IMPECCABLE_BIN;
    process.env.IMPECCABLE_BIN = path.join(project, 'missing-engine');
    try {
      const result = await verifyBinding(project);
      assert.equal(result.exitCode, 1);
      assert.equal(result.status, 'error');
      assert.match(result.lines.join('\n'), /no local Rust detector engine/);
    } finally {
      if (saved === undefined) delete process.env.IMPECCABLE_BIN;
      else process.env.IMPECCABLE_BIN = saved;
    }
  });

  it('exits 1 (never throws) on a nonexistent project dir', async () => {
    const result = await verifyBinding(path.join(os.tmpdir(), 'impeccable-bind-verify-does-not-exist'));
    assert.equal(result.exitCode, 1);
    assert.ok(result.lines.length > 0);
  });
});

describe('bind-verify CLI', { skip: !ENGINE && ENGINE_MISSING_MESSAGE }, () => {
  function run(args) {
    return spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf-8' });
  }

  it('exit 0 and readable proof lines on a bound project', async () => {
    const project = materialize('bound-project');
    const res = run([project]);
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.match(res.stdout, /off-system/);
    assert.match(res.stdout, /on-system/);
    assert.match(res.stdout, /BOUND/);
  });

  it('exit 3 on a project with no DESIGN.md', async () => {
    const project = materialize('no-design-project');
    const res = run([project]);
    assert.equal(res.status, 3, res.stdout + res.stderr);
  });

  it('exit 1 with a reason when given no argument', async () => {
    const res = run([]);
    assert.equal(res.status, 1);
    assert.match(res.stdout + res.stderr, /project/i);
  });
});
