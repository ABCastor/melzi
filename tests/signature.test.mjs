// The signature. FORK-ONLY (skill/scripts/melzi/signature.mjs).
//
// What these tests are really guarding: the signature is the only thing that is
// supposed to survive every world the tool deals, and it lives OUTSIDE this repo
// (~/.impeccable/signature.json) because it is a property of the person and must
// never be committed into a public fork. So the assertions are about the shape of
// the rendered block, about the module carrying no values of its own, and about
// every failure path ending in a quiet null or an empty string rather than a throw.
//
// Every test runs against a tmp home. None of them reads the real one.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadSignature, renderSignatureBlock, signaturePath } from '../skill/scripts/melzi/signature.mjs';

const MODULE = join(dirname(fileURLToPath(import.meta.url)), '..', 'skill', 'scripts', 'melzi', 'signature.mjs');

// Mirrors the real file's shape. The values are his, the file is not: this fixture
// is written into a tmp home and destroyed with it.
const SIGNATURE = {
  invariants: {
    coral: {
      value: '#FD4E5A',
      textSafe: '#E23742',
      role: 'leads: the identity and pay-attention colour',
    },
    klein: {
      light: '#2426E0',
      dark: '#5A5CF5',
      role: 'the spark, only the favourable signal, never a second lead',
    },
    neutrals: {
      bgLight: '#FFFFFF',
      bgDark: '#1A1A1A',
      textLight: '#1A1A1A',
      textDark: '#D4D4D4',
      secondaryLight: '#555555',
      secondaryDark: '#999999',
      hairlineLight: '#DDDDDD',
      hairlineDark: '#333333',
      note: 'a near-silent greyscale field; dark is soft charcoal, never black',
    },
    type: {
      content: 'Source Serif 4',
      data: 'monospace',
      concept: 'editorial instrument: serif for content, mono for data',
    },
    ratio: 'roughly 70/30: coral leads, Klein lifts; never 50/50; each colour keeps a steady role',
  },
  free: ['layout', 'composition', 'density', 'texture', 'imagery', 'motion', 'ornament', 'scale', 'grid', 'materiality'],
};

function withHome(fn) {
  const home = mkdtempSync(join(tmpdir(), 'melzi-signature-'));
  try { return fn(home); } finally { rmSync(home, { recursive: true, force: true }); }
}

function seed(home, contents) {
  fs.mkdirSync(join(home, '.impeccable'), { recursive: true });
  fs.writeFileSync(signaturePath(home), typeof contents === 'string' ? contents : JSON.stringify(contents));
  return home;
}

test('the signature lives in the HOME dir, outside any repo', () => {
  assert.match(signaturePath('/Users/x'), /^\/Users\/x\/\.impeccable\/signature\.json$/);
});

test('a missing signature loads as null and renders as nothing at all', () => withHome((home) => {
  assert.equal(loadSignature({ home }), null);
  assert.equal(renderSignatureBlock(null), '');
}));

test('invalid JSON loads as null rather than throwing into a design flow', () => withHome((home) => {
  assert.equal(loadSignature({ home: seed(home, '{"invariants": {') }), null);
}));

test('valid JSON that is not an object is not a signature', () => withHome((home) => {
  assert.equal(loadSignature({ home: seed(home, '["coral"]') }), null);
  assert.equal(loadSignature({ home: seed(home, 'null') }), null);
}));

test('a seeded signature round-trips through the tmp home', () => withHome((home) => {
  const sig = loadSignature({ home: seed(home, SIGNATURE) });
  assert.deepEqual(sig, SIGNATURE);
}));

// The block is the whole product of this module: what an LLM is told holds.
test('the block states every invariant, with the hexes and their roles', () => {
  const block = renderSignatureBlock(SIGNATURE);

  assert.match(block, /^SIGNATURE INVARIANTS\n/);
  assert.ok(block.includes('#FD4E5A'), 'the lead colour');
  assert.ok(block.includes('#E23742'), 'and its text-safe deepening, which is not optional');
  assert.ok(block.includes('#2426E0'), 'Klein, light');
  assert.ok(block.includes('#5A5CF5'), 'Klein, dark');
  assert.ok(block.includes('#1A1A1A'), 'the neutrals field');
  assert.ok(block.includes('Source Serif 4'), 'the type pairing');
  assert.ok(block.includes('monospace'));

  assert.ok(block.includes('never a second lead'), 'a hex without its role is a swatch, not a rule');
  assert.ok(block.includes('never black'), 'the neutrals note');
  assert.match(block, /^ratio: .*70\/30.*$/m, 'the ratio rule, on its own line');
});

test('the block names the free layers, so the world is licensed to be strange', () => {
  const block = renderSignatureBlock(SIGNATURE);
  const free = block.split('\n').filter((line) => line.startsWith('FREE'));

  assert.equal(free.length, 1, 'exactly one line naming what may vary');
  assert.ok(free[0].includes('layout, composition, density'), 'in the file\'s own order');
  assert.ok(free[0].includes('materiality'), 'every layer, not a sample');
});

test('a value field renders bare, so a hex reads as a fact and not a field name', () => {
  const block = renderSignatureBlock(SIGNATURE);
  assert.match(block, /^coral: #FD4E5A, textSafe #E23742$/m);
  assert.equal(block.includes('value #FD4E5A'), false);
});

// The module must know the SHAPE and never the values: a hex baked into code is a
// hex that goes stale in silence the first time the signature moves.
test('nothing is hardcoded: a different signature renders its own values', () => {
  const other = {
    oneLine: 'Ink on newsprint, one acid green.',
    invariants: {
      accent: { value: '#B6FF00', role: 'the only saturated thing on the page' },
      type: { content: 'Times New Roman', data: 'Courier' },
    },
    free: ['grid', 'imagery'],
  };
  const block = renderSignatureBlock(other);

  assert.ok(block.includes('#B6FF00') && block.includes('Times New Roman'));
  assert.ok(block.includes('Ink on newsprint'), 'the one-line summary leads when present');
  assert.equal(block.includes('#FD4E5A'), false, 'no trace of the other signature');
  assert.equal(block.includes('Source Serif 4'), false);
});

test('the block is deterministic, byte for byte', () => {
  assert.equal(renderSignatureBlock(SIGNATURE), renderSignatureBlock(JSON.parse(JSON.stringify(SIGNATURE))));
});

// `source` names a private vault note. A path the model cannot open is noise at
// best, and an invitation to go looking at worst.
test('bookkeeping fields stay out of the prompt', () => {
  const block = renderSignatureBlock({ ...SIGNATURE, schemaVersion: 1, source: '0_Projects/Private/Brand.md' });
  assert.equal(block.includes('0_Projects/Private/Brand.md'), false);
  assert.equal(block.includes('schemaVersion'), false);
});

test('an empty or shapeless signature renders as nothing, never a bare heading', () => {
  for (const input of [null, undefined, {}, { invariants: {} }, { free: ['layout'] }, { invariants: 'coral' }, 'coral']) {
    assert.equal(renderSignatureBlock(input), '', `renders empty for ${JSON.stringify(input)}`);
  }
});

test('a malformed invariant is skipped without taking the block down', () => {
  const block = renderSignatureBlock({
    invariants: { coral: { value: '#FD4E5A' }, broken: null, nested: { role: 'kept', extra: { deep: 'dropped' } } },
  });
  assert.ok(block.includes('#FD4E5A'));
  assert.equal(block.includes('broken'), false);
  assert.ok(block.includes('kept') && block.includes('deep') === false);
});

// The CLI is what a design flow shells out to. It must never be the reason a run
// stops, so both paths exit 0.
test('the CLI prints the block for a seeded home', () => withHome((home) => {
  seed(home, SIGNATURE);
  const out = execFileSync(process.execPath, [MODULE], { env: { ...process.env, HOME: home }, encoding: 'utf8' });
  assert.match(out, /^SIGNATURE INVARIANTS\n/);
  assert.ok(out.includes('#FD4E5A') && out.includes('FREE'));
}));

test('the CLI prints one line and exits 0 when there is no signature', () => withHome((home) => {
  const out = execFileSync(process.execPath, [MODULE], { env: { ...process.env, HOME: home }, encoding: 'utf8' });
  assert.equal(out.trim(), 'NO_SIGNATURE', 'a missing signature is a fact to report, not a failure');
}));

test('the CLI survives a corrupt signature file, still exiting 0', () => withHome((home) => {
  seed(home, 'not json at all');
  const out = execFileSync(process.execPath, [MODULE], { env: { ...process.env, HOME: home }, encoding: 'utf8' });
  assert.equal(out.trim(), 'NO_SIGNATURE');
}));
