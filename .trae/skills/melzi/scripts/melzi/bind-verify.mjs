#!/usr/bin/env node
/**
 * bind-verify: mechanically prove that a project's design system BINDS.
 *
 * Row-3 law 1: binding is proven, never assumed. After a genesis pick lands in
 * DESIGN.md, this tool demonstrates enforcement with a canary, both ways:
 *
 *   off-system direction: a synthesized edit carrying a color and a font-size
 *     that are NOT in the DESIGN.md tokens must be flagged by the real
 *     design-system drift rules.
 *   on-system direction: a synthesized edit carrying only declared values must
 *     be silent.
 *
 * Exit codes: 0 both directions hold. 3 the project has no DESIGN.md (one-line
 * reason). 1 anything else, with the failing direction or reason named.
 *
 * This module PROVES, it does not write: DESIGN.md is never mutated, and the
 * canary files live in the project's own tmp space (.impeccable/tmp) for the
 * duration of the run only. It never throws; failure is an exit code.
 *
 * Fork-only (melzi). Reaches the detector engine through ./engine.mjs, which
 * resolves a local native binary in both checkouts and installed bundles.
 *
 * Usage: node bind-verify.mjs <project-dir>
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { loadEngine } from './engine.mjs';

function toHex(color) {
  const channel = v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`;
}

// Sweep a coarse grid of the sRGB cube (stride 40 clears the engine's
// per-channel tolerance of 6) until a color falls outside every declared
// token. Deterministic, and guaranteed to terminate for any real palette.
function pickOffSystemColor(designSystem) {
  if (!designSystem?.hasColors) return null;
  for (let r = 8; r < 256; r += 40) {
    for (let g = 8; g < 256; g += 40) {
      for (let b = 8; b < 256; b += 40) {
        const hex = toHex({ r, g, b });
        // JS-PARITY: the original grid and 6-channel tolerance only select a
        // candidate. Actual acceptance is proved by the Rust detector below.
        const allowed = designSystem.allowedColorKeys.some(([, { color }]) =>
          Math.abs(color.r - r) <= 6 && Math.abs(color.g - g) <= 6 && Math.abs(color.b - b) <= 6);
        if (!allowed) return hex;
      }
    }
  }
  return null;
}

// A declared color, re-emitted as hex so the exact-match path is exercised.
// Skips translucent tokens: the engine treats near-transparent as allowed
// anyway, so an opaque token is the honest proof.
function pickOnSystemColor(designSystem) {
  if (!designSystem?.hasColors) return null;
  for (const [, entry] of designSystem.allowedColorKeys) {
    if ((entry.color?.a ?? 1) < 1) continue;
    const hex = toHex(entry.color);
    return hex;
  }
  return null;
}

// Walk integer px sizes until one clears every allowlisted step (enumerated
// and fluid endpoints alike) by more than the engine's 0.5px tolerance.
function pickOffSystemFontSize(designSystem) {
  if (!designSystem?.hasFontSizes) return null;
  for (let px = 7; px < 400; px++) {
    const value = `${px}px`;
    // JS-PARITY: candidate selection uses the normalized steps, including
    // fluid endpoints; the native scan remains the enforcement proof.
    if (!designSystem.allowedFontSizes.some(entry => Math.abs(entry.px - px) <= 0.5)) return value;
  }
  return null;
}

function pickOnSystemFontSize(designSystem) {
  if (!designSystem?.hasFontSizes) return null;
  for (const entry of designSystem.allowedFontSizes) {
    if (entry.fluid) continue;
    return entry.value;
  }
  return null;
}

// One pick per axis per direction; null on any axis the design system does
// not enumerate (that axis's drift rule abstains by design, so a canary for
// it would prove nothing).
export async function pickCanaryValues(designSystem) {
  return {
    offColor: pickOffSystemColor(designSystem),
    onColor: pickOnSystemColor(designSystem),
    offFontSize: pickOffSystemFontSize(designSystem),
    onFontSize: pickOnSystemFontSize(designSystem),
  };
}

function canaryCss(className, color, fontSize) {
  const decls = [];
  if (color) decls.push(`  color: ${color};`);
  if (fontSize) decls.push(`  font-size: ${fontSize};`);
  return `.${className} {\n${decls.join('\n')}\n}\n`;
}

function ruleIds(findings) {
  return [...new Set(findings.map(f => f.antipattern))].sort().join(', ');
}

// The full proof for one project dir. Pure result object; no printing, no
// process.exit, and any unexpected error is folded into exitCode 1.
export async function verifyBinding(projectDir) {
  const lines = [];
  const checks = [];
  const result = (exitCode, status, designPath = null) =>
    ({ exitCode, status, designPath, checks, lines });

  let cleanup = () => {};
  try {
    const project = path.resolve(String(projectDir || ''));
    if (!projectDir || !fs.existsSync(project) || !fs.statSync(project).isDirectory()) {
      lines.push(`bind-verify: not a project directory: ${projectDir || '(missing argument)'}`);
      return result(1, 'error');
    }

    const engine = loadEngine();
    const description = engine.describeDesign(project, project);
    if (!description.hasDesign) {
      lines.push(`bind-verify: no DESIGN.md found from ${project} upward; nothing to bind`);
      return result(3, 'no-design');
    }
    const designSystem = description.designSystem;
    if (!designSystem) {
      lines.push(`bind-verify: a DESIGN.md at ${description.designPath} exists but has no parseable frontmatter; the drift rules read nothing from it`);
      return result(1, 'unbound', description.designPath);
    }

    const designPath = designSystem.sourcePath;
    lines.push(`bind-verify: design system at ${designPath}`);

    const picks = await pickCanaryValues(designSystem);
    const axes = [];
    if (picks.offColor && picks.onColor) axes.push('color');
    else lines.push('bind-verify: color axis abstains (DESIGN.md enumerates no color tokens)');
    if (picks.offFontSize && picks.onFontSize) axes.push('font-size');
    else lines.push('bind-verify: font-size axis abstains (DESIGN.md enumerates no discrete type ramp)');

    if (axes.length === 0) {
      lines.push('UNBOUND: DESIGN.md declares no enforceable color or font-size tokens, so binding cannot be proven');
      return result(1, 'unbound', designPath);
    }

    // Canary files live in the project's own tmp space so the engine's walk-up
    // resolution is exercised for real, then are removed no matter what.
    const impeccableDir = path.join(project, '.impeccable');
    const tmpDir = path.join(impeccableDir, 'tmp');
    const hadImpeccable = fs.existsSync(impeccableDir);
    const hadTmp = fs.existsSync(tmpDir);
    fs.mkdirSync(tmpDir, { recursive: true });
    const stamp = `${process.pid}-${Date.now().toString(36)}`;
    const offPath = path.join(tmpDir, `bind-canary-off-${stamp}.css`);
    const onPath = path.join(tmpDir, `bind-canary-on-${stamp}.css`);
    cleanup = () => {
      for (const p of [offPath, onPath]) {
        try { fs.rmSync(p, { force: true }); } catch { /* best effort */ }
      }
      try {
        if (!hadTmp && fs.readdirSync(tmpDir).length === 0) fs.rmdirSync(tmpDir);
        if (!hadImpeccable && fs.readdirSync(impeccableDir).length === 0) fs.rmdirSync(impeccableDir);
      } catch { /* best effort */ }
    };

    const useColor = axes.includes('color');
    const useSize = axes.includes('font-size');
    const offCss = canaryCss('bind-canary-off', useColor ? picks.offColor : null, useSize ? picks.offFontSize : null);
    const onCss = canaryCss('bind-canary-on', useColor ? picks.onColor : null, useSize ? picks.onFontSize : null);
    fs.writeFileSync(offPath, offCss);
    fs.writeFileSync(onPath, onCss);

    // Resolution proof: the engine, walking up from the canary itself, must
    // land on the same DESIGN.md. Otherwise every later assertion is void.
    const resolved = engine.describeDesign(offPath, project).designSystem;
    if (!resolved || resolved.sourcePath !== designPath) {
      lines.push(`FAILED off-system direction: canary at ${offPath} does not resolve to ${designPath} (got ${resolved?.sourcePath || 'no design system'})`);
      return result(1, 'unbound', designPath);
    }

    const offFindings = engine.detect(offPath, project);
    const onFindings = engine.detect(onPath, project);

    let failed = false;
    if (useColor) {
      const hit = offFindings.some(f => f.antipattern === 'design-system-color');
      checks.push({ direction: 'off-system', axis: 'color', value: picks.offColor, ok: hit, detail: hit ? 'flagged by design-system-color' : 'NOT flagged' });
      if (!hit) failed = true;
      lines.push(`canary off-system color ${picks.offColor}: ${hit ? 'FLAGGED (design-system-color)' : 'NOT FLAGGED, enforcement is broken'}`);
    }
    if (useSize) {
      const hit = offFindings.some(f => f.antipattern === 'design-system-font-size');
      checks.push({ direction: 'off-system', axis: 'font-size', value: picks.offFontSize, ok: hit, detail: hit ? 'flagged by design-system-font-size' : 'NOT flagged' });
      if (!hit) failed = true;
      lines.push(`canary off-system font-size ${picks.offFontSize}: ${hit ? 'FLAGGED (design-system-font-size)' : 'NOT FLAGGED, enforcement is broken'}`);
    }

    if (useColor) {
      const noise = onFindings.filter(f => f.antipattern === 'design-system-color');
      const ok = noise.length === 0;
      checks.push({ direction: 'on-system', axis: 'color', value: picks.onColor, ok, detail: ok ? 'silent' : `false-flagged: ${ruleIds(noise)}` });
      if (!ok) failed = true;
      lines.push(`canary on-system color ${picks.onColor}: ${ok ? 'silent' : 'FALSE-FLAGGED, declared value rejected'}`);
    }
    if (useSize) {
      const noise = onFindings.filter(f => f.antipattern === 'design-system-font-size');
      const ok = noise.length === 0;
      checks.push({ direction: 'on-system', axis: 'font-size', value: picks.onFontSize, ok, detail: ok ? 'silent' : `false-flagged: ${ruleIds(noise)}` });
      if (!ok) failed = true;
      lines.push(`canary on-system font-size ${picks.onFontSize}: ${ok ? 'silent' : 'FALSE-FLAGGED, declared value rejected'}`);
    }

    if (failed) {
      const failing = checks.filter(c => !c.ok).map(c => `${c.direction} ${c.axis}`).join(', ');
      lines.push(`UNBOUND: failing direction(s): ${failing}`);
      return result(1, 'unbound', designPath);
    }

    lines.push(`BOUND: off-system values are flagged, declared values pass (${axes.join(' + ')})`);
    return result(0, 'bound', designPath);
  } catch (error) {
    lines.push(`bind-verify: unexpected error: ${error?.message || error}`);
    return result(1, 'error');
  } finally {
    try { cleanup(); } catch { /* best effort */ }
  }
}

async function main() {
  const projectDir = process.argv[2];
  const result = await verifyBinding(projectDir);
  for (const line of result.lines) console.log(line);
  process.exit(result.exitCode);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
