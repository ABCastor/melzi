#!/usr/bin/env node

/**
 * Deterministic mechanics for a logo campaign.
 *
 * This module does not invent a mark, detect AI authorship, score taste, claim
 * recognition, or perform trademark clearance. It protects the cheaper boundary:
 * every candidate has an editable construction, a stable export, decision lineage,
 * and the same actual-size proof before a person judges it.
 *
 * Universal production checks and project rules stay separate. An SVG must always be
 * inert and self-contained. A project may additionally require a particular viewBox,
 * currentColor, named component geometry, proof sizes, or a preferred path count.
 * Those project choices come from the manifest rather than becoming Melzi dogma.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { propagationTargets } from './mark-check.mjs';

export const MANIFEST_SCHEMA = 'melzi.logo-campaign/v1';

const FORBIDDEN_ELEMENTS = [
  'script',
  'image',
  'filter',
  'mask',
  'clipPath',
  'pattern',
  'use',
  'foreignObject',
  'text',
  'style',
  'audio',
  'video',
  'iframe',
  'object',
  'embed',
];

const ALLOWED_ELEMENTS = new Set(['svg', 'path']);
const ROOT_ATTRIBUTES = new Set(['xmlns', 'viewBox', 'fill', 'stroke', 'fill-rule', 'clip-rule']);
const PATH_ATTRIBUTES = new Set([
  'id',
  'd',
  'fill',
  'stroke',
  'fill-rule',
  'clip-rule',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-dasharray',
  'stroke-dashoffset',
  'vector-effect',
  'opacity',
  'fill-opacity',
  'stroke-opacity',
]);
const RULE_KEYS = new Set([
  'viewBox',
  'currentColorOnly',
  'requireComponentMaster',
  'requiredComponents',
  'preferredMaxExportPaths',
  'proofSizes',
]);
const STANDARD_COMPONENTS = ['form-a', 'form-b', 'overlap'];
const PATH_ARITY = { A: 7, C: 6, H: 1, L: 2, M: 2, Q: 4, S: 4, T: 2, V: 1, Z: 0 };
const SVG_NUMBER_SOURCE = '[-+]?(?:\\d+\\.\\d+|\\.\\d+|\\d+)(?:[eE][-+]?\\d+)?';

const REQUIRED_CANDIDATE_STRINGS = [
  'id',
  'name',
  'master',
  'export',
  'primaryReading',
  'fusion',
  'smallSize',
  'confusion',
  'motion',
  'objection',
  'status',
];

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function xmlTrim(value) {
  return String(value ?? '').replace(/^[\t\n\r ]+|[\t\n\r ]+$/g, '');
}

function cssTrim(value) {
  return String(value ?? '').replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, '');
}

function normalizeSpace(value) {
  return xmlTrim(value).replace(/[\t\n\r ,]+/g, ' ');
}

function normalizeCssSpace(value) {
  return cssTrim(value).replace(/[\t\n\f\r ]+/g, ' ');
}

const BASIC_NAMED_COLOURS = new Set([
  'aqua', 'black', 'blue', 'fuchsia', 'gray', 'green', 'lime', 'maroon',
  'navy', 'olive', 'orange', 'purple', 'red', 'silver', 'teal', 'white', 'yellow',
]);

function numericToken(value, { percent = false, minimum = -Infinity, maximum = Infinity } = {}) {
  const raw = cssTrim(value);
  const match = new RegExp(`^(${SVG_NUMBER_SOURCE})(%)?$`, 'i').exec(raw);
  if (!match || (match[2] && !percent)) return false;
  const number = Number(match[1]);
  if (!Number.isFinite(number)) return false;
  if (match[2]) return number >= 0 && number <= 100;
  return number >= minimum && number <= maximum;
}

function alphaToken(value) {
  return numericToken(value, { percent: true, minimum: 0, maximum: 1 });
}

function hueToken(value) {
  const raw = cssTrim(value).toLowerCase();
  const match = new RegExp(`^(${SVG_NUMBER_SOURCE})(deg|grad|rad|turn)?$`, 'i').exec(raw);
  return Boolean(match && Number.isFinite(Number(match[1])));
}

function functionalPaint(value) {
  const match = /^(rgb|rgba|hsl|hsla)\((.*)\)$/i.exec(cssTrim(value));
  if (!match) return false;
  const name = match[1].toLowerCase();
  const body = cssTrim(match[2]);
  if (!body || /,,|^,|,$/.test(body)) return false;

  let channels;
  let alpha = null;
  const commaSyntax = body.includes(',');
  if (commaSyntax) {
    if (body.includes('/')) return false;
    const parts = body.split(',').map(cssTrim);
    const expected = name.endsWith('a') ? 4 : 3;
    if (parts.length !== expected || parts.some((part) => !part)) return false;
    channels = parts.slice(0, 3);
    if (expected === 4) alpha = parts[3];
  } else {
    const slash = body.split('/').map(cssTrim);
    if (slash.length > 2 || slash.some((part) => !part)) return false;
    channels = slash[0].split(/[\t\n\f\r ]+/).filter(Boolean);
    if (channels.length !== 3) return false;
    if (slash.length === 2) alpha = slash[1];
    if (name.endsWith('a') && alpha === null) return false;
  }

  if (alpha !== null && !alphaToken(alpha)) return false;
  if (name.startsWith('rgb')) {
    if (commaSyntax) {
      const percentageChannels = channels.map((channel) => channel.endsWith('%'));
      if (percentageChannels.some(Boolean) && !percentageChannels.every(Boolean)) return false;
    }
    return channels.every((channel) => numericToken(channel, { percent: true, minimum: 0, maximum: 255 }));
  }
  return hueToken(channels[0])
    && numericToken(channels[1], { percent: true, minimum: 0, maximum: 100 })
    && channels[1].endsWith('%')
    && numericToken(channels[2], { percent: true, minimum: 0, maximum: 100 })
    && channels[2].endsWith('%');
}

function validPaint(value) {
  const normalized = cssTrim(value).toLowerCase();
  if (['currentcolor', 'none', 'transparent'].includes(normalized)) return true;
  if (BASIC_NAMED_COLOURS.has(normalized)) return true;
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(normalized)) return true;
  return functionalPaint(normalized);
}

function withoutComments(value) {
  return String(value ?? '').replace(/<!--[\s\S]*?-->/g, '');
}

function viewBoxNumbers(value) {
  const raw = typeof value === 'string' ? value : '';
  if (!raw) return null;
  const matches = [...raw.matchAll(new RegExp(SVG_NUMBER_SOURCE, 'g'))];
  if (matches.length !== 4) return null;
  let cursor = 0;
  for (const [index, match] of matches.entries()) {
    const separator = raw.slice(cursor, match.index);
    if (index === 0) {
      if (!/^[\t\n\r ]*$/.test(separator)) return null;
    } else if (!/^(?:[\t\n\r ]+[,]?[\t\n\r ]*|,[\t\n\r ]*)$/.test(separator)) {
      return null;
    }
    cursor = match.index + match[0].length;
  }
  if (!/^[\t\n\r ]*$/.test(raw.slice(cursor))) return null;
  return matches.map((match) => Number(match[0]));
}

function viewBoxError(value) {
  const raw = typeof value === 'string' ? value : '';
  if (!raw || /^[\t\n\r ]*$/.test(raw)) return 'viewBox is missing';
  const numbers = viewBoxNumbers(raw);
  if (!numbers) return 'viewBox must contain exactly four finite SVG decimal numbers separated by XML whitespace or commas';
  if (numbers.some((number) => !Number.isFinite(number))) return 'viewBox numbers must be finite';
  if (numbers[2] <= 0 || numbers[3] <= 0) return 'viewBox width and height must be positive';
  return null;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function scanAttributes(raw = '', { allowSelfClose = false } = {}) {
  const attrs = {};
  const issues = [];
  let cursor = 0;
  while (cursor < raw.length) {
    const whitespaceStart = cursor;
    while (/[\t\n\r ]/.test(raw[cursor] ?? '')) cursor += 1;
    const hadWhitespace = cursor > whitespaceStart;
    if (cursor === raw.length) break;
    if (raw[cursor] === '/') {
      if (allowSelfClose && cursor === raw.length - 1) {
        cursor += 1;
        break;
      }
      issues.push('contains a misplaced or repeated self-close slash');
      break;
    }
    if (!hadWhitespace) {
      issues.push('attributes must be separated by XML whitespace');
      break;
    }

    const nameMatch = /^[A-Za-z_:][A-Za-z0-9_.:-]*/.exec(raw.slice(cursor));
    if (!nameMatch) {
      issues.push(`contains a malformed attribute near "${raw.slice(cursor, cursor + 24)}"`);
      break;
    }
    const name = nameMatch[0];
    cursor += name.length;
    while (/[\t\n\r ]/.test(raw[cursor] ?? '')) cursor += 1;
    if (raw[cursor] !== '=') {
      issues.push(`attribute "${name}" is missing =`);
      break;
    }
    cursor += 1;
    while (/[\t\n\r ]/.test(raw[cursor] ?? '')) cursor += 1;
    const quote = raw[cursor];
    if (!['"', "'"].includes(quote)) {
      issues.push(`attribute "${name}" must use a quoted value`);
      break;
    }
    cursor += 1;
    const end = raw.indexOf(quote, cursor);
    if (end < 0) {
      issues.push(`attribute "${name}" has no closing quote`);
      break;
    }
    const value = raw.slice(cursor, end);
    if (value.includes('<')) issues.push(`attribute "${name}" contains an unescaped <`);
    if (Object.prototype.hasOwnProperty.call(attrs, name)) issues.push(`repeats attribute "${name}"`);
    attrs[name] = value;
    cursor = end + 1;
  }
  return { attrs, issues };
}

function readAttributes(raw = '', options = {}) {
  return scanAttributes(raw, options).attrs;
}

function parseAttributes(raw, label, errors, options = {}) {
  const { attrs, issues } = scanAttributes(raw, options);
  for (const issue of issues) errors.push(`${label} ${issue}.`);
  return attrs;
}

function rootAttributes(svg) {
  const match = /<svg\b([^>]*)>/.exec(withoutComments(svg));
  return match ? readAttributes(match[1], { allowSelfClose: false }) : null;
}

function elementRecords(svg, element) {
  const pattern = new RegExp(`<${element}\\b([^>]*)\\/?\>`, 'g');
  return [...withoutComments(svg).matchAll(pattern)].map((match) => ({
    attrs: readAttributes(match[1], { allowSelfClose: element === 'path' }),
    raw: match[0],
  }));
}

function pathRecords(svg) {
  return elementRecords(svg, 'path').map(({ attrs, raw }) => ({
    id: typeof attrs.id === 'string' ? attrs.id : '',
    d: typeof attrs.d === 'string' ? attrs.d : '',
    raw,
  }));
}

function validatePathData(d) {
  const value = typeof d === 'string' ? d : '';
  if (!xmlTrim(value)) return 'path data is empty';
  if (/^[\t\n\r ]*,|,[\t\n\r ]*$|,[\t\n\r ]*,|[A-Za-z][\t\n\r ]*,|,[\t\n\r ]*[A-Za-z]/.test(value)) {
    return 'path data contains an invalid comma separator';
  }
  const pattern = new RegExp(`[AaCcHhLlMmQqSsTtVvZz]|${SVG_NUMBER_SOURCE}`, 'g');
  const tokens = [];
  let end = 0;
  for (const match of value.matchAll(pattern)) {
    const separator = value.slice(end, match.index);
    if (!/^[\t\n\r ,]*$/.test(separator) || (separator.match(/,/g) ?? []).length > 1) {
      return `invalid path syntax near "${value.slice(end, match.index + 12)}"`;
    }
    tokens.push(match[0]);
    end = match.index + match[0].length;
  }
  if (!/^[\t\n\r ,]*$/.test(value.slice(end))) return `invalid path syntax near "${value.slice(end, end + 24)}"`;
  if (!tokens.length || !/^[Mm]$/.test(tokens[0])) return 'path data must begin with M or m';
  for (const token of tokens) {
    if (!/^[A-Za-z]$/.test(token) && !Number.isFinite(Number(token))) return `path number "${token}" must be finite`;
  }

  let command = null;
  let index = 0;
  let drawsGeometry = false;
  while (index < tokens.length) {
    if (/^[A-Za-z]$/.test(tokens[index])) {
      command = tokens[index];
      index += 1;
    }
    if (!command) return 'path data contains numbers without a command';
    const upper = command.toUpperCase();
    const arity = PATH_ARITY[upper];
    if (arity === undefined) return `unsupported path command ${command}`;
    const start = index;
    while (index < tokens.length && !/^[A-Za-z]$/.test(tokens[index])) index += 1;
    const count = index - start;
    if (arity === 0) {
      if (count) return `${command} cannot take numeric arguments`;
      command = null;
      continue;
    }
    if (count < arity || count % arity !== 0) return `${command} requires groups of ${arity} numbers`;
    if (!['M', 'Z'].includes(upper) || (upper === 'M' && count > arity)) drawsGeometry = true;
    if (upper === 'A') {
      for (let offset = start; offset < index; offset += arity) {
        if (Number(tokens[offset]) < 0 || Number(tokens[offset + 1]) < 0) {
          return `${command} arc radii must be non-negative`;
        }
        if (!['0', '1'].includes(tokens[offset + 3]) || !['0', '1'].includes(tokens[offset + 4])) {
          return `${command} arc flags must be 0 or 1`;
        }
      }
    }
  }
  if (!drawsGeometry) return 'path data must contain a drawing command beyond its initial move';
  return null;
}

function pathBounds(d) {
  const tokens = [...String(d ?? '').matchAll(new RegExp(`[AaCcHhLlMmQqSsTtVvZz]|${SVG_NUMBER_SOURCE}`, 'g'))]
    .map((match) => match[0]);
  let index = 0;
  let command = null;
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let bounds = null;
  const anchors = [];

  const add = (pointX, pointY) => {
    if (!Number.isFinite(pointX) || !Number.isFinite(pointY)) return;
    if (!bounds) bounds = { minX: pointX, minY: pointY, maxX: pointX, maxY: pointY };
    else {
      bounds.minX = Math.min(bounds.minX, pointX);
      bounds.minY = Math.min(bounds.minY, pointY);
      bounds.maxX = Math.max(bounds.maxX, pointX);
      bounds.maxY = Math.max(bounds.maxY, pointY);
    }
  };
  const anchor = (pointX, pointY) => {
    add(pointX, pointY);
    anchors.push([pointX, pointY]);
  };
  const point = (rawX, rawY, relative, originX = x, originY = y) => (
    relative ? [originX + rawX, originY + rawY] : [rawX, rawY]
  );

  while (index < tokens.length) {
    if (/^[A-Za-z]$/.test(tokens[index])) {
      command = tokens[index];
      index += 1;
    }
    if (!command) return null;
    const upper = command.toUpperCase();
    const relative = command !== upper;
    const arity = PATH_ARITY[upper];
    if (upper === 'Z') {
      x = startX;
      y = startY;
      anchor(x, y);
      command = null;
      continue;
    }

    let groupIndex = 0;
    while (index < tokens.length && !/^[A-Za-z]$/.test(tokens[index])) {
      const values = tokens.slice(index, index + arity).map(Number);
      if (values.length !== arity || values.some((value) => !Number.isFinite(value))) return null;
      const originX = x;
      const originY = y;

      if (['M', 'L', 'T'].includes(upper)) {
        [x, y] = point(values[0], values[1], relative, originX, originY);
        anchor(x, y);
        if (upper === 'M' && groupIndex === 0) {
          startX = x;
          startY = y;
        }
      } else if (upper === 'H') {
        x = relative ? originX + values[0] : values[0];
        anchor(x, y);
      } else if (upper === 'V') {
        y = relative ? originY + values[0] : values[0];
        anchor(x, y);
      } else if (upper === 'C') {
        const control1 = point(values[0], values[1], relative, originX, originY);
        const control2 = point(values[2], values[3], relative, originX, originY);
        const end = point(values[4], values[5], relative, originX, originY);
        add(...control1);
        add(...control2);
        [x, y] = end;
        anchor(x, y);
      } else if (upper === 'S' || upper === 'Q') {
        const control = point(values[0], values[1], relative, originX, originY);
        const end = point(values[2], values[3], relative, originX, originY);
        add(...control);
        [x, y] = end;
        anchor(x, y);
      } else if (upper === 'A') {
        const end = point(values[5], values[6], relative, originX, originY);
        [x, y] = end;
        anchor(x, y);
      }

      index += arity;
      groupIndex += 1;
    }
  }
  return bounds ? { ...bounds, anchors } : null;
}

function parseViewBoxBounds(value) {
  if (viewBoxError(value)) return null;
  const [x, y, width, height] = viewBoxNumbers(value);
  return { minX: x, minY: y, maxX: x + width, maxY: y + height };
}

function boundsIntersect(first, second) {
  return Boolean(first && second
    && first.maxX >= second.minX && second.maxX >= first.minX
    && first.maxY >= second.minY && second.maxY >= first.minY);
}

function boundsContainAnchor(bounds, container) {
  return Boolean(bounds && container && bounds.anchors?.some(([pointX, pointY]) => (
    pointX >= container.minX && pointX <= container.maxX
    && pointY >= container.minY && pointY <= container.maxY
  )));
}

function isCurrentColour(value) {
  const normalized = cssTrim(value).toLowerCase();
  return normalized === 'currentcolor' || normalized === 'none' || normalized === 'transparent';
}

function visiblePaintAttributes(svg) {
  const records = [];
  const elementPattern = /<(svg|g|path|circle|ellipse|rect|polygon|polyline|line)\b([^>]*)>/g;
  for (const match of svg.matchAll(elementPattern)) {
    const attrs = readAttributes(match[2]);
    for (const property of ['fill', 'stroke', 'color']) {
      if (Object.prototype.hasOwnProperty.call(attrs, property)) {
        records.push({ element: match[1].toLowerCase(), property, value: attrs[property] });
      }
    }
  }
  return records;
}

function effectivePathStyle(root, attrs) {
  const value = (key, fallback) => normalizeCssSpace(attrs[key] ?? root[key] ?? fallback).toLowerCase();
  return {
    fill: value('fill', 'black'),
    stroke: value('stroke', 'none'),
    fillRule: value('fill-rule', 'nonzero'),
    clipRule: value('clip-rule', 'nonzero'),
    strokeWidth: value('stroke-width', '1'),
    strokeLinecap: value('stroke-linecap', 'butt'),
    strokeLinejoin: value('stroke-linejoin', 'miter'),
    strokeMiterlimit: value('stroke-miterlimit', '4'),
    strokeDasharray: value('stroke-dasharray', 'none'),
    strokeDashoffset: value('stroke-dashoffset', '0'),
    vectorEffect: value('vector-effect', 'none'),
    opacity: value('opacity', '1'),
    fillOpacity: value('fill-opacity', '1'),
    strokeOpacity: value('stroke-opacity', '1'),
  };
}

function validatePresentationAttributes(attrs, label, errors) {
  for (const property of ['fill', 'stroke']) {
    if (attrs[property] !== undefined && !validPaint(attrs[property])) {
      errors.push(`${label} ${property} must be a self-contained colour, currentColor, none, or transparent.`);
    }
  }
  for (const property of ['fill-rule', 'clip-rule']) {
    if (attrs[property] !== undefined && !['nonzero', 'evenodd'].includes(cssTrim(attrs[property]).toLowerCase())) {
      errors.push(`${label} ${property} must be "nonzero" or "evenodd".`);
    }
  }
  if (attrs['stroke-linecap'] !== undefined && !['butt', 'round', 'square'].includes(cssTrim(attrs['stroke-linecap']).toLowerCase())) {
    errors.push(`${label} stroke-linecap is invalid.`);
  }
  if (attrs['stroke-linejoin'] !== undefined && !['miter', 'round', 'bevel'].includes(cssTrim(attrs['stroke-linejoin']).toLowerCase())) {
    errors.push(`${label} stroke-linejoin is invalid.`);
  }
  if (attrs['vector-effect'] !== undefined && !['none', 'non-scaling-stroke'].includes(cssTrim(attrs['vector-effect']).toLowerCase())) {
    errors.push(`${label} vector-effect is invalid.`);
  }

  for (const property of ['opacity', 'fill-opacity', 'stroke-opacity']) {
    if (attrs[property] === undefined) continue;
    const raw = cssTrim(attrs[property]);
    if (!numericToken(raw, { minimum: 0, maximum: 1 })) {
      errors.push(`${label} ${property} must be a finite number from 0 to 1.`);
    }
  }

  for (const [property, minimum] of [['stroke-width', 0], ['stroke-miterlimit', 1]]) {
    if (attrs[property] === undefined) continue;
    const raw = cssTrim(attrs[property]);
    if (!numericToken(raw, { minimum })) {
      errors.push(`${label} ${property} must be a finite number no smaller than ${minimum}.`);
    }
  }

  if (attrs['stroke-dashoffset'] !== undefined) {
    const raw = cssTrim(attrs['stroke-dashoffset']);
    if (!numericToken(raw)) {
      errors.push(`${label} stroke-dashoffset must be a finite number.`);
    }
  }
  if (attrs['stroke-dasharray'] !== undefined) {
    const raw = cssTrim(attrs['stroke-dasharray']).toLowerCase();
    const malformedSeparators = /^[\t\n\f\r ]*,|,[\t\n\f\r ]*$|,[\t\n\f\r ]*,/.test(raw);
    const values = raw === 'none' ? [] : raw.split(/[\t\n\f\r ,]+/).filter(Boolean);
    if (raw !== 'none' && (malformedSeparators || values.length === 0 || values.some((item) => {
      return !numericToken(item, { minimum: 0 });
    }))) {
      errors.push(`${label} stroke-dasharray must be "none" or a list of finite non-negative numbers.`);
    }
  }
}

function visibleStyle(style) {
  const fillVisible = !['none', 'transparent'].includes(style.fill) && Number(style.fillOpacity) > 0;
  const strokeVisible = !['none', 'transparent'].includes(style.stroke) && Number(style.strokeOpacity) > 0 && Number(style.strokeWidth) > 0;
  return Number(style.opacity) > 0 && (fillVisible || strokeVisible);
}

function hasCurrentColourPaint(style) {
  if (Number(style.opacity) <= 0) return false;
  const fill = style.fill === 'currentcolor' && Number(style.fillOpacity) > 0;
  const stroke = style.stroke === 'currentcolor' && Number(style.strokeOpacity) > 0 && Number(style.strokeWidth) > 0;
  return fill || stroke;
}

function renderSignature(svg) {
  const root = rootAttributes(svg) ?? {};
  const paths = [];
  for (const { attrs } of elementRecords(svg, 'path')) {
    const style = effectivePathStyle(root, attrs);
    if (!visibleStyle(style)) continue;
    paths.push({ style, d: normalizeSpace(attrs.d) });
  }
  return JSON.stringify({ viewBox: normalizeSpace(root.viewBox), paths });
}

function within(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function resolveCampaignFile(root, relative, label, errors) {
  const rel = text(relative);
  if (!rel) return null;
  const target = path.resolve(root, rel);
  if (!within(root, target)) {
    errors.push(`${label} leaves the campaign directory: ${rel}`);
    return null;
  }
  try {
    const canonicalRoot = fs.realpathSync(root);
    const canonicalTarget = fs.realpathSync(target);
    if (!within(canonicalRoot, canonicalTarget)) {
      errors.push(`${label} resolves outside the campaign directory through a symbolic link: ${rel}`);
      return null;
    }
    return canonicalTarget;
  } catch {
    return target;
  }
}

function safeRead(file, label, errors) {
  if (!file) return null;
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) throw new Error('not a file');
    return fs.readFileSync(file, 'utf8');
  } catch (error) {
    errors.push(`${label} cannot be read: ${error?.message ?? String(error)}`);
    return null;
  }
}

/**
 * Validate one SVG source string. Findings describe production mechanics only.
 * `authorshipVerdict` is permanently null because geometry cannot prove authorship.
 */
export function validateSvgSource(svg, {
  expectedViewBox = null,
  currentColorOnly = false,
  requiredComponents = [],
} = {}) {
  const source = typeof svg === 'string' ? svg : '';
  const errors = [];
  const warnings = [];
  if (/<!--[\s\S]*?-->/.test(source)) errors.push('XML comments are forbidden in the strict SVG profile.');
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/u.test(source)) {
    errors.push('SVG contains a character forbidden by XML 1.0.');
  }
  if (source.includes('&')) errors.push('Entity references and raw ampersands are forbidden in the strict SVG profile.');
  const withoutXmlDeclaration = withoutComments(source);
  if (/<\?|<!/.test(withoutXmlDeclaration)) errors.push('Processing instructions and declarations are forbidden.');
  const root = rootAttributes(withoutXmlDeclaration);

  if (!xmlTrim(source)) errors.push('SVG source is empty.');
  if (!root) errors.push('Root <svg> element is missing.');

  if (/<!doctype\b|<!entity\b/i.test(source)) errors.push('DOCTYPE and entity declarations are forbidden.');
  const rootMatch = /^[\t\n\r ]*<svg\b([^>]*)>([\s\S]*)<\/svg[\t\n\r ]*>[\t\n\r ]*$/.exec(withoutXmlDeclaration);
  const openingTags = [...withoutXmlDeclaration.matchAll(/<([A-Za-z][\w:.-]*)\b([^>]*)>/g)];
  const svgTags = openingTags.filter((match) => match[1] === 'svg');
  if (svgTags.length !== 1 || !rootMatch) errors.push('SVG must contain exactly one closed root <svg> element.');
  if (rootMatch) {
    const residue = xmlTrim(rootMatch[2]
      .replace(/<path\b[^>]*>[\t\n\r ]*<\/path[\t\n\r ]*>/g, '')
      .replace(/<path\b[^>]*\/>/g, ''));
    if (residue) errors.push('Only empty direct-child <path> elements are allowed inside the root <svg>.');
  }
  for (const match of openingTags) {
    const element = match[1];
    if (!ALLOWED_ELEMENTS.has(element)) errors.push(`<${match[1]}> is outside the strict path-only SVG profile.`);
    const attrs = parseAttributes(match[2], `<${match[1]}>`, errors, { allowSelfClose: element === 'path' });
    const allowed = element === 'svg' ? ROOT_ATTRIBUTES : PATH_ATTRIBUTES;
    for (const name of Object.keys(attrs)) {
      if (!allowed.has(name)) errors.push(`<${match[1]}> attribute "${name}" is outside the strict SVG profile.`);
    }
    validatePresentationAttributes(attrs, `<${match[1]}>`, errors);
  }

  if (root) {
    const error = viewBoxError(root.viewBox);
    if (error) errors.push(`${error}.`);
    if (root.xmlns !== 'http://www.w3.org/2000/svg') {
      errors.push('Root <svg> must declare xmlns="http://www.w3.org/2000/svg" for a valid standalone SVG.');
    }
  }
  if (expectedViewBox) {
    const error = viewBoxError(expectedViewBox);
    if (error) errors.push(`expected ${error}.`);
  }
  if (root && expectedViewBox && normalizeSpace(root.viewBox) !== normalizeSpace(expectedViewBox)) {
    errors.push(`viewBox must be "${expectedViewBox}", found "${root.viewBox ?? 'missing'}".`);
  }

  for (const element of FORBIDDEN_ELEMENTS) {
    const pattern = new RegExp(`<${element}\\b`, 'i');
    if (pattern.test(source)) errors.push(`<${element}> is forbidden in a production mark.`);
  }

  if (/\son[a-z]+\s*=/i.test(source)) errors.push('Event-handler attributes are forbidden.');
  if (/\sstyle\s*=/i.test(source)) errors.push('Inline style attributes are forbidden.');
  if (/\stransform\s*=/i.test(source)) errors.push('Transforms are forbidden; flatten geometry into path data.');
  if (/\b(?:href|xlink:href)\s*=\s*["'](?!#)[^"']+/i.test(source)) {
    errors.push('External or embedded references are forbidden.');
  }
  if (/\b(?:https?:|data:|javascript:)/i.test(source.replace(/xmlns\s*=\s*["'][^"']+["']/gi, ''))) {
    errors.push('Network, data, or executable URLs are forbidden.');
  }
  if (/url\s*\(/i.test(source)) errors.push('CSS url() references are forbidden.');

  const pathElements = elementRecords(withoutXmlDeclaration, 'path');
  const paths = pathElements.map(({ attrs, raw }) => ({
    id: typeof attrs.id === 'string' ? attrs.id : '',
    d: typeof attrs.d === 'string' ? attrs.d : '',
    attrs,
    raw,
  }));
  const calculatedBounds = [];
  if (paths.length === 0) errors.push('At least one <path> is required in a production mark.');
  for (const [index, record] of paths.entries()) {
    if (record.attrs.id !== undefined && !/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(record.id)) {
      errors.push(`path ${index + 1} id must be a whitespace-free ASCII XML name.`);
    }
    if (!record.d) errors.push(`path ${index + 1} has no geometry.`);
    else {
      const pathError = validatePathData(record.d);
      if (pathError) errors.push(`path ${index + 1}: ${pathError}.`);
      else calculatedBounds[index] = pathBounds(record.d);
    }
  }

  const rootPaint = root ?? {};
  const styles = paths.map(({ attrs }) => effectivePathStyle(rootPaint, attrs));

  if (currentColorOnly) {
    for (const [index, style] of styles.entries()) {
      for (const property of ['fill', 'stroke']) {
        if (!isCurrentColour(style[property])) errors.push(`path ${index + 1} effective ${property} must use currentColor or none, found "${style[property]}".`);
      }
    }
    if (!styles.some(hasCurrentColourPaint)) {
      errors.push('currentColor must be assigned to at least one non-zero paint channel; raster visibility is verified separately.');
    }
  }

  const idCounts = new Map();
  for (const { id } of paths) {
    if (id) idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
  }
  for (const [id, count] of idCounts) {
    if (count > 1) errors.push(`path id "${id}" is duplicated ${count} times.`);
  }
  const components = [...idCounts.keys()];
  for (const component of requiredComponents) {
    const count = idCounts.get(component) ?? 0;
    if (count === 0) errors.push(`required component "${component}" is missing.`);
    else if (count !== 1) errors.push(`required component "${component}" must appear exactly once.`);
  }

  const commandCount = paths.reduce((sum, record) => sum + (record.d.match(/[AaCcHhLlMmQqSsTtVvZz]/g) ?? []).length, 0);
  const coordinateCount = paths.reduce((sum, record) => (
    sum + (record.d.match(new RegExp(SVG_NUMBER_SOURCE, 'g')) ?? []).length
  ), 0);
  if (commandCount > 200) warnings.push(`The SVG has ${commandCount} path commands. Inspect it for sampled or redundant geometry.`);
  const componentBounds = {};
  const paintBearingPathBounds = [];
  for (const [index, record] of paths.entries()) {
    const bounds = calculatedBounds[index] ?? null;
    if (record.id && bounds && idCounts.get(record.id) === 1) componentBounds[record.id] = bounds;
    if (bounds && visibleStyle(styles[index])) paintBearingPathBounds.push(bounds);
  }

  return {
    errors,
    warnings,
    pathCount: paths.length,
    commandCount,
    coordinateCount,
    components,
    componentBounds,
    paintBearingPathBounds,
    viewBoxBounds: parseViewBoxBounds(root?.viewBox),
    geometry: renderSignature(source),
    authorshipVerdict: null,
    rasterVisibilityVerdict: null,
  };
}

function validateCandidateShape(candidate, prefix, errors) {
  for (const key of REQUIRED_CANDIDATE_STRINGS) {
    if (!text(candidate?.[key])) errors.push(`${prefix}.${key} is required.`);
  }
  if (candidate?.secondaryReading !== undefined && candidate.secondaryReading !== null && typeof candidate.secondaryReading !== 'string') {
    errors.push(`${prefix}.secondaryReading must be a string or null when present.`);
  }

  if (!Array.isArray(candidate?.construction) || candidate.construction.length === 0) {
    errors.push(`${prefix}.construction must contain redrawable steps.`);
  } else if (candidate.construction.some((step) => !text(step))) {
    errors.push(`${prefix}.construction contains an empty step.`);
  }

  const lineage = candidate?.lineage;
  if (!lineage || typeof lineage !== 'object' || Array.isArray(lineage)) {
    errors.push(`${prefix}.lineage is required.`);
    return;
  }
  if (!Array.isArray(lineage.parents)) errors.push(`${prefix}.lineage.parents must be an array.`);
  if (!text(lineage.change)) errors.push(`${prefix}.lineage.change is required.`);
  if (!text(lineage.hypothesis)) errors.push(`${prefix}.lineage.hypothesis is required.`);
  if (!Array.isArray(lineage.evidence) || lineage.evidence.length === 0 || lineage.evidence.some((item) => !text(item))) {
    errors.push(`${prefix}.lineage.evidence must contain at least one honest evidence or pending-evidence statement.`);
  }
}

function proofSizes(rules, errors) {
  const raw = rules?.proofSizes;
  if (!Array.isArray(raw) || raw.length === 0) {
    errors.push('rules.proofSizes must contain at least one positive integer.');
    return [];
  }
  const sizes = raw;
  if (sizes.some((size) => typeof size !== 'number' || !Number.isInteger(size) || size <= 0 || size > 1024)) {
    errors.push('rules.proofSizes must contain positive integers no larger than 1024.');
    return [];
  }
  return [...new Set(sizes)];
}

function validateRules(rules, errors) {
  for (const key of Object.keys(rules)) {
    if (!RULE_KEYS.has(key)) errors.push(`rules.${key} is not recognized by ${MANIFEST_SCHEMA}.`);
  }
  if (rules.viewBox !== undefined) {
    if (typeof rules.viewBox !== 'string') errors.push('rules.viewBox must be a string.');
    else {
      const error = viewBoxError(rules.viewBox);
      if (error) errors.push(`rules.${error}.`);
    }
  }
  for (const key of ['currentColorOnly', 'requireComponentMaster']) {
    if (rules[key] !== undefined && typeof rules[key] !== 'boolean') errors.push(`rules.${key} must be a boolean.`);
  }
  if (rules.preferredMaxExportPaths !== undefined
    && (typeof rules.preferredMaxExportPaths !== 'number'
      || !Number.isInteger(rules.preferredMaxExportPaths)
      || rules.preferredMaxExportPaths <= 0)) {
    errors.push('rules.preferredMaxExportPaths must be a positive integer when present.');
  }
  if (rules.requiredComponents !== undefined) {
    if (!Array.isArray(rules.requiredComponents)
      || rules.requiredComponents.some((item) => typeof item !== 'string' || !text(item))) {
      errors.push('rules.requiredComponents must be an array of non-empty strings.');
    } else if (new Set(rules.requiredComponents.map(text)).size !== rules.requiredComponents.length) {
      errors.push('rules.requiredComponents must not contain duplicates.');
    }
  }
  if (rules.requireComponentMaster === true
    && (!Array.isArray(rules.requiredComponents) || rules.requiredComponents.length === 0)) {
    errors.push('rules.requiredComponents must be a non-empty array when requireComponentMaster is true.');
  }
  if (rules.requireComponentMaster === true && Array.isArray(rules.requiredComponents)) {
    const actual = [...rules.requiredComponents].map(text).sort();
    const standard = [...STANDARD_COMPONENTS].sort();
    if (actual.length !== standard.length || actual.some((item, index) => item !== standard[index])) {
      errors.push(`rules.requiredComponents must be exactly ${STANDARD_COMPONENTS.map((item) => `"${item}"`).join(', ')} when requireComponentMaster is true.`);
    }
  }
}

function validateLineageGraph(candidates, errors) {
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  for (const [index, candidate] of candidates.entries()) {
    const parents = candidate?.lineage?.parents;
    if (!Array.isArray(parents)) continue;
    if (parents.some((parent) => typeof parent !== 'string' || !text(parent))) {
      errors.push(`candidates[${index}].lineage.parents must contain only non-empty candidate IDs.`);
      continue;
    }
    if (new Set(parents).size !== parents.length) errors.push(`candidates[${index}].lineage.parents contains duplicates.`);
    for (const parent of parents) {
      if (parent === candidate.id) errors.push(`candidates[${index}].lineage.parents cannot contain its own ID.`);
      else if (!byId.has(parent)) errors.push(`candidates[${index}].lineage parent "${parent}" does not exist in this campaign.`);
    }
  }

  const visiting = new Set();
  const visited = new Set();
  function visit(id, trail = []) {
    if (visiting.has(id)) {
      errors.push(`candidate lineage contains a cycle: ${[...trail, id].join(' -> ')}.`);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    const candidate = byId.get(id);
    const parents = Array.isArray(candidate?.lineage?.parents) ? candidate.lineage.parents : [];
    for (const parent of parents) {
      if (byId.has(parent)) visit(parent, [...trail, id]);
    }
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of byId.keys()) visit(id);
}

/** Load a manifest plus every named source/export and return one complete report. */
export function loadAndValidateCampaign(manifestPath) {
  const absoluteManifest = path.resolve(String(manifestPath ?? ''));
  let canonicalManifest = absoluteManifest;
  try {
    canonicalManifest = fs.realpathSync(absoluteManifest);
  } catch {
    // The read below reports the useful missing-file or malformed-path error.
  }
  const rootDir = path.dirname(canonicalManifest);
  const errors = [];
  const warnings = [];
  let manifest = null;

  try {
    manifest = JSON.parse(fs.readFileSync(canonicalManifest, 'utf8'));
  } catch (error) {
    errors.push(`campaign manifest cannot be read: ${error?.message ?? String(error)}`);
  }

  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return {
      manifestPath: canonicalManifest,
      rootDir,
      manifest: null,
      project: '',
      wordmark: '',
      rules: {},
      sizes: [],
      candidates: [],
      errors,
      warnings,
    };
  }

  if (manifest.schema !== MANIFEST_SCHEMA) errors.push(`schema must be "${MANIFEST_SCHEMA}".`);
  if (!text(manifest.project)) errors.push('project is required.');
  if (!text(manifest.wordmark)) errors.push('wordmark is required.');
  const rules = manifest.rules && typeof manifest.rules === 'object' && !Array.isArray(manifest.rules)
    ? manifest.rules
    : {};
  validateRules(rules, errors);
  const sizes = proofSizes(rules, errors);
  const candidatesInput = Array.isArray(manifest.candidates) ? manifest.candidates : [];
  if (candidatesInput.length === 0) errors.push('candidates must contain at least one candidate.');

  const seen = new Set();
  const candidates = candidatesInput.map((candidate, index) => {
    const prefix = `candidates[${index}]`;
    validateCandidateShape(candidate, prefix, errors);
    const id = text(candidate?.id);
    if (id && !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id)) errors.push(`${prefix}.id is unsafe: ${id}`);
    if (id && seen.has(id)) errors.push(`${prefix}.id is duplicated: ${id}`);
    if (id) seen.add(id);

    const masterPath = resolveCampaignFile(rootDir, candidate?.master, `${prefix}.master`, errors);
    const exportPath = resolveCampaignFile(rootDir, candidate?.export, `${prefix}.export`, errors);
    const masterSource = safeRead(masterPath, `${prefix}.master`, errors);
    const exportSource = safeRead(exportPath, `${prefix}.export`, errors);
    const expectedViewBox = text(rules.viewBox) || null;
    const requiredComponents = rules.requireComponentMaster === true
      ? (Array.isArray(rules.requiredComponents) ? rules.requiredComponents.map(text).filter(Boolean) : [])
      : [];

    const master = masterSource === null
      ? null
      : validateSvgSource(masterSource, {
        expectedViewBox,
        currentColorOnly: rules.currentColorOnly === true,
        requiredComponents,
      });
    const exported = exportSource === null
      ? null
      : validateSvgSource(exportSource, {
        expectedViewBox,
        currentColorOnly: rules.currentColorOnly === true,
      });

    for (const message of master?.errors ?? []) errors.push(`${prefix}.master: ${message}`);
    for (const message of exported?.errors ?? []) errors.push(`${prefix}.export: ${message}`);
    for (const message of master?.warnings ?? []) warnings.push(`${prefix}.master: ${message}`);
    for (const message of exported?.warnings ?? []) warnings.push(`${prefix}.export: ${message}`);

    if (master && requiredComponents.length) {
      for (const component of requiredComponents) {
        const bounds = master.componentBounds?.[component];
        if (!bounds) continue;
        if (!boundsContainAnchor(bounds, master.viewBoxBounds)) {
          errors.push(`${prefix}.master component "${component}" must have at least one anchor inside the SVG viewBox.`);
        }
        if (!master.paintBearingPathBounds.some((paintBounds) => boundsIntersect(bounds, paintBounds))) {
          errors.push(`${prefix}.master component "${component}" does not intersect any paint-bearing path bounds.`);
        }
      }
      const formA = master.componentBounds?.['form-a'];
      const formB = master.componentBounds?.['form-b'];
      const overlap = master.componentBounds?.overlap;
      if (formA && overlap && !boundsIntersect(formA, overlap)) {
        errors.push(`${prefix}.master overlap bounds do not intersect form-a bounds.`);
      }
      if (formB && overlap && !boundsIntersect(formB, overlap)) {
        errors.push(`${prefix}.master overlap bounds do not intersect form-b bounds.`);
      }
    }

    const renderParity = Boolean(master && exported
      && master.errors.length === 0 && exported.errors.length === 0
      && master.geometry && master.geometry === exported.geometry);
    if (master && exported && !renderParity) errors.push(`${prefix} fails source/export render parity.`);

    const preferredMax = rules.preferredMaxExportPaths;
    if (exported && Number.isInteger(preferredMax) && preferredMax > 0 && exported.pathCount > preferredMax) {
      warnings.push(`${prefix}.export exceeds the preferred maximum of ${preferredMax} path${preferredMax === 1 ? '' : 's'}; this is advisory, not an authorship or quality failure.`);
    }

    return {
      ...candidate,
      id,
      masterPath,
      exportPath,
      masterSource,
      exportSource,
      master,
      export: exported,
      renderParity,
    };
  });

  validateLineageGraph(candidates, errors);

  return {
    manifestPath: canonicalManifest,
    rootDir,
    manifest,
    project: text(manifest.project),
    wordmark: text(manifest.wordmark),
    rules,
    sizes,
    candidates,
    errors,
    warnings,
  };
}

function inlineSvg(source, label) {
  return source
    .replace(/<\?xml[\s\S]*?\?>/gi, '')
    .replace(/<!doctype[\s\S]*?>/gi, '')
    .replace(/\sxmlns(?::\w+)?\s*=\s*["'][^"']+["']/gi, '')
    .replace(/<svg\b/i, `<svg aria-label="${escapeHtml(label)}" role="img" focusable="false"`)
    .trim();
}

function proofCell(candidate, size, ground) {
  const svg = inlineSvg(candidate.exportSource, `${candidate.name}, ${size} pixels, ${ground} ground`);
  return `<div class="proof-cell ${ground}" data-size="${size}" data-ground="${ground}" style="--proof-size:${size}px">
    <div class="mark">${svg}</div>
    <span>${size}px</span>
  </div>`;
}

/** Render one no-network, no-script HTML proof from an already loaded campaign. */
export function renderProofSheet(campaign) {
  if (!campaign || !Array.isArray(campaign.candidates)) throw new Error('A loaded campaign is required.');
  if (campaign.errors?.length) throw new Error(`Campaign has ${campaign.errors.length} validation error(s).`);

  const cards = campaign.candidates.map((candidate) => {
    const cells = campaign.sizes.flatMap((size) => [
      proofCell(candidate, size, 'light'),
      proofCell(candidate, size, 'dark'),
    ]).join('\n');
    const wordmarkSvg = inlineSvg(candidate.exportSource, `${candidate.name} beside ${campaign.wordmark}`);
    const tabSvg = inlineSvg(candidate.exportSource, `${candidate.name} browser-tab mark`);

    return `<article class="candidate" id="${escapeHtml(candidate.id)}">
      <header class="candidate-head"><span class="candidate-id">${escapeHtml(candidate.id)}</span><h2>${escapeHtml(candidate.name)}</h2></header>
      <div class="proof-grid">${cells}</div>
      <div class="contexts">
        <div class="wordmark-lockup"><span class="context-mark">${wordmarkSvg}</span><span class="wordmark">${escapeHtml(campaign.wordmark)}</span></div>
        <div class="browser-tab"><span class="tab-mark">${tabSvg}</span><span>${escapeHtml(campaign.wordmark)}</span><span class="tab-close">×</span></div>
      </div>
      <dl class="notes">
        <div><dt>First read</dt><dd>${escapeHtml(candidate.primaryReading)}</dd></div>
        ${text(candidate.secondaryReading) ? `<div><dt>Second read</dt><dd>${escapeHtml(candidate.secondaryReading)}</dd></div>` : ''}
        <div><dt>Confusion</dt><dd>${escapeHtml(candidate.confusion)}</dd></div>
        <div><dt>Strongest objection</dt><dd>${escapeHtml(candidate.objection)}</dd></div>
      </dl>
    </article>`;
  }).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="icon" href="data:,">
<title>${escapeHtml(campaign.project)} logo proofs</title>
<style>
  :root{color-scheme:light;--ink:#111;--paper:#f2f1ed;--line:#d5d3cc;--muted:#696863}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{width:min(1480px,calc(100% - 40px));margin:0 auto;padding:34px 0 60px}.page-head{display:flex;align-items:end;justify-content:space-between;gap:24px;margin:0 0 24px}.page-head h1{margin:0;font-size:clamp(24px,3vw,42px);line-height:1;letter-spacing:-.04em}.page-head p{max-width:620px;margin:0;color:var(--muted)}.candidate{min-width:0;background:#fff;border:1px solid var(--line);margin:0 0 24px}.candidate-head{display:flex;align-items:baseline;gap:12px;padding:18px 20px;border-bottom:1px solid var(--line)}.candidate-head h2{margin:0;font-size:18px}.candidate-id{font:700 12px/1 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--muted)}.proof-grid{display:flex;max-width:100%;overflow-x:auto;border-bottom:1px solid var(--line)}.proof-cell{flex:0 0 max(160px,calc(var(--proof-size) + 40px));min-height:max(132px,calc(var(--proof-size) + 52px));display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;border-right:1px solid var(--line);overflow:hidden}.proof-cell:last-child{border-right:0}.proof-cell.dark{background:#111;color:#fff}.proof-cell.light{background:#fff;color:#111}.proof-cell span{font:11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;opacity:.66}.mark{flex:0 0 auto;width:var(--proof-size);height:var(--proof-size);color:currentColor}.mark svg,.context-mark svg,.tab-mark svg{display:block;width:100%;height:100%}.contexts{display:grid;grid-template-columns:1fr 1fr;gap:0;border-bottom:1px solid var(--line)}.wordmark-lockup,.browser-tab{min-height:88px;display:flex;align-items:center}.wordmark-lockup{gap:13px;padding:18px 22px;border-right:1px solid var(--line)}.context-mark{width:34px;height:34px}.wordmark{font-size:28px;line-height:1;letter-spacing:-.04em}.browser-tab{align-self:center;min-height:44px;margin:21px;padding:0 12px;gap:9px;border:1px solid #c7c7c7;border-bottom-color:#fff;border-radius:10px 10px 0 0;background:#fff;box-shadow:0 6px 18px rgba(0,0,0,.08)}.tab-mark{width:16px;height:16px}.tab-close{margin-left:auto;color:var(--muted)}.notes{display:grid;grid-template-columns:repeat(4,1fr);margin:0}.notes div{padding:14px 18px;border-right:1px solid var(--line)}.notes div:last-child{border-right:0}.notes dt{font:700 10px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}.notes dd{margin:6px 0 0}@media(max-width:900px){.page-head{align-items:start;flex-direction:column}.proof-cell{border-bottom:1px solid var(--line)}.contexts,.notes{grid-template-columns:1fr}.wordmark-lockup{border-right:0;border-bottom:1px solid var(--line)}.notes div{border-right:0;border-bottom:1px solid var(--line)}}
</style>
</head>
<body>
<main>
  <header class="page-head"><h1>${escapeHtml(campaign.project)} mark proofs</h1><p>Mechanically validated candidates at declared sizes and both grounds. This sheet contains no audience-recognition evidence and makes no authorship or trademark claim.</p></header>
  ${cards}
</main>
</body>
</html>\n`;
}

function publicReport(campaign) {
  return {
    schema: campaign.manifest?.schema ?? null,
    project: campaign.project,
    candidates: campaign.candidates.map((candidate) => ({
      id: candidate.id,
      master: candidate.master ? {
        pathCount: candidate.master.pathCount,
        commandCount: candidate.master.commandCount,
        coordinateCount: candidate.master.coordinateCount,
        components: candidate.master.components,
      } : null,
      export: candidate.export ? {
        pathCount: candidate.export.pathCount,
        commandCount: candidate.export.commandCount,
        coordinateCount: candidate.export.coordinateCount,
      } : null,
      renderParity: candidate.renderParity,
    })),
    errors: campaign.errors,
    warnings: campaign.warnings,
    rasterVisibilityVerdict: null,
    claimsNotMade: [
      'authorship',
      'recognition',
      'preference',
      'trademark-clearance',
      'component-semantic-correctness',
      'nonempty-raster-output',
      'renderer-pixel-equivalence',
    ],
  };
}

function usage() {
  return `Usage:
  node logo.mjs check <campaign.json>
  node logo.mjs proof <campaign.json> --output <proof.html>
  node logo.mjs propagate <project-dir>

The check is mechanical. It never claims human authorship, audience recognition,
preference, originality, or trademark clearance. Propagation is read-only and
calls the signature-aware mark checker.`;
}

function parseCli(argv) {
  const [command, manifest, ...rest] = argv;
  let output = null;
  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] === '--output') {
      output = rest[index + 1] ?? null;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${rest[index]}`);
    }
  }
  return { command, manifest, output };
}

function canonicalPath(target) {
  if (fs.existsSync(target)) return fs.realpathSync(target);
  return path.join(fs.realpathSync(path.dirname(target)), path.basename(target));
}

function assertSafeProofOutput(output, campaign) {
  const protectedFiles = new Set([
    campaign.manifestPath,
    ...campaign.candidates.flatMap((candidate) => [candidate.masterPath, candidate.exportPath]),
  ].filter(Boolean).map((file) => fs.realpathSync(file)));
  const canonicalOutput = canonicalPath(output);
  if (protectedFiles.has(canonicalOutput)) throw new Error('proof output must not overwrite the campaign manifest, a master, or an export.');
}

function atomicWrite(output, contents) {
  const temporary = `${output}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temporary, contents, { flag: 'wx' });
    fs.renameSync(temporary, output);
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary);
  }
}

function runCli(argv) {
  let args;
  try {
    args = parseCli(argv);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    return 2;
  }

  if (!['check', 'proof', 'propagate'].includes(args.command) || !args.manifest) {
    process.stderr.write(`${usage()}\n`);
    return 2;
  }

  if (args.command === 'propagate') {
    const report = propagationTargets(path.resolve(args.manifest));
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return report.findings.some((finding) => finding.severity === 'fail') ? 1 : 0;
  }

  const campaign = loadAndValidateCampaign(args.manifest);
  if (args.command === 'check') {
    process.stdout.write(`${JSON.stringify(publicReport(campaign), null, 2)}\n`);
    return campaign.errors.length ? 1 : 0;
  }

  if (!args.output) {
    process.stderr.write(`proof requires --output.\n${usage()}\n`);
    return 2;
  }
  if (campaign.errors.length) {
    process.stderr.write(`${JSON.stringify(publicReport(campaign), null, 2)}\n`);
    return 1;
  }

  const output = path.resolve(args.output);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  try {
    assertSafeProofOutput(output, campaign);
    atomicWrite(output, renderProofSheet(campaign));
  } catch (error) {
    process.stderr.write(`${error?.message ?? String(error)}\n`);
    return 1;
  }
  process.stdout.write(`${output}\n`);
  return 0;
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entry === fileURLToPath(import.meta.url)) process.exitCode = runCli(process.argv.slice(2));
