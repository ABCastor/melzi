// The mark check. FORK-ONLY (skill/scripts/melzi/mark-check.mjs).
//
// What these tests are really guarding. The owner asked whether the tool can make
// logos. It cannot, and it should not try: inventing a mark is a taste judgement and
// he has said plainly he will never be the design reviewer. The half that pays is
// mechanical, and his own identity note supplies both the standard and the proof:
//
//   - He killed Direction B (blending Klein blue into the coral mark) on ARITHMETIC,
//     not on taste. The Klein lived in the faint outer ring of the glow, which at
//     16px is one or two near-transparent pixels, so it either vanished or, boosted
//     enough to show, turned the icon edge purple and the mark stopped reading
//     coral-owned. Two of the tests below are that finding, reproduced from the SVG.
//
//   - The same note records a notification icon and a landing page sitting
//     un-rebranded for MONTHS, still carrying a rejected teal and a dropped rebus,
//     while the app beside them was fully on-brand. The propagation tests are that
//     failure, caught.
//
// So the assertions are about findings a person with no design knowledge can act on,
// and about the checks that must NOT fire: his real mark draws a NEUTRAL arch with a
// single coral node, so a dominance check that counted grey as a rival colour would
// fail the very mark it was written from. That case has its own test.
//
// Every fixture is authored here and written into a tmp dir. Nothing reads his real
// home, and no brand asset is committed into this public fork.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  checkMark,
  markVariants,
  propagationTargets,
  analyzeMark,
  readSignatureColours,
  parseColour,
  toHex,
  ICON_PX,
  MIN_STROKE_DEVICE_PX,
} from '../skill/scripts/melzi/mark-check.mjs';

// Mirrors the real ~/.impeccable/signature.json shape. The values are his, the file
// is not: this object never touches disk outside a tmp dir.
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
    ratio: 'roughly 70/30: coral leads, Klein lifts; never 50/50',
  },
  free: ['layout', 'composition', 'density', 'texture', 'motion'],
};

const opts = { signature: SIGNATURE };

function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'melzi-mark-'));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

function ids(findings) {
  return findings.map((f) => f.id);
}

function fails(findings) {
  return findings.filter((f) => f.severity === 'fail').map((f) => f.id);
}

// ---------------------------------------------------------------------------
// Fixtures. Each one is a real, renderable SVG in the shape of his actual mark:
// a charcoal ground, a clean arch, and a single glowing node at the crossing.
// ---------------------------------------------------------------------------

/** Passes everything. Neutral arch, one coral node, strokes that survive 16px. */
const PASSING = `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <title>bridge node</title>
  <defs>
    <radialGradient id="nodeGlow">
      <stop offset="0" stop-color="#FD4E5A" stop-opacity="1"/>
      <stop offset="0.52" stop-color="#FD4E5A" stop-opacity="0.52"/>
      <stop offset="1" stop-color="#FD4E5A" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect x="0" y="0" width="64" height="64" fill="#1A1A1A"/>
  <path d="M8 48 Q32 8 56 48" fill="none" stroke="#D4D4D4" stroke-width="4"/>
  <circle cx="32" cy="22" r="7" fill="url(#nodeGlow)"/>
</svg>`;

/** Identical, except the arch is a hairline that dies at icon size. */
const HAIRLINE = PASSING.replace('stroke-width="4"', 'stroke-width="0.5"');

/**
 * Direction B, as his note describes it: the coral core blended out through a
 * magenta midpoint into Klein blue. The radial bands make the outer colours own most
 * of the coloured ink, which is exactly why the mark stopped reading coral-owned.
 */
const DIRECTION_B = `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="blend">
      <stop offset="0" stop-color="#FD4E5A" stop-opacity="1"/>
      <stop offset="0.5" stop-color="#913A9D" stop-opacity="1"/>
      <stop offset="1" stop-color="#2426E0" stop-opacity="1"/>
    </radialGradient>
  </defs>
  <rect x="0" y="0" width="64" height="64" fill="#1A1A1A"/>
  <path d="M8 48 Q32 8 56 48" fill="none" stroke="#D4D4D4" stroke-width="4"/>
  <circle cx="32" cy="22" r="12" fill="url(#blend)"/>
</svg>`;

/** One colour that is not in the signature, and nothing else wrong. */
const OFF_SIGNATURE = `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="64" height="64" fill="#F2F2F2"/>
  <path d="M8 48 Q32 8 56 48" fill="none" stroke="#1A1A1A" stroke-width="4"/>
  <circle cx="32" cy="22" r="7" fill="#FD4E5A"/>
</svg>`;

// ---------------------------------------------------------------------------
// checkMark
// ---------------------------------------------------------------------------

test('a sound mark produces no failures at all', () => {
  const findings = checkMark(PASSING, opts);
  assert.deepEqual(fails(findings), [], `unexpected failures: ${JSON.stringify(findings, null, 2)}`);
});

// The frame question, and the one most likely to be got wrong. His real mark is a
// NEUTRAL arch carrying a single coral node, so grey is most of the ink by design.
// A dominance check that treated the greyscale field as a rival colour would fail
// his own approved logo, which is precision inside the wrong frame.
test('a neutral field is the stage, not a rival: grey never costs the mark its dominance', () => {
  const findings = checkMark(PASSING, opts);
  assert.equal(ids(findings).includes('mark-brand-hue-minority'), false);

  const analysis = analyzeMark(PASSING);
  const grey = [...analysis.ink.values()].find((e) => e.hex === '#d4d4d4');
  const coral = [...analysis.ink.values()].find((e) => e.hex === '#fd4e5a');
  assert.ok(grey && coral, 'both the arch and the node are measured');
  assert.ok(grey.ink > coral.ink, 'the grey really is the larger share of the ink');
});

test('a hairline that disappears at 16px is caught, with the number that proves it', () => {
  const findings = checkMark(HAIRLINE, opts);
  assert.ok(fails(findings).includes('mark-hairline-stroke'), JSON.stringify(fails(findings)));

  const hairline = findings.find((f) => f.id === 'mark-hairline-stroke');
  // 0.5 user units on a 64-unit frame rendered at 16px is 0.125 device pixels.
  assert.match(hairline.summary, /0\.13px|0\.12px/);
  assert.match(hairline.summary, new RegExp(`${ICON_PX}px`));
  assert.ok(hairline.fix.includes(String(MIN_STROKE_DEVICE_PX)));

  // The same mark with a real stroke does not trip it, so the check is measuring
  // width rather than merely noticing that a stroke exists.
  assert.equal(ids(checkMark(PASSING, opts)).includes('mark-hairline-stroke'), false);
});

// Calibration, found by running this against his REAL app icon rather than only
// against fixtures written to agree with it. That icon carries a 2-unit rim
// highlight on a 1024 frame at 6% opacity: invisible at 16px, and deliberately so.
// Reporting it as a broken mark would be a false alarm on the reference mark, and a
// check that cries wolf on the reference is a check nobody keeps running.
test('a near-transparent large-format detail is noted, not failed', () => {
  const rimmed = `<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <rect x="64" y="64" width="896" height="896" rx="224" fill="#1A1A1A"/>
  <rect x="65" y="65" width="894" height="894" rx="223" fill="none" stroke="#FFFFFF" stroke-opacity="0.06" stroke-width="2"/>
  <path d="M192 800 C192 384 320 256 512 256 C704 256 832 384 832 800" fill="none" stroke="#D4D4D4" stroke-width="70"/>
  <circle cx="512" cy="256" r="90" fill="#FD4E5A"/>
</svg>`;
  const findings = checkMark(rimmed, opts);
  assert.equal(fails(findings).includes('mark-hairline-stroke'), false, JSON.stringify(findings, null, 2));

  const noted = findings.find((f) => f.id === 'mark-large-format-detail');
  assert.ok(noted, 'it is still reported, because a silent pass and a clean bill of health must not look the same');
  assert.equal(noted.severity, 'warn');
  assert.match(noted.summary, /6% opacity/);

  // The same rim at full opacity IS a broken line, so the split is about the
  // opacity in the file and not about the shape being a rect.
  const opaque = rimmed.replace('stroke-opacity="0.06"', 'stroke-opacity="1"');
  assert.ok(fails(checkMark(opaque, opts)).includes('mark-hairline-stroke'));
});

// This is the Direction B finding, reproduced mechanically. He rejected it because
// blending Klein into the mark meant coral no longer owned it.
test('Direction B fails: the brand hue is a minority of the coloured ink', () => {
  const findings = checkMark(DIRECTION_B, opts);
  const failed = fails(findings);
  assert.ok(failed.includes('mark-brand-hue-minority'), JSON.stringify(findings, null, 2));

  const minority = findings.find((f) => f.id === 'mark-brand-hue-minority');
  assert.match(minority.summary, /#FD4E5A/i, 'it names the brand colour it measured against');
  assert.match(minority.summary, /coral/i, 'and says where in the signature that came from');
  assert.match(minority.summary, /Greys are excluded/i);

  // The magenta the palette does not even contain is reported too, by a different
  // check. Both of his objections to Direction B fire, separately.
  assert.ok(failed.includes('mark-off-signature-colour'));
  assert.match(findings.find((f) => f.id === 'mark-off-signature-colour').summary, /#913a9d/i);
});

// The other horn of the same argument, and the reason boosting the blend did not
// rescue it: a colour can be present in the file and absent from the render.
test('a colour that amounts to under one device pixel at 16px is reported, not passed', () => {
  const faint = `<svg viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="512" height="512" fill="#1A1A1A"/>
  <path d="M64 400 Q256 80 448 400" fill="none" stroke="#D4D4D4" stroke-width="32"/>
  <circle cx="256" cy="200" r="3" fill="#2426E0"/>
  <circle cx="256" cy="200" r="40" fill="#FD4E5A"/>
</svg>`;
  const findings = checkMark(faint, opts);
  const invisible = findings.filter((f) => f.id === 'mark-colour-invisible-at-icon-size');
  assert.equal(invisible.length, 1, JSON.stringify(findings, null, 2));
  assert.match(invisible[0].summary, /#2426e0/i, 'the Klein speck, not the coral node');
  assert.equal(invisible[0].severity, 'warn', 'a rival colour vanishing is a warning');
});

test('an off-signature colour is named, with the nearest signature value beside it', () => {
  const findings = checkMark(OFF_SIGNATURE, opts);
  assert.deepEqual(fails(findings), ['mark-off-signature-colour'], JSON.stringify(findings, null, 2));

  const stray = findings.find((f) => f.id === 'mark-off-signature-colour');
  assert.match(stray.summary, /#f2f2f2/i);
  assert.match(stray.summary, /#FFFFFF/i, 'and the signature value it is nearly, so the fix is obvious');
});

test('a mark that is nearly empty at icon size fails, and so does one that is nearly solid', () => {
  const sparse = `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <circle cx="32" cy="32" r="1" fill="#FD4E5A"/>
</svg>`;
  assert.ok(fails(checkMark(sparse, opts)).includes('mark-ink-too-sparse'));

  const solid = `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="60" height="60" fill="#FD4E5A"/>
</svg>`;
  assert.ok(fails(checkMark(solid, opts)).includes('mark-ink-too-solid'));

  assert.equal(fails(checkMark(PASSING, opts)).length, 0, 'and the sound mark sits between them');
});

// A check that quietly does nothing is worse than an absent one: a silent pass reads
// as a clean bill of health, and that is exactly how the teal notification icon
// survived for months.
test('what cannot be measured without rasterizing says so, rather than passing', () => {
  const raster = `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <image href="logo.png" width="64" height="64"/>
</svg>`;
  const findings = checkMark(raster, opts);
  const unchecked = findings.filter((f) => f.severity === 'unchecked').map((f) => f.id);
  assert.ok(unchecked.includes('mark-unchecked-raster'), JSON.stringify(findings, null, 2));
  assert.ok(unchecked.includes('mark-no-ink-found'), 'and it does not pretend to have measured coverage');

  const text = checkMark(`<svg viewBox="0 0 64 64"><text x="0" y="10" fill="#FD4E5A">GB</text></svg>`, opts);
  assert.ok(ids(text).includes('mark-unchecked-text'));

  const masked = checkMark(`<svg viewBox="0 0 64 64"><circle cx="8" cy="8" r="4" fill="#FD4E5A" mask="url(#m)"/></svg>`, opts);
  assert.ok(ids(masked).includes('mark-unchecked-mask'));
});

test('paint hidden in a <style> block is measured, not silently missed', () => {
  const styled = `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <style>.arch { fill: none; stroke: #D4D4D4; stroke-width: 4 } .node { fill: #FD4E5A }</style>
  <rect x="0" y="0" width="64" height="64" fill="#1A1A1A"/>
  <path class="arch" d="M8 48 Q32 8 56 48"/>
  <circle class="node" cx="32" cy="22" r="7"/>
</svg>`;
  const analysis = analyzeMark(styled);
  assert.ok(analysis.ink.has('#fd4e5a'), 'the node colour came out of the stylesheet');
  assert.ok(analysis.ink.has('#d4d4d4'));
  assert.deepEqual(fails(checkMark(styled, opts)), []);

  // And a selector it cannot resolve is reported rather than skipped in silence.
  const complex = styled.replace('.node {', 'g > .node:hover {');
  assert.ok(ids(checkMark(complex, opts)).includes('mark-unchecked-css'));
});

test('a gradient stop is weighted by band area and its own opacity', () => {
  // The mechanic behind the Direction B verdict: the outer ring is most of the area
  // and almost none of the ink, because it is nearly transparent.
  const analysis = analyzeMark(PASSING);
  const coral = analysis.ink.get('#fd4e5a');
  const circleArea = Math.PI * 49;
  assert.ok(coral.ink > 0 && coral.ink < circleArea, 'a fading glow is worth less than a solid disc');
});

test('missing, malformed, and hostile input become findings, never exceptions', () => {
  assert.deepEqual(fails(checkMark('not an svg at all', opts)), ['mark-unparseable']);
  assert.deepEqual(fails(checkMark('', opts)), ['mark-unparseable']);
  assert.deepEqual(fails(checkMark(null, opts)), ['mark-unparseable']);
  assert.doesNotThrow(() => checkMark('<svg><path d="M M M z z"/></svg>', opts));
  assert.doesNotThrow(() => checkMark(PASSING, {}));
});

test('with no signature the geometry still runs, and the colour checks say they did not', () => {
  const findings = checkMark(HAIRLINE, { signature: null });
  assert.ok(ids(findings).includes('mark-no-signature'));
  assert.ok(fails(findings).includes('mark-hairline-stroke'), 'geometry does not need his palette');
  assert.equal(ids(findings).includes('mark-off-signature-colour'), false, 'and nothing is judged against a palette that is not there');
});

test('the brand colour is resolved from the signature, never hardcoded', () => {
  const read = readSignatureColours(SIGNATURE);
  assert.equal(read.primary.hex, '#fd4e5a');
  assert.match(read.primaryFrom, /coral/);

  // Someone else's signature checks their mark: a green lead makes the coral mark
  // the minority colour, with no code change anywhere.
  const other = { invariants: { primary: { value: '#0B7A3B' }, neutrals: { bgLight: '#FFFFFF', bgDark: '#111111' } } };
  const findings = checkMark(OFF_SIGNATURE, { signature: other });
  assert.ok(fails(findings).includes('mark-brand-hue-minority'));
  assert.match(findings.find((f) => f.id === 'mark-brand-hue-minority').summary, /#0B7A3B/i);
});

// ---------------------------------------------------------------------------
// markVariants
// ---------------------------------------------------------------------------

test('one source yields the four variants an identity actually needs, all distinct and all valid', () => {
  const variants = markVariants(PASSING, opts);
  assert.deepEqual(variants.map((v) => v.id), ['mono', 'reversed', 'icon', 'favicon']);

  const seen = new Set();
  for (const variant of variants) {
    assert.ok(variant.svg.includes('<svg'), `${variant.id} is still an svg`);
    assert.ok(variant.svg.trim().endsWith('</svg>'), `${variant.id} is closed`);
    assert.ok(analyzeMark(variant.svg).ok, `${variant.id} parses`);
    assert.ok(variant.note && variant.note.length > 20, `${variant.id} explains itself`);
    assert.equal(seen.has(variant.svg), false, `${variant.id} is not a duplicate of an earlier variant`);
    seen.add(variant.svg);
    assert.equal(variant.changed, true, `${variant.id} actually transformed the source`);
  }
});

test('the monochrome variant keeps one ink and drops the brand colour on purpose', () => {
  const mono = markVariants(PASSING, opts).find((v) => v.id === 'mono');
  assert.equal(/#FD4E5A/i.test(mono.svg), false, 'no coral survives');
  // The glow survives as a tonal fade: the gradient is still there, in one colour.
  assert.ok(mono.svg.includes('radialGradient'));
  assert.ok(mono.svg.includes('stop-opacity="0.52"'));

  const inks = [...analyzeMark(mono.svg).ink.keys()];
  assert.ok(inks.length <= 2, `mono should carry one ink over one ground, got ${inks.join(', ')}`);
});

// #1A1A1A is BOTH the dark background and the light-mode text in his signature, so a
// last-one-wins swap map would turn the ground into body text.
test('the reversed variant swaps light and dark twins, and resolves the hex that means two things', () => {
  const reversed = markVariants(PASSING, opts).find((v) => v.id === 'reversed');
  assert.match(reversed.svg, /fill="#FFFFFF"/i, 'the charcoal ground became the light ground');
  assert.match(reversed.svg, /stroke="#1A1A1A"/i, 'and the light-on-dark arch became dark-on-light');
  assert.match(reversed.svg, /#FD4E5A/i, 'the lead colour is the same in both modes and is left alone');
  assert.match(reversed.note, /two roles/i, 'the collision is named rather than hidden');
});

test('the icon variant flattens the glow and lifts strokes off the 16px floor', () => {
  const icon = markVariants(HAIRLINE, opts).find((v) => v.id === 'icon');
  assert.equal(/url\(#nodeGlow\)/.test(icon.svg), false, 'the gradient is flattened to its dominant colour');
  assert.equal(icon.svg.includes('<title>'), false, 'decoration is stripped');

  const strokes = analyzeMark(icon.svg).strokes;
  assert.ok(strokes.length > 0);
  for (const stroke of strokes) {
    assert.ok(stroke.devicePx >= MIN_STROKE_DEVICE_PX, `stroke still at ${stroke.devicePx} device px`);
  }
  assert.deepEqual(fails(checkMark(icon.svg, opts)).filter((id) => id === 'mark-hairline-stroke'), []);
});

test('the favicon variant is pinned to 16px and leaves the drawing alone', () => {
  const favicon = markVariants(PASSING, opts).find((v) => v.id === 'favicon');
  assert.match(favicon.svg, /width="16"/);
  assert.match(favicon.svg, /height="16"/);
  assert.match(favicon.svg, /viewBox="0 0 64 64"/, 'the viewBox is untouched, only the intrinsic size is fixed');
});

test('variants never throw on input that is not a mark', () => {
  assert.deepEqual(markVariants('nope', opts), []);
  assert.deepEqual(markVariants(null, opts), []);
  assert.doesNotThrow(() => markVariants(PASSING, {}));
});

// ---------------------------------------------------------------------------
// propagationTargets
// ---------------------------------------------------------------------------

/**
 * A project tree in the exact shape his note records: the app is on-brand, and two
 * assets beside it were never rebranded. One of them is a PNG, which cannot be read
 * without rasterizing and must therefore be reported as unverifiable rather than
 * quietly passed.
 */
function seedProject(dir) {
  const write = (rel, body) => {
    fs.mkdirSync(join(dir, rel, '..'), { recursive: true });
    fs.writeFileSync(join(dir, rel), body);
  };
  write('app/app-icon.svg', PASSING);
  // The landing page, still fully pre-rebrand: a tan accent and no signature colour.
  write('docs/index.html', `<!doctype html><html><head><link rel="icon" href="/favicon.svg"></head>
<body style="background: #14110F; color: #c2a878">
  <svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="10" fill="#c2a878"/></svg>
</body></html>`);
  // The notification icon: a raster, unreadable here, and the exact asset that
  // carried a rejected teal for months.
  write('assets/garminbridge-icon.png', 'PNG\0 not really, and that is the point');
  // Unrelated source that must be left alone even though it contains a hex.
  write('src/parser.ts', `// tolerance ladder, see #c2a878 in the old theme\nexport const SEP = "#dad";\n`);
  // The app stylesheet. Colour drift here belongs to the design-system enforcer,
  // which already exists; this pass must not bury the mark findings under it.
  write('app/styles.css', ':root { --a: #6f6f6f; --b: #212121; --c: #8f1220 } .logo { width: 2rem }');
  // A framework logo from the scaffold, which is not his to retokenise.
  write('app/assets/tauri.svg', '<svg viewBox="0 0 8 8"><circle cx="4" cy="4" r="3" fill="#24C8DB"/></svg>');
}

// The failure his note actually records: an asset carrying NONE of the identity,
// sitting there for months while the app beside it was fully on-brand.
test('an asset with none of the identity in it is the failure, and it fails', () => withDir((dir) => {
  seedProject(dir);
  const report = propagationTargets(dir, opts);

  const stale = report.findings.find((f) => f.id === 'propagation-unbranded-asset' && f.path.endsWith('index.html'));
  assert.ok(stale, JSON.stringify(report.findings, null, 2));
  assert.equal(stale.severity, 'fail');
  assert.match(stale.summary, /#c2a878/i, 'it names what the asset is wearing instead');

  // The on-brand asset is not reported, so a clean project reads as clean.
  assert.equal(report.findings.some((f) => f.path && f.path.endsWith('app-icon.svg')), false);
}));

// Severity follows the evidence. A stray colour ALONGSIDE the real palette is drift
// worth one line; his own approved icon draws the arch in #E6E6E6, which is in
// neither the palette table nor the neutrals.
test('an asset on the palette that also carries a stray is drift, not a failure', () => withDir((dir) => {
  fs.writeFileSync(join(dir, 'mark.svg'), PASSING.replace('#D4D4D4', '#E6E6E6'));
  const findings = propagationTargets(dir, opts).findings;

  const drift = findings.find((f) => f.id === 'propagation-off-signature');
  assert.ok(drift, JSON.stringify(findings, null, 2));
  assert.equal(drift.severity, 'warn');
  assert.match(drift.summary, /#e6e6e6/i);
  assert.match(drift.summary, /nearest/i, 'and the signature value it is nearly');
}));

test('unrelated source and app stylesheets are never candidates', () => withDir((dir) => {
  seedProject(dir);
  const candidates = propagationTargets(dir, opts).candidates.map((c) => c.path);

  assert.equal(candidates.some((p) => p.endsWith('parser.ts')), false, 'a hex in a comment is not a brand asset');
  // Stylesheet colour drift is the design-system enforcer's job. Measuring it here
  // too would duplicate working code and drown the mark findings.
  assert.equal(candidates.some((p) => p.endsWith('styles.css')), false);
  assert.ok(candidates.some((p) => p.endsWith('index.html')));
}));

// Found by running this against his real repo, where it asked for the JavaScript
// logo to be retokenised to coral. Dropping the file silently would be the same
// failure this module refuses, so the guess is stated instead.
test('a framework logo is named as someone elses and not judged against his palette', () => withDir((dir) => {
  seedProject(dir);
  const findings = propagationTargets(dir, opts).findings;
  const third = findings.find((f) => f.path && f.path.endsWith('tauri.svg'));
  assert.ok(third, JSON.stringify(findings.map((f) => `${f.id} ${f.path}`), null, 2));
  assert.equal(third.id, 'propagation-third-party-asset');
  assert.equal(third.severity, 'unchecked');
  assert.match(third.fix, /rename it/i, 'and it says how to correct the guess');
}));

test('a raster mark asset is reported as unverifiable, never as passing', () => withDir((dir) => {
  seedProject(dir);
  const report = propagationTargets(dir, opts);
  const raster = report.findings.find((f) => f.id === 'propagation-unverifiable-raster');
  assert.ok(raster, JSON.stringify(report.findings.map((f) => f.id)));
  assert.match(raster.summary, /garminbridge-icon\.png/);
  assert.equal(raster.severity, 'unchecked');
  assert.match(raster.fix, /regenerate them from the SVG source/i);
}));

// A generated Tauri icon set is a dozen files with one verdict between them.
// Printing the same paragraph a dozen times is how a report stops being read.
test('one verdict repeated across a generated icon set is emitted once', () => withDir((dir) => {
  fs.mkdirSync(join(dir, 'icons'), { recursive: true });
  for (const size of [32, 64, 128, 256, 512, 1024]) {
    fs.writeFileSync(join(dir, `icons/app-icon-${size}.png`), 'not really a png');
  }
  const findings = propagationTargets(dir, opts).findings.filter((f) => f.id === 'propagation-unverifiable-raster');
  assert.equal(findings.length, 1, JSON.stringify(findings, null, 2));
  assert.match(findings[0].summary, /6 raster mark asset/);
  assert.match(findings[0].summary, /1 more/, 'and it says how many it did not list');
}));

test('one asset produces one verdict, so the report cannot double-count a file', () => withDir((dir) => {
  seedProject(dir);
  const report = propagationTargets(dir, opts);
  const page = report.findings.filter((f) => f.path && f.path.endsWith('index.html'));
  assert.equal(page.length, 1, JSON.stringify(page.map((f) => f.id)));
}));

test('propagation reports and never rewrites', () => withDir((dir) => {
  seedProject(dir);
  const before = fs.readFileSync(join(dir, 'docs/index.html'), 'utf8');
  propagationTargets(dir, opts);
  assert.equal(fs.readFileSync(join(dir, 'docs/index.html'), 'utf8'), before);
}));

test('generated and vendored output is skipped, so the report stays about his own assets', () => withDir((dir) => {
  fs.mkdirSync(join(dir, 'node_modules/pkg'), { recursive: true });
  fs.writeFileSync(join(dir, 'node_modules/pkg/logo.svg'), '<svg viewBox="0 0 8 8"><rect width="8" height="8" fill="#c2a878"/></svg>');
  fs.mkdirSync(join(dir, 'src'), { recursive: true });
  fs.writeFileSync(join(dir, 'src/mark.svg'), PASSING);

  const report = propagationTargets(dir, opts);
  assert.equal(report.candidates.some((c) => c.path.includes('node_modules')), false);
  assert.ok(report.candidates.some((c) => c.path.endsWith('src/mark.svg')));
}));

test('a scanned count comes back even when nothing is wrong, so silence is unambiguous', () => withDir((dir) => {
  fs.writeFileSync(join(dir, 'mark.svg'), PASSING);
  const report = propagationTargets(dir, opts);
  assert.equal(report.scanned, 1);
  assert.equal(report.candidates.length, 1);
  assert.deepEqual(report.findings.filter((f) => f.severity === 'fail'), []);
}));

test('a missing root, a file for a root, and a missing signature are findings, not throws', () => withDir((dir) => {
  const missing = propagationTargets(join(dir, 'nope'), opts);
  assert.deepEqual(missing.findings.map((f) => f.id), ['propagation-bad-root']);

  fs.writeFileSync(join(dir, 'a.txt'), 'x');
  assert.deepEqual(propagationTargets(join(dir, 'a.txt'), opts).findings.map((f) => f.id), ['propagation-bad-root']);

  const noSig = propagationTargets(dir, { signature: null });
  assert.deepEqual(noSig.findings.map((f) => f.id), ['propagation-no-signature']);
  assert.equal(noSig.scanned, 0, 'and it does not walk a tree it cannot judge');
}));

test('the module never reaches for his real home unless asked', () => withDir((dir) => {
  // Passing a signature explicitly must not consult ~/.impeccable at all: point home
  // at an empty tmp dir and the answer is unchanged.
  fs.writeFileSync(join(dir, 'mark.svg'), OFF_SIGNATURE);
  const withHome = propagationTargets(dir, { signature: SIGNATURE, home: dir });
  assert.ok(withHome.findings.some((f) => f.id === 'propagation-off-signature'), JSON.stringify(withHome.findings, null, 2));
}));

// ---------------------------------------------------------------------------
// Colour plumbing, because every finding above is built on it
// ---------------------------------------------------------------------------

test('colour parsing covers the forms a real mark uses, and refuses to guess at the rest', () => {
  assert.equal(toHex(parseColour('#FD4E5A')), '#fd4e5a');
  assert.equal(toHex(parseColour('#fd4')), '#ffdd44');
  assert.equal(toHex(parseColour('rgb(253, 78, 90)')), '#fd4e5a');
  assert.equal(parseColour('rgba(253,78,90,0.5)').a, 0.5);
  assert.equal(parseColour('none'), null);
  assert.equal(parseColour('currentColor'), null);
  assert.equal(parseColour('url(#glow)'), null);
  assert.equal(parseColour('rebeccapurple'), null, 'an unknown name is unresolved, not guessed');
});
