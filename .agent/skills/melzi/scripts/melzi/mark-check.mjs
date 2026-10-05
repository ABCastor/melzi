/**
 * The mark: check it mechanically, derive its variants, and find every place it
 * was supposed to travel to and did not.
 *
 * FORK-ONLY. Upstream has no notion of a personal mark, so this file carries zero
 * merge burden.
 *
 * WHY THIS EXISTS, AND WHY IT DELIBERATELY DOES NOT DRAW ANYTHING. The owner asked
 * whether the tool can make logos. It cannot, and pretending otherwise would be the
 * worst possible feature for him specifically: inventing a mark from nothing is a
 * taste judgement, he has said plainly he will never be the design reviewer, and a
 * generated mark he cannot assess is a coin flip he would have to keep forever. The
 * half of the job that pays without any taste at all is the mechanical half, and his
 * own identity note proves both sides of it:
 *
 *   1. CHECKING. He killed Direction B (blending Klein blue into the coral mark) on
 *      a MECHANICAL finding, not on taste: the Klein lived in the faint outer ring
 *      of the glow, which at 16px is one or two near-transparent pixels, so it
 *      either vanished or, boosted enough to show, turned the icon edge purple and
 *      the mark stopped reading coral-owned. That is arithmetic over the SVG. A tool
 *      can do it every time, before he ever looks.
 *
 *   2. PROPAGATING. The same note records that two real assets, a macOS
 *      notification icon and a GitHub Pages landing page, sat un-rebranded for
 *      months, still carrying a REJECTED teal and a DROPPED rebus, while the app
 *      itself was fully on-brand. Nobody was lazy; nothing was watching. That
 *      failure is worth more to prevent than any logo invention, because it is the
 *      one that happens silently and keeps happening.
 *
 * WHY TEXT AND GEOMETRY, NOT RASTERIZING, AND WHAT THAT COSTS. Rasterizing would
 * need a renderer (resvg, sharp, a headless browser), and every fork-only module
 * here is dependency-free node builtins on purpose. So this parses the SVG source as
 * text and reasons about geometry. The honest cost, stated once here and again as
 * explicit findings at runtime:
 *
 *   - Curves are measured by their chords and paths by the shoelace area of their
 *     endpoints, so a curvy mark's ink is under-counted and a path with holes or
 *     overlapping subpaths is over-counted. Coverage is therefore an ESTIMATE, and
 *     the thresholds it is judged against are coarse for that reason.
 *   - Anything whose painted result depends on a renderer is NOT CHECKED and says
 *     so: embedded raster (`<image>`), text (glyph ink needs font metrics), filters,
 *     masks and clip paths, `<use>` references, and CSS selectors more complex than
 *     a class, id, or tag.
 *   - Antialiasing, gamma, and subpixel rendering at 16px are not modelled. The
 *     stroke check answers "how many device pixels wide is this line", which is the
 *     part that is arithmetic, and stops there.
 *
 * A CHECK THAT QUIETLY DOES NOTHING IS WORSE THAN AN ABSENT ONE, so every one of
 * those gaps returns an `unchecked` finding rather than a silent pass. A silent pass
 * is indistinguishable from a clean bill of health, and that is exactly how the
 * teal notification icon survived for months.
 *
 * WHY THE SEVERITY WORDS DIFFER FROM lib/staleness.mjs. That module's `auto` /
 * `mention` / `route` name what the doctor pass should DO about an artifact, and
 * `auto` means "rewrite it silently on the next write". None of that fits here: the
 * roadmap rules out anything that rewrites his surfaces without showing him, and
 * "this line disappears at icon size" is not a thing to fix silently. So the words
 * are `fail` (the mark is broken at the size it will be used), `warn` (worth knowing
 * before it becomes a habit), and `unchecked` (I could not tell you, here is why).
 * The FIELD SHAPE is identical, `{ id, severity, summary, fix, path }`, so any
 * renderer in the codebase can print these alongside anything else.
 *
 * NO VALUES IN THIS FILE. Like signature.mjs, the module knows the SHAPE of a
 * signature and never its hexes. The brand hue it measures dominance against comes
 * from the signature, so someone else's signature.json checks their mark, and a hex
 * duplicated in code is a hex that goes stale the first time the source of truth
 * moves.
 *
 * READ-ONLY BY DESIGN. `propagationTargets` reports and never rewrites: the assets
 * it finds are his, in projects this tool was not asked to edit.
 *
 * FAILURE POLICY. Nothing here throws into a caller's flow. Unparseable input,
 * a missing signature, an unreadable directory: each becomes a finding.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadSignature } from './signature.mjs';

export const MARK_SEVERITIES = ['fail', 'warn', 'unchecked'];

/**
 * The icon size the whole check is written against. His note judged Direction B at
 * 16px because that is where a mark stops being a picture and becomes a handful of
 * pixels: the favicon, the macOS notification icon, the menu bar.
 */
export const ICON_PX = 16;

/**
 * A stroke thinner than one device pixel at the render size does not become a
 * thinner line, it becomes a fainter one, and below about a pixel it stops reading
 * as a line at all. One device pixel is the floor, not a preference.
 */
export const MIN_STROKE_DEVICE_PX = 1;

/**
 * A stroke fainter than this is decoration, not structure. The number comes from his
 * own approved icon, which carries a 6%-opacity rim highlight that is invisible at
 * 16px on purpose.
 */
const FAINT_STROKE_ALPHA = 0.2;
/** Below this share of the frame the mark has nothing left to see at icon size. */
const MIN_INK_COVERAGE = 0.02;
/** Above this share there is no figure left, only a filled square. */
const MAX_INK_COVERAGE = 0.8;
/** The brand colour has to OWN the mark, not merely appear in it. */
const MIN_BRAND_SHARE = 0.5;
/** Degrees of hue either side of the brand colour that still read as the same colour. */
const BRAND_HUE_TOLERANCE = 20;
/** Below this saturation a colour has no meaningful hue, it is a grey. */
const CHROMA_FLOOR = 0.15;
/** RGB distance under which two colours are the same colour with rounding. */
const COLOUR_MATCH_TOLERANCE = 12;

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

// Only the names that turn up in real marks and stylesheets. An unrecognised name
// becomes an `unchecked` finding rather than a guess.
const NAMED_COLOURS = {
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff',
  yellow: '#ffff00', orange: '#ffa500', purple: '#800080', gray: '#808080', grey: '#808080',
  silver: '#c0c0c0', navy: '#000080', teal: '#008080', maroon: '#800000', olive: '#808000',
  lime: '#00ff00', aqua: '#00ffff', cyan: '#00ffff', fuchsia: '#ff00ff', magenta: '#ff00ff',
  transparent: null,
};

/** Parse a CSS colour into { r, g, b, a } in 0-255 / 0-1, or null when unresolvable. */
export function parseColour(input) {
  if (typeof input !== 'string') return null;
  const text = input.trim().toLowerCase();
  if (!text || text === 'none' || text === 'currentcolor' || text === 'inherit') return null;
  if (text.startsWith('url(')) return null;

  const hex = /^#([0-9a-f]{3,8})$/.exec(text);
  if (hex) {
    const d = hex[1];
    const expand = (c) => parseInt(c + c, 16);
    if (d.length === 3) return { r: expand(d[0]), g: expand(d[1]), b: expand(d[2]), a: 1 };
    if (d.length === 4) return { r: expand(d[0]), g: expand(d[1]), b: expand(d[2]), a: expand(d[3]) / 255 };
    if (d.length === 6) return { r: parseInt(d.slice(0, 2), 16), g: parseInt(d.slice(2, 4), 16), b: parseInt(d.slice(4, 6), 16), a: 1 };
    if (d.length === 8) return { r: parseInt(d.slice(0, 2), 16), g: parseInt(d.slice(2, 4), 16), b: parseInt(d.slice(4, 6), 16), a: parseInt(d.slice(6, 8), 16) / 255 };
    return null;
  }

  const rgb = /^rgba?\(([^)]+)\)$/.exec(text);
  if (rgb) {
    const parts = rgb[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const chan = (raw) => {
      const n = parseFloat(raw);
      if (!Number.isFinite(n)) return null;
      return raw.includes('%') ? Math.round((n / 100) * 255) : Math.round(n);
    };
    const r = chan(parts[0]); const g = chan(parts[1]); const b = chan(parts[2]);
    if (r === null || g === null || b === null) return null;
    const a = parts.length > 3 ? Math.max(0, Math.min(1, parseFloat(parts[3]))) : 1;
    return { r, g, b, a: Number.isFinite(a) ? a : 1 };
  }

  if (Object.prototype.hasOwnProperty.call(NAMED_COLOURS, text)) {
    const mapped = NAMED_COLOURS[text];
    return mapped ? parseColour(mapped) : null;
  }
  return null;
}

export function toHex({ r, g, b }) {
  const pad = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${pad(r)}${pad(g)}${pad(b)}`;
}

/** Hue in degrees plus saturation and lightness, the HSL of the colour. */
export function toHsl({ r, g, b }) {
  const rn = r / 255; const gn = g / 255; const bn = b / 255;
  const max = Math.max(rn, gn, bn); const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0));
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return { h: h * 60, s, l };
}

function hueDistance(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function colourDistance(a, b) {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}

// ---------------------------------------------------------------------------
// The signature, read for what a mark check needs from it
// ---------------------------------------------------------------------------

const PROSE_KEYS = new Set(['role', 'note', 'concept']);
const BACKGROUND_KEY_RE = /^(bg|background|ground|surface|canvas)/i;
const LIGHT_KEY_RE = /light$/i;
const DARK_KEY_RE = /dark$/i;
const INK_KEY_RE = /^(text|ink|fg|foreground)/i;

/**
 * Flatten the signature into the colour facts a mark check needs.
 *
 * `primary` is the colour the mark is supposed to be owned by. There is no
 * `primary` marker in the schema, so it is resolved in this order, and the
 * resolution is REPORTED in the finding rather than assumed silently:
 *   1. an invariant literally named primary / brand / mark,
 *   2. the invariant whose prose role says it leads (his coral's role reads
 *      "leads: the identity and pay-attention colour"),
 *   3. the first saturated colour in the file.
 */
export function readSignatureColours(sig) {
  const out = { colours: [], primary: null, primaryFrom: null, backgrounds: [], inks: [], pairs: [] };
  const invariants = sig && typeof sig === 'object' && !Array.isArray(sig) ? sig.invariants : null;
  if (!invariants || typeof invariants !== 'object' || Array.isArray(invariants)) return out;

  let leadName = null;
  let namedPrimary = null;

  for (const [name, invariant] of Object.entries(invariants)) {
    if (!invariant || typeof invariant !== 'object' || Array.isArray(invariant)) continue;
    const roleText = Object.entries(invariant)
      .filter(([key, v]) => PROSE_KEYS.has(key) && typeof v === 'string')
      .map(([, v]) => v)
      .join(' ');
    if (/\blead(s|ing)?\b/i.test(roleText) && !leadName) leadName = name;
    if (/^(primary|brand|mark)$/i.test(name)) namedPrimary = name;

    const byKey = new Map();
    for (const [key, value] of Object.entries(invariant)) {
      if (typeof value !== 'string' || PROSE_KEYS.has(key)) continue;
      const rgb = parseColour(value);
      if (!rgb) continue;
      const entry = { name, key, label: `${name}.${key}`, raw: value, rgb, hex: toHex(rgb), hsl: toHsl(rgb) };
      out.colours.push(entry);
      byKey.set(key, entry);
      if (BACKGROUND_KEY_RE.test(key)) out.backgrounds.push(entry);
      if (INK_KEY_RE.test(key)) out.inks.push(entry);
    }

    // Light/dark twins, which is what a reversed variant swaps.
    for (const [key, entry] of byKey) {
      if (!LIGHT_KEY_RE.test(key)) continue;
      const twinKey = key.replace(LIGHT_KEY_RE, 'Dark');
      const twin = byKey.get(twinKey) || byKey.get(twinKey.toLowerCase());
      if (twin) out.pairs.push([entry, twin]);
    }
    if (byKey.has('light') && byKey.has('dark')) out.pairs.push([byKey.get('light'), byKey.get('dark')]);
  }

  const pick = (name) => out.colours.find((c) => c.name === name && c.hsl.s >= CHROMA_FLOOR)
    || out.colours.find((c) => c.name === name);
  if (namedPrimary && pick(namedPrimary)) { out.primary = pick(namedPrimary); out.primaryFrom = `named "${namedPrimary}"`; }
  else if (leadName && pick(leadName)) { out.primary = pick(leadName); out.primaryFrom = `"${leadName}", whose role says it leads`; }
  else {
    const saturated = out.colours.find((c) => c.hsl.s >= CHROMA_FLOOR);
    if (saturated) { out.primary = saturated; out.primaryFrom = `${saturated.label}, the first saturated colour in the signature`; }
  }
  return out;
}

function nearestSignatureColour(rgb, colours) {
  let best = null;
  for (const entry of colours) {
    const d = colourDistance(rgb, entry.rgb);
    if (!best || d < best.distance) best = { entry, distance: d };
  }
  return best;
}

// ---------------------------------------------------------------------------
// A very small SVG reader
// ---------------------------------------------------------------------------

const TAG_RE = /<\/?([a-zA-Z][-\w:.]*)((?:[^>"']|"[^"]*"|'[^']*')*)\/?>/g;
const ATTR_RE = /([-\w:.]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;

const SHAPE_TAGS = new Set(['circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'path']);
const CONTAINER_TAGS = new Set(['svg', 'g', 'defs', 'clippath', 'mask', 'symbol', 'marker', 'pattern', 'a', 'switch', 'text', 'lineargradient', 'radialgradient', 'style', 'title', 'desc', 'metadata', 'filter', 'foreignobject']);
/** Inside these, geometry describes a stencil or a template, never painted ink. */
const NON_PAINT_TAGS = new Set(['defs', 'clippath', 'mask', 'symbol', 'marker', 'pattern', 'filter']);

const INHERITED = ['fill', 'stroke', 'stroke-width', 'opacity', 'fill-opacity', 'stroke-opacity'];

function parseAttrs(raw) {
  const attrs = {};
  ATTR_RE.lastIndex = 0;
  let m;
  while ((m = ATTR_RE.exec(raw || '')) !== null) {
    attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return attrs;
}

/** Presentation properties written as CSS inside a style attribute. */
function parseStyleDecls(text) {
  const out = {};
  for (const decl of String(text || '').split(';')) {
    const idx = decl.indexOf(':');
    if (idx < 0) continue;
    const key = decl.slice(0, idx).trim().toLowerCase();
    const value = decl.slice(idx + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

/**
 * Enough CSS to catch a mark that keeps all its paint in a <style> block, which is
 * common and would otherwise sail through every check with no ink found at all.
 * Selectors more complex than a class, id, or tag are REPORTED, not guessed at.
 */
function parseStyleBlocks(source) {
  const rules = { class: new Map(), id: new Map(), tag: new Map() };
  const unsupported = [];
  const blocks = source.match(/<style\b[^>]*>([\s\S]*?)<\/style>/gi) || [];
  for (const block of blocks) {
    const body = block.replace(/^<style\b[^>]*>/i, '').replace(/<\/style>$/i, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
    let m;
    while ((m = ruleRe.exec(body)) !== null) {
      const decls = parseStyleDecls(m[2]);
      for (const selector of m[1].split(',')) {
        const sel = selector.trim();
        if (!sel) continue;
        if (/^\.[-\w]+$/.test(sel)) mergeInto(rules.class, sel.slice(1), decls);
        else if (/^#[-\w]+$/.test(sel)) mergeInto(rules.id, sel.slice(1), decls);
        else if (/^[a-zA-Z][-\w]*$/.test(sel)) mergeInto(rules.tag, sel.toLowerCase(), decls);
        else unsupported.push(sel);
      }
    }
  }
  return { rules, unsupported };
}

function mergeInto(map, key, decls) {
  map.set(key, { ...(map.get(key) || {}), ...decls });
}

function num(value, fallback = 0) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

/** The uniform-equivalent scale of a transform list. Rotation and skew keep area. */
function transformScale(text) {
  if (!text) return 1;
  let scale = 1;
  const re = /(matrix|scale)\s*\(([^)]*)\)/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const args = m[2].split(/[\s,]+/).filter(Boolean).map(Number);
    if (m[1].toLowerCase() === 'scale') {
      const sx = Number.isFinite(args[0]) ? args[0] : 1;
      const sy = Number.isFinite(args[1]) ? args[1] : sx;
      scale *= Math.sqrt(Math.abs(sx * sy)) || 1;
    } else if (args.length >= 6) {
      const det = args[0] * args[3] - args[1] * args[2];
      scale *= Math.sqrt(Math.abs(det)) || 1;
    }
  }
  return scale || 1;
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

const PATH_ARGS = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };

/** Subpaths of a path's `d`, as endpoint polylines. Curves become their chords. */
export function pathSubpaths(d) {
  const tokens = String(d || '').match(/[MmLlHhVvCcSsQqTtAaZz]|-?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?/g) || [];
  const subpaths = [];
  let current = null;
  let cx = 0; let cy = 0; let sx = 0; let sy = 0;
  let cmd = null;
  let i = 0;

  const start = (x, y) => { current = { points: [[x, y]], closed: false }; subpaths.push(current); };

  while (i < tokens.length) {
    const token = tokens[i];
    if (/^[A-Za-z]$/.test(token)) { cmd = token; i += 1; }
    else if (!cmd) { i += 1; continue; }

    const lower = cmd.toLowerCase();
    const relative = cmd === lower;
    const need = PATH_ARGS[lower];
    if (need === undefined) { i += 1; continue; }
    if (need === 0) {
      if (current) { current.closed = true; cx = sx; cy = sy; }
      cmd = 'L'; // an implicit line follows a close only if coordinates follow
      continue;
    }
    const args = tokens.slice(i, i + need).map(Number);
    if (args.length < need || args.some((n) => !Number.isFinite(n))) break;
    i += need;

    let nx = cx; let ny = cy;
    if (lower === 'h') nx = relative ? cx + args[0] : args[0];
    else if (lower === 'v') ny = relative ? cy + args[0] : args[0];
    else {
      const ex = args[need - 2]; const ey = args[need - 1];
      nx = relative ? cx + ex : ex;
      ny = relative ? cy + ey : ey;
    }

    if (lower === 'm') { start(nx, ny); sx = nx; sy = ny; cmd = relative ? 'l' : 'L'; }
    else {
      if (!current) start(cx, cy);
      current.points.push([nx, ny]);
    }
    cx = nx; cy = ny;
  }
  return subpaths.filter((sp) => sp.points.length > 1);
}

function shoelace(points) {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

function polylineLength(points, close) {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  }
  if (close && points.length > 2) {
    total += Math.hypot(points[0][0] - points[points.length - 1][0], points[0][1] - points[points.length - 1][1]);
  }
  return total;
}

function pointsList(text) {
  const nums = String(text || '').match(/-?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?/g) || [];
  const pts = [];
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push([Number(nums[i]), Number(nums[i + 1])]);
  return pts;
}

function ellipsePerimeter(rx, ry) {
  return Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)));
}

/** Fill area and stroke centreline length of one shape, in user units. */
function shapeGeometry(tag, attrs) {
  switch (tag) {
    case 'circle': {
      const r = num(attrs.r);
      return { fillArea: Math.PI * r * r, strokeLength: 2 * Math.PI * r };
    }
    case 'ellipse': {
      const rx = num(attrs.rx); const ry = num(attrs.ry);
      return { fillArea: Math.PI * rx * ry, strokeLength: ellipsePerimeter(rx, ry) };
    }
    case 'rect': {
      const w = num(attrs.width); const h = num(attrs.height);
      return { fillArea: w * h, strokeLength: 2 * (w + h) };
    }
    case 'line': {
      const len = Math.hypot(num(attrs.x2) - num(attrs.x1), num(attrs.y2) - num(attrs.y1));
      return { fillArea: 0, strokeLength: len };
    }
    case 'polygon':
    case 'polyline': {
      const pts = pointsList(attrs.points);
      if (pts.length < 2) return { fillArea: 0, strokeLength: 0 };
      return { fillArea: shoelace(pts), strokeLength: polylineLength(pts, tag === 'polygon') };
    }
    case 'path': {
      const subs = pathSubpaths(attrs.d);
      let fillArea = 0; let strokeLength = 0;
      for (const sp of subs) {
        fillArea += shoelace(sp.points);
        strokeLength += polylineLength(sp.points, sp.closed);
      }
      return { fillArea, strokeLength };
    }
    default:
      return { fillArea: 0, strokeLength: 0 };
  }
}

// ---------------------------------------------------------------------------
// Gradients
// ---------------------------------------------------------------------------

/**
 * Every gradient in the source, as ordered stops.
 *
 * This is the part that reproduces the Direction B finding. A gradient's colour is
 * not one colour: each stop owns a BAND of the painted area, and for a radial
 * gradient a band's area grows with the square of its offset, while its contribution
 * is scaled by its own stop-opacity. So a Klein blue sitting in the outer stops at
 * 0.09 opacity contributes almost nothing, which is precisely why it vanished at
 * 16px, and boosting the opacity to make it show is what turned the edge purple.
 */
function parseGradients(source) {
  const gradients = new Map();
  const re = /<(linearGradient|radialGradient)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(source)) !== null) {
    const attrs = parseAttrs(m[2]);
    const id = attrs.id;
    if (!id) continue;
    const stops = [];
    const stopRe = /<stop\b([^>]*)\/?>/gi;
    let s;
    while ((s = stopRe.exec(m[3])) !== null) {
      const sa = parseAttrs(s[1]);
      const style = parseStyleDecls(sa.style);
      const raw = style['stop-color'] ?? sa['stop-color'] ?? '#000000';
      const offsetRaw = sa.offset ?? '0';
      const offset = offsetRaw.includes('%') ? num(offsetRaw) / 100 : num(offsetRaw);
      const opacityRaw = style['stop-opacity'] ?? sa['stop-opacity'] ?? '1';
      stops.push({ offset: Math.max(0, Math.min(1, offset)), raw, opacity: Math.max(0, Math.min(1, num(opacityRaw, 1))) });
    }
    gradients.set(id, {
      id,
      radial: m[1].toLowerCase() === 'radialgradient',
      stops,
      href: (attrs['xlink:href'] || attrs.href || '').replace(/^#/, ''),
    });
  }
  // One level of stop inheritance, which is how a light/dark pair is usually written.
  for (const gradient of gradients.values()) {
    if (gradient.stops.length || !gradient.href) continue;
    const parent = gradients.get(gradient.href);
    if (parent) gradient.stops = parent.stops;
  }
  return gradients;
}

/** Split a painted area across a gradient's stops by band area and stop opacity. */
function gradientContributions(gradient, area) {
  const stops = gradient.stops.filter((s) => parseColour(s.raw));
  if (!stops.length) return [];
  if (stops.length === 1) return [{ raw: stops[0].raw, ink: area * stops[0].opacity }];

  const out = [];
  for (let i = 1; i < stops.length; i += 1) {
    const a = stops[i - 1]; const b = stops[i];
    const share = gradient.radial
      ? Math.max(0, b.offset ** 2 - a.offset ** 2)
      : Math.max(0, b.offset - a.offset);
    if (!share) continue;
    const band = area * share;
    out.push({ raw: a.raw, ink: (band / 2) * a.opacity });
    out.push({ raw: b.raw, ink: (band / 2) * b.opacity });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

/**
 * Walk the source once and return everything the checks need: the frame, every
 * painted element with its resolved paint and estimated ink, the ink totals per
 * colour, and the list of things that could not be checked without a renderer.
 *
 * Exported because the tests assert on the ink arithmetic directly. A finding that
 * says "the brand colour is a minority of the ink" is only trustworthy if the shares
 * behind it are inspectable.
 */
export function analyzeMark(svgSource) {
  const result = {
    ok: false,
    viewBox: null, width: null, height: null, frameArea: 0, scale16: null,
    elements: [], ink: new Map(), colours: new Map(), strokes: [],
    unsupported: [], hasShapes: false,
  };
  if (typeof svgSource !== 'string' || !/<svg\b/i.test(svgSource)) return result;

  const source = svgSource.replace(/<!--[\s\S]*?-->/g, '');
  const gradients = parseGradients(source);
  const { rules, unsupported } = parseStyleBlocks(source);
  for (const sel of unsupported) result.unsupported.push({ kind: 'css', detail: sel });

  const stack = [{ inherited: {}, scale: 1, nonPaint: false, tag: 'root' }];
  TAG_RE.lastIndex = 0;
  let m;
  while ((m = TAG_RE.exec(source)) !== null) {
    const whole = m[0];
    const tag = m[1].toLowerCase();
    const closing = whole.startsWith('</');
    const selfClosing = whole.endsWith('/>');

    if (closing) {
      if (stack.length > 1) stack.pop();
      continue;
    }

    const attrs = parseAttrs(m[2]);
    const parent = stack[stack.length - 1];

    if (tag === 'svg' && !result.ok) {
      const vb = (attrs.viewbox || '').split(/[\s,]+/).map(Number).filter((n) => Number.isFinite(n));
      if (vb.length === 4) { result.viewBox = vb; result.width = vb[2]; result.height = vb[3]; }
      else { result.width = num(attrs.width, 0) || null; result.height = num(attrs.height, 0) || null; }
      if (result.width && result.height) {
        result.frameArea = result.width * result.height;
        result.scale16 = ICON_PX / Math.max(result.width, result.height);
      }
      result.ok = true;
    }

    if (tag === 'image') result.unsupported.push({ kind: 'raster', detail: attrs.href || attrs['xlink:href'] || 'inline' });
    if (tag === 'text' || tag === 'tspan' || tag === 'textpath') result.unsupported.push({ kind: 'text', detail: tag });
    if (tag === 'use') result.unsupported.push({ kind: 'use', detail: attrs.href || attrs['xlink:href'] || '' });
    if (tag === 'filter') result.unsupported.push({ kind: 'filter', detail: attrs.id || '' });
    if (tag === 'mask' || tag === 'clippath') result.unsupported.push({ kind: 'mask', detail: tag });
    if (tag === 'foreignobject') result.unsupported.push({ kind: 'foreign', detail: tag });
    if (attrs.filter) result.unsupported.push({ kind: 'filter', detail: attrs.filter });
    if (attrs.mask || attrs['clip-path']) result.unsupported.push({ kind: 'mask', detail: attrs.mask || attrs['clip-path'] });

    // Resolve presentation properties: <style> rules, then attributes, then style="".
    const fromCss = {
      ...(rules.tag.get(tag) || {}),
      ...(attrs.class ? attrs.class.split(/\s+/).reduce((acc, cls) => ({ ...acc, ...(rules.class.get(cls) || {}) }), {}) : {}),
      ...(attrs.id ? rules.id.get(attrs.id) || {} : {}),
    };
    const inlineStyle = parseStyleDecls(attrs.style);
    const own = {};
    for (const key of INHERITED) {
      const value = inlineStyle[key] ?? attrs[key] ?? fromCss[key];
      if (value !== undefined) own[key] = value;
    }
    const inherited = { ...parent.inherited, ...own };
    const scale = parent.scale * transformScale(attrs.transform);
    const nonPaint = parent.nonPaint || NON_PAINT_TAGS.has(tag);

    if (SHAPE_TAGS.has(tag) && !nonPaint) {
      result.hasShapes = true;
      const geom = shapeGeometry(tag, attrs);
      const areaScale = scale * scale;
      const groupOpacity = Math.max(0, Math.min(1, num(inherited.opacity, 1)));
      // SVG's own default: an element with no fill declared anywhere paints black.
      const fillRaw = inherited.fill ?? '#000000';
      const strokeRaw = inherited.stroke ?? 'none';
      const strokeWidth = num(inherited['stroke-width'], 1);
      const fillOpacity = Math.max(0, Math.min(1, num(inherited['fill-opacity'], 1)));
      const strokeOpacity = Math.max(0, Math.min(1, num(inherited['stroke-opacity'], 1)));

      const element = {
        tag,
        id: attrs.id || null,
        fillRaw,
        strokeRaw,
        strokeWidth,
        strokeDevicePx: result.scale16 ? strokeWidth * scale * result.scale16 : null,
        fillArea: geom.fillArea * areaScale,
        strokeArea: geom.strokeLength * scale * strokeWidth * scale,
        contributions: [],
      };

      const paint = (raw, area, alpha) => {
        if (!area || !raw || raw === 'none') return;
        const url = /^url\(#([^)]+)\)/i.exec(raw.trim());
        if (url) {
          const gradient = gradients.get(url[1]);
          if (!gradient) { result.unsupported.push({ kind: 'paint-server', detail: url[1] }); return; }
          for (const part of gradientContributions(gradient, area)) {
            element.contributions.push({ raw: part.raw, ink: part.ink * alpha * groupOpacity });
          }
          return;
        }
        const colour = parseColour(raw);
        if (!colour) {
          if (raw.trim().toLowerCase() !== 'none' && raw.trim().toLowerCase() !== 'currentcolor') {
            result.unsupported.push({ kind: 'colour', detail: raw.trim() });
          } else if (raw.trim().toLowerCase() === 'currentcolor') {
            result.unsupported.push({ kind: 'colour', detail: 'currentColor' });
          }
          return;
        }
        element.contributions.push({ raw, ink: area * alpha * groupOpacity * colour.a });
      };

      paint(fillRaw, element.fillArea, fillOpacity);
      paint(strokeRaw, element.strokeArea, strokeOpacity);
      if (strokeRaw && strokeRaw !== 'none' && strokeWidth > 0) {
        const strokeColour = parseColour(strokeRaw);
        result.strokes.push({
          tag,
          id: element.id,
          strokeWidth,
          devicePx: element.strokeDevicePx,
          raw: strokeRaw,
          // Effective alpha, which is what separates a line that carries the drawing
          // from a rim highlight that was only ever meant to read at large sizes.
          alpha: strokeOpacity * groupOpacity * (strokeColour ? strokeColour.a : 1),
        });
      }
      result.elements.push(element);
    }

    if (!selfClosing && (CONTAINER_TAGS.has(tag) || SHAPE_TAGS.has(tag))) {
      stack.push({ inherited, scale, nonPaint, tag });
    }
  }

  // Ink per colour, and the flag for what counts as the ground rather than the mark.
  for (const element of result.elements) {
    for (const part of element.contributions) {
      const colour = parseColour(part.raw);
      if (!colour) continue;
      const hex = toHex(colour);
      const entry = result.ink.get(hex) || { hex, rgb: colour, hsl: toHsl(colour), ink: 0, raws: new Set() };
      entry.ink += part.ink;
      entry.raws.add(part.raw.trim());
      result.ink.set(hex, entry);
      if (!result.colours.has(hex)) result.colours.set(hex, { hex, rgb: colour, raws: new Set([part.raw.trim()]) });
      else result.colours.get(hex).raws.add(part.raw.trim());
    }
  }
  return result;
}

function finding({ id, severity, summary, fix, filePath = null }) {
  return { id, severity, summary, fix, path: filePath };
}

const SEVERITY_ORDER = { fail: 0, warn: 1, unchecked: 2 };
function sortFindings(list) {
  return list.slice().sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9));
}

const UNCHECKED_COPY = {
  raster: ['an embedded raster image', 'Its pixels are not in the source, so none of its colour or coverage is measured here. Open it and check it by eye, or replace it with vector.'],
  text: ['live text', 'Glyph ink needs font metrics this has no way to read, so the text contributes nothing to the coverage and hue numbers. Convert the text to outlines if the mark depends on it.'],
  use: ['a <use> reference', 'The referenced geometry is not resolved, so anything it draws is missing from the numbers.'],
  filter: ['an SVG filter', 'A filter changes the painted result in ways only a renderer knows, so the ink measured here is the pre-filter ink.'],
  mask: ['a mask or clip path', 'Masking removes ink that is still counted here, so coverage is an over-estimate for the masked parts.'],
  foreign: ['a foreignObject', 'Its content is not SVG and is not measured.'],
  css: ['a CSS selector this reader does not resolve', 'Paint applied through it is missing from the numbers. Move it to a class, id, or tag selector, or onto the element.'],
  colour: ['a colour value this reader cannot resolve', 'It is left out of the hue and conformance numbers.'],
  'paint-server': ['a paint reference with no matching definition', 'The element paints with something not defined in this file, so its ink is not counted.'],
};

/**
 * Check one mark against a signature. Returns findings, never throws.
 *
 * Every check here is arithmetic over the source. None of them is a taste judgement,
 * which is the entire point: they are the checks that can be run without the owner
 * having to know anything about design.
 */
export function checkMark(svgSource, { signature = null, path: filePath = null } = {}) {
  const findings = [];
  const add = (f) => findings.push(finding({ ...f, filePath }));

  let analysis;
  try {
    analysis = analyzeMark(svgSource);
  } catch (error) {
    add({
      id: 'mark-unparseable',
      severity: 'fail',
      summary: `This file could not be read as SVG (${error && error.message ? error.message : 'unknown error'}).`,
      fix: 'Check that it is a valid SVG file and not a raster image or a wrapper page.',
    });
    return findings;
  }

  if (!analysis.ok) {
    add({
      id: 'mark-unparseable',
      severity: 'fail',
      summary: 'No <svg> element found, so nothing here could be checked.',
      fix: 'Point the check at the SVG source of the mark. A PNG or ICO cannot be checked without rasterizing, which this deliberately does not do.',
    });
    return findings;
  }

  const sigColours = readSignatureColours(signature);
  if (!sigColours.colours.length) {
    add({
      id: 'mark-no-signature',
      severity: 'unchecked',
      summary: 'No signature colours were available, so brand-hue dominance and colour conformance were not checked.',
      fix: 'Write ~/.impeccable/signature.json, or pass a signature, and run the check again. Geometry checks still ran.',
    });
  }

  // 1. Stroke width in device pixels at icon size.
  if (!analysis.scale16) {
    add({
      id: 'mark-no-viewbox',
      severity: 'warn',
      summary: 'The root <svg> has neither a viewBox nor width and height, so it has no intrinsic size.',
      fix: 'Add a viewBox. Without one the mark does not scale predictably, and stroke width at icon size cannot be computed.',
    });
    if (analysis.strokes.length) {
      add({
        id: 'mark-unchecked-stroke',
        severity: 'unchecked',
        summary: `${analysis.strokes.length} stroked element(s) were not checked for hairline width, because there is no frame to scale them against.`,
        fix: 'Add a viewBox to the root <svg>.',
      });
    }
  } else {
    const thin = analysis.strokes
      .filter((s) => Number.isFinite(s.devicePx) && s.devicePx > 0 && s.devicePx < MIN_STROKE_DEVICE_PX)
      .sort((a, b) => a.devicePx - b.devicePx);
    // A stroke this faint is a large-format detail, not a line that carries the
    // drawing. His own approved icon has one: a 2-unit rim on a 1024 frame at 6%
    // opacity. Reporting that as a broken mark would be a false alarm, and a check
    // that cries wolf on the reference mark is a check nobody keeps running.
    const structural = thin.filter((s) => s.alpha >= FAINT_STROKE_ALPHA);
    const faint = thin.filter((s) => s.alpha < FAINT_STROKE_ALPHA);
    const floorUnits = (MIN_STROKE_DEVICE_PX / analysis.scale16).toFixed(2);

    if (structural.length) {
      const worst = structural[0];
      add({
        id: 'mark-hairline-stroke',
        severity: 'fail',
        summary: `${structural.length} stroke(s) fall under one device pixel at a ${ICON_PX}px render. The thinnest is the <${worst.tag}>${worst.id ? ` #${worst.id}` : ''} at ${worst.devicePx.toFixed(2)}px.`,
        fix: `A line under ${MIN_STROKE_DEVICE_PX} device pixel does not get thinner, it gets fainter, and then it is gone. Thicken it to at least ${floorUnits} user units, or draw a separate simplified icon variant for small sizes.`,
      });
    }
    if (faint.length) {
      const worst = faint[0];
      add({
        id: 'mark-large-format-detail',
        severity: 'warn',
        summary: `${faint.length} stroke(s) are both under one device pixel at ${ICON_PX}px and nearly transparent (the faintest is the <${worst.tag}>${worst.id ? ` #${worst.id}` : ''} at ${worst.devicePx.toFixed(2)}px and ${(worst.alpha * 100).toFixed(0)}% opacity), so they read as detail for large sizes only.`,
        fix: `Nothing is broken. Just know this part of the drawing does not exist below about ${floorUnits} user units, so do not rely on it to make the mark recognisable.`,
      });
    }
  }

  // Split ground from mark before measuring either coverage or dominance.
  const backgroundHexes = new Set(sigColours.backgrounds.map((b) => b.hex));
  const inkEntries = [...analysis.ink.values()];
  const isGround = (entry) => {
    if (backgroundHexes.has(entry.hex)) return true;
    const neutral = entry.hsl.s < CHROMA_FLOOR;
    return neutral && analysis.frameArea > 0 && entry.ink >= analysis.frameArea * 0.85;
  };
  const markInk = inkEntries.filter((e) => !isGround(e));
  const totalMarkInk = markInk.reduce((sum, e) => sum + e.ink, 0);

  // 2. Ink coverage at icon size.
  if (!analysis.hasShapes) {
    add({
      id: 'mark-no-ink-found',
      severity: 'unchecked',
      summary: 'No drawable shapes were found in this file, so coverage and hue could not be measured.',
      fix: 'If the mark is drawn with <use>, <image>, or <text>, none of those are measured here. Otherwise the file may be empty.',
    });
  } else if (analysis.frameArea > 0) {
    const coverage = Math.min(1, totalMarkInk / analysis.frameArea);
    const iconPixels = coverage * ICON_PX * ICON_PX;
    if (coverage < MIN_INK_COVERAGE) {
      add({
        id: 'mark-ink-too-sparse',
        severity: 'fail',
        summary: `The mark covers an estimated ${(coverage * 100).toFixed(1)}% of its frame, which is about ${iconPixels.toFixed(0)} pixels of ink in a ${ICON_PX}x${ICON_PX} icon.`,
        fix: 'At icon size there is almost nothing to see. Make the drawing bigger inside its frame, or make a dedicated icon variant that keeps only the part that survives.',
      });
    } else if (coverage > MAX_INK_COVERAGE) {
      add({
        id: 'mark-ink-too-solid',
        severity: 'fail',
        summary: `The mark covers an estimated ${(coverage * 100).toFixed(1)}% of its frame, so at icon size it reads as a filled block rather than a shape. The estimate counts overlapping shapes twice, so treat it as an upper bound.`,
        fix: 'Open up the negative space. A mark is recognised by its silhouette, and a nearly solid frame has none.',
      });
    }
  }

  // 3. Brand-hue dominance among the CHROMATIC ink, and the vanishing-colour case.
  //
  // WHY CHROMATIC AND NOT ALL NON-BACKGROUND INK, which is the obvious reading and
  // the wrong one. His signature is one bold colour LEADING A NEAR-SILENT GREYSCALE
  // FIELD, and his own approved mark is a neutral grey arch carrying a single coral
  // node: the grey is most of the ink on purpose. A check that counted the field as
  // a rival would fail the very mark it was written from, which is precision inside
  // the wrong frame. The greys are the stage. The question that actually decides
  // whether a mark is owned by the brand colour is which COLOUR wins among the
  // colours, and that is the question Direction B lost.
  const chromatic = markInk.filter((e) => e.hsl.s >= CHROMA_FLOOR);
  const chromaticInk = chromatic.reduce((sum, e) => sum + e.ink, 0);
  if (sigColours.primary && analysis.hasShapes) {
    const primary = sigColours.primary;
    const isBrand = (entry) => hueDistance(entry.hsl.h, primary.hsl.h) <= BRAND_HUE_TOLERANCE;
    const brandInk = chromatic.filter(isBrand).reduce((sum, e) => sum + e.ink, 0);

    if (!chromaticInk) {
      add({
        id: 'mark-no-brand-colour',
        severity: 'warn',
        summary: `This mark carries no chromatic ink at all, so the brand colour ${primary.hex} is absent from it.`,
        fix: 'A monochrome variant is meant to look like this. A source mark is not: an all-neutral mark is what an asset that was never rebranded looks like. Check which one this is.',
      });
    } else {
      const share = brandInk / chromaticInk;
      if (share < MIN_BRAND_SHARE) {
        const rival = chromatic.filter((e) => !isBrand(e)).sort((a, b) => b.ink - a.ink)[0];
        add({
          id: 'mark-brand-hue-minority',
          severity: 'fail',
          summary: `The brand colour holds ${(share * 100).toFixed(0)}% of the mark's coloured ink, measured against ${primary.hex} (taken from ${sigColours.primaryFrom}). ${rival ? `The largest rival is ${rival.hex} at ${((rival.ink / chromaticInk) * 100).toFixed(0)}%.` : ''} Greys are excluded, they are the field the colour sits on.`.trim(),
          fix: `A mark that shares its colour with another colour is not owned by either. Either give the brand colour the majority of the coloured ink, or drop the rival from the mark and keep it for the interface. Gradient stops are weighted by band area and stop-opacity, so a rival hiding in a faint outer stop counts for little here and will be invisible at ${ICON_PX}px too.`,
        });
      }
    }

    // The other horn of the same argument. A colour can be in the file and absent
    // from the render: at 16px an outer glow ring is one or two near-transparent
    // pixels. Present in the source, gone in the icon, and nobody notices.
    if (analysis.scale16) {
      const pxScale = analysis.scale16 * analysis.scale16;
      for (const entry of chromatic) {
        const devicePixels = entry.ink * pxScale;
        if (devicePixels >= 1) continue;
        const brand = isBrand(entry);
        add({
          id: 'mark-colour-invisible-at-icon-size',
          severity: brand ? 'fail' : 'warn',
          summary: `${entry.hex} amounts to about ${devicePixels.toFixed(2)} device pixels at a ${ICON_PX}px render${brand ? ', and it is the brand colour' : ''}.`,
          fix: brand
            ? 'At icon size the mark loses the colour that identifies it. Make the coloured part bigger or more opaque in a dedicated icon variant.'
            : 'This colour is in the file and not in the icon. Either it is decoration that belongs to large formats only, in which case say so, or it is meant to read and needs more area or opacity.',
        });
      }
    }
  }

  // 4. Colour-set conformance.
  if (sigColours.colours.length && analysis.colours.size) {
    const strays = [];
    for (const entry of analysis.colours.values()) {
      const nearest = nearestSignatureColour(entry.rgb, sigColours.colours);
      if (nearest && nearest.distance <= COLOUR_MATCH_TOLERANCE) continue;
      strays.push({ hex: entry.hex, nearest });
    }
    if (strays.length) {
      const listed = strays.slice(0, 6)
        .map((s) => `${s.hex}${s.nearest ? ` (nearest signature colour ${s.nearest.entry.label} ${s.nearest.entry.hex})` : ''}`)
        .join(', ');
      add({
        id: 'mark-off-signature-colour',
        severity: 'fail',
        summary: `${strays.length} colour(s) in this mark are not in the signature: ${listed}${strays.length > 6 ? ', and more' : ''}.`,
        fix: 'Either replace them with the signature values, or, if one of them has genuinely earned a place, add it to the signature so every other surface can be checked against the same set. A colour that lives only in one asset is how a rejected colour survives for months.',
      });
    }
  }

  // 5. Everything a renderer would have to answer.
  const grouped = new Map();
  for (const item of analysis.unsupported) {
    const list = grouped.get(item.kind) || [];
    if (item.detail && !list.includes(item.detail)) list.push(item.detail);
    grouped.set(item.kind, list);
  }
  for (const [kind, details] of grouped) {
    const copy = UNCHECKED_COPY[kind];
    if (!copy) continue;
    add({
      id: `mark-unchecked-${kind}`,
      severity: 'unchecked',
      summary: `This mark uses ${copy[0]}${details.length ? ` (${details.slice(0, 4).join(', ')})` : ''}, which is not measured without rasterizing.`,
      fix: copy[1],
    });
  }

  return sortFindings(findings);
}

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

const PAINT_ATTRS = ['fill', 'stroke', 'stop-color', 'color', 'flood-color', 'lighting-color', 'solid-color'];

/**
 * Rewrite every colour that sits in a paint position, and only those.
 *
 * Deliberately not a blanket hex replace over the source: `id="dad"` and
 * `href="#fed"` are valid hex triples, and rewriting them would break the document.
 */
function rewritePaints(source, fn) {
  let out = source;
  for (const attr of PAINT_ATTRS) {
    const attrRe = new RegExp(`(\\b${attr}\\s*=\\s*)(["'])([^"']*)\\2`, 'gi');
    out = out.replace(attrRe, (whole, head, quote, value) => {
      const next = fn(value, attr);
      return next === null || next === undefined ? whole : `${head}${quote}${next}${quote}`;
    });
    const cssRe = new RegExp(`(\\b${attr}\\s*:\\s*)([^;"'}]+)`, 'gi');
    out = out.replace(cssRe, (whole, head, value) => {
      const next = fn(value.trim(), attr);
      return next === null || next === undefined ? whole : `${head}${next}`;
    });
  }
  return out;
}

function stripDecoration(source) {
  return source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(title|desc|metadata)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/\n{3,}/g, '\n\n');
}

/**
 * Every gradient's single most present colour, for flattening at icon size.
 *
 * "Most present" is weighted by band area and stop-opacity, not by stop count, so a
 * gradient whose second colour lives in a faint outer ring flattens to the colour
 * that was actually carrying it. That is the same arithmetic the dominance check
 * uses, and for the same reason.
 */
function gradientFlatColours(source) {
  const out = new Map();
  for (const [id, gradient] of parseGradients(source)) {
    const totals = new Map();
    for (const part of gradientContributions(gradient, 1)) {
      const colour = parseColour(part.raw);
      if (!colour) continue;
      const hex = toHex(colour);
      totals.set(hex, (totals.get(hex) || 0) + part.ink);
    }
    const winner = [...totals.entries()].sort((a, b) => b[1] - a[1])[0];
    if (winner) out.set(id, winner[0]);
  }
  return out;
}

function resolveGradientRef(value, flat) {
  const url = /^url\(#([^)]+)\)/i.exec(String(value || '').trim());
  if (!url) return null;
  return flat.get(url[1]) || null;
}

/** Raise every stroke that would vanish at icon size up to the floor. */
function thickenStrokes(source, scale16) {
  if (!scale16) return source;
  const floor = MIN_STROKE_DEVICE_PX / scale16;
  let out = source.replace(/(\bstroke-width\s*=\s*)(["'])([^"']*)\2/gi, (whole, head, quote, value) => {
    const n = parseFloat(value);
    if (!Number.isFinite(n) || n * scale16 >= MIN_STROKE_DEVICE_PX) return whole;
    return `${head}${quote}${Number(floor.toFixed(3))}${quote}`;
  });
  out = out.replace(/(\bstroke-width\s*:\s*)([^;"'}]+)/gi, (whole, head, value) => {
    const n = parseFloat(value);
    if (!Number.isFinite(n) || n * scale16 >= MIN_STROKE_DEVICE_PX) return whole;
    return `${head}${Number(floor.toFixed(3))}`;
  });
  return out;
}

/**
 * Derive the variants an identity actually needs from one source file.
 *
 * These are the four an asset set is always missing, and each one is a mechanical
 * transformation of the original rather than a redraw. Nothing here invents a shape.
 * The four exist because his own note names the places the mark has to survive: the
 * app icon, the notification icon, the site, a dark ground, and 16px.
 */
export function markVariants(svgSource, { signature = null } = {}) {
  if (typeof svgSource !== 'string' || !/<svg\b/i.test(svgSource)) return [];

  const analysis = analyzeMark(svgSource);
  const sig = readSignatureColours(signature);
  const backgroundHexes = new Set(sig.backgrounds.map((b) => b.hex));
  const ink = (sig.inks.find((i) => LIGHT_KEY_RE.test(i.key)) || sig.inks[0] || null);
  const lightBg = sig.backgrounds.find((b) => LIGHT_KEY_RE.test(b.key) || /light/i.test(b.key)) || sig.backgrounds[0] || null;
  const flat = gradientFlatColours(svgSource);

  const inkHex = ink ? ink.hex : '#000000';
  const groundHex = lightBg ? lightBg.hex : '#ffffff';

  const variants = [];
  const push = (id, filename, svg, note) => {
    variants.push({ id, filename, svg, note, changed: svg !== svgSource });
  };

  // 1. Monochrome. One ink, for stamping where colour is not available or not wanted.
  const mono = rewritePaints(svgSource, (value) => {
    const text = String(value).trim();
    if (!text || text === 'none' || text.toLowerCase() === 'currentcolor') return null;
    // Leave gradient references alone. Their stop-color values are rewritten by this
    // same pass, so a glow becomes a tonal fade in one ink instead of a flat blob.
    if (/^url\(/i.test(text)) return null;
    const colour = parseColour(text);
    if (!colour) return null;
    return backgroundHexes.has(toHex(colour)) ? groundHex : inkHex;
  });
  push('mono', 'mark-mono.svg', mono, `Every paint flattened to one ink (${inkHex}); background colours kept as ${groundHex}. Gradients keep their stop structure, so the glow survives as a tonal fade.`);

  // 2. Reversed. Swap the signature's own light/dark twins and leave the rest alone,
  //    which is exactly right for a signature whose lead colour is the same in both
  //    modes and whose neutrals are not.
  //
  //    One hex can mean two things: in his own signature #1A1A1A is BOTH the dark
  //    background and the light-mode text. A last-one-wins map would silently pick
  //    the wrong reading and turn the ground into body text. Background pairs go
  //    first and first-wins, because a reversal is a statement about the ground, and
  //    the collision is named in the note rather than hidden.
  const swap = new Map();
  const ambiguous = [];
  const ordered = sig.pairs.slice().sort((a, b) => {
    const bg = (pair) => (BACKGROUND_KEY_RE.test(pair[0].key) || BACKGROUND_KEY_RE.test(pair[1].key) ? 0 : 1);
    return bg(a) - bg(b);
  });
  for (const [light, dark] of ordered) {
    for (const [from, to] of [[light, dark], [dark, light]]) {
      if (swap.has(from.hex)) {
        if (swap.get(from.hex) !== to.hex) ambiguous.push(`${from.hex} also reads as ${from.label}`);
        continue;
      }
      swap.set(from.hex, to.hex);
    }
  }
  const reversed = swap.size
    ? rewritePaints(svgSource, (value) => {
      const colour = parseColour(value);
      if (!colour) return null;
      return swap.get(toHex(colour)) || null;
    })
    : svgSource;
  push('reversed', 'mark-reversed.svg', reversed, swap.size
    ? `Light and dark twins from the signature swapped (${swap.size} value(s)). Colours with no twin, the lead colour included, are untouched on purpose.${ambiguous.length ? ` One hex carries two roles here, and the background reading was used: ${ambiguous.join('; ')}.` : ''}`
    : 'The signature declares no light/dark pairs, so there was nothing to swap. This is a copy.');

  // 3. Icon. Gradients flattened, small detail dropped, hairlines raised.
  let icon = stripDecoration(svgSource);
  icon = rewritePaints(icon, (value) => resolveGradientRef(value, flat));
  icon = thickenStrokes(icon, analysis.scale16);
  const dropped = [];
  if (analysis.frameArea > 0) {
    // Only self-closing shapes are removed: splicing a container out of text without
    // a real DOM is how you produce invalid SVG.
    const smallRe = /<(circle|ellipse|rect|line|polyline|polygon|path)\b[^>]*\/>/gi;
    icon = icon.replace(smallRe, (whole) => {
      const attrs = parseAttrs(whole);
      const geom = shapeGeometry(/<([a-z]+)/i.exec(whole)[1].toLowerCase(), attrs);
      const area = geom.fillArea + geom.strokeLength * num(attrs['stroke-width'], 1);
      const share = area / analysis.frameArea;
      if (share > 0 && share < 0.004) { dropped.push(attrs.id || 'unnamed'); return ''; }
      return whole;
    });
  }
  push('icon', 'mark-icon.svg', icon, `Simplified for small sizes: gradients flattened to their dominant colour, titles and comments stripped, strokes raised to the ${ICON_PX}px floor${dropped.length ? `, ${dropped.length} shape(s) under 0.4% of the frame dropped (${dropped.slice(0, 4).join(', ')})` : ''}.`);

  // 4. Favicon. The icon, pinned to 16px so a browser cannot pick its own size.
  let favicon = icon.replace(/<svg\b([^>]*)>/i, (whole, attrs) => {
    const cleaned = attrs
      .replace(/\swidth\s*=\s*(["'])[^"']*\1/gi, '')
      .replace(/\sheight\s*=\s*(["'])[^"']*\1/gi, '');
    return `<svg${cleaned} width="${ICON_PX}" height="${ICON_PX}">`;
  });
  favicon = thickenStrokes(favicon, analysis.scale16);
  push('favicon', 'mark-favicon.svg', favicon, `The icon variant pinned to ${ICON_PX}x${ICON_PX}. The viewBox is untouched, so the drawing is unchanged and only the intrinsic size is fixed.`);

  return variants;
}

// ---------------------------------------------------------------------------
// Propagation
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'target', 'coverage', '.next', '.nuxt',
  '.svelte-kit', '.cache', 'vendor', '.venv', 'venv', '__pycache__', '.turbo', 'Pods',
]);
const MAX_WALK_FILES = 5000;
const MAX_WALK_DEPTH = 12;
const MAX_TEXT_BYTES = 512 * 1024;

const RASTER_EXT = new Set(['.png', '.ico', '.icns', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tiff']);
const TEXT_EXT = new Set(['.svg', '.html', '.htm', '.css', '.scss', '.md', '.json', '.webmanifest', '.plist', '.xml']);
const MANIFEST_NAMES = /^(manifest\.json|manifest\.webmanifest|site\.webmanifest|info\.plist|tauri\.conf\.json|app\.json|browserconfig\.xml)$/i;
const ICONISH_NAME = /(favicon|apple-touch-icon|app-?icon|appicon|logo|logomark|wordmark|brand|mark|icon[-_.]?\d*)/i;

/**
 * Hexes in text, only where a colour can actually sit.
 *
 * The value has to follow a `:`, `=`, `,` or `(`, optionally through a quote, which
 * is what separates a colour from an id: `#dad {` and `#face` in a CSS selector or a
 * fragment link are valid hex triples and are not colours. `url(#glow)` and
 * `href="#..."` are skipped outright.
 */
function textColours(text) {
  const out = new Map();
  const re = /[:=,(]\s*["']?\s*(#[0-9a-fA-F]{3,8})\b/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const before = text.slice(Math.max(0, m.index - 16), m.index + 1);
    if (/(href|url\()\s*=?\s*$/i.test(before)) continue;
    const colour = parseColour(m[1]);
    if (!colour) continue;
    const hex = toHex(colour);
    out.set(hex, (out.get(hex) || 0) + 1);
  }
  const rgbRe = /rgba?\([^)]*\)/gi;
  let r;
  while ((r = rgbRe.exec(text)) !== null) {
    const colour = parseColour(r[0]);
    if (!colour) continue;
    const hex = toHex(colour);
    out.set(hex, (out.get(hex) || 0) + 1);
  }
  return out;
}

function walk(rootDir) {
  const files = [];
  const errors = [];
  const stack = [{ dir: rootDir, depth: 0 }];
  while (stack.length && files.length < MAX_WALK_FILES) {
    const { dir, depth } = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      errors.push({ dir, message: error && error.message ? error.message : 'unreadable' });
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
        if (depth + 1 <= MAX_WALK_DEPTH) stack.push({ dir: full, depth: depth + 1 });
        continue;
      }
      if (!entry.isFile()) continue;
      files.push(full);
      if (files.length >= MAX_WALK_FILES) break;
    }
  }
  return { files, errors };
}

/**
 * Framework and language logos that ship with a scaffold. A guess, and named as one
 * in the finding rather than silently suppressed: telling him to retokenise the
 * JavaScript logo to his coral is worse than useless, and pretending the file was
 * never there is the silent pass this module exists to refuse.
 */
const THIRD_PARTY_LOGO_RE = /^(tauri|vite|vitejs|react|vue|svelte|angular|next|nuxt|astro|solid|javascript|typescript|node|npm|bun|deno|electron|flutter|rust|python|github|google|apple|figma)([-_.].*)?\.svg$/i;

/**
 * What counts as a place the mark was supposed to travel to.
 *
 * Stylesheets are deliberately NOT here. Colour drift across a whole app stylesheet
 * is what the design-system enforcer already measures (cli/engine/design-system.mjs
 * plus the four drift rules), and rebuilding it in this lane would both duplicate
 * working code and bury the mark findings under a wall of interface colours. This
 * pass is about mark-carrying ASSETS.
 */
function classify(file) {
  const base = path.basename(file);
  const ext = path.extname(file).toLowerCase();
  if (ext === '.svg') return THIRD_PARTY_LOGO_RE.test(base) ? 'third-party' : 'svg';
  if (MANIFEST_NAMES.test(base)) return 'manifest';
  if (RASTER_EXT.has(ext)) return ICONISH_NAME.test(base) || /icon|logo/i.test(file) ? 'raster-mark' : null;
  if (ext === '.html' || ext === '.htm') return 'page';
  return null;
}

/**
 * A page or stylesheet only counts as brand-carrying if it actually reaches for the
 * mark. Without this gate every stylesheet in every repo reports a wall of drift
 * that is nothing of the kind, which is the same mistake the signature design-system
 * gate exists to avoid.
 */
function carriesMark(text) {
  return /<svg\b/i.test(text)
    || /rel\s*=\s*["'][^"']*icon/i.test(text)
    || /favicon|apple-touch-icon|logo|logomark|app-?icon/i.test(text)
    || /\.svg\b/i.test(text);
}

/**
 * Find every file in a project that plausibly carries the mark or the brand colour,
 * and report the ones that do not match the current signature.
 *
 * This is the half of the job with the highest proven value, because his own note
 * records the failure it prevents: a notification icon and a landing page carrying a
 * REJECTED colour and a DROPPED mark for months, while the app beside them was fully
 * on-brand. Nobody forgot; nothing was looking.
 *
 * READ-ONLY. It reports, it never rewrites. A raster asset is reported as
 * UNVERIFIABLE rather than passed, because a PNG cannot be checked without
 * rasterizing and a silent pass on the notification icon is exactly the failure.
 */
export function propagationTargets(rootDir, { signature, home = os.homedir() } = {}) {
  const report = { root: rootDir, scanned: 0, candidates: [], findings: [] };
  const add = (f) => report.findings.push(finding(f));

  const sig = readSignatureColours(signature === undefined ? loadSignature({ home }) : signature);
  if (!sig.colours.length) {
    add({
      id: 'propagation-no-signature',
      severity: 'unchecked',
      summary: 'No signature colours were available, so nothing could be compared against them.',
      fix: 'Write ~/.impeccable/signature.json, or pass a signature, and run this again.',
    });
    return report;
  }

  let listing;
  try {
    const stat = fs.statSync(rootDir);
    if (!stat.isDirectory()) {
      add({ id: 'propagation-bad-root', severity: 'unchecked', summary: `${rootDir} is not a directory.`, fix: 'Point this at a project root.' });
      return report;
    }
    listing = walk(rootDir);
  } catch (error) {
    add({
      id: 'propagation-bad-root',
      severity: 'unchecked',
      summary: `${rootDir} could not be read (${error && error.message ? error.message : 'unknown error'}).`,
      fix: 'Point this at a readable project root.',
    });
    return report;
  }

  report.scanned = listing.files.length;
  for (const { dir, message } of listing.errors) {
    add({ id: 'propagation-unreadable-dir', severity: 'unchecked', summary: `${dir} could not be listed (${message}).`, fix: 'Anything inside it was not checked.', filePath: dir });
  }

  const signatureHexes = sig.colours.map((c) => c.rgb);
  const isSignatureColour = (rgb) => signatureHexes.some((s) => colourDistance(rgb, s) <= COLOUR_MATCH_TOLERANCE);
  const rasters = [];
  const thirdParty = [];

  for (const file of listing.files) {
    const kind = classify(file);
    if (!kind) continue;

    // Both of these are one verdict repeated, and a generated icon set is a dozen
    // files. Printing the same paragraph a dozen times is how a report stops being
    // read, so they are collected and emitted once below.
    if (kind === 'raster-mark' || kind === 'third-party') {
      report.candidates.push({ path: file, kind });
      (kind === 'raster-mark' ? rasters : thirdParty).push(file);
      continue;
    }

    let text;
    try {
      if (fs.statSync(file).size > MAX_TEXT_BYTES) continue;
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }

    if (kind === 'page' && !carriesMark(text)) continue;
    report.candidates.push({ path: file, kind });

    const colours = textColours(text);
    if (!colours.size) continue;
    const strays = [...colours.keys()]
      .map((hex) => ({ hex, rgb: parseColour(hex) }))
      .filter((c) => c.rgb && !isSignatureColour(c.rgb));
    const onSignature = [...colours.keys()].filter((hex) => {
      const rgb = parseColour(hex);
      return rgb && isSignatureColour(rgb);
    });

    // The severity split comes from what actually went wrong, not from how it feels.
    // The recorded failure was assets carrying NONE of the identity for months, so
    // that is the fail. An asset that is on the palette and also carries a stray
    // value is drift, worth saying once, and the design-system enforcer owns the
    // deeper version of that question.
    if (!onSignature.length) {
      add({
        id: 'propagation-unbranded-asset',
        severity: 'fail',
        summary: `${path.relative(rootDir, file)} carries the mark or an icon reference and contains no signature colour at all. Its colours are ${[...colours.keys()].slice(0, 4).join(', ')}${colours.size > 4 ? ', and more' : ''}.`,
        fix: 'This is what an asset that was never rebranded looks like from the outside, and it is the failure that has already happened here once. Either bring it onto the signature or, if it is not yours, move it somewhere this pass does not look.',
        filePath: file,
      });
    } else if (strays.length) {
      const listed = strays.slice(0, 6).map((s) => {
        const nearest = nearestSignatureColour(s.rgb, sig.colours);
        return `${s.hex}${nearest ? ` (nearest ${nearest.entry.label} ${nearest.entry.hex})` : ''}`;
      }).join(', ');
      add({
        id: 'propagation-off-signature',
        severity: 'warn',
        summary: `${path.relative(rootDir, file)} is on the signature and also carries ${strays.length} colour(s) that are not: ${listed}${strays.length > 6 ? ', and more' : ''}.`,
        fix: 'Either replace them with the signature values, or add the ones that have earned a place to the signature so every other asset is measured against the same set.',
        filePath: file,
      });
    }
  }

  const sample = (files) => files.slice(0, 5).map((f) => path.relative(rootDir, f)).join(', ') + (files.length > 5 ? `, and ${files.length - 5} more` : '');

  if (rasters.length) {
    add({
      id: 'propagation-unverifiable-raster',
      severity: 'unchecked',
      summary: `${rasters.length} raster mark asset(s) cannot be read without rasterizing, so their colours were not checked: ${sample(rasters)}.`,
      fix: 'Check them against the current mark by eye, or regenerate them from the SVG source so they cannot drift on their own. A raster icon still carrying a retired colour is the exact failure this pass exists to catch, and it is the one that has already happened here.',
      filePath: rasters[0],
    });
  }
  if (thirdParty.length) {
    add({
      id: 'propagation-third-party-asset',
      severity: 'unchecked',
      summary: `${thirdParty.length} file(s) look like framework or language logos rather than yours, so they were not judged against the signature: ${sample(thirdParty)}.`,
      fix: 'If that guess is wrong and one of them is your mark, rename it or check it directly with --check. Someone else\'s logo is not yours to retokenise.',
      filePath: thirdParty[0],
    });
  }

  if (!report.candidates.length) {
    add({
      id: 'propagation-no-candidates',
      severity: 'warn',
      summary: `No mark-carrying files were found under ${rootDir} (${report.scanned} file(s) scanned).`,
      fix: 'Either the mark does not live here, or it lives somewhere this pass skips: raster-only assets outside an icon-shaped name, generated output, or a directory below the depth limit.',
    });
  }

  report.findings = sortFindings(report.findings);
  return report;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function renderFindings(findings) {
  if (!findings.length) return 'No findings.';
  return findings.map((f) => `[${f.severity}] ${f.id}\n  ${f.summary}\n  fix: ${f.fix}`).join('\n\n');
}

function cli(argv) {
  const args = argv.slice(2);
  const value = (flag) => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null;
  };
  const json = args.includes('--json');
  const signature = loadSignature();

  const checkTarget = value('--check');
  const variantsTarget = value('--variants');
  const propagateTarget = value('--propagate');

  if (!checkTarget && !variantsTarget && !propagateTarget) {
    process.stdout.write([
      'mark-check: check a mark mechanically, derive its variants, and find where it did not travel.',
      '',
      '  --check <file.svg>                 stroke width at 16px, brand-hue dominance, ink coverage, colour conformance',
      '  --variants <file.svg> [--out dir]  derive mono, reversed, icon, and favicon versions',
      '  --propagate <dir>                  report every mark-carrying file that does not match the signature',
      '  --json                             machine-readable output',
      '',
      'Exits non-zero when a check fails. It never rewrites anything it did not create.',
    ].join('\n') + '\n');
    return 0;
  }

  if (checkTarget) {
    let source = '';
    try {
      source = fs.readFileSync(checkTarget, 'utf8');
    } catch (error) {
      process.stdout.write(`Could not read ${checkTarget}: ${error && error.message ? error.message : 'unknown error'}\n`);
      return 1;
    }
    const findings = checkMark(source, { signature, path: checkTarget });
    process.stdout.write(json ? `${JSON.stringify(findings, null, 2)}\n` : `${renderFindings(findings)}\n`);
    return findings.some((f) => f.severity === 'fail') ? 1 : 0;
  }

  if (variantsTarget) {
    let source = '';
    try {
      source = fs.readFileSync(variantsTarget, 'utf8');
    } catch (error) {
      process.stdout.write(`Could not read ${variantsTarget}: ${error && error.message ? error.message : 'unknown error'}\n`);
      return 1;
    }
    const variants = markVariants(source, { signature });
    if (!variants.length) {
      process.stdout.write(`${variantsTarget} could not be read as SVG, so no variants were derived.\n`);
      return 1;
    }
    const out = value('--out');
    if (out) {
      try {
        fs.mkdirSync(out, { recursive: true });
        for (const variant of variants) fs.writeFileSync(path.join(out, variant.filename), variant.svg);
      } catch (error) {
        process.stdout.write(`Could not write variants to ${out}: ${error && error.message ? error.message : 'unknown error'}\n`);
        return 1;
      }
    }
    if (json) {
      process.stdout.write(`${JSON.stringify(variants.map((v) => ({ ...v, svg: out ? path.join(out, v.filename) : v.svg })), null, 2)}\n`);
    } else {
      process.stdout.write(variants.map((v) => `${v.filename}${out ? ` -> ${path.join(out, v.filename)}` : ''}\n  ${v.note}`).join('\n\n') + '\n');
    }
    return 0;
  }

  const report = propagationTargets(propagateTarget, { signature });
  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`${report.scanned} file(s) scanned, ${report.candidates.length} mark-carrying.\n\n${renderFindings(report.findings)}\n`);
  }
  return report.findings.some((f) => f.severity === 'fail') ? 1 : 0;
}

// Run cli() only when this module is the entry point. Compare realpaths rather than
// endsWith(): a loose suffix match also fires for unrelated scripts, and realpath
// tolerates symlinked invocation (the test harness symlinks the skill dir).
function invokedAsScript() {
  const arg = process.argv[1];
  if (!arg) return false;
  try {
    return fs.realpathSync(arg) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedAsScript()) {
  process.exitCode = cli(process.argv);
}
