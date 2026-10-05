// The guided identity session. FORK-ONLY.
//
// Identity has a narrow write boundary: the user chooses rendered alternatives,
// the deriver calculates downstream values, and this seam persists the result.
// These tests keep the signature personal (a temporary home only), preserve its
// free axes, and make an overwrite recoverable.
import test from 'node:test';
import assert from 'node:assert/strict';
import { findEngineBinary, engineEnv, ENGINE_MISSING_MESSAGE } from './lib/engine-bin.mjs';
const ENGINE = findEngineBinary();
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SKILL_CATEGORIES } from '../scripts/lib/skill-categories.js';
import { replacePlaceholders } from '../scripts/lib/utils.js';

import {
  IDENTITY_MARK_SCHEMA,
  IDENTITY_TRAITS,
  adoptIdentityMark,
  buildIdentitySignature,
  completeIdentity,
  measureFontMetricsBuffer,
  renderIdentityDesignMd,
  writeIdentityArtifacts,
} from '../skill/scripts/melzi/identity.mjs';

const SIGNATURE = {
  invariants: {
    coral: { value: '#FD4E5A', textSafe: '#E23742' },
    klein: { light: '#2426E0', dark: '#5A5CF5' },
    neutrals: { bgLight: '#FFFFFF', bgDark: '#1A1A1A' },
    type: { content: 'Source Serif 4', data: 'monospace' },
    ratio: 'roughly 70/30: coral leads, Klein lifts',
  },
  free: ['layout', 'composition', 'density', 'texture', 'scale', 'grid'],
};

const DERIVATION = {
  tokens: { neutrals: { bgLight: '#FFFFFF' }, accents: { coralText: '#D90035' } },
  type: {
    bodySize: 18,
    measure: 65,
    lineHeight: 1.5058,
    lineHeightPx: 27.1,
    lineHeightEvidence: 'field fit over ten sites; not a validated law; roughly +/-0.08',
    scale: { body: '18px', h3: '24px' },
    faces: { content: 'Source Serif 4', data: 'IBM Plex Mono' },
  },
  spacing: { baseUnit: '27.1px', steps: { sm: '13.6px', md: '27.1px' } },
  defects: [{ id: 'coralText-aa', disposition: 'auto-derived' }],
  unresolved: [],
};

function withPaths(fn) {
  const root = mkdtempSync(join(tmpdir(), 'melzi-identity-'));
  const home = join(root, 'home');
  const project = join(root, 'project');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(project, { recursive: true });
  try { return fn({ root, home, project }); } finally { rmSync(root, { recursive: true, force: true }); }
}

function syntheticFont() {
  const head = Buffer.alloc(54);
  head.writeUInt16BE(1000, 18);
  const hhea = Buffer.alloc(36);
  hhea.writeUInt16BE(2, 34);
  const maxp = Buffer.alloc(6);
  maxp.writeUInt16BE(2, 4);
  const hmtx = Buffer.alloc(8);
  hmtx.writeUInt16BE(500, 4);
  const os2 = Buffer.alloc(74);
  os2.writeInt16BE(1000, 68);
  os2.writeInt16BE(-300, 70);
  const cmap = Buffer.alloc(44);
  cmap.writeUInt16BE(1, 2);
  cmap.writeUInt16BE(3, 4);
  cmap.writeUInt16BE(1, 6);
  cmap.writeUInt32BE(12, 8);
  const subtable = 12;
  cmap.writeUInt16BE(4, subtable);
  cmap.writeUInt16BE(32, subtable + 2);
  cmap.writeUInt16BE(4, subtable + 6);
  cmap.writeUInt16BE(4, subtable + 8);
  cmap.writeUInt16BE(1, subtable + 10);
  cmap.writeUInt16BE(0, subtable + 12);
  cmap.writeUInt16BE(65, subtable + 14);
  cmap.writeUInt16BE(0xffff, subtable + 16);
  cmap.writeUInt16BE(65, subtable + 20);
  cmap.writeUInt16BE(0xffff, subtable + 22);
  cmap.writeInt16BE(-64, subtable + 24);
  cmap.writeInt16BE(1, subtable + 26);
  const tables = { 'OS/2': os2, cmap, head, hhea, hmtx, maxp };
  const tags = Object.keys(tables);
  let offset = 12 + tags.length * 16;
  const placed = [];
  for (const tag of tags) {
    offset = Math.ceil(offset / 4) * 4;
    placed.push({ tag, offset, data: tables[tag] });
    offset += tables[tag].length;
  }
  const font = Buffer.alloc(offset);
  font.writeUInt32BE(0x00010000, 0);
  font.writeUInt16BE(tags.length, 4);
  placed.forEach(({ tag, offset: tableOffset, data }, index) => {
    const record = 12 + index * 16;
    font.write(tag, record, 4, 'ascii');
    font.writeUInt32BE(tableOffset, record + 8);
    font.writeUInt32BE(data.length, record + 12);
    data.copy(font, tableOffset);
  });
  return font;
}

test('selected-face metrics come from the SFNT binary, not a generic character-width guess', () => {
  const metrics = measureFontMetricsBuffer(syntheticFont(), { family: 'Fixture Mono', sampleText: 'AAA' });
  assert.deepEqual(metrics, {
    family: 'Fixture Mono',
    averageAdvance: 0.5,
    unitsPerEm: 1000,
    typoAscender: 1000,
    typoDescender: -300,
    typoLineGap: 0,
    source: 'font-binary',
  });
  assert.equal(measureFontMetricsBuffer(Buffer.from('not a font')), null);
});

test('identity keeps every free axis and records the two non-automatic decisions as dated traits', () => {
  const result = buildIdentitySignature(SIGNATURE, DERIVATION, {
    bodySize: 18,
    measure: 65,
    mono: 'IBM Plex Mono',
    traits: {
      kleinDarkHue: '#5A5CF5',
      coralFillForeground: '#FFFFFF',
    },
    now: '2026-07-29T12:00:00.000Z',
  });

  assert.equal(result.schemaVersion, 2);
  assert.deepEqual(result.free, SIGNATURE.free);
  assert.deepEqual(result.derived.tokens, DERIVATION.tokens);
  assert.equal(result.derived.choices.measure, 65);
  assert.deepEqual(result.learnedTraits.map((trait) => trait.axis), IDENTITY_TRAITS.map((trait) => trait.axis));
  assert.ok(result.learnedTraits.every((trait) => trait.learnedAt === '2026-07-29T12:00:00.000Z'));
});

test('identity refuses to turn an unresolved taste conflict into a silent default', () => {
  assert.throws(() => buildIdentitySignature(SIGNATURE, DERIVATION, {
    bodySize: 18,
    measure: 65,
    mono: 'IBM Plex Mono',
    traits: { kleinDarkHue: '#4264F5' },
  }), /coralFillForeground/);
});

test('identity adoption preserves the signature and joins the validated production mark', () => {
  const campaign = {
    errors: [],
    manifest: { schema: 'melzi.logo-campaign/v1' },
    project: 'Fixture project',
    wordmark: 'Fixture',
    rules: { viewBox: '0 0 24 24', currentColorOnly: true },
    sizes: [96, 32, 16],
    candidates: [{
      id: 'c01',
      name: 'Joined forms',
      status: 'approved',
      primaryReading: 'A joined pair',
      secondaryReading: null,
      fusion: 'One shared contour',
      construction: ['Draw form A', 'Draw form B', 'Join the overlap'],
      smallSize: 'The shared contour survives',
      confusion: 'May read as a knot',
      motion: 'None',
      objection: 'The overlap may be too subtle',
      lineage: { parents: [], change: 'Initial candidate', hypothesis: 'Read as one', evidence: ['mechanical gates passed'] },
      masterSource: '<svg viewBox="0 0 24 24"><path id="form-a" d="M0 0h12v24H0z"/></svg>',
      exportSource: '<svg viewBox="0 0 24 24"><path d="M0 0h12v24H0z"/></svg>',
      renderParity: true,
    }],
  };

  const adopted = adoptIdentityMark(SIGNATURE, campaign, {
    candidateId: 'c01',
    now: '2026-08-25T12:00:00.000Z',
  });

  assert.deepEqual(adopted.invariants, SIGNATURE.invariants);
  assert.deepEqual(adopted.free, SIGNATURE.free);
  assert.equal(adopted.mark.schema, IDENTITY_MARK_SCHEMA);
  assert.equal(adopted.mark.candidate.id, 'c01');
  assert.equal(adopted.mark.master, campaign.candidates[0].masterSource);
  assert.equal(adopted.mark.export, campaign.candidates[0].exportSource);
  assert.deepEqual(adopted.mark.rules.proofSizes, [96, 32, 16]);
  assert.ok(adopted.mark.claimsNotMade.includes('trademark-clearance'));
  assert.equal(SIGNATURE.mark, undefined, 'adoption must not mutate the loaded signature');
});

test('identity refuses a mark whose campaign or master/export parity is not clean', () => {
  const candidate = {
    id: 'c01',
    masterSource: '<svg/>',
    exportSource: '<svg/>',
    renderParity: true,
    lineage: { parents: [], evidence: [] },
  };
  assert.throws(() => adoptIdentityMark(SIGNATURE, {
    errors: ['flattened export differs from master'],
    candidates: [candidate],
  }, { candidateId: 'c01' }), /must pass mechanical validation/);
  assert.throws(() => adoptIdentityMark(SIGNATURE, {
    errors: [],
    candidates: [{ ...candidate, renderParity: false }],
  }, { candidateId: 'c01' }), /proven render parity/);
});

test('the session seam calls the pure deriver rather than duplicating its arithmetic', () => {
  const complete = completeIdentity(SIGNATURE, {
    bodySize: 18,
    measure: 65,
    mono: 'IBM Plex Mono',
    traits: { kleinDarkHue: '#4264F5', coralFillForeground: '#1A1A1A' },
    now: '2026-07-29T12:00:00.000Z',
  });
  assert.equal(complete.derivation.type.measure, 65);
  assert.equal(complete.signature.derived.type.lineHeightEvidence.includes('not a validated law'), true);
});

test('writing backs up an existing signature, writes DESIGN.md, and does not touch the real home', () => withPaths(({ home, project }) => {
  const signatureFile = join(home, '.impeccable', 'signature.json');
  fs.mkdirSync(join(home, '.impeccable'), { recursive: true });
  fs.writeFileSync(signatureFile, JSON.stringify(SIGNATURE));
  const next = buildIdentitySignature(SIGNATURE, DERIVATION, {
    bodySize: 18,
    measure: 65,
    mono: 'IBM Plex Mono',
    traits: { kleinDarkHue: '#4264F5', coralFillForeground: '#1A1A1A' },
    now: '2026-07-29T12:00:00.000Z',
  });

  const written = writeIdentityArtifacts({ home, project, signature: next, derivation: DERIVATION, now: '2026-07-29T12:00:00.000Z' });
  assert.ok(fs.existsSync(written.signature));
  assert.ok(fs.existsSync(written.backup));
  assert.deepEqual(JSON.parse(fs.readFileSync(written.backup, 'utf8')), SIGNATURE);
  assert.match(fs.readFileSync(written.design, 'utf8'), /^---\nname: Design System\n/m);
  assert.match(fs.readFileSync(written.design, 'utf8'), /field fit over ten sites/i);
}));

test('identity never overwrites an existing DESIGN.md without an explicit choice', () => withPaths(({ home, project }) => {
  fs.writeFileSync(join(project, 'DESIGN.md'), '# Existing\n');
  assert.throws(() => writeIdentityArtifacts({ home, project, signature: SIGNATURE, derivation: DERIVATION }), /DESIGN\.md already exists/);
}));

test('the generated DESIGN.md describes derived values without pretending the line-height fit is a law', () => {
  const design = renderIdentityDesignMd({ signature: SIGNATURE, derivation: DERIVATION });
  assert.match(design, /# Design System: Identity/);
  assert.match(design, /Source Serif 4/);
  assert.match(design, /not a validated law/i);
  assert.match(design, /density, scale, and grid open/i);
  assert.doesNotMatch(design, /^\s*(density|grid):/mi, 'free axes must never become derived values');
});

test('identity is registered everywhere a sub-command needs to exist', () => {
  const source = fs.readFileSync('skill/SKILL.src.md', 'utf8');
  const metadata = JSON.parse(fs.readFileSync('skill/scripts/command-metadata.json', 'utf8'));
  assert.match(source, /^\| `identity \[project\]` .*reference\/identity\.md/m);
  assert.match(replacePlaceholders('{{available_commands}}', 'claude-code', []), /\/melzi identity\b/);
  assert.ok(metadata.identity?.description.length > 80);
  assert.equal(metadata.identity?.argumentHint, '[project]');
  assert.ok(SKILL_CATEGORIES.identity);
  assert.ok(ENGINE, ENGINE_MISSING_MESSAGE);
  const pin = spawnSync(ENGINE, ['pin', 'pin', 'not-a-real-command'], { encoding: 'utf8', env: engineEnv(ENGINE) });
  assert.equal(pin.status, 1);
  assert.match(pin.stderr, /\bidentity\b/);
});
