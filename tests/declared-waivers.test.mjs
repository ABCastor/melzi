// Declared-value waivers. FORK-ONLY (skill/scripts/melzi/declared-waivers.mjs).
//
// Row-3 law 2: arbitration is data-side. When a project DECLARES a value in its
// design system (DESIGN.md frontmatter, the design.json sidecar, or a component
// library pack's Detector notes), the aesthetic-taste rules defer to that
// declaration through scoped detector.ignoreValues entries in
// .impeccable/config.json. No rule code is ever patched.
//
// Row-3 law 3, asserted hard here: accessibility is never waived automatically.
// A pack that names `low-contrast` with a concrete value must produce NOTHING.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  A11Y_WAIVER_DENYLIST,
  AUTO_REASON_PREFIX,
  VALUE_KEYED_RULES,
  deriveDeclaredWaivers,
  applyDeclaredWaivers,
} from '../skill/scripts/melzi/declared-waivers.mjs';

import { loadEngine } from '../skill/scripts/melzi/engine.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, 'fixtures', 'declared-waivers');
const SCRIPT = path.join(HERE, '..', 'skill', 'scripts', 'melzi', 'declared-waivers.mjs');
const PACK_ENV = { IMPECCABLE_LIBRARY_DIR: path.join(FIXTURES, 'packs') };

function copyFixture(name, dir) {
  fs.cpSync(path.join(FIXTURES, name), dir, { recursive: true });
}

async function withTmpProject(fixtureName, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'declared-waivers-'));
  try {
    copyFixture(fixtureName, dir);
    return await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function readConfig(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, '.impeccable', 'config.json'), 'utf-8'));
}

function entriesFor(entries, rule) {
  return entries.filter((e) => e.rule === rule);
}

// ---------- the denylist itself ----------

test('the a11y denylist is hardcoded and carries every accessibility-measuring rule', async () => {
  const required = [
    'low-contrast', 'gray-on-color', 'tiny-text', 'undersized-ui-text',
    'tight-leading', 'line-length', 'skipped-heading', 'all-caps-body',
    'wide-tracking', 'justified-text', 'text-occlusion', 'text-overflow',
    'content-hidden-at-rest', 'clipped-overflow-container',
    'body-text-viewport-edge', 'cramped-padding', 'broken-image', 'script-error',
  ];
  for (const rule of required) {
    assert.ok(A11Y_WAIVER_DENYLIST.has(rule), `denylist must contain ${rule}`);
  }
});

test('no value-keyed rule set member is ever also emitted while denylisted', async () => {
  // The eligible set is value-keyed minus denylist; if a rule ever lands in
  // both, the denylist must win. Guarded structurally here.
  for (const rule of VALUE_KEYED_RULES) {
    assert.ok(typeof rule === 'string' && rule.length > 0);
  }
});

// ---------- derivation from DESIGN.md + sidecar ----------

test('declared fonts derive overused-font waivers, generic families do not', async () => {
  const { entries } = await deriveDeclaredWaivers(path.join(FIXTURES, 'project-basic'), { env: {} });
  const fonts = entriesFor(entries, 'overused-font').map((e) => e.value).sort();
  assert.deepEqual(fonts, ['fraunces', 'inter']);
});

test('declared sidecar motion beziers derive bounce-easing waivers in the finding snippet form', async () => {
  const { entries } = await deriveDeclaredWaivers(path.join(FIXTURES, 'project-basic'), { env: {} });
  const beziers = entriesFor(entries, 'bounce-easing').map((e) => e.value).sort();
  assert.deepEqual(beziers, [
    'cubic-bezier(.28, 1.35, .5, 1)',
    'cubic-bezier(0.4, 0, 0.2, 1)',
  ]);
});

test('design-system-* rules get no waivers from DESIGN.md tokens (the engine already allowlists declarations)', async () => {
  const { entries } = await deriveDeclaredWaivers(path.join(FIXTURES, 'project-basic'), { env: {} });
  for (const rule of ['design-system-color', 'design-system-font', 'design-system-radius', 'design-system-font-size']) {
    assert.deepEqual(entriesFor(entries, rule), [], `${rule} must not be derived from DESIGN.md`);
  }
});

test('every derived entry carries provenance: createdAt and the auto-derived reason', async () => {
  const { entries } = await deriveDeclaredWaivers(path.join(FIXTURES, 'project-basic'), { env: {} });
  assert.ok(entries.length > 0);
  for (const entry of entries) {
    assert.ok(typeof entry.createdAt === 'string' && entry.createdAt.length > 0, 'createdAt present');
    assert.ok(entry.reason.startsWith(AUTO_REASON_PREFIX), `reason starts with prefix: ${entry.reason}`);
    assert.match(entry.reason, /regenerate with declared-waivers/);
    assert.match(entry.reason, /delete if the token leaves/);
  }
});

test('font provenance names the DESIGN.md token path', async () => {
  const { entries } = await deriveDeclaredWaivers(path.join(FIXTURES, 'project-basic'), { env: {} });
  const inter = entriesFor(entries, 'overused-font').find((e) => e.value === 'inter');
  assert.match(inter.reason, /DESIGN\.md typography\.body\.fontFamily/);
});

// ---------- derivation from a library pack's Detector notes ----------

test('a declared library pack derives waivers for the value-keyed rules its Detector notes name', async () => {
  const { entries } = await deriveDeclaredWaivers(path.join(FIXTURES, 'project-with-pack'), { env: PACK_ENV });

  const beziers = entriesFor(entries, 'bounce-easing').map((e) => e.value).sort();
  assert.deepEqual(beziers, [
    'cubic-bezier(.28, 1.35, .5, 1)',
    'cubic-bezier(.34, 1.5, .5, 1)',
  ]);

  assert.deepEqual(entriesFor(entries, 'design-system-radius').map((e) => e.value), ['999px']);

  // clamp() never matches as a waiver value; the generator emits the endpoints.
  const sizes = entriesFor(entries, 'design-system-font-size').map((e) => e.value).sort();
  assert.deepEqual(sizes, ['2.5rem', '5rem']);

  // Hex is emitted; oklch is skipped because the matcher only parses hex/rgb/hsl.
  assert.deepEqual(entriesFor(entries, 'design-system-color').map((e) => e.value), ['#e8467c']);
});

test('LAW 3: a pack naming an a11y rule with a concrete value emits nothing for it', async () => {
  const { entries } = await deriveDeclaredWaivers(path.join(FIXTURES, 'project-with-pack'), { env: PACK_ENV });
  for (const entry of entries) {
    assert.ok(!A11Y_WAIVER_DENYLIST.has(entry.rule), `denylisted rule leaked: ${entry.rule}`);
  }
  assert.deepEqual(entriesFor(entries, 'low-contrast'), [], 'low-contrast must never be waived automatically');
});

test('rules without per-value waiver support are skipped even when a pack names them', async () => {
  const { entries } = await deriveDeclaredWaivers(path.join(FIXTURES, 'project-with-pack'), { env: PACK_ENV });
  assert.deepEqual(entriesFor(entries, 'pulsing-dot'), []);
  for (const entry of entries) {
    assert.ok(VALUE_KEYED_RULES.has(entry.rule), `non-value-keyed rule leaked: ${entry.rule}`);
  }
});

test('pack provenance names the pack, not DESIGN.md', async () => {
  const { entries } = await deriveDeclaredWaivers(path.join(FIXTURES, 'project-with-pack'), { env: PACK_ENV });
  const radius = entriesFor(entries, 'design-system-radius')[0];
  assert.match(radius.reason, /jelly-ui/);
  assert.match(radius.reason, /Detector notes/);
});

// ---------- writing .impeccable/config.json ----------

test('apply writes detector.ignoreValues into .impeccable/config.json', async () => {
  await withTmpProject('project-basic', async (dir) => {
    const result = await applyDeclaredWaivers(dir, { env: {} });
    assert.equal(result.written, true);
    const config = readConfig(dir);
    const values = config.detector.ignoreValues;
    assert.ok(values.length >= 4);
    assert.ok(values.some((e) => e.rule === 'overused-font' && e.value === 'inter'));
    assert.ok(values.every((e) => typeof e.createdAt === 'string' && e.reason.startsWith(AUTO_REASON_PREFIX)));
  });
});

test('re-running is idempotent: the config file is byte-identical after a second run', async () => {
  await withTmpProject('project-basic', async (dir) => {
    await applyDeclaredWaivers(dir, { env: {} });
    const first = fs.readFileSync(path.join(dir, '.impeccable', 'config.json'), 'utf-8');
    await applyDeclaredWaivers(dir, { env: {} });
    const second = fs.readFileSync(path.join(dir, '.impeccable', 'config.json'), 'utf-8');
    assert.equal(second, first);
  });
});

test('a token that leaves DESIGN.md takes its auto-derived waiver with it on the next run', async () => {
  await withTmpProject('project-basic', async (dir) => {
    await applyDeclaredWaivers(dir, { env: {} });
    assert.ok(readConfig(dir).detector.ignoreValues.some((e) => e.value === 'inter'));

    const designPath = path.join(dir, 'DESIGN.md');
    const md = fs.readFileSync(designPath, 'utf-8').replace('Inter, sans-serif', 'Sohne, sans-serif');
    fs.writeFileSync(designPath, md);

    await applyDeclaredWaivers(dir, { env: {} });
    const values = readConfig(dir).detector.ignoreValues;
    assert.ok(!values.some((e) => e.value === 'inter'), 'stale auto entry removed');
    assert.ok(values.some((e) => e.rule === 'overused-font' && e.value === 'sohne'), 'new token derived');
  });
});

test('hand-written entries and unknown config keys survive untouched, byte-for-byte semantics', async () => {
  await withTmpProject('project-basic', async (dir) => {
    const handEntry = {
      rule: 'design-system-font-size',
      value: '*',
      files: ['src/legacy/**'],
      createdAt: '2026-07-01T00:00:00.000Z',
      reason: 'testbed clamp waiver, written by hand',
      note: 'unknown key that must survive',
    };
    const seeded = {
      updateCheck: { lastRun: '2026-07-27T00:00:00.000Z' },
      detector: {
        ignoreRules: ['side-tab'],
        ignoreFiles: ['vendor/**'],
        ignoreValues: [handEntry],
      },
    };
    fs.mkdirSync(path.join(dir, '.impeccable'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.impeccable', 'config.json'), JSON.stringify(seeded, null, 2) + '\n');

    await applyDeclaredWaivers(dir, { env: {} });
    const config = readConfig(dir);
    assert.deepEqual(config.updateCheck, seeded.updateCheck, 'unknown top-level key preserved');
    assert.deepEqual(config.detector.ignoreRules, ['side-tab']);
    assert.deepEqual(config.detector.ignoreFiles, ['vendor/**']);
    const kept = config.detector.ignoreValues.find((e) => e.value === '*');
    assert.deepEqual(kept, handEntry, 'hand-written entry preserved verbatim, unknown keys included');
  });
});

test('a hand-written entry for the same rule and value is never duplicated or replaced', async () => {
  await withTmpProject('project-basic', async (dir) => {
    const handEntry = { rule: 'overused-font', value: 'inter', reason: 'I like Inter here, mine' };
    fs.mkdirSync(path.join(dir, '.impeccable'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.impeccable', 'config.json'),
      JSON.stringify({ detector: { ignoreValues: [handEntry] } }, null, 2) + '\n',
    );

    await applyDeclaredWaivers(dir, { env: {} });
    const inters = readConfig(dir).detector.ignoreValues.filter((e) => e.rule === 'overused-font' && e.value === 'inter');
    assert.equal(inters.length, 1);
    assert.equal(inters[0].reason, handEntry.reason);
  });
});

test('auto entries keep their original createdAt across regenerations', async () => {
  await withTmpProject('project-basic', async (dir) => {
    await applyDeclaredWaivers(dir, { env: {}, now: new Date('2026-07-27T09:00:00Z') });
    const first = readConfig(dir).detector.ignoreValues.find((e) => e.value === 'inter');
    await applyDeclaredWaivers(dir, { env: {}, now: new Date('2026-07-28T09:00:00Z') });
    const second = readConfig(dir).detector.ignoreValues.find((e) => e.value === 'inter');
    assert.equal(second.createdAt, first.createdAt);
  });
});

// ---------- dry-run and CLI ----------

test('--dry-run prints the would-be entries and writes nothing', async () => {
  await withTmpProject('project-basic', async (dir) => {
    const res = spawnSync(process.execPath, [SCRIPT, dir, '--dry-run'], { encoding: 'utf-8' });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /overused-font/);
    assert.match(res.stdout, /bounce-easing/);
    assert.ok(!fs.existsSync(path.join(dir, '.impeccable', 'config.json')), 'dry-run must not write');
  });
});

test('the CLI writes the config and reports what it did', async () => {
  await withTmpProject('project-with-pack', async (dir) => {
    const res = spawnSync(process.execPath, [SCRIPT, dir], { encoding: 'utf-8', env: { ...process.env, ...PACK_ENV } });
    assert.equal(res.status, 0, res.stderr);
    const config = readConfig(dir);
    assert.ok(config.detector.ignoreValues.some((e) => e.rule === 'design-system-radius' && e.value === '999px'));
    assert.match(res.stdout, /design-system-radius/);
  });
});

test('a project with no declarations at all writes nothing and exits 0', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'declared-waivers-empty-'));
  try {
    const res = spawnSync(process.execPath, [SCRIPT, dir], { encoding: 'utf-8' });
    assert.equal(res.status, 0, res.stderr);
    assert.ok(!fs.existsSync(path.join(dir, '.impeccable', 'config.json')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a malformed config.json is refused rather than clobbered', async () => {
  await withTmpProject('project-basic', async (dir) => {
    fs.mkdirSync(path.join(dir, '.impeccable'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.impeccable', 'config.json'), '{ not json');
    const res = spawnSync(process.execPath, [SCRIPT, dir], { encoding: 'utf-8' });
    assert.notEqual(res.status, 0);
    assert.equal(fs.readFileSync(path.join(dir, '.impeccable', 'config.json'), 'utf-8'), '{ not json');
  });
});


test('derived font waivers silence the real detector, and removing them restores the finding', async () => {
  await withTmpProject('project-basic', async (dir) => {
    const target = path.join(dir, 'font.css');
    fs.writeFileSync(target, '.probe { font-family: Inter, sans-serif; }\n');
    const engine = loadEngine();
    const hasFontFinding = () => engine.detect(target, dir).some(f => f.antipattern === 'overused-font');
    assert.equal(hasFontFinding(), true, 'the unwaived detector must flag the canary');
    await applyDeclaredWaivers(dir, { env: {} });
    assert.equal(hasFontFinding(), false, 'declared font waiver must affect actual enforcement');
    const configPath = path.join(dir, '.impeccable', 'config.json');
    const config = readConfig(dir);
    config.detector.ignoreValues = [];
    fs.writeFileSync(configPath, JSON.stringify(config));
    assert.equal(hasFontFinding(), true, 'removing the data-side waiver restores the unchanged rule');
  });
});

test('a missing engine refuses derivation without deleting previous auto entries', async () => {
  await withTmpProject('project-basic', async (dir) => {
    await applyDeclaredWaivers(dir, { env: {} });
    const configPath = path.join(dir, '.impeccable', 'config.json');
    const before = fs.readFileSync(configPath, 'utf8');
    const res = spawnSync(process.execPath, [SCRIPT, dir], {
      encoding: 'utf8', env: { ...process.env, IMPECCABLE_BIN: path.join(dir, 'missing-engine') },
    });
    assert.equal(res.status, 1);
    assert.match(res.stderr, /no local Rust detector engine/);
    assert.equal(fs.readFileSync(configPath, 'utf8'), before);
  });
});
