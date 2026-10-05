import test from 'node:test';
import assert from 'node:assert/strict';
import { findEngineBinary, engineEnv, ENGINE_MISSING_MESSAGE } from './lib/engine-bin.mjs';
const ENGINE = findEngineBinary();
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CATEGORY_ORDER, SKILL_CATEGORIES } from '../scripts/lib/skill-categories.js';
import { MELZI_SUB_COMMANDS, MELZI_COMMAND_ALIASES } from '../scripts/lib/utils.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
const sorted = (values) => [...values].sort();

function commandTable() {
  const source = read('skill/SKILL.src.md');
  const section = source.match(/## Commands\n([\s\S]*?)\nRouting:/)?.[1] ?? '';
  return [...section.matchAll(/^\| `([a-z-]+)(?: [^`]*)?` \| ([A-Za-z]+) \|/gm)]
    .map(([, command, category]) => ({ command, category: category.toLowerCase() }));
}


test('the Commands table, all four canonical registries, taxonomies, and stated counts agree', () => {
  const rows = commandTable();
  const tableCommands = rows.map(({ command }) => command);
  const metadataCommands = Object.keys(JSON.parse(read('skill/scripts/command-metadata.json')));
  const categoryCommands = Object.keys(SKILL_CATEGORIES).filter((command) => command !== 'melzi');
  assert.ok(ENGINE, ENGINE_MISSING_MESSAGE);
  const pin = spawnSync(ENGINE, ['pin', 'pin', 'not-a-real-command'], { encoding: 'utf8', env: engineEnv(ENGINE) });
  assert.equal(pin.status, 1, pin.stderr);
  const accepted = pin.stderr.match(/Available commands and aliases: (.+)/)?.[1].split(', ');
  assert.ok(accepted, pin.stderr);
  const pinCommands = accepted.slice(0, tableCommands.length);
  assert.deepEqual(sorted(accepted.slice(tableCommands.length)), sorted(Object.keys(MELZI_COMMAND_ALIASES)));

  assert.equal(new Set(tableCommands).size, tableCommands.length, 'Commands table contains a duplicate command');
  assert.deepEqual(sorted(MELZI_SUB_COMMANDS), sorted(tableCommands), 'MELZI_SUB_COMMANDS drifted from the Commands table');
  assert.deepEqual(sorted(categoryCommands), sorted(tableCommands), 'SKILL_CATEGORIES drifted from the Commands table');
  assert.deepEqual(sorted(metadataCommands), sorted(tableCommands), 'command-metadata.json drifted from the Commands table');
  assert.deepEqual(sorted(pinCommands), sorted(tableCommands), 'engine canonical commands drifted from the Commands table');

  for (const { command, category } of rows) {
    assert.ok(CATEGORY_ORDER.includes(category), `${command} uses unknown table category ${category}`);
    assert.equal(SKILL_CATEGORIES[command], category, `${command} is filed differently in the two taxonomies`);
  }

  const expected = rows.length;
  const countFiles = [
    'README.md',
    'README.npm.md',
    '.claude-plugin/plugin.json',
    '.claude-plugin/marketplace.json',
  ];

  for (const file of countFiles) {
    const claims = [...read(file).matchAll(/\b(\d+)\s+canonical commands\b/gi)];
    assert.ok(claims.length > 0, `${file} has no canonical command-count statement`);
    for (const claim of claims) {
      assert.equal(Number(claim[1]), expected, `${file} says ${claim[1]} canonical commands; table has ${expected}`);
    }
  }

  const generatedCount = Number(read('site/public/js/generated/counts.js').match(/COMMAND_COUNT = (\d+)/)?.[1]);
  assert.equal(generatedCount, expected, `generated site count says ${generatedCount}; table has ${expected}`);
});
