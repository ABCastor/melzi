// Identity derivation vectors. The numbers below were measured before the
// deriver existed, so this suite rejects an implementation that merely makes
// plausible-looking ramps.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  apcaContrast,
  contrastRatio,
  deriveTypeAndSpace,
  deriveSignature,
  findRequiredLightness,
  hexToOklch,
  oklchToHex,
} from '../skill/scripts/melzi/derive.mjs';

const signature = {
  invariants: {
    coral: { value: '#FD4E5A', textSafe: '#E23742' },
    klein: { light: '#2426E0', dark: '#5A5CF5' },
    // The recorded defect values: danger is only 2.3 degrees from coral in
    // light mode and its dark token is dE 0.022 from coralText.
    danger: { light: '#D24648', dark: '#E2213C' },
    neutrals: {
      bgLight: '#FFFFFF', bgDark: '#1A1A1A', textLight: '#1A1A1A', textDark: '#D4D4D4',
    },
    type: { content: 'Source Serif 4', data: 'monospace' },
  },
  free: ['density', 'scale', 'grid'],
};

function close(actual, expected, tolerance, label) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: expected ${expected} ± ${tolerance}, got ${actual}`);
}

test('recorded colour science vectors are reproduced before any token is emitted', () => {
  const coral = { l: 0.6, c: 0.21, h: 21.2 };
  const klein = { l: 0.5, c: 0.262, h: 268.5 };
  const white = hexToOklch('#FFFFFF');
  const charcoal = hexToOklch('#1A1A1A');

  const cases = [
    ['coral body on white', coral, white, 'body', 0.594, 0.415],
    ['coral body on dark', coral, charcoal, 'body', 0.631, 0.927],
    ['klein body on dark', klein, charcoal, 'body', 0.615, 0.924],
    ['coral UI mark on white', coral, white, 'mark', 0.691, 0.758],
  ];

  for (const [label, seed, background, job, wcag, apca] of cases) {
    const result = findRequiredLightness({ seed, background, job });
    close(result.wcagLightness, wcag, 0.004, `${label}, WCAG`);
    close(result.apcaLightness, apca, 0.005, `${label}, APCA`);
  }
});

test('recorded coral contrast disagreement is reproduced', () => {
  const coral = '#FD4E5A';
  const dark = '#1A1A1A';
  close(contrastRatio(coral, dark), 5.32, 0.02, 'WCAG ratio');
  close(apcaContrast(coral, dark), -41.6, 0.5, 'APCA Lc');
});

test('the current signature defects are reported rather than hidden', () => {
  const result = deriveSignature(signature, {
    bodySize: 19,
    measure: 65,
    mono: { family: 'IBM Plex Mono', averageAdvance: 0.6, unitsPerEm: 1000, typoAscender: 1025, typoDescender: -275, typoLineGap: 0 },
  });
  const defects = new Map(result.defects.map((defect) => [defect.id, defect]));

  close(defects.get('coral-text-aa').actual, 4.322, 0.004, 'coralText WCAG defect');
  close(defects.get('coral-danger-distance').actual, 0.022, 0.004, 'coral/dark-danger Oklab dE defect');
  assert.ok(defects.has('danger-hue-separation'));
  assert.ok(defects.has('klein-dark-hue-drift'));
  assert.equal(result.unresolved.some((item) => item.id === 'klein-dark-hue'), true);
  assert.equal(result.unresolved.some((item) => item.id === 'coral-fill-foreground'), true);
});

test('accent output obeys the specified gamut-aware chroma policy', () => {
  const result = deriveSignature(signature, { bodySize: 19, measure: 65 });
  for (const ramp of Object.values(result.tokens.accents)) {
    for (const token of ramp) {
      const cap = token.maxChroma * 0.92;
      assert.ok(token.oklch.c <= cap + 0.0001, `${token.name} exceeds its 92% gamut cap`);
      assert.ok(token.oklch.c <= token.identityChroma + 0.0001, `${token.name} exceeds identity chroma`);
    }
  }
});

test('the neutral spine is derived and contrast-gated before accent output', () => {
  const result = deriveSignature(signature, { bodySize: 19, measure: 65 });
  const tokens = new Map(result.tokens.neutrals.map((token) => [token.name, token]));

  for (const name of ['neutral-text-light', 'neutral-text-dark', 'neutral-secondary-light', 'neutral-secondary-dark', 'neutral-hairline-light', 'neutral-hairline-dark']) {
    assert.ok(tokens.has(name), `${name} is a derived neutral job, not an echoed input`);
    assert.ok(tokens.get(name).gates, `${name} carries its contrast evidence`);
  }
  assert.ok(tokens.get('neutral-text-light').gates.wcag >= 4.5);
  assert.ok(Math.abs(tokens.get('neutral-text-dark').gates.apca) >= 90);
  assert.ok(tokens.get('neutral-secondary-light').gates.wcag >= 3);
  assert.ok(Math.abs(tokens.get('neutral-secondary-dark').gates.apca) >= 45);
});

test('type and space output derives from selected metrics, not a modular ratio', () => {
  const result = deriveSignature(signature, {
    bodySize: 19,
    measure: 65,
    mono: { family: 'IBM Plex Mono', averageAdvance: 0.6, unitsPerEm: 1000, typoAscender: 1025, typoDescender: -275, typoLineGap: 0 },
  });

  close(result.type.lineHeight, 1.5048, 0.0001, 'line-height field fit');
  close(result.type.contentBoxFloor, 1.371, 0.0001, 'Source Serif 4 metric floor');
  close(result.type.measureWidthPx, 546.364, 0.001, 'measure derives from selected face advance');
  assert.match(result.type.lineHeightEvidence, /field fit over ten sites.*R² 0\.41.*±0\.08/i);
  assert.equal(Object.hasOwn(result.type, 'ratio'), false);
  assert.equal(Object.hasOwn(result.type, 'scale'), false, 'no unvalidated modular heading scale');
  assert.match(result.type.hierarchy.note, /visual.*session-resolved/i);
  close(result.spacing.baseUnit, 28.5912, 0.0001, 'spacing base is the computed body line-height');
  assert.deepEqual(result.spacing.steps, [14.2956, 28.5912, 42.8868, 57.1824, 85.7736, 114.3648]);
  assert.equal(result.spacing.origin, 'computed body line height');
});

test('an unknown face does not inherit Source Serif 4 metrics', () => {
  const result = deriveTypeAndSpace({
    bodySize: 19,
    measure: 65,
    content: { family: 'Unmeasured Display' },
  });
  assert.equal(result.faces.content.averageAdvance, 0.5);
  assert.equal(result.faces.content.metricSource, 'unknown-face fallback');
  assert.equal(result.contentBoxFloor, null);
});

test('OKLCH output is serialisable to CSS-friendly hex without invalid sRGB channels', () => {
  const hex = oklchToHex({ l: 0.6, c: 0.21, h: 21.2 });
  assert.match(hex, /^#[0-9A-F]{6}$/);
});
