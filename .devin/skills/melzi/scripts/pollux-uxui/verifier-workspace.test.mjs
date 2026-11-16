import assert from 'node:assert/strict';
import {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { materializeWorkspace } from './verifier-workspace.mjs';

function workspaceFiles() {
  return [
    { path: 'input/flaw.json', content: '{"flawId":"flaw-1"}', mode: 0o444 },
    { path: 'config/storage-state.json', content: '{"cookies":[]}', mode: 0o400 },
  ];
}

function createWorkspace(t) {
  const handle = materializeWorkspace({ files: workspaceFiles() });
  t.after(() => handle.dispose());
  return handle;
}

test('materializeWorkspace writes exact files and creates a writable runtime directory', (t) => {
  const files = workspaceFiles();
  const handle = materializeWorkspace({ files });
  t.after(() => handle.dispose());

  assert.deepEqual(handle.allowedPaths, [
    'config/storage-state.json',
    'input/flaw.json',
  ]);
  for (const file of files) {
    const target = join(handle.dir, file.path);
    assert.equal(readFileSync(target, 'utf8'), file.content);
    assert.equal(statSync(target).mode & 0o777, file.mode);
    assert.match(handle.digest(file.path), /^[a-f0-9]{64}$/);
  }

  const runtimePath = join(handle.dir, handle.runtimeDir);
  assert.equal(statSync(runtimePath).isDirectory(), true);
  accessSync(runtimePath, constants.W_OK);
  writeFileSync(join(runtimePath, 'write-probe.txt'), 'writable');
});

test('verify returns true for a freshly materialized workspace', (t) => {
  const handle = createWorkspace(t);

  assert.equal(handle.verify(), true);
});

test('verify rejects an unexpected file outside runtime', (t) => {
  const handle = createWorkspace(t);
  writeFileSync(join(handle.dir, 'input/leak.txt'), 'x');

  assert.throws(() => handle.verify(), /unexpected file: input\/leak\.txt/);
});

test('verify rejects an allowed input whose bytes were mutated', (t) => {
  const handle = createWorkspace(t);
  const target = join(handle.dir, 'input/flaw.json');
  chmodSync(target, 0o644);
  writeFileSync(target, '{"tampered":true}');

  assert.throws(() => handle.verify(), /hash mismatch: input\/flaw\.json/);
});

test('verify allows files written under runtime', (t) => {
  const handle = createWorkspace(t);
  writeFileSync(join(handle.dir, handle.runtimeDir, 'screenshot.png'), 'image bytes');

  assert.doesNotThrow(() => handle.verify());
});

test('verify rejects a symlink planted in the workspace', (t) => {
  const handle = createWorkspace(t);
  const linkPath = join(handle.dir, 'leak-link');

  try {
    symlinkSync('/etc/passwd', linkPath);
  } catch (error) {
    if (error.code === 'EPERM') {
      t.skip('platform does not permit symlink creation');
      return;
    }
    throw error;
  }

  assert.throws(() => handle.verify(), /symlink entry: leak-link/);
});

test('materializeWorkspace rejects unsafe and duplicate paths', () => {
  const invalidFileSets = [
    [{ path: '/etc/passwd', content: 'x', mode: 0o444 }],
    [{ path: 'input/../secret.txt', content: 'x', mode: 0o444 }],
    [{ path: 'input\\secret.txt', content: 'x', mode: 0o444 }],
    [
      { path: 'input/Flaw.json', content: 'x', mode: 0o444 },
      { path: 'input/flaw.json', content: 'y', mode: 0o444 },
    ],
  ];

  assert.throws(() => materializeWorkspace({ files: [] }), TypeError);
  for (const files of invalidFileSets) {
    assert.throws(() => materializeWorkspace({ files }), TypeError);
  }
});

test('dispose removes the workspace directory', (t) => {
  const handle = createWorkspace(t);
  const { dir } = handle;

  handle.dispose();

  assert.equal(existsSync(dir), false);
});
