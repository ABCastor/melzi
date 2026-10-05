import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_URL = `${pathToFileURL(path.join(ROOT, 'tests/fixtures/island/host-token-decoys.html')).href}#review`;

let browser;

before(async () => {
  const puppeteer = await import('puppeteer');
  browser = await puppeteer.default.launch({
    headless: true,
    args: process.env.CI ? ['--no-sandbox', '--disable-setuid-sandbox'] : [],
  });
});

after(async () => {
  if (browser) await browser.close();
});

async function openFixture(width = 1440) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
  await page.goto(FIXTURE_URL, { waitUntil: 'load' });
  await page.waitForFunction(() => window.reviewLayer && window.reviewLayer._state.mounted);
  return { context, page };
}

async function pointAtTarget(page) {
  await page.evaluate(() => {
    const shadow = document.querySelector('review-island').shadowRoot;
    shadow.querySelector('[data-comment-point]').click();
  });
  const target = await page.$('#review-target');
  const rect = await target.boundingBox();
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.waitForFunction(() => {
    const shadow = document.querySelector('review-island').shadowRoot;
    return shadow.querySelector('.island-comment-outline') && shadow.querySelector('.island-frame-blocker');
  });
  await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.waitForFunction(() => document.querySelector('review-island').shadowRoot.querySelector('.island-comment-box'));
}

async function openGroundEditor(page) {
  await page.evaluate(() => {
    const shadow = document.querySelector('review-island').shadowRoot;
    shadow.querySelector('[data-mode="colour"]').click();
    shadow.querySelector('.colour-slot[data-role="ground"]').click();
  });
  await page.waitForFunction(() => document.querySelector('review-island').shadowRoot.querySelector('input[aria-label="Lightness"]'));
}

// puppeteer's keyboard has no combo-string form: press('Meta+z') throws
// "Unknown key" before the assertion runs, so the binding was never driven.
// Hold the modifiers explicitly instead.
async function chord(page, modifiers, key) {
  for (const modifier of modifiers) await page.keyboard.down(modifier);
  await page.keyboard.press(key);
  for (const modifier of [...modifiers].reverse()) await page.keyboard.up(modifier);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function dragGroundLightness(page, value, commit = false) {
  await page.evaluate(({ value, commit }) => {
    const shadow = document.querySelector('review-island').shadowRoot;
    const input = shadow.querySelector('input[aria-label="Lightness"]');
    input.focus();
    input.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    if (commit) input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  }, { value, commit });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

describe('Review Island browser regressions', () => {
  it('keeps every shadow-tree sibling on the island palette instead of host token decoys', async () => {
    const { context, page } = await openFixture();
    try {
      await pointAtTarget(page);
      await page.keyboard.type('Keep this note anchored');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.querySelector('review-island').shadowRoot.querySelector('.island-pin-marker'));
      await page.evaluate(() => document.querySelector('review-island').shadowRoot.querySelector('.island-pin-marker').click());
      await page.waitForFunction(() => document.querySelector('review-island').shadowRoot.querySelector('.island-comment-box'));

      const result = await page.evaluate(() => {
        const shadow = document.querySelector('review-island').shadowRoot;
        const hostStyle = getComputedStyle(document.documentElement);
        const selectors = ['.island-comment-box', '.island-comment-outline', '.island-pin-marker', '.island-frame-blocker'];
        return {
          decoys: {
            rule: hostStyle.getPropertyValue('--rule').trim(),
            muted: hostStyle.getPropertyValue('--muted').trim(),
          },
          elements: selectors.map((selector) => {
            const element = shadow.querySelector(selector);
            const style = getComputedStyle(element);
            return {
              selector,
              rule: style.getPropertyValue('--rule').trim(),
              muted: style.getPropertyValue('--muted').trim(),
              gold: style.getPropertyValue('--gold').trim(),
              lacquer: style.getPropertyValue('--lacquer').trim(),
              background: style.backgroundColor,
              border: style.borderColor,
            };
          }),
        };
      });

      for (const element of result.elements) {
        assert.notEqual(element.rule, result.decoys.rule, `${element.selector} must not inherit the host --rule`);
        assert.notEqual(element.muted, result.decoys.muted, `${element.selector} must not inherit the host --muted`);
        assert.ok(element.gold, `${element.selector} must inherit the island --gold`);
        assert.ok(element.lacquer, `${element.selector} must inherit the island --lacquer`);
      }
      const composer = result.elements.find((item) => item.selector === '.island-comment-box');
      const marker = result.elements.find((item) => item.selector === '.island-pin-marker');
      assert.notEqual(composer.background, 'rgba(0, 0, 0, 0)');
      assert.notEqual(composer.border, 'rgb(1, 2, 3)');
      assert.notEqual(marker.background, 'rgb(4, 5, 6)');
    } finally {
      await context.close();
    }
  });

  it('does not render the attachment preview before an image exists', async () => {
    const { context, page } = await openFixture();
    try {
      await pointAtTarget(page);
      const preview = await page.evaluate(() => {
        const image = document.querySelector('review-island').shadowRoot.querySelector('.island-note-preview');
        return { hidden: image.hidden, src: image.getAttribute('src'), display: getComputedStyle(image).display };
      });
      assert.equal(preview.hidden, true);
      assert.ok(preview.src === null || preview.src === '', 'an unattached preview carries no src');
      assert.equal(preview.display, 'none');
    } finally {
      await context.close();
    }
  });

  it('reserves header space so Go never intersects a mode tab', async () => {
    const { context, page } = await openFixture(1265);
    try {
      for (const width of [1265, 1440]) {
        await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
        const intersections = await page.evaluate(() => {
          const shadow = document.querySelector('review-island').shadowRoot;
          const go = shadow.querySelector('.go').getBoundingClientRect();
          return Array.from(shadow.querySelectorAll('.mode'), (tab) => {
            const rect = tab.getBoundingClientRect();
            return {
              tab: tab.textContent,
              intersects: rect.left < go.right && rect.right > go.left && rect.top < go.bottom && rect.bottom > go.top,
            };
          });
        });
        assert.deepEqual(intersections.filter((item) => item.intersects), [], `Go overlaps a tab at ${width}px`);
      }
    } finally {
      await context.close();
    }
  });

  it('binds undo and redo from page and island focus without stealing text-field undo', async () => {
    const { context, page } = await openFixture();
    try {
      await openGroundEditor(page);
      const before = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ground').trim());
      await dragGroundLightness(page, 0.45, true);
      const changed = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ground').trim());
      assert.notEqual(changed, before);
      assert.equal(await page.evaluate(() => typeof window.reviewLayer.undo), 'function');
      assert.equal(await page.evaluate(() => typeof window.reviewLayer.redo), 'function');

      await page.focus('#review-target');
      await chord(page, ['Meta'], 'z');
      assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ground').trim()), before);
      await chord(page, ['Meta', 'Shift'], 'z');
      assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ground').trim()), changed);

      await page.evaluate(() => document.querySelector('review-island').shadowRoot.querySelector('[data-mode="colour"]').focus());
      await chord(page, ['Control'], 'z');
      assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ground').trim()), before);
      assert.equal(await page.evaluate(() => window.reviewLayer.redo()), true);
      assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ground').trim()), changed);

      const typing = await page.evaluate(() => {
        const shadow = document.querySelector('review-island').shadowRoot;
        shadow.querySelector('[data-mode="comment"]').click();
        const field = shadow.querySelector('.island-about-text');
        let prevented = null;
        field.addEventListener('keydown', (event) => { if (event.metaKey && event.key.toLowerCase() === 'z') prevented = event.defaultPrevented; });
        field.focus();
        field.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true, composed: true, cancelable: true }));
        return { prevented, ground: getComputedStyle(document.documentElement).getPropertyValue('--ground').trim() };
      });
      assert.equal(typing.prevented, false);
      assert.equal(typing.ground, changed);
    } finally {
      await context.close();
    }
  });

  it('updates a role chip from the live colour state during a drag', async () => {
    const { context, page } = await openFixture();
    try {
      await openGroundEditor(page);
      const before = await page.evaluate(() => document.querySelector('review-island').shadowRoot.querySelector('.colour-slot[data-role="ground"] code').textContent);
      await dragGroundLightness(page, 0.45);
      const live = await page.evaluate(() => {
        const shadow = document.querySelector('review-island').shadowRoot;
        return {
          page: getComputedStyle(document.documentElement).getPropertyValue('--ground').trim(),
          chip: shadow.querySelector('.colour-slot[data-role="ground"] code').textContent.trim(),
        };
      });
      assert.notEqual(live.page, before);
      assert.equal(live.chip, live.page);
    } finally {
      await context.close();
    }
  });
});
