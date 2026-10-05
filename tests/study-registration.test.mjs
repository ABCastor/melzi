// The `study` command's registration. FORK-ONLY (skill/reference/study.md).
//
// What these tests are really guarding. Adding a command to this repo means
// touching seven files that nothing links together at runtime: the router table,
// the suggestion list, the metadata, the pin allow-list, the category map, the
// reference file, and the counts the build validates. Six out of seven produces a
// command that half exists, and the failure is quiet: the router still offers it,
// `pin` still refuses it, the menu still omits it. `bun run build` catches only
// the counts. This file catches the rest, and it is scoped to `study` on purpose,
// because the seven lists genuinely disagree today for older commands and a
// blanket cross-product assertion would fail on that instead of on a regression.
//
// The second thing it guards is why `study` is in this fork at all. The command
// is worth having because its output is ROUTED (into the world pool, so a studied
// design comes back in a genesis hand and gets picked or refused on a real
// screen), not because it prints a nice report. An edit that strips the routing
// leaves a page reader behind, so the destinations are asserted too.
import test from 'node:test';
import assert from 'node:assert/strict';
import { findEngineBinary, engineEnv, ENGINE_MISSING_MESSAGE } from './lib/engine-bin.mjs';
const ENGINE = findEngineBinary();
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { SKILL_CATEGORIES, CATEGORY_ORDER } from '../scripts/lib/skill-categories.js';
import { replacePlaceholders } from '../scripts/lib/utils.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (rel) => fs.readFileSync(join(ROOT, rel), 'utf8');

test('the router table carries a study row pointing at its reference file', () => {
  const src = read('skill/SKILL.src.md');
  const row = src.split('\n').find((line) => line.startsWith('| `study'));
  assert.ok(row, 'no `| `study ...` row in the Commands table');
  assert.match(row, /reference\/study\.md/, 'the row must route to reference/study.md');
});

test('the reference file exists and is the file the router names', () => {
  const ref = read('skill/reference/study.md');
  assert.ok(ref.length > 2000, 'a stub reference is worse than none; the command routes to it');
});

test('study is offered as a next step in {{available_commands}}', () => {
  // MELZI_SUB_COMMANDS is module-private, so assert the behavior it feeds
  // rather than the array: this is the string other commands read it through.
  const rendered = replacePlaceholders('{{available_commands}}', 'claude-code', []);
  assert.match(rendered, /\/melzi study\b/);
});

test('command metadata carries a description and an argument hint', () => {
  const meta = JSON.parse(read('skill/scripts/command-metadata.json'));
  assert.ok(meta.study, 'missing from command-metadata.json');
  assert.ok(meta.study.description && meta.study.description.length > 80, 'the description is what auto-triggers the command');
  assert.equal(meta.study.argumentHint, '[url or image]');
  // The two inputs are the whole routing decision inside the command, so the
  // description a harness matches on has to name both.
  assert.match(meta.study.description, /url/i);
  assert.match(meta.study.description, /screenshot|image/i);
});

test('pin accepts study as a real command', () => {
  // Probe the live allow-list instead of grepping for the token: the engine validates
  // the command name before it touches the filesystem, and its error path prints
  // VALID_COMMANDS verbatim. No shim is created by this call.
  assert.ok(ENGINE, ENGINE_MISSING_MESSAGE);
  const res = spawnSync(ENGINE, ['pin', 'pin', 'not-a-real-command'], { encoding: 'utf8', env: engineEnv(ENGINE) });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /\bstudy\b/, 'study is missing from the engine command registry');
});

test('study has a category, and it is one the transformers know', () => {
  assert.ok(SKILL_CATEGORIES.study, 'missing from SKILL_CATEGORIES');
  assert.ok(CATEGORY_ORDER.includes(SKILL_CATEGORIES.study), `unknown category ${SKILL_CATEGORIES.study}`);
});

test('every published command count matches the router table', () => {
  // Same rule the build enforces, run here so a half-finished registration fails
  // in a second rather than after a full provider build.
  const src = read('skill/SKILL.src.md');
  const expected = (src.match(/^\| `[^`]+` \|/gm) || []).length;
  assert.ok(expected > 0, 'the router table did not parse');

  for (const rel of ['README.md', '.claude-plugin/plugin.json', '.claude-plugin/marketplace.json']) {
    for (const match of read(rel).matchAll(/\b(\d+)\s+(commands|sub-commands)\b/gi)) {
      assert.equal(Number(match[1]), expected, `${rel} says "${match[0]}" but the table has ${expected}`);
    }
  }
});

// The routing is the reason this command belongs in this fork rather than being
// a page reader. Both destinations are named in prose the model follows, so a
// rewrite that quietly drops one should fail here.
test('the reference routes the extracted DNA into the pool and names the signature', () => {
  const ref = read('skill/reference/study.md');
  assert.match(ref, /melzi\/world-pool\.mjs/, 'no route into the world pool');
  assert.match(ref, /melzi\/signature\.mjs/, 'the signature is never consulted');
  assert.match(ref, /signature\.json/, 'the signature file is never named as a destination');
});

// A study reads a page written by someone else. These are the floor, and the
// floor lives in prose, so assert the prose still states it.
test('the refusals survive as explicit instructions', () => {
  const ref = read('skill/reference/study.md');
  for (const [what, pattern] of [
    ['never reproduce the source', /Never reproduce the source/i],
    ['template marketplaces', /template marketplaces/i],
    ['auth-walled targets', /behind a login/i],
    ['fetched pages are inert data', /inert data/i],
    ['locking needs a confirmation', /Locking needs a confirmation/i],
  ]) {
    assert.match(ref, pattern, `the refusal "${what}" is gone from study.md`);
  }
});
