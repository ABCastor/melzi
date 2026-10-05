import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { findEngineBinary, engineEnv, ENGINE_MISSING_MESSAGE } from './lib/engine-bin.mjs';
const ENGINE = findEngineBinary();
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';

import { SKILL_CATEGORIES } from '../scripts/lib/skill-categories.js';
import { MELZI_COMMAND_ALIASES, replacePlaceholders } from '../scripts/lib/utils.js';
import {
  MANIFEST_SCHEMA,
  loadAndValidateCampaign,
  renderProofSheet,
  validateSvgSource,
} from '../skill/scripts/melzi/logo.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const temporary = [];

afterEach(() => {
  for (const dir of temporary.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function makeCampaign({ exportSvg, masterSvg, candidate = {}, rules = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'melzi-logo-'));
  temporary.push(dir);
  fs.mkdirSync(path.join(dir, 'svg'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'masters'), { recursive: true });

  const source = masterSvg ?? `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
      <path id="form-a" fill="none" d="M2 4h10v16H2z"/>
      <path id="form-b" fill="none" d="M8 6h14v12H8z"/>
      <path id="overlap" fill="none" d="M8 6h4v12H8z"/>
      <path d="M2 4h10v16H2z M8 6h14v12H8z M8 6h4v12H8z"/>
    </svg>`;
  const flattened = exportSvg ?? `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
      <path d="M2 4h10v16H2z M8 6h14v12H8z M8 6h4v12H8z"/>
    </svg>`;
  fs.writeFileSync(path.join(dir, 'masters', 'c01.svg'), source);
  fs.writeFileSync(path.join(dir, 'svg', 'c01.svg'), flattened);

  const manifest = {
    schema: MANIFEST_SCHEMA,
    project: 'Example',
    wordmark: 'Example',
    rules: {
      viewBox: '0 0 24 24',
      currentColorOnly: true,
      requireComponentMaster: true,
      requiredComponents: ['form-a', 'form-b', 'overlap'],
      preferredMaxExportPaths: 1,
      proofSizes: [96, 32, 16],
      ...rules,
    },
    candidates: [{
      id: 'c01',
      name: 'Joined blocks',
      master: 'masters/c01.svg',
      export: 'svg/c01.svg',
      primaryReading: 'two joined blocks',
      secondaryReading: 'a third shared strip',
      fusion: 'the shared strip is explicit intersection geometry',
      construction: ['draw the wider block', 'cross it with the lower block', 'retain the shared strip'],
      smallSize: 'the strip remains two device pixels wide at 16px',
      confusion: 'a chain link',
      motion: 'the blocks approach and the strip appears',
      objection: 'the construction is generic',
      lineage: {
        parents: [],
        change: 'first construction',
        hypothesis: 'an explicit seam makes the bond visible',
        evidence: ['mechanical render pending human recognition'],
      },
      status: 'generated',
      ...candidate,
    }],
  };
  const manifestPath = path.join(dir, 'campaign.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { dir, manifestPath };
}

describe('logo SVG validation', () => {
  it('accepts a deliberate currentColor SVG and reports production facts without guessing authorship', () => {
    const report = validateSvgSource(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M2 2h20v20H2z"/></svg>',
      { expectedViewBox: '0 0 24 24', currentColorOnly: true },
    );

    assert.deepEqual(report.errors, []);
    assert.equal(report.pathCount, 1);
    assert.ok(report.commandCount >= 5);
    assert.equal(report.authorshipVerdict, null, 'geometry cannot prove who made the mark');
    assert.equal(report.rasterVisibilityVerdict, null, 'structure cannot prove rendered pixels');
  });

  it('rejects renderer-dependent, executable, raster and network content', () => {
    for (const [label, fragment] of [
      ['script', '<script>alert(1)</script>'],
      ['raster', '<image href="data:image/png;base64,AA=="/>'],
      ['filter', '<filter id="f"/>'],
      ['external reference', '<use href="https://example.com/a.svg#x"/>'],
      ['animation', '<animate attributeName="fill" values="red;blue"/>'],
      ['set animation', '<set attributeName="fill" to="red"/>'],
      ['extra geometry', '<rect width="24" height="24"/>'],
    ]) {
      const report = validateSvgSource(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">${fragment}<path d="M0 0h1v1z"/></svg>`,
        { expectedViewBox: '0 0 24 24', currentColorOnly: true },
      );
      assert.ok(report.errors.length > 0, `${label} passed`);
    }
  });

  it('rejects a fixed visible colour when the project requires currentColor', () => {
    const report = validateSvgSource(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#000"><path d="M0 0h24v24z"/></svg>',
      { expectedViewBox: '0 0 24 24', currentColorOnly: true },
    );
    assert.match(report.errors.join('\n'), /currentColor/i);
  });

  it('keeps renderer visibility outside the structural validator', () => {
    const filledLine = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M0 0L24 24"/></svg>';
    const filledLineReport = validateSvgSource(filledLine, { currentColorOnly: true });
    assert.deepEqual(filledLineReport.errors, []);
    assert.equal(filledLineReport.rasterVisibilityVerdict, null);

    const crossedDegenerateSubpaths = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M0 0L24 24M0 24L24 0Z"/></svg>';
    assert.equal(validateSvgSource(crossedDegenerateSubpaths, { currentColorOnly: true }).rasterVisibilityVerdict, null);

    const closedTriangle = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M2 2L22 2L12 22Z"/></svg>';
    assert.deepEqual(validateSvgSource(closedTriangle, { currentColorOnly: true }).errors, []);

    const strokedLine = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M0 0L24 24"/></svg>';
    assert.deepEqual(validateSvgSource(strokedLine, { currentColorOnly: true }).errors, []);

    const zeroLengthStroke = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M2 2L2 2"/></svg>';
    assert.equal(validateSvgSource(zeroLengthStroke, { currentColorOnly: true }).rasterVisibilityVerdict, null);

    const transparentPaint = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" opacity="0"><path d="M2 2L22 2L12 22Z"/></svg>';
    assert.match(validateSvgSource(transparentPaint, { currentColorOnly: true }).errors.join('\n'), /non-zero paint channel|raster visibility/i);

    const closedArc = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2A10 10 0 0 1 12 22A10 10 0 0 1 12 2Z"/></svg>';
    assert.deepEqual(validateSvgSource(closedArc, { currentColorOnly: true }).errors, []);
  });

  it('rejects inline styles, transforms, default-black paint and malformed path data', () => {
    for (const [label, source] of [
      ['inline style', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path style="fill:red" d="M0 0h1v1z"/></svg>'],
      ['transform', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path transform="translate(1)" d="M0 0h1v1z"/></svg>'],
      ['default black', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0h1v1z"/></svg>'],
      ['bad path', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="x"/></svg>'],
    ]) {
      const report = validateSvgSource(source, { expectedViewBox: '0 0 24 24', currentColorOnly: true });
      assert.ok(report.errors.length > 0, `${label} passed`);
    }
  });

  it('rejects commented geometry, non-direct paths and renderer-invalid path syntax', () => {
    const cases = [
      ['commented path', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><!-- <path d="M0 0h1v1z"/> --></svg>'],
      ['nested path', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><g><path d="M0 0h1v1z"/></g></svg>'],
      ['uppercase path element', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><PATH d="M0 0h1v1z"/></svg>'],
      ['double comma', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M0 0,,L2 2z"/></svg>'],
      ['NBSP path separator', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M0\u00a00h2v2z"/></svg>'],
      ['vertical-tab path separator', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M0\u000b0h2v2z"/></svg>'],
      ['trailing-dot path number', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M0 0L2 2.z"/></svg>'],
      ['non-finite number', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M1e999 0L2 2z"/></svg>'],
      ['move only', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M0 0"/></svg>'],
    ];

    for (const [label, source] of cases) {
      const report = validateSvgSource(source, { expectedViewBox: '0 0 24 24', currentColorOnly: true });
      assert.ok(report.errors.length > 0, `${label} passed`);
      if (label === 'commented path') assert.equal(report.pathCount, 0);
    }
  });

  it('rejects invalid viewBoxes and presentation values', () => {
    for (const [label, viewBox, attributes] of [
      ['zero width', '0 0 0 24', ''],
      ['nonnumeric viewBox', 'not-a-viewbox', ''],
      ['double-comma viewBox', '0,,0,24,24', ''],
      ['trailing-comma viewBox', '0 0 24 24,', ''],
      ['trailing-dot viewBox', '0 0 24 24.', ''],
      ['hexadecimal viewBox', '0 0 0x18 24', ''],
      ['binary viewBox', '0 0 0b11000 24', ''],
      ['non-XML whitespace viewBox', '0\u00a00 24 24', ''],
      ['opacity over one', '0 0 24 24', ' opacity="2"'],
      ['negative fill opacity', '0 0 24 24', ' fill-opacity="-0.1"'],
      ['percentage opacity', '0 0 24 24', ' opacity="0%"'],
      ['trailing-dot fill opacity', '0 0 24 24', ' fill-opacity="0."'],
      ['trailing-dot stroke width', '0 0 24 24', ' stroke="currentColor" stroke-width="2."'],
      ['trailing-dot miter limit', '0 0 24 24', ' stroke="currentColor" stroke-miterlimit="4."'],
      ['trailing-dot dash offset', '0 0 24 24', ' stroke="currentColor" stroke-dashoffset="2."'],
      ['trailing-dot dash array', '0 0 24 24', ' stroke="currentColor" stroke-dasharray="2."'],
      ['NBSP dash array', '0 0 24 24', ' stroke="currentColor" stroke-dasharray="2\u00a03"'],
      ['nonnumeric stroke width', '0 0 24 24', ' fill="none" stroke="currentColor" stroke-width="NaN"'],
    ]) {
      const report = validateSvgSource(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" fill="currentColor"><path${attributes} d="M0 0h2v2z"/></svg>`,
        { currentColorOnly: true },
      );
      assert.ok(report.errors.length > 0, `${label} passed`);
    }
  });

  it('requires a standalone SVG namespace and rejects malformed or context-dependent paint', () => {
    for (const [label, source] of [
      ['missing namespace', '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M0 0h2v2z"/></svg>'],
      ['uppercase root', '<SVG xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M0 0h2v2z"/></SVG>'],
      ['wrong namespace', '<svg xmlns="https://example.com/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M0 0h2v2z"/></svg>'],
      ['raw ampersand', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path id="a&b" d="M0 0h2v2z"/></svg>'],
      ['adjacent root attributes', '<svg xmlns="http://www.w3.org/2000/svg"viewBox="0 0 24 24"fill="currentColor"><path d="M0 0h2v2z"/></svg>'],
      ['adjacent path attributes', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path id="artwork"d="M0 0h2v2z"/></svg>'],
      ['repeated self-close slash', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path //// d="M0 0h2v2z"/></svg>'],
      ['space after self-close slash', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M0 0h2v2z"/ ></svg>'],
      ['space-padded id', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path id=" artwork " d="M0 0h2v2z"/></svg>'],
      ['NBSP-padded id', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path id="artwork\u00a0" d="M0 0h2v2z"/></svg>'],
      ['XML declaration', '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M0 0h2v2z"/></svg>'],
      ['CSS variable', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="var(--missing)"><path d="M0 0h2v2z"/></svg>'],
      ['malformed rgb', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="rgb(255,,0,0)"><path d="M0 0h2v2z"/></svg>'],
      ['NBSP rgb', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="rgb(255\u00a00\u00a00)"><path d="M0 0h2v2z"/></svg>'],
      ['NBSP hsl', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="hsl(0\u00a0100%\u00a050%)"><path d="M0 0h2v2z"/></svg>'],
      ['mixed comma rgb channels', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="rgb(10%, 20, 30%)"><path d="M0 0h2v2z"/></svg>'],
      ['mixed comma rgba channels', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="rgba(10%, 20, 30%, 50%)"><path d="M0 0h2v2z"/></svg>'],
      ['trailing-dot rgb', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="rgb(255. 0 0)"><path d="M0 0h2v2z"/></svg>'],
      ['trailing-dot alpha', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="rgba(255,0,0,1.)"><path d="M0 0h2v2z"/></svg>'],
      ['trailing-dot hue', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="hsl(0. 100% 50%)"><path d="M0 0h2v2z"/></svg>'],
    ]) {
      const report = validateSvgSource(source);
      assert.ok(report.errors.length > 0, `${label} passed`);
    }
  });

  it('loads an accepted standalone export as an image', async () => {
    const source = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M0 0h24v24z"/></svg>';
    assert.deepEqual(validateSvgSource(source).errors, []);
    for (const invalidViewBox of ['0 0 0x18 24', '0 0 0b11000 24', '0\u00a00 24 24', '0 0 24 24.']) {
      const invalid = source.replace('0 0 24 24', invalidViewBox);
      assert.match(validateSvgSource(invalid).errors.join('\n'), /SVG decimal numbers/);
    }
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const encoded = `data:image/svg+xml,${encodeURIComponent(source)}`;
      await page.setContent(`<img id="mark" src="${encoded}" alt="">`);
      await page.locator('#mark').evaluate((image) => image.decode());
      const [width, height] = await page.locator('#mark').evaluate((image) => [image.naturalWidth, image.naturalHeight]);
      assert.ok(width > 0);
      assert.equal(width, height);

      await page.setContent('<svg id="invalid-viewbox" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24."><path d="M0 0h24v24z"/></svg>');
      const invalidDimensions = await page.locator('#invalid-viewbox').evaluate((svg) => [
        svg.viewBox.baseVal.width,
        svg.viewBox.baseVal.height,
      ]);
      assert.deepEqual(invalidDimensions, [0, 0], 'Chromium must confirm why the validator rejects trailing-dot viewBox numbers');

      await page.setContent(`
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
          <path id="valid-paint" fill="rgb(255 0 0)" d="M0 0h12v24z"/>
          <path id="invalid-paint" fill="rgb(255. 0 0)" d="M12 0h12v24z"/>
          <path id="invalid-nbsp-rgb" fill="rgb(255\u00a00\u00a00)" d="M0 0h12v24z"/>
          <path id="invalid-nbsp-hsl" fill="hsl(0\u00a0100%\u00a050%)" d="M12 0h12v24z"/>
          <path id="invalid-mixed-rgb" fill="rgb(10%, 20, 30%)" d="M0 0h12v24z"/>
          <path id="invalid-mixed-rgba" fill="rgba(10%, 20, 30%, 50%)" d="M12 0h12v24z"/>
        </svg>
      `);
      const paints = await page.locator('path').evaluateAll((paths) => paths.map((path) => getComputedStyle(path).fill));
      assert.deepEqual(
        paints,
        ['rgb(255, 0, 0)', 'rgb(0, 0, 0)', 'rgb(0, 0, 0)', 'rgb(0, 0, 0)', 'rgb(0, 0, 0)', 'rgb(0, 0, 0)'],
        'Chromium must confirm invalid trailing-dot and NBSP paint falls back to black',
      );

      await page.setContent(`
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
          <path id="invalid-opacity" fill="currentColor" fill-opacity="0." d="M0 0h12v24z"/>
          <path id="invalid-stroke" fill="none" stroke="currentColor" stroke-width="2." stroke-dasharray="2." d="M12 0v24"/>
          <path id="invalid-nbsp-dash" fill="none" stroke="currentColor" stroke-dasharray="2\u00a03" d="M6 0v24"/>
        </svg>
      `);
      const presentation = await page.locator('path').evaluateAll((paths) => paths.map((path) => {
        const style = getComputedStyle(path);
        return [style.fillOpacity, style.strokeWidth, style.strokeDasharray];
      }));
      assert.deepEqual(
        presentation,
        [['1', '1px', 'none'], ['1', '1px', 'none'], ['1', '1px', 'none']],
        'Chromium must confirm invalid trailing-dot presentation values fall back to visible defaults',
      );

      const rendererBoundary = await page.evaluate(async (sources) => {
        async function raster(source) {
          const image = new Image();
          image.src = `data:image/svg+xml,${encodeURIComponent(source)}`;
          try {
            await image.decode();
          } catch {
            return { decoded: false, alpha: 0 };
          }
          const canvas = document.createElement('canvas');
          canvas.width = 24;
          canvas.height = 24;
          const context = canvas.getContext('2d');
          context.drawImage(image, 0, 0, 24, 24);
          const pixels = context.getImageData(0, 0, 24, 24).data;
          let alpha = 0;
          for (let index = 3; index < pixels.length; index += 4) alpha += pixels[index];
          return { decoded: true, alpha };
        }
        return Object.fromEntries(await Promise.all(Object.entries(sources).map(async ([key, value]) => [key, await raster(value)])));
      }, {
        valid: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="red"><path d="M0 0h24v24z"/></svg>',
        uppercasePath: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="red"><PATH d="M0 0h24v24z"/></svg>',
        nbspPath: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="red"><path d="M0\u00a00h24v24z"/></svg>',
        uppercaseRoot: '<SVG xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="red"><path d="M0 0h24v24z"/></SVG>',
        rawAmpersand: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="red"><path id="a&b" d="M0 0h24v24z"/></svg>',
        adjacentAttributes: '<svg xmlns="http://www.w3.org/2000/svg"viewBox="0 0 24 24"fill="red"><path d="M0 0h24v24z"/></svg>',
        repeatedSlash: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="red"><path //// d="M0 0h24v24z"/></svg>',
        filledLine: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="red"><path d="M0 0L24 24"/></svg>',
      });
      assert.ok(rendererBoundary.valid.decoded && rendererBoundary.valid.alpha > 0);
      assert.equal(rendererBoundary.uppercasePath.alpha, 0, 'Chromium treats uppercase PATH as non-SVG and renders no geometry');
      assert.equal(rendererBoundary.nbspPath.alpha, 0, 'Chromium rejects NBSP as path-data whitespace and renders no geometry');
      assert.equal(rendererBoundary.uppercaseRoot.decoded, false, 'Chromium rejects uppercase SVG as a standalone image root');
      assert.equal(rendererBoundary.rawAmpersand.decoded, false, 'Chromium rejects XML with an unescaped ampersand');
      assert.equal(rendererBoundary.adjacentAttributes.decoded, false, 'Chromium rejects attributes with no XML whitespace separator');
      assert.equal(rendererBoundary.repeatedSlash.decoded, false, 'Chromium rejects repeated self-close slashes');
      assert.ok(rendererBoundary.filledLine.decoded && rendererBoundary.filledLine.alpha === 0, 'Chromium decodes a fill-only line but renders zero ink');
    } finally {
      await browser.close();
    }
  });
});

describe('logo campaign validation', () => {
  it('validates the editable component master, flattened export, notes and lineage together', () => {
    const { manifestPath } = makeCampaign();
    const result = loadAndValidateCampaign(manifestPath);

    assert.deepEqual(result.errors, []);
    assert.equal(result.candidates.length, 1);
    assert.deepEqual(result.candidates[0].master.components, ['form-a', 'form-b', 'overlap']);
    assert.equal(result.candidates[0].export.pathCount, 1);
    assert.equal(result.candidates[0].renderParity, true);
  });

  it('treats the preferred one-path export as advisory rather than a design-quality law', () => {
    const { manifestPath } = makeCampaign({
      masterSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path id="form-a" fill="none" d="M2 4h10v16H2z"/><path id="form-b" fill="none" d="M8 6h14v12H8z"/><path id="overlap" fill="none" d="M8 6h4v12H8z"/><path d="M2 4h10v16H2z"/><path d="M8 6h14v12H8z M8 6h4v12H8z"/></svg>',
      exportSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M2 4h10v16H2z"/><path d="M8 6h14v12H8z M8 6h4v12H8z"/></svg>',
    });
    const result = loadAndValidateCampaign(manifestPath);

    assert.deepEqual(result.errors, []);
    assert.match(result.warnings.join('\n'), /preferred maximum.*1 path/i);
  });

  it('fails missing component geometry and empty decision lineage', () => {
    const { manifestPath } = makeCampaign({
      masterSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path id="form-a" d="M0 0h12v12z"/></svg>',
      candidate: { lineage: { parents: [], change: '', hypothesis: '', evidence: [] } },
    });
    const result = loadAndValidateCampaign(manifestPath);

    assert.match(result.errors.join('\n'), /form-b/);
    assert.match(result.errors.join('\n'), /overlap/);
    assert.match(result.errors.join('\n'), /lineage\.change/);
    assert.match(result.errors.join('\n'), /lineage\.hypothesis/);
  });

  it('fails when the source and flattened export do not carry the same path geometry', () => {
    const { manifestPath } = makeCampaign({
      exportSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M2 4h10v16H2z"/></svg>',
    });
    const result = loadAndValidateCampaign(manifestPath);

    assert.match(result.errors.join('\n'), /render parity/i);
  });

  it('requires exact rule types and a real component list', () => {
    for (const rules of [
      { currentColorOnly: 'false' },
      { proofSizes: ['16'] },
      { requireComponentMaster: true, requiredComponents: [] },
      { requiredComponents: ['form-a', 'form-a'] },
      { requireComponentMaster: true, requiredComponents: ['left', 'right', 'junction'] },
      { viewBox: 'not-a-viewbox' },
      { unknownRule: true },
    ]) {
      const { manifestPath } = makeCampaign({ rules });
      assert.ok(loadAndValidateCampaign(manifestPath).errors.length > 0, JSON.stringify(rules));
    }
  });

  it('validates lineage references, self-parenting and cycles', () => {
    const { dir, manifestPath } = makeCampaign({ candidate: { lineage: {
      parents: ['missing'], change: 'revision', hypothesis: 'test', evidence: ['pending'],
    } } });
    const missing = loadAndValidateCampaign(manifestPath);
    assert.match(missing.errors.join('\n'), /does not exist/);

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.candidates[0].lineage.parents = ['c01'];
    fs.writeFileSync(path.join(dir, 'campaign.json'), JSON.stringify(manifest));
    assert.match(loadAndValidateCampaign(manifestPath).errors.join('\n'), /own ID|cycle/);
  });

  it('reports an invalid lineage parent type instead of throwing', () => {
    const { manifestPath } = makeCampaign({ candidate: { lineage: {
      parents: 123, change: 'revision', hypothesis: 'test', evidence: ['pending'],
    } } });

    assert.doesNotThrow(() => loadAndValidateCampaign(manifestPath));
    assert.match(loadAndValidateCampaign(manifestPath).errors.join('\n'), /lineage\.parents must be an array/);
  });

  it('rejects duplicate component IDs and move-only component placeholders', () => {
    const duplicate = makeCampaign({
      masterSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path id="form-a" fill="none" d="M0 0h1v1z"/><path id="form-a" fill="none" d="M1 1h1v1z"/><path id="form-b" fill="none" d="M2 2h1v1z"/><path id="overlap" fill="none" d="M3 3h1v1z"/><path d="M2 4h10v16H2z M8 6h14v12H8z M8 6h4v12H8z"/></svg>',
    });
    assert.match(loadAndValidateCampaign(duplicate.manifestPath).errors.join('\n'), /duplicated|exactly once/);

    const moveOnly = makeCampaign({
      masterSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path id="form-a" fill="none" d="M0 0"/><path id="form-b" fill="none" d="M2 2h1v1z"/><path id="overlap" fill="none" d="M3 3h1v1z"/><path d="M2 4h10v16H2z M8 6h14v12H8z M8 6h4v12H8z"/></svg>',
    });
    assert.match(loadAndValidateCampaign(moveOnly.manifestPath).errors.join('\n'), /drawing command/);
  });

  it('does not merge separate same-style paths when checking render parity', () => {
    const { manifestPath } = makeCampaign({
      masterSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path id="form-a" fill="none" d="M0 0h1v1z"/><path id="form-b" fill="none" d="M1 1h1v1z"/><path id="overlap" fill="none" d="M1 0h1v1z"/><path opacity="0.5" d="M2 2h10v10H2z"/><path opacity="0.5" d="M8 8h10v10H8z"/></svg>',
      exportSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path opacity="0.5" d="M2 2h10v10H2z M8 8h10v10H8z"/></svg>',
    });

    assert.match(loadAndValidateCampaign(manifestPath).errors.join('\n'), /render parity/);
  });

  it('does not normalize malformed paint into a false parity pass', () => {
    const { manifestPath } = makeCampaign({
      rules: { currentColorOnly: false },
      masterSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path id="form-a" fill="none" d="M2 4h10v16H2z"/><path id="form-b" fill="none" d="M8 6h14v12H8z"/><path id="overlap" fill="none" d="M8 6h4v12H8z"/><path fill="rgb(255,,0,0)" d="M2 4h10v16H2z M8 6h14v12H8z M8 6h4v12H8z"/></svg>',
      exportSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path fill="rgb(255 0 0)" d="M2 4h10v16H2z M8 6h14v12H8z M8 6h4v12H8z"/></svg>',
    });
    const result = loadAndValidateCampaign(manifestPath);

    assert.match(result.errors.join('\n'), /self-contained colour/);
    assert.equal(result.candidates[0].renderParity, false);
    assert.match(result.errors.join('\n'), /render parity/);
  });

  it('rejects campaign assets that escape through a symbolic link', () => {
    const { dir, manifestPath } = makeCampaign();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'melzi-logo-outside-'));
    temporary.push(outside);
    const outsideSvg = path.join(outside, 'outside.svg');
    fs.writeFileSync(outsideSvg, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M0 0h24v24z"/></svg>');
    fs.rmSync(path.join(dir, 'masters', 'c01.svg'));
    fs.symlinkSync(outsideSvg, path.join(dir, 'masters', 'c01.svg'));

    assert.match(loadAndValidateCampaign(manifestPath).errors.join('\n'), /symbolic link/);
  });

  it('rejects required component placeholders outside the artwork', () => {
    const { manifestPath } = makeCampaign({
      masterSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path id="form-a" fill="none" d="M100 100h10v10z"/><path id="form-b" fill="none" d="M100 100h10v10z"/><path id="overlap" fill="none" d="M100 100h10v10z"/><path d="M2 4h10v16H2z M8 6h14v12H8z M8 6h4v12H8z"/></svg>',
    });

    assert.match(loadAndValidateCampaign(manifestPath).errors.join('\n'), /outside the SVG viewBox|does not intersect any paint-bearing path/);
  });

  it('rejects component placeholders in the empty gap between painted paths', () => {
    const masterSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path id="form-a" fill="none" d="M10 10h1v1z"/><path id="form-b" fill="none" d="M10 10h1v1z"/><path id="overlap" fill="none" d="M10 10h1v1z"/><path d="M1 1h2v2H1z"/><path d="M20 20h2v2h-2z"/></svg>';
    const exportSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M1 1h2v2H1z"/><path d="M20 20h2v2h-2z"/></svg>';
    const { manifestPath } = makeCampaign({ masterSvg, exportSvg });
    const report = loadAndValidateCampaign(manifestPath);

    assert.equal(report.candidates[0].renderParity, true);
    assert.match(report.errors.join('\n'), /does not intersect any paint-bearing path bounds/);
  });

  it('rejects outside arc components whose radius envelope crosses the viewBox', () => {
    const { manifestPath } = makeCampaign({
      masterSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path id="form-a" fill="none" d="M100 10A100 100 0 0 0 110 10"/><path id="form-b" fill="none" d="M100 10A100 100 0 0 0 110 10"/><path id="overlap" fill="none" d="M100 10A100 100 0 0 0 110 10"/><path d="M2 4h10v16H2z M8 6h14v12H8z M8 6h4v12H8z"/></svg>',
    });

    assert.match(loadAndValidateCampaign(manifestPath).errors.join('\n'), /anchor inside the SVG viewBox/);
  });

  it('does not treat an in-view curve control as an in-view component anchor', () => {
    const { manifestPath } = makeCampaign({
      masterSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path id="form-a" fill="none" d="M100 100C10 10 10 10 110 110"/><path id="form-b" fill="none" d="M100 100C10 10 10 10 110 110"/><path id="overlap" fill="none" d="M100 100C10 10 10 10 110 110"/><path d="M2 4h10v16H2z M8 6h14v12H8z M8 6h4v12H8z"/></svg>',
    });

    assert.match(loadAndValidateCampaign(manifestPath).errors.join('\n'), /anchor inside the SVG viewBox/);
  });

  it('marks parity false when either SVG is invalid', () => {
    const { manifestPath } = makeCampaign({
      exportSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0,,0,24,24" fill="currentColor"><path d="M2 4h10v16H2z M8 6h14v12H8z M8 6h4v12H8z"/></svg>',
    });
    const result = loadAndValidateCampaign(manifestPath);

    assert.match(result.errors.join('\n'), /SVG decimal numbers/);
    assert.equal(result.candidates[0].renderParity, false);
  });

  it('allows a deliberately single-reading mark without fabricated secondary prose', () => {
    const { manifestPath } = makeCampaign({ candidate: { secondaryReading: null } });
    const result = loadAndValidateCampaign(manifestPath);
    assert.deepEqual(result.errors, []);
    assert.doesNotMatch(renderProofSheet(result), /Second read/);
  });

  it('the component-master fixture and export rasterize identically at proof sizes', async () => {
    const { manifestPath } = makeCampaign();
    const campaign = loadAndValidateCampaign(manifestPath);
    assert.equal(campaign.candidates[0].renderParity, true);
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ deviceScaleFactor: 1 });
      for (const size of [96, 16]) {
        await page.setContent(`<style>.mark{display:inline-block;width:${size}px;height:${size}px;color:#111;background:#fff}.mark svg{display:block;width:100%;height:100%}</style><div class="mark" id="master">${campaign.candidates[0].masterSource}</div><div class="mark" id="export">${campaign.candidates[0].exportSource}</div>`);
        const master = await page.locator('#master').screenshot();
        const exported = await page.locator('#export').screenshot();
        assert.deepEqual(master, exported, `raster mismatch at ${size}px`);
      }
    } finally {
      await browser.close();
    }
  });
});

describe('static proof sheet', () => {
  it('is self-contained, script-free and declares both grounds at every requested size', () => {
    const { manifestPath } = makeCampaign();
    const campaign = loadAndValidateCampaign(manifestPath);
    const html = renderProofSheet(campaign);

    assert.doesNotMatch(html, /<script\b/i);
    assert.doesNotMatch(html, /https?:\/\//i);
    assert.doesNotMatch(html, /<img\b/i, 'proofs inline the validated vector instead of requesting an asset');
    assert.match(html, /<link rel="icon" href="data:,">/, 'proofs suppress the browser favicon request without a network dependency');
    assert.match(html, /data-size="96"/);
    assert.match(html, /data-size="32"/);
    assert.match(html, /data-size="16"/);
    assert.match(html, /data-ground="light"/);
    assert.match(html, /data-ground="dark"/);
    assert.match(html, /class="wordmark"[^>]*>Example</);
    assert.match(html, /class="browser-tab"/);
    assert.match(html, /Joined blocks/);
  });

  it('does not silently cap declared proof sizes at 96 pixels', () => {
    const { manifestPath } = makeCampaign({ rules: { proofSizes: [192] } });
    const html = renderProofSheet(loadAndValidateCampaign(manifestPath));

    assert.match(html, /--proof-size:192px/);
    assert.doesNotMatch(html, /max-(?:width|height):96px/);
  });

  it('contains a 1024px proof in a scrollable row without cell overlap', async () => {
    const { manifestPath } = makeCampaign({ rules: { proofSizes: [1024] } });
    const html = renderProofSheet(loadAndValidateCampaign(manifestPath));
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1480, height: 900 } });
      await page.setContent(html);
      const metrics = await page.evaluate(() => {
        const grid = document.querySelector('.proof-grid');
        const cells = [...document.querySelectorAll('.proof-cell')].map((cell) => cell.getBoundingClientRect());
        const mark = document.querySelector('.mark').getBoundingClientRect();
        return {
          mark: [mark.width, mark.height],
          scrollable: grid.scrollWidth > grid.clientWidth,
          firstRight: cells[0].right,
          secondLeft: cells[1].left,
        };
      });
      assert.deepEqual(metrics.mark, [1024, 1024]);
      assert.equal(metrics.scrollable, true);
      assert.ok(metrics.firstRight <= metrics.secondLeft, JSON.stringify(metrics));
    } finally {
      await browser.close();
    }
  });

  it('the CLI writes only the explicit proof path after a clean validation', () => {
    const { dir, manifestPath } = makeCampaign();
    const proof = path.join(dir, 'explicit-proof.html');
    const result = spawnSync(process.execPath, [
      path.join(ROOT, 'skill/scripts/melzi/logo.mjs'),
      'proof', manifestPath, '--output', proof,
    ], { encoding: 'utf8' });

    assert.equal(result.status, 0, result.stderr);
    assert.ok(fs.existsSync(proof));
    assert.match(result.stdout, /explicit-proof\.html/);
  });

  it('refuses to overwrite a campaign input with proof HTML', () => {
    const { manifestPath } = makeCampaign();
    const before = fs.readFileSync(manifestPath);
    const result = spawnSync(process.execPath, [
      path.join(ROOT, 'skill/scripts/melzi/logo.mjs'),
      'proof', manifestPath, '--output', manifestPath,
    ], { encoding: 'utf8' });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /must not overwrite/);
    assert.deepEqual(fs.readFileSync(manifestPath), before);
  });
});

describe('mark propagation caller', () => {
  it('calls the signature-aware propagation scan and fails on an unbranded mark asset', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'melzi-logo-propagate-'));
    temporary.push(root);
    const home = path.join(root, 'home');
    const project = path.join(root, 'project');
    fs.mkdirSync(path.join(home, '.impeccable'), { recursive: true });
    fs.mkdirSync(project, { recursive: true });
    fs.writeFileSync(path.join(home, '.impeccable', 'signature.json'), JSON.stringify({
      invariants: {
        primary: { value: '#FD4E5A', role: 'The leading mark colour.' },
        neutrals: { bgLight: '#FFFFFF', bgDark: '#1A1A1A' },
      },
    }));
    const page = path.join(project, 'index.html');
    fs.writeFileSync(page, '<svg viewBox="0 0 24 24"><path fill="#FD4E5A" d="M0 0h24v24H0z"/></svg>');

    const clean = spawnSync(process.execPath, [
      path.join(ROOT, 'skill/scripts/melzi/logo.mjs'), 'propagate', project,
    ], { encoding: 'utf8', env: { ...process.env, HOME: home } });
    assert.equal(clean.status, 0, clean.stderr);
    assert.equal(JSON.parse(clean.stdout).candidates.length, 1);

    fs.writeFileSync(page, '<svg viewBox="0 0 24 24"><path fill="#00FF00" d="M0 0h24v24H0z"/></svg>');
    const drifted = spawnSync(process.execPath, [
      path.join(ROOT, 'skill/scripts/melzi/logo.mjs'), 'propagate', project,
    ], { encoding: 'utf8', env: { ...process.env, HOME: home } });
    assert.equal(drifted.status, 1, drifted.stderr);
    assert.ok(JSON.parse(drifted.stdout).findings.some(({ id }) => id === 'propagation-unbranded-asset'));
  });
});

describe('/melzi logo registration', () => {
  it('remains a routed and pinnable alias into identity instead of a second front door', () => {
    const row = read('skill/SKILL.src.md').split('\n').find((line) => line.startsWith('| `logo'));
    assert.equal(row, undefined);
    assert.match(read('skill/SKILL.src.md'), /^  - `logo` → the Mark phase in \[identity\.md\]/m);
    assert.ok(read('skill/reference/identity.md').length > 10000, 'identity mark phase is a stub');
    assert.doesNotMatch(replacePlaceholders('{{available_commands}}', 'claude-code', []), /\/melzi logo\b/);

    const meta = JSON.parse(read('skill/scripts/command-metadata.json'));
    assert.equal(meta.logo, undefined);
    assert.deepEqual(MELZI_COMMAND_ALIASES.logo, ['identity']);

    assert.ok(ENGINE, ENGINE_MISSING_MESSAGE);
    const pin = spawnSync(ENGINE, ['pin', 'pin', 'not-a-real-command'], { encoding: 'utf8', env: engineEnv(ENGINE) });
    assert.equal(pin.status, 1);
    assert.match(pin.stderr, /\blogo\b/);

    assert.equal(SKILL_CATEGORIES.logo, undefined);
  });

  it('loads the signature before mark work and joins an adopted mark back into it', () => {
    const identity = read('skill/reference/identity.md');
    const loadAt = identity.indexOf('melzi/signature.mjs');
    const constructAt = identity.indexOf('### 8.5 Generate mechanisms before styles');
    assert.ok(loadAt > 0 && loadAt < constructAt, 'signature must load before mark construction');
    assert.match(identity, /adoptIdentityMark\(\)/);
    assert.match(identity, /logo\.mjs propagate path\/to\/project/);
    assert.match(identity, /mark-check\.mjs --check/);
    assert.equal(fs.existsSync(path.join(ROOT, 'skill/reference/logo.md')), false);
  });
});
