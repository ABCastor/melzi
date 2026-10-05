#!/usr/bin/env node
/**
 * declared-waivers: derive detector.ignoreValues entries from the project's
 * DECLARED design system, so taste rules defer to declarations, data-side.
 *
 * Row-3 law 2: arbitration is data-side. When a project declares a value (a
 * font in DESIGN.md, a spring curve in the design.json sidecar, a value a
 * component library pack's Detector notes call intentional), the aesthetic
 * rules that would nag about that value defer to the declaration. The
 * mechanism is the existing config subtraction knob, detector.ignoreValues in
 * .impeccable/config.json, and nothing else: no rule code in cli/engine is
 * ever patched, and removing the config entry restores the rule untouched.
 *
 * Row-3 law 3: accessibility is never waived automatically. See
 * A11Y_WAIVER_DENYLIST below; it is a hard gate on every emission path.
 *
 * WHAT IS DERIVED, AND WHAT DELIBERATELY IS NOT.
 *
 *   - DESIGN.md `typography.<role>.fontFamily` -> `overused-font` waivers.
 *     A declared Inter is a choice, not slop, so the overused-font nag defers.
 *     Generic families (sans-serif, monospace, ...) are skipped: declaring a
 *     generic is not declaring a face.
 *   - sidecar `.impeccable/design.json` `extensions.motion[].value` beziers ->
 *     `bounce-easing` waivers. A declared spring overshoots on purpose.
 *   - a declared component library pack's `## Detector notes` section ->
 *     waivers for the value-keyed rules it names, with the concrete values it
 *     names (bezier tuples, lengths, hex/rgb/hsl colors). clamp() values are
 *     decomposed into their fixed endpoints, because a waiver whose value is a
 *     clamp() string never matches a finding (findings carry one endpoint).
 *
 *   - design-system-color / -font / -radius / -font-size waivers are NOT
 *     derived from DESIGN.md tokens. The engine already allowlists every
 *     declared token when it loads the design system (including clamp
 *     endpoints), so a declared value never produces a design-system finding
 *     in the first place; a waiver for it could never match anything and would
 *     be provenance noise. Pack-named values ARE emitted for those rules,
 *     because a library can impose values that sit outside the project's own
 *     DESIGN.md scale, and those DO produce findings.
 *   - rules outside VALUE_KEYED_RULES (cream-palette, pulsing-dot,
 *     layout-transition, ...) are never emitted: the hook can only match
 *     per-value waivers for the six rules in its directValueRules set. Waiving
 *     anything else per-value is a no-op on disk, and waiving it whole-rule or
 *     via a file-scoped wildcard is a human decision for hook-admin, not an
 *     auto-derivation.
 *   - oklch() colors are skipped: the ignore matcher parses hex/rgb/hsl only,
 *     so an oklch waiver would match nothing but its own exact string.
 *   - values containing `+` (calc arithmetic) are refused: ignore-value
 *     normalization maps `+` to a space and would corrupt them.
 *
 * PROVENANCE AND IDEMPOTENCY. Every derived entry carries createdAt and a
 * reason starting with AUTO_REASON_PREFIX naming the exact token it came from.
 * Re-running replaces the tool's own entries (recognized by that prefix): a
 * token that left the design system takes its waiver with it, an unchanged
 * token keeps its original entry byte-for-byte (createdAt included). Entries
 * without the prefix are hand-written and are never touched, and an entry the
 * user already wrote by hand for the same rule+value+scope wins over the
 * derived one. Unknown config keys pass through untouched.
 *
 * Fork-only (melzi). Reaches the engine's frontmatter parser through
 * ./engine.mjs, which resolves the local native binary without downloading.
 * The two pure config helpers below preserve the retired hook-lib behavior.
 *
 * Usage: node declared-waivers.mjs [project-dir] [--dry-run]
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { extractLibrarySlug, resolveLibraryPackPath } from './library-pack.mjs';
import { loadEngine } from './engine.mjs';
// JS-PARITY: hook-lib.mjs#getConfigPath and #normalizeIgnoreValue, pure
// plumbing only. Enforcement and frontmatter parsing stay in the Rust engine.
const getConfigPath = cwd => path.join(cwd, '.impeccable', 'config.json');
const normalizeIgnoreValue = value => String(value || '').trim()
  .replace(/^["']|["']$/g, '').replace(/\+/g, ' ').replace(/\s+/g, ' ').toLowerCase();

export const AUTO_REASON_PREFIX = 'auto-derived from';

/**
 * The six rules whose findings carry an extractable value, mirrored from
 * hook-lib's extractFindingIgnoreValue directValueRules set (and its twin in
 * cli/lib/impeccable-config.mjs). Only these can be waived per-value; an
 * entry for any other rule never matches a finding.
 */
export const VALUE_KEYED_RULES = new Set([
  'overused-font',
  'bounce-easing',
  'design-system-font',
  'design-system-color',
  'design-system-radius',
  'design-system-font-size',
]);

/**
 * ROW-3 LAW 3: ACCESSIBILITY IS NEVER WAIVED AUTOMATICALLY.
 *
 * Rules that measure whether a human can perceive or operate the interface
 * are on this hard denylist. A declaration cannot make 4.31:1 coral on white
 * readable (that finding was real, and it stays flagged); only aesthetic
 * taste may defer to a declaration. Every emission path checks this set, so
 * even a library pack that names one of these rules with a concrete value
 * produces nothing. If a rule below ever gains an extractable value, it stays
 * here anyway; the denylist wins over VALUE_KEYED_RULES by construction.
 */
export const A11Y_WAIVER_DENYLIST = new Set([
  'low-contrast',
  'gray-on-color',
  'tiny-text',
  'undersized-ui-text',
  'tight-leading',
  'line-length',
  'skipped-heading',
  'all-caps-body',
  'wide-tracking',
  'justified-text',
  'text-occlusion',
  'text-overflow',
  'content-hidden-at-rest',
  'clipped-overflow-container',
  'body-text-viewport-edge',
  'cramped-padding',
  'broken-image',
  'script-error',
]);

const DESIGN_NAMES = ['DESIGN.md', 'Design.md', 'design.md'];
const PRODUCT_NAMES = ['PRODUCT.md', 'Product.md', 'product.md'];
const CONTEXT_FALLBACK_DIRS = ['.agents/context', 'docs'];

/** Generic CSS families: declaring one is not declaring a typeface. */
const GENERIC_FONTS = new Set([
  'sans-serif', 'serif', 'monospace', 'cursive', 'fantasy', 'system-ui',
  'ui-sans-serif', 'ui-serif', 'ui-monospace', 'ui-rounded', 'math', 'emoji', 'fangsong',
]);

const LENGTH_RE = /^-?(?:\d+\.?\d*|\.\d+)(?:px|rem|em|%)$/i;
const HEX_COLOR_RE = /^#[0-9a-f]{3,8}$/i;
const FUNC_COLOR_RE = /^(?:rgb|hsl)a?\([^)]*\)$/i;

function firstExisting(dir, names) {
  for (const name of names) {
    const candidate = path.join(dir, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function resolveContextFile(projectDir, names) {
  const dirs = [projectDir, ...CONTEXT_FALLBACK_DIRS.map((rel) => path.join(projectDir, rel))];
  for (const dir of dirs) {
    const found = firstExisting(dir, names);
    if (found) return found;
  }
  return null;
}

function safeRead(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function safeReadJson(filePath) {
  const text = safeRead(filePath);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Canonicalize a bezier token into the exact form finding snippets use:
 * `cubic-bezier(a, b, c, d)` with the source's own number literals. Accepts
 * both `cubic-bezier(...)` and the bare `(...)` tuple shorthand pack prose
 * uses for continuation lists. Returns null for anything else.
 */
function canonicalBezier(raw) {
  const text = String(raw || '').trim();
  const match = /^(?:cubic-bezier)?\(([^)]*)\)$/i.exec(text);
  if (!match) return null;
  const args = match[1].split(',').map((s) => s.trim());
  if (args.length !== 4) return null;
  if (!args.every((a) => /^-?(?:\d+\.?\d*|\.\d+)$/.test(a))) return null;
  return `cubic-bezier(${args.join(', ')})`;
}

function splitTopLevelArgs(s) {
  const args = [];
  let depth = 0;
  let current = '';
  for (const ch of String(s)) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      args.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) args.push(current.trim());
  return args;
}

/**
 * A clamp() waiver value can never match: findings carry a single off-ramp
 * endpoint, not the clamp expression. Emit the two fixed endpoints instead.
 */
function lengthValues(raw) {
  const text = String(raw || '').trim();
  if (LENGTH_RE.test(text)) return [text];
  const clamp = /^clamp\((.+)\)$/i.exec(text);
  if (clamp) {
    const args = splitTopLevelArgs(clamp[1]);
    if (args.length === 3) {
      return [args[0], args[2]].filter((a) => LENGTH_RE.test(a));
    }
  }
  return [];
}

function colorValues(raw) {
  const text = String(raw || '').trim();
  // oklch is deliberately absent: the ignore matcher parses hex/rgb/hsl only.
  if (HEX_COLOR_RE.test(text) || FUNC_COLOR_RE.test(text)) return [text];
  return [];
}

/** Per-rule extraction of concrete waivable values from a raw declared token. */
function extractValuesForRule(rule, raw) {
  switch (rule) {
    case 'bounce-easing': {
      const bezier = canonicalBezier(raw);
      return bezier ? [bezier] : [];
    }
    case 'design-system-radius':
    case 'design-system-font-size':
      return lengthValues(raw);
    case 'design-system-color':
      return colorValues(raw);
    // overused-font / design-system-font: no pack extractor. A prose token is
    // not reliably a font name; fonts derive from DESIGN.md only.
    default:
      return [];
  }
}

function primaryFont(stack) {
  const first = String(stack || '').split(',')[0] || '';
  return first.trim().replace(/^["']|["']$/g, '').trim();
}

function reasonFor(source, now) {
  const date = now.toISOString().slice(0, 10);
  return `${AUTO_REASON_PREFIX} ${source.from} on ${date}; regenerate with declared-waivers; delete if the token leaves ${source.home}`;
}

/**
 * The final gate every candidate passes through. The denylist check is
 * deliberately here, at the single choke point, so no derivation path can
 * bypass law 3, and calc values that normalization would corrupt are refused.
 */
function admit(candidates, rule, rawValue, source, now, out) {
  if (A11Y_WAIVER_DENYLIST.has(rule)) return;
  if (!VALUE_KEYED_RULES.has(rule)) return;
  for (const extracted of candidates) {
    if (extracted.includes('+')) continue;
    const value = normalizeIgnoreValue(extracted);
    if (!value) continue;
    const key = `${rule}\0${value}`;
    if (out.seen.has(key)) continue;
    out.seen.add(key);
    out.entries.push({
      rule,
      value,
      createdAt: now.toISOString(),
      reason: reasonFor(source, now),
    });
  }
}

async function deriveFromDesignMd(projectDir, now, out) {
  const designPath = resolveContextFile(projectDir, DESIGN_NAMES);
  if (!designPath) return null;
  const engine = loadEngine();
  const frontmatter = engine.describeDesign(designPath, projectDir).frontmatter;
  if (!frontmatter || typeof frontmatter !== 'object') return designPath;

  const typography = frontmatter.typography;
  if (typography && typeof typography === 'object') {
    for (const [role, spec] of Object.entries(typography)) {
      if (role === 'scale' || !spec || typeof spec !== 'object') continue;
      if (typeof spec.fontFamily !== 'string') continue;
      const font = primaryFont(spec.fontFamily);
      if (!font || GENERIC_FONTS.has(font.toLowerCase())) continue;
      admit([font], 'overused-font', spec.fontFamily, {
        from: `DESIGN.md typography.${role}.fontFamily`,
        home: 'DESIGN.md',
      }, now, out);
    }
  }
  return designPath;
}

function deriveFromSidecar(projectDir, now, out) {
  const sidecarPath = path.join(projectDir, '.impeccable', 'design.json');
  const sidecar = safeReadJson(sidecarPath);
  const motion = sidecar?.extensions?.motion;
  if (!Array.isArray(motion)) return sidecar ? sidecarPath : null;
  for (const token of motion) {
    if (!token || typeof token !== 'object') continue;
    const bezier = canonicalBezier(String(token.value || '').trim());
    if (!bezier) continue;
    const name = typeof token.name === 'string' && token.name ? token.name : 'unnamed';
    admit([bezier], 'bounce-easing', token.value, {
      from: `DESIGN.md sidecar extensions.motion.${name}`,
      home: 'DESIGN.md',
    }, now, out);
  }
  return sidecarPath;
}

/**
 * Parse a pack's `## Detector notes` section into bullets. By convention the
 * first backticked token in a bullet is the rule id; every later backticked
 * token is a candidate value for that rule.
 */
export function parseDetectorNotes(packText) {
  const lines = String(packText || '').split(/\r?\n/);
  const start = lines.findIndex((line) => /^##\s+Detector notes\s*$/i.test(line.trim()));
  if (start === -1) return [];
  const section = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) break;
    section.push(lines[i]);
  }

  const bullets = [];
  let current = null;
  for (const line of section) {
    if (/^\s*-\s+/.test(line)) {
      if (current) bullets.push(current);
      current = line.replace(/^\s*-\s+/, '');
    } else if (current && line.trim()) {
      current += ' ' + line.trim();
    }
  }
  if (current) bullets.push(current);

  const notes = [];
  for (const bullet of bullets) {
    const tokens = [...bullet.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    if (tokens.length === 0) continue;
    const rule = tokens[0].trim().toLowerCase();
    if (!/^[a-z][a-z0-9-]*$/.test(rule)) continue;
    notes.push({ rule, values: tokens.slice(1) });
  }
  return notes;
}

function deriveFromLibraryPack(projectDir, env, now, out) {
  const productPath = resolveContextFile(projectDir, PRODUCT_NAMES);
  if (!productPath) return null;
  const slug = extractLibrarySlug(safeRead(productPath) || '');
  if (!slug) return null;
  const packPath = resolveLibraryPackPath(slug, { env });
  const pack = safeRead(packPath);
  if (pack === null) return null;

  for (const note of parseDetectorNotes(pack)) {
    for (const raw of note.values) {
      admit(extractValuesForRule(note.rule, raw), note.rule, raw, {
        from: `library pack ${slug} Detector notes (${note.rule})`,
        home: 'the pack',
      }, now, out);
    }
  }
  return { slug, path: packPath };
}

/**
 * Derive the full set of declared-value waivers for a project. Pure read:
 * touches no config. Returns { entries, sources }.
 */
export async function deriveDeclaredWaivers(projectDir, { env = process.env, now = new Date() } = {}) {
  const dir = path.resolve(projectDir);
  const out = { entries: [], seen: new Set() };
  const designMd = await deriveFromDesignMd(dir, now, out);
  const sidecar = deriveFromSidecar(dir, now, out);
  const pack = deriveFromLibraryPack(dir, env, now, out);
  return { entries: out.entries, sources: { designMd, sidecar, pack } };
}

function entryKey(entry) {
  const files = Array.isArray(entry?.files) && entry.files.length > 0
    ? [...entry.files].sort().join('\x1f')
    : '';
  return `${entry?.rule}\0${entry?.value}\0${files}`;
}

function isAutoEntry(entry) {
  return typeof entry?.reason === 'string' && entry.reason.startsWith(AUTO_REASON_PREFIX);
}

/**
 * Derive and write. Replaces only this tool's own previous entries; keeps
 * hand-written entries and every unknown config key exactly as found. With
 * dryRun nothing touches disk. Throws on a malformed config.json rather than
 * clobbering whatever the user had there.
 */
export async function applyDeclaredWaivers(projectDir, { env = process.env, now = new Date(), dryRun = false } = {}) {
  const dir = path.resolve(projectDir);
  const { entries, sources } = await deriveDeclaredWaivers(dir, { env, now });
  const configPath = getConfigPath(dir);

  let raw = null;
  const exists = fs.existsSync(configPath);
  if (exists) {
    try {
      raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch {
      throw new Error(`refusing to touch malformed config: ${configPath}`);
    }
  }
  if (raw !== null && (typeof raw !== 'object' || Array.isArray(raw))) {
    throw new Error(`refusing to touch malformed config: ${configPath}`);
  }

  const existingDetector = raw?.detector && typeof raw.detector === 'object' && !Array.isArray(raw.detector)
    ? raw.detector
    : {};
  const existingValues = Array.isArray(existingDetector.ignoreValues) ? existingDetector.ignoreValues : [];

  const hand = existingValues.filter((e) => !isAutoEntry(e));
  const handKeys = new Set(hand.map(entryKey));
  const previousAuto = new Map(existingValues.filter(isAutoEntry).map((e) => [entryKey(e), e]));

  const auto = [];
  for (const entry of entries) {
    const key = entryKey(entry);
    // A hand-written entry for the same rule+value+scope wins; never shadow it.
    if (handKeys.has(key)) continue;
    // An unchanged token keeps its original entry (createdAt and reason
    // included), so a re-run is byte-stable and the diff stays quiet.
    auto.push(previousAuto.get(key) || entry);
  }

  const finalValues = [...hand, ...auto];
  const shouldWrite = exists || finalValues.length > 0;

  if (dryRun || !shouldWrite) {
    return { entries: auto, handWritten: hand.length, written: false, configPath, sources };
  }

  const next = { ...(raw || {}), detector: { ...existingDetector, ignoreValues: finalValues } };
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(next, null, 2) + '\n');
  return { entries: auto, handWritten: hand.length, written: true, configPath, sources };
}

async function main(argv) {
  const args = argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const positionals = args.filter((a) => !a.startsWith('--'));
  const projectDir = path.resolve(positionals[0] || '.');

  let result;
  try {
    result = await applyDeclaredWaivers(projectDir, { dryRun });
  } catch (err) {
    console.error(String(err?.message || err));
    return 1;
  }

  if (result.entries.length === 0) {
    console.log('No declared-value waivers to derive: no eligible declared tokens found.');
  } else {
    console.log(`${dryRun ? 'Would write' : 'Derived'} ${result.entries.length} declared-value waiver(s):`);
    for (const entry of result.entries) {
      console.log(`  ${entry.rule}=${entry.value}  (${entry.reason})`);
    }
  }
  if (result.handWritten > 0) {
    console.log(`Kept ${result.handWritten} hand-written ignoreValues entr${result.handWritten === 1 ? 'y' : 'ies'} untouched.`);
  }
  console.log(result.written
    ? `Wrote ${result.configPath}`
    : dryRun
      ? 'Dry run: nothing written.'
      : 'Nothing written.');
  return 0;
}

const invokedDirectly = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) {
  process.exit(await main(process.argv));
}
