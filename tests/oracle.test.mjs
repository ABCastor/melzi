/**
 * Behavior gate: replays the oracle corpus (tests/oracle) against the engine
 * binary and asserts no case differs from its golden beyond the reviewed
 * deltas in tests/oracle/DELTAS.md.
 *
 * Skips cleanly when no binary is available: set IMPECCABLE_BIN or run
 * `bun run fetch:engine` (which writes skill/scripts/bin/<os>-<arch>/).
 *
 * Run with: node --test tests/oracle.test.mjs
 * Scope:    IMPECCABLE_ORACLE_PREFIX=detect- node --test tests/oracle.test.mjs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ENGINE_MISSING_MESSAGE, findEngineBinary } from './lib/engine-bin.mjs';
import { materializeFixtureHarnesses, stageWorkspace, WORKSPACES_DIR } from './oracle/lib.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENGINE_BIN = findEngineBinary();

function fixtureFiles(root) {
  const files = {};
  for (const entry of fs.readdirSync(root, { recursive: true }).sort()) {
    const full = path.join(root, entry);
    if (fs.statSync(full).isFile()) files[entry] = fs.readFileSync(full).toString('hex');
  }
  return files;
}

describe('oracle fixture harness storage', () => {
  for (const name of ['ctx-pin', 'hook-project']) {
    it(`materializes ${name} with identical bytes and leaves stored fixtures unchanged`, () => {
      const source = path.join(WORKSPACES_DIR, name);
      const before = fixtureFiles(source);
      const staged = stageWorkspace(name);
      try {
        const expected = Object.fromEntries(Object.entries(before).map(([file, bytes]) => [
          file.replace(/^_fixture-claude\//, '.claude/').replace(/^_fixture-cursor\//, '.cursor/'), bytes,
        ]));
        assert.deepEqual(fixtureFiles(staged), expected);
        for (const harness of ['claude', 'cursor']) {
          assert.equal(fs.existsSync(path.join(source, `.${harness}`)), false);
          assert.equal(fs.existsSync(path.join(staged, `.${harness}`)), true);
          assert.equal(fs.existsSync(path.join(staged, `_fixture-${harness}`)), false);
        }
        assert.deepEqual(fixtureFiles(source), before);
      } finally {
        fs.rmSync(staged, { recursive: true, force: true });
      }
    });
  }
  it('rejects a destination collision before materializing either harness', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-fixture-collision-'));
    try {
      for (const dir of ['_fixture-claude', '_fixture-cursor', '.cursor']) fs.mkdirSync(path.join(root, dir));
      fs.writeFileSync(path.join(root, '.cursor', 'sentinel'), 'retain existing content');
      assert.throws(() => materializeFixtureHarnesses(root), /fixture harness collision: \.cursor/);
      assert.equal(fs.existsSync(path.join(root, '_fixture-claude')), true);
      assert.equal(fs.existsSync(path.join(root, '_fixture-cursor')), true);
      assert.equal(fs.existsSync(path.join(root, '.claude')), false);
      assert.equal(fs.readFileSync(path.join(root, '.cursor', 'sentinel'), 'utf8'), 'retain existing content');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('oracle corpus against the engine binary', { skip: ENGINE_BIN ? false : ENGINE_MISSING_MESSAGE }, () => {
  it('replays every recorded case with zero unreviewed differences', () => {
    const args = [path.join(REPO_ROOT, 'tests', 'oracle', 'run.mjs')];
    if (process.env.IMPECCABLE_ORACLE_PREFIX) args.push(process.env.IMPECCABLE_ORACLE_PREFIX);
    const result = spawnSync(process.execPath, args, {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
      env: { ...process.env, IMPECCABLE_BIN: ENGINE_BIN },
      maxBuffer: 64 * 1024 * 1024,
    });
    const summary = (result.stdout || '').trim().split('\n').pop();
    const failures = (result.stdout || '').split('\n').filter((line) => line.startsWith('XX ') || line.startsWith('?? '));
    assert.equal(
      result.status,
      0,
      `oracle run exited ${result.status}: ${summary}\n${failures.slice(0, 40).join('\n')}\n${(result.stderr || '').slice(-4000)}`,
    );
  });
});
