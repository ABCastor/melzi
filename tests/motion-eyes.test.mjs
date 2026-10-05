import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseDocument } from 'htmlparser2';
import { selectAll } from 'css-select';

import { parseDuration, parseScript } from '../skill/scripts/motion-eyes.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = path.join(ROOT, 'tests/fixtures/motion-eyes/motion-demo.html');

/**
 * The interaction script is the whole user interface of motion-eyes, and every mistake
 * in it is otherwise paid for at Chromium-boot prices: a bad selector or a stray unit
 * shows up 3 seconds later as an empty timeout, not as a syntax error. So the parser is
 * unit-tested and the browser half is not: launching a real Chromium here would put a
 * multi-second, video-encoding, machine-dependent capture into the default suite, which
 * is what the opt-in Playwright suites exist to keep out.
 *
 * The browser half is proved by running the tool by hand against the fixture:
 *
 *   node skill/scripts/motion-eyes.mjs \
 *     --url tests/fixtures/motion-eyes/motion-demo.html \
 *     --do "scroll 0..100 over 4s; hover a.link for 1s; click [data-theme-toggle] then 1s" \
 *     --name proof --output-dir /tmp/motion-eyes
 *
 * The last two tests here are what keeps that command runnable: they pin the smoke
 * script against the parser and against the fixture's own selectors, so a fixture edit
 * that drops the theme toggle fails here instead of silently making the smoke check
 * capture nothing.
 */

const SMOKE_SCRIPT = 'scroll 0..100 over 4s; hover a.link for 1s; click [data-theme-toggle] then 1s';

describe('motion-eyes interaction script parsing', () => {
  it('accepts milliseconds and fractional seconds', () => {
    assert.equal(parseDuration('250ms'), 250);
    assert.equal(parseDuration('1.5s'), 1500);
  });

  it('parses the documented example with stable defaults', () => {
    assert.deepEqual(
      parseScript('scroll 0..100 over 4s; hover a.link; click [data-theme-toggle]'),
      [
        {
          type: 'scroll',
          from: { value: 0, unit: '%' },
          to: { value: 100, unit: '%' },
          durationMs: 4000,
          source: 'scroll 0..100 over 4s',
        },
        { type: 'hover', selector: 'a.link', durationMs: 750, source: 'hover a.link' },
        {
          type: 'click',
          selector: '[data-theme-toggle]',
          durationMs: 750,
          source: 'click [data-theme-toggle]',
        },
      ],
    );
  });

  it('keeps an optional hold out of the selector', () => {
    assert.deepEqual(parseScript('hover nav a for 1s; click button.primary then 250ms'), [
      { type: 'hover', selector: 'nav a', durationMs: 1000, source: 'hover nav a for 1s' },
      {
        type: 'click',
        selector: 'button.primary',
        durationMs: 250,
        source: 'click button.primary then 250ms',
      },
    ]);
  });

  it('rejects malformed scripts before a browser is launched', () => {
    assert.throws(() => parseScript('scroll 0..100px over 1s'), /units must match/i);
    assert.throws(() => parseScript('spin wildly'), /unsupported interaction/i);
    assert.throws(() => parseScript(''), /empty/i);
  });
});

describe('motion-eyes smoke fixture', () => {
  it('exists and carries the motion the capture is meant to show', () => {
    assert.ok(existsSync(FIXTURE), `missing fixture: ${FIXTURE}`);
    const html = readFileSync(FIXTURE, 'utf-8');

    // One of each kind of motion a contact sheet has to be able to expose: a continuous
    // loop, a scroll-triggered reveal, a hover response, and a whole-page state change.
    assert.match(html, /animation:\s*breathe/, 'no continuous animation');
    assert.match(html, /IntersectionObserver/, 'no scroll-triggered reveal');
    assert.match(html, /a:hover/, 'no hover state');
    assert.match(html, /transition:\s*background/, 'no theme transition');
    assert.match(html, /prefers-reduced-motion/, 'no reduced-motion path');
  });

  it('answers every selector the smoke script drives', () => {
    const document = parseDocument(readFileSync(FIXTURE, 'utf-8'));
    const selectors = parseScript(SMOKE_SCRIPT)
      .filter((action) => action.selector)
      .map((action) => action.selector);

    assert.ok(selectors.length > 0, 'the smoke script drives no selector');
    for (const selector of selectors) {
      assert.ok(selectAll(selector, document).length > 0, `fixture has no match for "${selector}"`);
    }
  });
});

describe('skill/reference/animate.md documents a grammar the parser accepts', () => {
  it('parses every --do example the reference gives', () => {
    const animate = readFileSync(path.join(ROOT, 'skill/reference/animate.md'), 'utf-8');
    const examples = [...animate.matchAll(/--do\s+"([^"]+)"/g)].map((match) => match[1]);

    assert.ok(examples.length > 0, 'the capture section no longer shows a --do example');
    for (const example of examples) {
      assert.doesNotThrow(() => parseScript(example), `reference example does not parse: ${example}`);
    }
  });
});
