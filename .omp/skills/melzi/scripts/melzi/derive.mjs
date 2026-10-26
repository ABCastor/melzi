/**
 * Pure identity derivation.
 *
 * This module deliberately has no filesystem, prompt, or session dependency. A
 * caller supplies invariant colours and the settings chosen from rendered
 * alternatives; this module derives downstream tokens and reports conflicts.
 */

const EPSILON = 1e-7;
const WCAG_BODY = 4.5;
const WCAG_MARK = 3;
const WCAG_HAIRLINE = 1.5;
// APCA's body-text target is Lc 90. Its lower Lc 60 guidance is for larger
// text, and would reproduce neither the recorded white nor dark-body vectors.
const APCA_BODY = 90;
const APCA_MARK = 45;
const APCA_HAIRLINE = 15;
const SOURCE_SERIF_4 = {
  averageAdvance: 0.4424,
  unitsPerEm: 1000,
  typoAscender: 1036,
  typoDescender: -335,
  typoLineGap: 0,
};

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function round(value, places = 4) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function hueDistance(a, b) {
  const distance = Math.abs(a - b) % 360;
  return distance > 180 ? 360 - distance : distance;
}

function srgbToLinear(value) {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(value) {
  const channel = clamp(value);
  return 255 * (channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055);
}

export function parseHex(input) {
  if (typeof input !== 'string') return null;
  const match = /^#?([0-9a-f]{6})$/i.exec(input.trim());
  if (!match) return null;
  const hex = match[1];
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  };
}

export function hexToOklab(input) {
  const rgb = typeof input === 'string' ? parseHex(input) : input;
  if (!rgb) return null;
  const r = srgbToLinear(rgb.r);
  const g = srgbToLinear(rgb.g);
  const b = srgbToLinear(rgb.b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

export function hexToOklch(input) {
  const lab = hexToOklab(input);
  if (!lab) return null;
  const c = Math.hypot(lab.a, lab.b);
  return { l: lab.l, c, h: ((Math.atan2(lab.b, lab.a) * 180 / Math.PI) + 360) % 360 };
}

export function oklchToLinearRgb({ l, c, h }) {
  const radians = h * Math.PI / 180;
  const a = c * Math.cos(radians);
  const b = c * Math.sin(radians);
  const lRoot = l + 0.3963377774 * a + 0.2158037573 * b;
  const mRoot = l - 0.1055613458 * a - 0.0638541728 * b;
  const sRoot = l - 0.0894841775 * a - 1.291485548 * b;
  const l3 = lRoot ** 3;
  const m3 = mRoot ** 3;
  const s3 = sRoot ** 3;
  return {
    r: 4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
    g: -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
    b: -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3,
  };
}

export function isSrgbGamut(oklch) {
  const rgb = oklchToLinearRgb(oklch);
  return Object.values(rgb).every((value) => value >= -EPSILON && value <= 1 + EPSILON);
}

export function oklchToHex(oklch) {
  const rgb = oklchToLinearRgb(oklch);
  const hex = [rgb.r, rgb.g, rgb.b]
    .map((channel) => Math.round(linearToSrgb(channel)).toString(16).padStart(2, '0').toUpperCase())
    .join('');
  return `#${hex}`;
}

/** Largest sRGB chroma at a lightness and hue, solved rather than tabled. */
export function maxChroma(lightness, hue) {
  let low = 0;
  let high = 0.5;
  for (let index = 0; index < 28; index += 1) {
    const middle = (low + high) / 2;
    if (isSrgbGamut({ l: lightness, c: middle, h: hue })) low = middle;
    else high = middle;
  }
  return low;
}

/** The required C(L) = min(C_identity, 0.92 * maxChroma(L, hue)) policy. */
export function chromaAtLightness({ l, h, identityChroma }) {
  const ceiling = maxChroma(l, h);
  return Math.min(identityChroma, 0.92 * ceiling);
}

export function relativeLuminance(input) {
  const rgb = typeof input === 'string' ? parseHex(input) : input;
  if (!rgb) return NaN;
  return 0.2126 * srgbToLinear(rgb.r) + 0.7152 * srgbToLinear(rgb.g) + 0.0722 * srgbToLinear(rgb.b);
}

export function contrastRatio(foreground, background) {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// APCA 0.1.9G constants. Signed result is foreground relative to background.
export function apcaContrast(foreground, background) {
  const foregroundRgb = typeof foreground === 'string' ? parseHex(foreground) : foreground;
  const backgroundRgb = typeof background === 'string' ? parseHex(background) : background;
  if (!foregroundRgb || !backgroundRgb) return NaN;
  const y = ({ r, g, b }) => 0.2126729 * (r / 255) ** 2.4 + 0.7151522 * (g / 255) ** 2.4 + 0.072175 * (b / 255) ** 2.4;
  const softClamp = (value) => value < 0.022 ? value + (0.022 - value) ** 1.414 : value;
  const txt = softClamp(y(foregroundRgb));
  const bg = softClamp(y(backgroundRgb));
  if (Math.abs(bg - txt) < 0.0005) return 0;
  if (bg > txt) {
    const sapc = (bg ** 0.56 - txt ** 0.57) * 1.14;
    return sapc < 0.1 ? 0 : (sapc - 0.027) * 100;
  }
  const sapc = (bg ** 0.65 - txt ** 0.62) * 1.14;
  return sapc > -0.1 ? 0 : (sapc + 0.027) * 100;
}

function colourAtLightness(seed, lightness) {
  return {
    l: lightness,
    c: chromaAtLightness({ l: lightness, h: seed.h, identityChroma: seed.c }),
    h: seed.h,
  };
}

function solveThreshold({ seed, background, target, metric }) {
  const backgroundHex = typeof background === 'string' ? background : oklchToHex(background);
  const backgroundLuminance = relativeLuminance(backgroundHex);
  const needsDarkForeground = backgroundLuminance >= 0.5;
  let low = needsDarkForeground ? 0 : (hexToOklch(backgroundHex)?.l ?? 0);
  let high = needsDarkForeground ? (hexToOklch(backgroundHex)?.l ?? 1) : 1;
  const passes = (lightness) => {
    const colour = oklchToHex(colourAtLightness(seed, lightness));
    const value = metric === 'wcag'
      ? contrastRatio(colour, backgroundHex)
      : Math.abs(apcaContrast(colour, backgroundHex));
    return value >= target;
  };
  // Find the boundary closest to the background, not an arbitrary lighter/darker step.
  for (let index = 0; index < 32; index += 1) {
    const middle = (low + high) / 2;
    if (needsDarkForeground) {
      if (passes(middle)) low = middle;
      else high = middle;
    } else if (passes(middle)) high = middle;
    else low = middle;
  }
  return needsDarkForeground ? low : high;
}

/**
 * Solve both gates independently. The caller, not this helper, decides which
 * gate binds: WCAG everywhere, APCA only on dark surfaces.
 */
export function findRequiredLightness({ seed, background, job = 'body' }) {
  const targets = job === 'hairline'
    ? { wcag: WCAG_HAIRLINE, apca: APCA_HAIRLINE }
    : job === 'mark'
      ? { wcag: WCAG_MARK, apca: APCA_MARK }
      : { wcag: WCAG_BODY, apca: APCA_BODY };
  return {
    wcagLightness: solveThreshold({ seed, background, target: targets.wcag, metric: 'wcag' }),
    apcaLightness: solveThreshold({ seed, background, target: targets.apca, metric: 'apca' }),
  };
}

function isLightSurface(hex) {
  return relativeLuminance(hex) >= 0.5;
}

function tokenForJob(name, seed, background, job) {
  const solved = findRequiredLightness({ seed, background, job });
  const lightness = isLightSurface(background) ? solved.wcagLightness : Math.max(solved.wcagLightness, solved.apcaLightness);
  const oklch = colourAtLightness(seed, lightness);
  return {
    name,
    hex: oklchToHex(oklch),
    oklch: { l: round(oklch.l), c: round(oklch.c), h: round(oklch.h, 1) },
    identityChroma: round(seed.c),
    maxChroma: round(maxChroma(oklch.l, oklch.h)),
    gates: {
      wcag: round(contrastRatio(oklchToHex(oklch), background), 3),
      apca: round(apcaContrast(oklchToHex(oklch), background), 1),
      requiredLightness: { wcag: round(solved.wcagLightness, 3), apca: round(solved.apcaLightness, 3) },
      apcaBinding: !isLightSurface(background),
    },
  };
}

function readColour(invariants, group, keys) {
  const value = invariants?.[group];
  if (!value || typeof value !== 'object') return null;
  for (const key of keys) {
    if (typeof value[key] === 'string' && parseHex(value[key])) return value[key];
  }
  return null;
}

function readSeed(invariants, group, keys) {
  const hex = readColour(invariants, group, keys);
  return hex ? { hex, ...hexToOklch(hex) } : null;
}

function oklabDistance(first, second) {
  const a = hexToOklab(first);
  const b = hexToOklab(second);
  if (!a || !b) return null;
  return Math.hypot(a.l - b.l, a.a - b.a, a.b - b.b);
}

function currentSignatureDefects({ invariants, coral, klein, backgrounds }) {
  const defects = [];
  const coralText = readColour(invariants, 'coral', ['textSafe', 'coralText', 'text']);
  const dangerLight = readColour(invariants, 'danger', ['light', 'value']);
  const dangerDark = readColour(invariants, 'danger', ['dark']);
  const kleinDark = readColour(invariants, 'klein', ['dark']);
  if (coralText && backgrounds.light) {
    const actual = contrastRatio(coralText, backgrounds.light);
    if (actual < WCAG_BODY) defects.push({
      id: 'coral-text-aa', severity: 'auto', actual: round(actual, 3), floor: WCAG_BODY,
      summary: `coralText is ${round(actual, 3)}:1 against the light background, below the ${WCAG_BODY}:1 AA floor.`,
      fix: 'Derive the text token from the WCAG floor.',
    });
  }
  if (coral && dangerLight) {
    const danger = hexToOklch(dangerLight);
    const actual = hueDistance(coral.h, danger.h);
    if (actual < 20) defects.push({
      id: 'danger-hue-separation', severity: 'route', actual: round(actual, 1), floor: 20,
      summary: `Danger is ${round(actual, 1)} degrees from coral, below the stated 20 degree separation.`,
      fix: 'Derive danger from a stated hue separation.',
    });
  }
  if (coralText && dangerDark) {
    const actual = oklabDistance(coralText, dangerDark);
    if (actual !== null && actual <= 0.025) defects.push({
      id: 'coral-danger-distance', severity: 'route', actual: round(actual, 3), floor: 0.025,
      summary: `coralText and dark-mode danger are only ${round(actual, 3)} Oklab dE apart.`,
      fix: 'Re-derive danger after fixing the text-safe coral floor.',
    });
  }
  if (klein && kleinDark) {
    const dark = hexToOklch(kleinDark);
    const actual = hueDistance(klein.h, dark.h);
    if (actual >= 5) defects.push({
      id: 'klein-dark-hue-drift', severity: 'route', actual: round(actual, 1),
      summary: `Klein dark is hue-rotated ${round(actual, 1)} degrees from Klein light.`,
      fix: 'Offer the constant-hue and hand-picked dark candidates as a pairwise choice.',
    });
  }
  return defects;
}

function normaliseFontMetrics(metrics = {}, fallback = {}) {
  const merged = { ...fallback, ...metrics };
  const unitsPerEm = Number(merged.unitsPerEm) || 1000;
  const ascender = Number(merged.typoAscender);
  const descender = Number(merged.typoDescender);
  const lineGap = Number(merged.typoLineGap) || 0;
  const hasVerticalMetrics = Number.isFinite(ascender) && Number.isFinite(descender);
  return {
    family: typeof merged.family === 'string' ? merged.family : 'unknown',
    averageAdvance: Number(merged.averageAdvance) || 0.5,
    unitsPerEm,
    typoAscender: Number.isFinite(ascender) ? ascender : 0,
    typoDescender: Number.isFinite(descender) ? descender : 0,
    typoLineGap: lineGap,
    contentBox: hasVerticalMetrics ? (Math.abs(ascender) + Math.abs(descender) + lineGap) / unitsPerEm : null,
    metricSource: hasVerticalMetrics ? 'font-binary' : 'unknown-face fallback',
  };
}

export function deriveTypeAndSpace({ bodySize = 18, measure = 65, content = {}, mono = {} } = {}) {
  const selectedBodySize = Number(bodySize);
  const selectedMeasure = Number(measure);
  if (!Number.isFinite(selectedBodySize) || selectedBodySize <= 0) throw new TypeError('bodySize must be a positive number.');
  if (!Number.isFinite(selectedMeasure) || selectedMeasure < 55 || selectedMeasure > 75) throw new RangeError('measure must be within the 55 to 75 character band.');
  const hasExplicitContentMetrics = content && Object.keys(content).length > 0;
  const contentMetrics = normaliseFontMetrics(content, hasExplicitContentMetrics
    ? { family: 'unknown', averageAdvance: 0.5 }
    : { family: 'Source Serif 4', ...SOURCE_SERIF_4 });
  const monoMetrics = normaliseFontMetrics(mono, { family: 'monospace', averageAdvance: 0.6 });
  const lineHeight = 1.094 + 0.00632 * selectedMeasure;
  const lineHeightPx = selectedBodySize * lineHeight;
  // The body line box is the shared spatial origin. Keep the computed values:
  // snapping to an unrelated grid would break that claim.
  const baseUnit = lineHeightPx;
  return {
    bodySize: selectedBodySize,
    measure: selectedMeasure,
    lineHeight: round(lineHeight, 4),
    lineHeightPx: round(lineHeightPx, 2),
    lineHeightEvidence: 'Field fit over ten sites, R² 0.41, with tolerance roughly ±0.08. This is not a validated law.',
    contentBoxFloor: contentMetrics.contentBox === null ? null : round(contentMetrics.contentBox, 3),
    measureWidthPx: round(selectedBodySize * contentMetrics.averageAdvance * selectedMeasure, 3),
    faces: {
      content: contentMetrics,
      mono: monoMetrics,
      unknownFaceFallback: 'Use 0.5em average advance until the font binary supplies metrics.',
    },
    hierarchy: {
      status: 'unresolved',
      note: 'Heading hierarchy remains a visual, session-resolved concern; no modular ratio is derived.',
    },
    spacing: {
      origin: 'computed body line height',
      baseUnit: round(baseUnit, 4),
      steps: [0.5, 1, 1.5, 2, 3, 4].map((multiplier) => round(baseUnit * multiplier, 4)),
    },
  };
}

function neutralTokens(backgrounds) {
  const light = hexToOklch(backgrounds.light);
  const dark = hexToOklch(backgrounds.dark);
  const neutral = { l: 0.5, c: 0, h: 0 };
  return [
    { name: 'field-light', hex: backgrounds.light, oklch: light },
    { name: 'field-dark', hex: backgrounds.dark, oklch: dark },
    tokenForJob('neutral-text-light', neutral, backgrounds.light, 'body'),
    tokenForJob('neutral-text-dark', neutral, backgrounds.dark, 'body'),
    tokenForJob('neutral-secondary-light', neutral, backgrounds.light, 'mark'),
    tokenForJob('neutral-secondary-dark', neutral, backgrounds.dark, 'mark'),
    tokenForJob('neutral-hairline-light', neutral, backgrounds.light, 'hairline'),
    tokenForJob('neutral-hairline-dark', neutral, backgrounds.dark, 'hairline'),
  ];
}

/**
 * The pure integration point for `/melzi identity` and later document/audit
 * consumers. It derives only invariant-axis values. Free axes are returned intact
 * and never assigned values.
 */
export function deriveSignature(signature, options = {}) {
  const invariants = signature?.invariants || {};
  const coral = readSeed(invariants, 'coral', ['value', 'light']);
  const klein = readSeed(invariants, 'klein', ['light', 'value']);
  const backgrounds = {
    light: readColour(invariants, 'neutrals', ['bgLight', 'backgroundLight']) || '#FFFFFF',
    dark: readColour(invariants, 'neutrals', ['bgDark', 'backgroundDark']) || '#1A1A1A',
  };
  if (!coral || !klein) throw new TypeError('The signature needs coral and Klein seed colours.');
  const accents = {
    coral: [
      tokenForJob('coral-text-light', coral, backgrounds.light, 'body'),
      tokenForJob('coral-text-dark', coral, backgrounds.dark, 'body'),
      tokenForJob('coral-mark-light', coral, backgrounds.light, 'mark'),
    ],
    klein: [
      tokenForJob('klein-text-light', klein, backgrounds.light, 'body'),
      tokenForJob('klein-text-dark', klein, backgrounds.dark, 'body'),
      tokenForJob('klein-mark-light', klein, backgrounds.light, 'mark'),
    ],
  };
  const declaredContentFace = typeof invariants?.type?.content === 'string' ? invariants.type.content : null;
  const type = deriveTypeAndSpace({
    ...options,
    content: options.content || (declaredContentFace && declaredContentFace !== 'Source Serif 4'
      ? { family: declaredContentFace }
      : undefined),
  });
  const defects = currentSignatureDefects({ invariants, coral, klein, backgrounds });
  return {
    tokens: { neutrals: neutralTokens(backgrounds), accents },
    type: {
      bodySize: type.bodySize,
      measure: type.measure,
      lineHeight: type.lineHeight,
      lineHeightPx: type.lineHeightPx,
      lineHeightEvidence: type.lineHeightEvidence,
      contentBoxFloor: type.contentBoxFloor,
      measureWidthPx: type.measureWidthPx,
      faces: type.faces,
      hierarchy: type.hierarchy,
    },
    spacing: type.spacing,
    defects,
    unresolved: [
      {
        id: 'klein-dark-hue',
        candidates: ['#4264F5', readColour(invariants, 'klein', ['dark'])].filter(Boolean),
        reason: 'Blue-purple hue non-linearity makes this a pairwise choice, not an automatic correction.',
      },
      {
        id: 'coral-fill-foreground',
        candidates: ['#FFFFFF', backgrounds.dark],
        reason: 'WCAG and APCA recommend opposite foregrounds on the coral fill.',
      },
    ],
    free: Array.isArray(signature?.free) ? [...signature.free] : [],
  };
}
