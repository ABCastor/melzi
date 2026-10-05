import test from 'node:test';
import assert from 'node:assert/strict';
import { findEngineBinary, engineEnv, ENGINE_MISSING_MESSAGE } from './lib/engine-bin.mjs';
const ENGINE = findEngineBinary();
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { MELZI_COMMAND_ALIASES } from '../scripts/lib/utils.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

const EXPECTED_ALIASES = {
  adapt: {
    destinations: ['audit', 'polish', 'adapt.native'],
    preserved: ['bottom sheets', 'safe-area-inset-bottom', 'srcset', 'one real iPhone'],
    references: [
      ['skill/reference/audit.md', '## Adaptation evidence on the web'],
      ['skill/reference/polish.md', '## Web adaptation implementation'],
      ['skill/reference/adapt.native.md', '## Adaptation Strategies'],
    ],
  },
  craft: {
    destinations: ['new-work'],
    preserved: ['Create or replace the visual world'],
    references: [['skill/reference/new-work.md', '## 1. Decide what is already true']],
  },
  delight: {
    destinations: ['bolder', 'animate'],
    preserved: ["brand's emotional range", 'hundredth use', 'sound without consent'],
    references: [
      ['skill/reference/bolder.md', '## Earned delight'],
      ['skill/reference/animate.md', '## Capture existing motion'],
    ],
  },
  distill: {
    destinations: ['quieter'],
    preserved: ['one spacing scale', 'alternative access', 'Never remove functionality'],
    references: [['skill/reference/quieter.md', '## Distill phase']],
  },
  extract: {
    destinations: ['document'],
    preserved: ['three or more times', 'accessibility built in', 'Storybook'],
    references: [['skill/reference/document.md', '## Extract mode: consolidate the system in code']],
  },
  logo: {
    destinations: ['identity'],
    preserved: ['symbolic-link escapes', 'flattened/master parity', 'serve-compare.mjs'],
    references: [['skill/reference/identity.md', '## 8. Mark phase: build the production mark inside the identity']],
  },
  onboard: {
    destinations: ['clarify', 'new-work'],
    preserved: ['localStorage.setItem', 'React Joyride', 'First use'],
    references: [
      ['skill/reference/clarify.md', '## Onboarding language and first-value states'],
      ['skill/reference/new-work.md', '## 8. Onboarding flow'],
    ],
  },
  optimize: {
    destinations: ['audit'],
    preserved: ['service workers', 'offsetHeight', 'navigator.connection', 'Chrome UX Report'],
    references: [['skill/reference/audit.md', '## Optimize mode: measure, fix, measure again']],
  },
  overdrive: {
    destinations: ['bolder', 'animate'],
    preserved: ['Entering overdrive mode', '@starting-style', 'WebGPU', 'WASM'],
    references: [
      ['skill/reference/bolder.md', '## Overdrive phase'],
      ['skill/reference/animate.md', '## Technical ambition catalogue'],
    ],
  },
};


test('every folded name routes to merged content, has no dead reference, and remains pinnable', () => {
  const skill = read('skill/SKILL.src.md');
  assert.deepEqual(MELZI_COMMAND_ALIASES, Object.fromEntries(
    Object.entries(EXPECTED_ALIASES).map(([alias, value]) => [alias, value.destinations]),
  ));

  for (const [alias, { references, preserved }] of Object.entries(EXPECTED_ALIASES)) {
    assert.match(skill, new RegExp('^  - `' + alias + '` → .+$', 'm'), `${alias} has no documented compatibility route`);
    assert.equal(fs.existsSync(path.join(ROOT, `skill/reference/${alias}.md`)), false, `${alias}.md survived instead of being folded`);
    const mergedContent = references.map(([reference]) => read(reference)).join('\n');
    for (const [reference, uniqueSection] of references) {
      assert.ok(read(reference).includes(uniqueSection), `${alias} lost its merged section in ${reference}`);
    }
    for (const method of preserved) {
      assert.ok(mergedContent.includes(method), `${alias} lost its unique method or constraint: ${method}`);
    }
  }

  assert.ok(ENGINE, ENGINE_MISSING_MESSAGE);
  const probe = spawnSync(ENGINE, ['pin', 'pin', 'not-a-real-command'], { encoding: 'utf8', env: engineEnv(ENGINE) });
  assert.equal(probe.status, 1, probe.stderr);
  const accepted = probe.stderr.match(/Available commands and aliases: (.+)/)?.[1].split(', ');
  assert.ok(accepted, probe.stderr);
  const canonical = Object.keys(JSON.parse(read('skill/scripts/command-metadata.json')));
  const pinAliases = accepted.filter((command) => !canonical.includes(command));
  assert.deepEqual(pinAliases.sort(), Object.keys(EXPECTED_ALIASES).sort());

  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'melzi-alias-pin-'));
  try {
    const installedSkill = path.join(cwd, '.claude', 'skills', 'melzi');
    fs.mkdirSync(installedSkill, { recursive: true });
    fs.writeFileSync(path.join(installedSkill, 'SKILL.md'), '# Melzi fixture\n');
    for (const alias of Object.keys(EXPECTED_ALIASES)) {
      const result = spawnSync(ENGINE, ['pin', 'pin', alias], {
        cwd,
        encoding: 'utf8',
        env: engineEnv(ENGINE),
      });
      assert.equal(result.status, 0, `${alias} was rejected: ${result.stderr}`);
      assert.doesNotMatch(result.stderr, /Unknown command/);
      const pinned = path.join(cwd, '.claude', 'skills', alias, 'SKILL.md');
      assert.ok(fs.existsSync(pinned), `${alias} was accepted but no shortcut was created`);
      assert.ok(fs.readFileSync(pinned, 'utf8').includes(`/melzi ${alias}`), `${alias} shortcut routes to the wrong typed command`);
    }
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
