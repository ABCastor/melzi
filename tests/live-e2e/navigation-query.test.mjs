import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { it } from 'node:test';
import { chromium } from 'playwright';
import { installLiveQueryHelpers } from './ui.mjs';

it('query helper installation survives navigation that destroys its first execution context', async () => {
  const server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end('<html><body><button id="control">Ready</button></body></html>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`${origin}/before`);
    let navigated = false;
    let navigation;
    await page.exposeFunction('__navigationGate', async () => {
      assert.equal(navigated, false, 'only one controlled navigation');
      navigated = true;
      navigation = page.goto(`${origin}/after`);
      await navigation;
      return true;
    });
    // Pause the first helper invocation while a real navigation destroys its
    // context. The same gate covers evaluate and waitForFunction, so the test
    // exercises their different lifecycle behavior without faking an error.
    const duringNavigation = async ({ source }) => {
      if (location.pathname === '/before') await window.__navigationGate();
      return (0, eval)(`(${source})`)();
    };
    const evaluate = page.evaluate.bind(page);
    const waitForFunction = page.waitForFunction.bind(page);
    page.evaluate = (fn, arg) => fn?.name === 'installLiveQueryHelpersInPage'
      ? evaluate(duringNavigation, { source: fn.toString() })
      : evaluate(fn, arg);
    page.waitForFunction = (fn, arg, options) => fn?.name === 'installLiveQueryHelpersInPage'
      ? waitForFunction(duringNavigation, { source: fn.toString() }, options)
      : waitForFunction(fn, arg, options);
    await installLiveQueryHelpers(page);
    await navigation;
    assert.equal(navigated, true, 'navigation crossed the helper installation');
    assert.equal(page.url(), `${origin}/after`);
    assert.equal(await page.evaluate(() => window.__impeccableLiveQuery('#control')?.textContent), 'Ready');
  } finally {
    try {
      await browser?.close();
    } finally {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }
});
