// The component-library pack. FORK-ONLY (skill/scripts/melzi/library-pack.mjs).
//
// What these tests guard: a project that declares `## Component Library` in
// PRODUCT.md gets that library's own rules in front of the agent at boot,
// verbatim, without anyone having to remember to paste them. Two failure modes
// are worse than the feature not existing, so both are asserted here: a boot
// that crashes because a pack is missing or unreadable, and a boot that stays
// silent about a library the user explicitly declared.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { ENGINE_MISSING_MESSAGE, findEngineBinary } from './lib/engine-bin.mjs';

import {
  appendLibraryPack,
  buildLibraryPackBlock,
  extractLibrarySlug,
  resolveLibraryPackPath,
} from '../skill/scripts/melzi/library-pack.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(HERE, 'fixtures', 'library-pack');
// The context verb lives in the engine binary since the 2026-09-14 Rust adoption; the
// launcher exports IMPECCABLE_SKILL_DIR for it, so the tests do too.
const ENGINE_BIN = findEngineBinary();
const SKILL_DIR = path.join(HERE, '..', 'skill');
const ENGINE_SKIP = ENGINE_BIN ? false : ENGINE_MISSING_MESSAGE;
const FIXTURE_ENV = { IMPECCABLE_LIBRARY_DIR: FIXTURE_DIR };

const DECLARED = '# Thing\n\n## Platform\n\nweb\n\n## Component Library\n\njelly-ui\n\n## Users\n\nEveryone.\n';

function withTmp(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'melzi-library-'));
  try { return fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('the declaration is read as a bare slug under `## Component Library`', () => {
  assert.equal(extractLibrarySlug(DECLARED), 'jelly-ui');
});

test('prose after the slug on the same line does not become part of the slug', () => {
  // The contract is a bare value, but people annotate. Taking the first token
  // means an annotated line still resolves instead of silently missing.
  assert.equal(extractLibrarySlug('## Component Library\n\njelly-ui (v2, vendored)\n'), 'jelly-ui');
  assert.equal(extractLibrarySlug('## Component Library\n\njelly-ui, the in-house kit\n'), 'jelly-ui');
});

test('no section means no library and no opinion about one', () => {
  assert.equal(extractLibrarySlug('# Thing\n\n## Platform\n\nweb\n'), null);
  assert.equal(extractLibrarySlug(''), null);
  assert.equal(extractLibrarySlug(null), null);
});

test('an empty section is not a declaration', () => {
  assert.equal(extractLibrarySlug('## Component Library\n\n## Platform\n\nweb\n'), null);
});

// A slug names a directory. Anything carrying a path separator is not a slug,
// and resolving it would let a PRODUCT.md read an arbitrary file.
test('a value that is a path, not a slug, is refused', () => {
  assert.equal(extractLibrarySlug('## Component Library\n\n../../etc/passwd\n'), null);
  assert.equal(extractLibrarySlug('## Component Library\n\n/abs/path\n'), null);
  assert.equal(extractLibrarySlug('## Component Library\n\n..\n'), null);
});

test('the pack lives under IMPECCABLE_LIBRARY_DIR when it is set, else ~/.impeccable/libraries', () => {
  assert.equal(
    resolveLibraryPackPath('jelly-ui', { env: { IMPECCABLE_LIBRARY_DIR: '/packs' } }),
    path.join('/packs', 'jelly-ui', 'LIBRARY.md'),
  );
  assert.equal(
    resolveLibraryPackPath('jelly-ui', { env: {}, home: '/h' }),
    path.join('/h', '.impeccable', 'libraries', 'jelly-ui', 'LIBRARY.md'),
  );
});

test('a declared library that is present is inlined verbatim, under a header naming it', () => {
  const block = buildLibraryPackBlock(DECLARED, { env: FIXTURE_ENV });
  const packPath = path.join(FIXTURE_DIR, 'jelly-ui', 'LIBRARY.md');

  assert.match(block, /^# COMPONENT LIBRARY: jelly-ui/);
  assert.ok(block.includes(packPath), 'the header names the resolved path so the user can find the pack');
  // Verbatim. Paraphrase is the whole thing this feature exists to prevent.
  assert.ok(block.includes('`<JellyButton variant="primary" | "ghost">` is the only button.'));
  assert.ok(block.includes('--jelly-space-1'));
});

test('a declared library with no pack on disk warns, and names the path it looked at', () => {
  const block = buildLibraryPackBlock('## Component Library\n\nghost-kit\n', { env: FIXTURE_ENV });
  const expected = path.join(FIXTURE_DIR, 'ghost-kit', 'LIBRARY.md');

  assert.match(block, /^WARNING:/);
  assert.ok(block.includes('ghost-kit'));
  assert.ok(block.includes(expected), `the warning must name ${expected}, got:\n${block}`);
});

test('no declaration produces nothing at all, not an empty block', () => {
  assert.equal(buildLibraryPackBlock('# Thing\n\n## Platform\n\nweb\n', { env: FIXTURE_ENV }), null);
  const parts = ['# PRODUCT.md'];
  appendLibraryPack(parts, '# Thing\n', { env: FIXTURE_ENV });
  assert.deepEqual(parts, ['# PRODUCT.md']);
});

test('an unreadable pack degrades to the warning instead of throwing', () => withTmp((dir) => {
  // A directory where LIBRARY.md should be: readFileSync throws EISDIR.
  fs.mkdirSync(path.join(dir, 'broken-kit', 'LIBRARY.md'), { recursive: true });
  const env = { IMPECCABLE_LIBRARY_DIR: dir };

  const block = buildLibraryPackBlock('## Component Library\n\nbroken-kit\n', { env });
  assert.match(block, /^WARNING:/);

  const parts = [];
  appendLibraryPack(parts, '## Component Library\n\nbroken-kit\n', { env });
  assert.equal(parts.length, 1);
}));

// The boot must survive anything this module can be handed. It runs before the
// agent has any context at all, so a throw here costs the whole session.
test('appendLibraryPack never throws, whatever it is handed', () => {
  for (const product of [null, undefined, 42, {}, '## Component Library\n\njelly-ui\n']) {
    const parts = [];
    assert.doesNotThrow(() => appendLibraryPack(parts, product, { env: { IMPECCABLE_LIBRARY_DIR: '\0bad' } }));
  }
});

// The hook itself. Everything above tests the module in isolation, which proves
// nothing about whether the context verb actually calls it.
test('the context verb inlines the pack for a project that declares one', { skip: ENGINE_SKIP }, () => withTmp((dir) => {
  fs.writeFileSync(path.join(dir, 'PRODUCT.md'), DECLARED);
  fs.writeFileSync(path.join(dir, 'DESIGN.md'), '# Design\n\nQuiet.\n');

  const res = spawnSync(ENGINE_BIN, ['context'], {
    cwd: dir,
    encoding: 'utf8',
    env: {
      ...process.env,
      IMPECCABLE_SKILL_DIR: SKILL_DIR,
      IMPECCABLE_LIBRARY_DIR: FIXTURE_DIR,
      IMPECCABLE_NO_UPDATE_CHECK: '1',
      IMPECCABLE_NO_STALENESS_CHECK: '1',
    },
  });

  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /# COMPONENT LIBRARY: jelly-ui/);
  assert.ok(res.stdout.includes('`<JellyCard>` owns its own padding.'));
}));

test('the context verb stays silent for a project that declares no library', { skip: ENGINE_SKIP }, () => withTmp((dir) => {
  fs.writeFileSync(path.join(dir, 'PRODUCT.md'), '# Thing\n\n## Platform\n\nweb\n');

  const res = spawnSync(ENGINE_BIN, ['context'], {
    cwd: dir,
    encoding: 'utf8',
    env: {
      ...process.env,
      IMPECCABLE_SKILL_DIR: SKILL_DIR,
      IMPECCABLE_LIBRARY_DIR: FIXTURE_DIR,
      IMPECCABLE_NO_UPDATE_CHECK: '1',
      IMPECCABLE_NO_STALENESS_CHECK: '1',
    },
  });

  assert.equal(res.status, 0, res.stderr);
  assert.doesNotMatch(res.stdout, /COMPONENT LIBRARY/);
}));
