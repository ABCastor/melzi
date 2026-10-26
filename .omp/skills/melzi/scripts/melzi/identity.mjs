/**
 * The persistence seam for the guided identity session.
 *
 * The session itself lives in reference/identity.md because an agent has to
 * render and ask the visual questions. This module owns only the deterministic
 * part after those clicks: retain the person-level invariants, attach the
 * derived values and dated decisions, back up a prior signature, and emit the
 * portable DESIGN.md artifact. It deliberately does not invent a hue, alter a
 * colour dose, or make density, scale, or grid less free.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { deriveSignature } from './derive.mjs';
import { verifyBinding } from './bind-verify.mjs';
import { signaturePath } from './signature.mjs';

/** The two questions colour science cannot settle on the user's behalf. */
export const IDENTITY_TRAITS = [
  { axis: 'kleinDarkHue', label: 'Klein on dark', candidates: ['#4264F5', '#5A5CF5'] },
  { axis: 'coralFillForeground', label: 'Foreground on coral', candidates: ['#1A1A1A', '#FFFFFF'] },
];

export const IDENTITY_MARK_SCHEMA = 'melzi.identity-mark/v1';

function assertObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
}

function requiredTraitEntries(traits, now) {
  assertObject(traits, 'traits');
  return IDENTITY_TRAITS.map(({ axis, candidates }) => {
    const selection = traits[axis];
    if (!candidates.includes(selection)) {
      throw new TypeError(`${axis} must be resolved by a visual pairwise choice: ${candidates.join(' or ')}`);
    }
    return { axis, selection, learnedAt: now, source: 'identity-pairwise' };
  });
}

function mergeTraits(existing, next) {
  const retained = Array.isArray(existing)
    ? existing.filter((trait) => trait && typeof trait === 'object' && !next.some((item) => item.axis === trait.axis))
    : [];
  return [...retained, ...next];
}

function tableDirectory(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  const count = buffer.readUInt16BE(4);
  if (12 + count * 16 > buffer.length) return null;
  const tables = new Map();
  for (let index = 0; index < count; index += 1) {
    const at = 12 + index * 16;
    const tag = buffer.toString('ascii', at, at + 4);
    const offset = buffer.readUInt32BE(at + 8);
    const length = buffer.readUInt32BE(at + 12);
    if (offset + length > buffer.length) return null;
    tables.set(tag, { offset, length });
  }
  return tables;
}

function glyphForCodePoint(buffer, table, codePoint) {
  const start = table.offset;
  if (table.length < 4) return 0;
  const records = buffer.readUInt16BE(start + 2);
  let preferred = null;
  for (let index = 0; index < records; index += 1) {
    const at = start + 4 + index * 8;
    if (at + 8 > start + table.length) return 0;
    const platform = buffer.readUInt16BE(at);
    const encoding = buffer.readUInt16BE(at + 2);
    const offset = buffer.readUInt32BE(at + 4);
    const subtable = start + offset;
    if (subtable + 2 > start + table.length) continue;
    const format = buffer.readUInt16BE(subtable);
    if ((platform === 3 && (encoding === 1 || encoding === 10)) || platform === 0) {
      preferred = { subtable, format };
      if (format === 12) break;
    }
  }
  if (!preferred) return 0;
  const { subtable, format } = preferred;
  if (format === 12) {
    if (subtable + 16 > start + table.length) return 0;
    const groups = buffer.readUInt32BE(subtable + 12);
    for (let index = 0; index < groups; index += 1) {
      const at = subtable + 16 + index * 12;
      if (at + 12 > start + table.length) return 0;
      const first = buffer.readUInt32BE(at);
      const last = buffer.readUInt32BE(at + 4);
      if (codePoint >= first && codePoint <= last) return buffer.readUInt32BE(at + 8) + codePoint - first;
    }
    return 0;
  }
  if (format !== 4 || subtable + 16 > start + table.length || codePoint > 0xffff) return 0;
  const segments = buffer.readUInt16BE(subtable + 6) / 2;
  const ends = subtable + 14;
  const starts = ends + 2 * segments + 2;
  const deltas = starts + 2 * segments;
  const ranges = deltas + 2 * segments;
  if (ranges + 2 * segments > start + table.length) return 0;
  for (let index = 0; index < segments; index += 1) {
    const end = buffer.readUInt16BE(ends + index * 2);
    const begin = buffer.readUInt16BE(starts + index * 2);
    if (codePoint < begin || codePoint > end) continue;
    const delta = buffer.readInt16BE(deltas + index * 2);
    const range = buffer.readUInt16BE(ranges + index * 2);
    if (range === 0) return (codePoint + delta) & 0xffff;
    const glyphAt = ranges + index * 2 + range + 2 * (codePoint - begin);
    if (glyphAt + 2 > start + table.length) return 0;
    const glyph = buffer.readUInt16BE(glyphAt);
    return glyph === 0 ? 0 : (glyph + delta) & 0xffff;
  }
  return 0;
}

/**
 * Read only the font tables the type derivation needs. The selected face is
 * measured from its binary rather than treated as a generic half-em font.
 */
export function measureFontMetricsBuffer(buffer, {
  family,
  sampleText = 'The quick brown fox jumps over the lazy dog 0123456789.',
} = {}) {
  try {
    const tables = tableDirectory(buffer);
    const head = tables?.get('head');
    const hhea = tables?.get('hhea');
    const hmtx = tables?.get('hmtx');
    const maxp = tables?.get('maxp');
    const os2 = tables?.get('OS/2');
    const cmap = tables?.get('cmap');
    if (!head || !hhea || !hmtx || !maxp || !os2 || !cmap || head.length < 20 || hhea.length < 36 || maxp.length < 6 || os2.length < 74) return null;
    const unitsPerEm = buffer.readUInt16BE(head.offset + 18);
    const longMetrics = buffer.readUInt16BE(hhea.offset + 34);
    const glyphs = buffer.readUInt16BE(maxp.offset + 4);
    if (!unitsPerEm || !longMetrics || hmtx.length < longMetrics * 4) return null;
    const advanceForGlyph = (glyph) => {
      if (glyph <= 0 || glyph >= glyphs) return null;
      const metric = Math.min(glyph, longMetrics - 1);
      return buffer.readUInt16BE(hmtx.offset + metric * 4);
    };
    const advances = [...String(sampleText)].map((char) => advanceForGlyph(glyphForCodePoint(buffer, cmap, char.codePointAt(0)))).filter(Number.isFinite);
    if (advances.length === 0) return null;
    return {
      family: family ?? 'unknown',
      averageAdvance: advances.reduce((sum, value) => sum + value, 0) / advances.length / unitsPerEm,
      unitsPerEm,
      typoAscender: buffer.readInt16BE(os2.offset + 68),
      typoDescender: buffer.readInt16BE(os2.offset + 70),
      typoLineGap: buffer.readInt16BE(os2.offset + 72),
      source: 'font-binary',
    };
  } catch {
    return null;
  }
}

/** Return null when a binary is unavailable or malformed, never a guessed measurement. */
export function measureFontMetrics(fontPath, options = {}) {
  try {
    return measureFontMetricsBuffer(fs.readFileSync(fontPath), options);
  } catch {
    return null;
  }
}

/**
 * Create the post-session signature shape. `derivation` comes from
 * deriveSignature(), which stays pure and has no write access.
 */
export function buildIdentitySignature(signature, derivation, {
  bodySize,
  measure,
  mono,
  traits,
  now = new Date().toISOString(),
} = {}) {
  assertObject(signature, 'signature');
  assertObject(derivation, 'derivation');
  if (!Array.isArray(signature.free)) throw new TypeError('signature.free must remain an array of free axes');
  if (!Number.isFinite(bodySize) || !Number.isFinite(measure) || typeof mono !== 'string' || !mono.trim()) {
    throw new TypeError('bodySize, measure, and mono must come from the three visual picks');
  }

  const learnedTraits = requiredTraitEntries(traits, now);
  const existingVersion = Number.isFinite(signature.schemaVersion) ? signature.schemaVersion : 1;
  return {
    ...signature,
    schemaVersion: Math.max(2, existingVersion),
    updatedAt: now,
    learnedTraits: mergeTraits(signature.learnedTraits, learnedTraits),
    derived: {
      at: now,
      choices: { bodySize, measure, mono: mono.trim() },
      tokens: derivation.tokens ?? {},
      type: derivation.type ?? {},
      spacing: derivation.spacing ?? {},
      defects: Array.isArray(derivation.defects) ? derivation.defects : [],
      unresolved: Array.isArray(derivation.unresolved) ? derivation.unresolved : [],
    },
  };
}

/**
 * Join the pure derivation to the persisted identity shape. Rendering and
 * collecting the choices belongs to the session, never to this function.
 */
export function completeIdentity(signature, {
  bodySize,
  measure,
  mono,
  monoMetrics = {},
  contentMetrics = {},
  monoFontPath,
  contentFontPath,
  traits,
  now,
} = {}) {
  const measuredContent = Object.keys(contentMetrics).length > 0
    ? contentMetrics
    : (contentFontPath ? measureFontMetrics(contentFontPath, { family: 'Source Serif 4' }) ?? {} : {});
  const measuredMono = Object.keys(monoMetrics).length > 0
    ? monoMetrics
    : (monoFontPath ? measureFontMetrics(monoFontPath, { family: mono }) ?? {} : {});
  const derivation = deriveSignature(signature, {
    bodySize,
    measure,
    content: measuredContent,
    mono: Object.keys(measuredMono).length > 0
      ? { family: mono, ...measuredMono }
      : { family: mono, averageAdvance: 0.5, source: 'unknown-face-fallback' },
  });
  return {
    derivation,
    signature: buildIdentitySignature(signature, derivation, { bodySize, measure, mono, traits, now }),
  };
}

/**
 * Join one mechanically clean campaign candidate to the personal signature.
 * The campaign remains the working-history home; the signature carries the
 * selected editable master, production export, construction, and lineage so
 * later projects do not have to find the original checkout to know the mark.
 */
export function adoptIdentityMark(signature, campaign, {
  candidateId,
  now = new Date().toISOString(),
} = {}) {
  assertObject(signature, 'signature');
  assertObject(campaign, 'campaign');
  if (Array.isArray(campaign.errors) && campaign.errors.length > 0) {
    throw new Error(`the campaign must pass mechanical validation before adoption: ${campaign.errors.join('; ')}`);
  }
  const candidate = Array.isArray(campaign.candidates)
    ? campaign.candidates.find((item) => item?.id === candidateId)
    : null;
  if (!candidate) throw new Error(`candidate ${candidateId ?? '(missing)'} was not found in the campaign`);
  if (!candidate.masterSource || !candidate.exportSource || candidate.renderParity !== true) {
    throw new Error('the adopted candidate needs an editable master, a production export, and proven render parity');
  }

  return {
    ...signature,
    schemaVersion: Math.max(2, Number.isFinite(signature.schemaVersion) ? signature.schemaVersion : 1),
    updatedAt: now,
    mark: {
      schema: IDENTITY_MARK_SCHEMA,
      adoptedAt: now,
      campaignSchema: campaign.manifest?.schema ?? null,
      project: campaign.project ?? '',
      wordmark: campaign.wordmark ?? '',
      candidate: {
        id: candidate.id,
        name: candidate.name,
        status: candidate.status,
        primaryReading: candidate.primaryReading,
        secondaryReading: candidate.secondaryReading ?? null,
        fusion: candidate.fusion,
        construction: [...(candidate.construction ?? [])],
        smallSize: candidate.smallSize,
        confusion: candidate.confusion,
        motion: candidate.motion,
        objection: candidate.objection,
        lineage: {
          parents: [...(candidate.lineage?.parents ?? [])],
          change: candidate.lineage?.change ?? '',
          hypothesis: candidate.lineage?.hypothesis ?? '',
          evidence: [...(candidate.lineage?.evidence ?? [])],
        },
      },
      rules: {
        viewBox: campaign.rules?.viewBox ?? null,
        currentColorOnly: campaign.rules?.currentColorOnly ?? null,
        proofSizes: [...(campaign.sizes ?? [])],
      },
      master: candidate.masterSource,
      export: candidate.exportSource,
      claimsNotMade: [
        'authorship',
        'recognition',
        'preference',
        'trademark-clearance',
        'component-semantic-correctness',
        'renderer-pixel-equivalence',
      ],
    },
  };
}

function yamlValue(value) {
  return typeof value === 'string' ? JSON.stringify(value) : JSON.stringify(String(value));
}

function renderYamlSection(name, value, indent = '') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const lines = [`${indent}${name}:`];
  for (const [key, item] of Object.entries(value)) {
    if (item && typeof item === 'object' && !Array.isArray(item)) lines.push(...renderYamlSection(key, item, `${indent}  `));
    else lines.push(`${indent}  ${key}: ${yamlValue(item)}`);
  }
  return lines;
}

function namedValues(value, prefix) {
  if (Array.isArray(value)) return Object.fromEntries(value.map((item, index) => [`${prefix}-${index + 1}`, item]));
  return value && typeof value === 'object' ? value : {};
}

function hexTokens(tokens) {
  const output = {};
  for (const token of Array.isArray(tokens?.neutrals) ? tokens.neutrals : []) {
    if (token?.name && token?.hex) output[token.name] = token.hex;
  }
  for (const group of Object.values(tokens?.accents ?? {})) {
    for (const token of Array.isArray(group) ? group : []) {
      if (token?.name && token?.hex) output[token.name] = token.hex;
    }
  }
  // This also keeps the renderer useful for a caller's already-normalized
  // token map, which is convenient for document and audit reuse.
  if (Object.keys(output).length === 0) {
    Object.assign(output, tokens?.neutrals ?? {}, tokens?.accents ?? {});
  }
  return Object.fromEntries(Object.entries(output).filter(([, value]) => typeof value === 'string'));
}

function faceName(face) {
  return typeof face === 'string' ? face : face?.family ?? 'unspecified';
}

/** Render the portions of Google Labs DESIGN.md that are determined by the session. */
export function renderIdentityDesignMd({ signature, derivation }) {
  assertObject(signature, 'signature');
  assertObject(derivation, 'derivation');
  const tokens = derivation.tokens ?? {};
  const type = derivation.type ?? {};
  const spacing = derivation.spacing ?? {};
  const colorTokens = hexTokens(tokens);
  const faces = type.faces ?? signature.invariants?.type ?? {};
  const contentFace = faceName(faces.content);
  const monoFace = faceName(faces.mono ?? faces.data);
  const typeScale = namedValues(type.scale, 'step');
  const spacingSteps = namedValues(spacing.steps, 'step');
  const lineHeightEvidence = type.lineHeightEvidence ?? 'Field fit evidence was not supplied.';
  const lines = [
    '---',
    'name: Design System',
    'description: "Derived identity values, then visual choices where mathematics stops."',
    ...renderYamlSection('colors', colorTokens),
    'typography:',
    '  body:',
    `    fontFamily: ${yamlValue(contentFace)}`,
    `    fontSize: ${yamlValue(`${type.bodySize ?? ''}px`)}`,
    `    lineHeight: ${yamlValue(type.lineHeight ?? '')}`,
    '  mono:',
    `    fontFamily: ${yamlValue(monoFace)}`,
    '  scale:',
    ...Object.entries(typeScale).map(([name, value]) => `    ${name}: ${yamlValue(`${value}px`)}`),
    ...renderYamlSection('spacing', spacingSteps),
    '---',
    '',
    '# Design System: Identity',
    '',
    '## Overview',
    '',
    'A warm coral leads a near-silent neutral field. Klein blue remains the smaller spark. The session preserves the signature\'s free layers instead of converting a token system into a layout prescription.',
    '',
    '## Colors',
    '',
    'Use named tokens, not inline replacements. The neutral field is solved before the accents. WCAG 2 remains the shipping floor; dark-surface text also meets the binding APCA gate.',
    '',
    ...Object.entries(colorTokens).map(([name, value]) => `- **${name}:** ${value}`),
    '',
    '## Typography',
    '',
    `**Body:** ${contentFace}. **Mono:** ${monoFace}.`,
    '',
    `Body size: ${type.bodySize ?? 'unspecified'}px. Target measure: ${type.measure ?? 'unspecified'} characters. Line height: ${type.lineHeight ?? 'unspecified'} (${type.lineHeightPx ?? 'unspecified'}px).`,
    '',
    `Line-height evidence: ${lineHeightEvidence}`,
    '',
    '## Layout',
    '',
    `Spacing begins at the computed body line height (${spacing.baseUnit ?? 'unspecified'}), so vertical rhythm and horizontal padding share one origin.`,
    '',
    ...Object.entries(spacingSteps).map(([name, value]) => `- **${name}:** ${value}px`),
    '',
    '## Components',
    '',
    'Component treatment remains a surface-level decision. Apply the named tokens consistently and leave composition, density, scale, and grid open to the selected world.',
    '',
  ];
  return lines.join('\n');
}

function safeStamp(now) {
  return String(now).replace(/[:.]/g, '-');
}

/**
 * Write both requested artifacts only after every refusal condition has been
 * checked. The prior personal signature is copied before its replacement.
 */
export function writeIdentityArtifacts({
  home = os.homedir(),
  project = process.cwd(),
  signature,
  derivation,
  now = new Date().toISOString(),
  overwriteDesign = false,
} = {}) {
  assertObject(signature, 'signature');
  assertObject(derivation, 'derivation');
  const targetSignature = signaturePath(home);
  const targetDesign = path.join(project, 'DESIGN.md');
  if (fs.existsSync(targetDesign) && !overwriteDesign) {
    throw new Error('DESIGN.md already exists; show it and get an explicit overwrite or merge choice first');
  }

  const backup = fs.existsSync(targetSignature)
    ? `${targetSignature}.backup-${safeStamp(now)}`
    : null;
  fs.mkdirSync(path.dirname(targetSignature), { recursive: true });
  if (backup) fs.copyFileSync(targetSignature, backup);
  fs.writeFileSync(targetSignature, `${JSON.stringify(signature, null, 2)}\n`);
  fs.writeFileSync(targetDesign, renderIdentityDesignMd({ signature, derivation }));
  return { signature: targetSignature, backup, design: targetDesign };
}

/** Write the artifacts and make the existing binding proof the completion gate. */
export async function finalizeIdentity(options = {}) {
  const written = writeIdentityArtifacts(options);
  const binding = await verifyBinding(options.project ?? process.cwd());
  if (binding.exitCode !== 0) {
    throw new Error(`Identity artifacts were written but are not complete: ${binding.lines.join('\n')}`);
  }
  return { ...written, binding };
}
