#!/usr/bin/env node
/**
 * Record scripted browser motion and emit a video plus a timestamped contact sheet.
 *
 * WHY THIS EXISTS. An agent reviewing a web surface can read the DOM, the computed
 * styles, and a still screenshot. All three describe one sampled instant. They can
 * prove that `transition: transform 180ms ease` is declared and that the card ends up
 * lifted; they cannot show the 100 ms dead pause before it moves, the single-frame
 * jump near the end of the curve, the hover that restarts badly when the pointer
 * crosses twice, or whether 180 ms reads as cheap beside the rest of the page. Motion
 * quality is the one design property a still frame structurally cannot carry, so
 * judging it from stills is guessing with a confident voice.
 *
 * Usage:
 *   node <scripts_path>/motion-eyes.mjs --url <url-or-path> --do "<interactions>"
 *
 * Two artifacts come out. The `.webm` is the raw recording, for anything about
 * smoothness, pacing, easing, or latency. The `-frames.png` contact sheet tiles N
 * stamped frames into ONE image, which is what makes the run readable by any vision
 * surface today without a video transport, an upload API, or a credential. That split
 * is deliberate: capture stays local and model-agnostic, and the choice of which model
 * looks at the sheet stays outside this script.
 *
 * No image library and no new dependency. Playwright renders the contact sheet as a
 * page and screenshots it, so the only requirement is a Playwright install this
 * process can resolve (the repo's own, the user project's, or the npx cache).
 */

import { access, mkdir, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import process from 'node:process';

const VERSION = '1.0.0';
const DEFAULTS = Object.freeze({
  frames: 12,
  width: 1280,
  height: 720,
  name: 'motion-eyes',
  outputDir: 'output',
});
const require = createRequire(import.meta.url);

function helpText() {
  return `motion-eyes ${VERSION}

Record a URL or local HTML file while running a small interaction script.

Usage:
  node motion-eyes.mjs --url <url-or-path> [options]

Options:
  --do <script>       Semicolon-separated interactions (default: "wait 2s")
  --name <name>       Output basename without an extension (default: motion-eyes)
  --output-dir <dir>  Artifact directory (default: ./output)
  --frames <n>        Contact-sheet frames, 2-60 (default: 12)
  --width <px>        Browser viewport width (default: 1280)
  --height <px>       Browser viewport height (default: 720)
  --overwrite         Replace the two named output artifacts if they exist
  --help              Show this help

Interaction grammar:
  wait <duration>
  scroll <start>..<end> over <duration>
  hover <css-selector> [for <duration>]
  click <css-selector> [then <duration>]

Durations accept ms or s, for example 250ms or 1.5s. Scroll positions are
percentages of the available document scroll by default; add px for pixels.
Selectors may contain spaces, but the grammar is deliberately simple: do not
put semicolons inside selectors.

Examples:
  node motion-eyes.mjs --url https://example.com --do "hover a for 1s; click a then 1s"
  node motion-eyes.mjs --url page.html --do "scroll 0..100 over 4s; hover a.link"

Stdout is one JSON object. Human diagnostics and failures go to stderr.
`;
}

function parseArgs(argv) {
  const options = { ...DEFAULTS, script: 'wait 2s', overwrite: false };
  const values = new Set(['--url', '--do', '--name', '--output-dir', '--frames', '--width', '--height']);

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') return { help: true };
    if (arg === '--overwrite') {
      options.overwrite = true;
      continue;
    }
    if (!values.has(arg)) throw new Error(`Unknown option: ${arg}`);
    const value = argv[index + 1];
    if (value === undefined) throw new Error(`Missing value for ${arg}`);
    index += 1;
    if (arg === '--url') options.target = value;
    else if (arg === '--do') options.script = value;
    else if (arg === '--name') options.name = value;
    else if (arg === '--output-dir') options.outputDir = value;
    else options[arg.slice(2)] = Number(value);
  }

  if (!options.target) throw new Error('--url is required');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(options.name)) {
    throw new Error('--name must contain only letters, numbers, dot, underscore, and hyphen');
  }
  if (!Number.isInteger(options.frames) || options.frames < 2 || options.frames > 60) {
    throw new Error('--frames must be an integer from 2 to 60');
  }
  for (const dimension of ['width', 'height']) {
    if (!Number.isInteger(options[dimension]) || options[dimension] < 240 || options[dimension] > 4096) {
      throw new Error(`--${dimension} must be an integer from 240 to 4096`);
    }
  }
  return options;
}

export function parseDuration(raw) {
  const match = /^(\d+(?:\.\d+)?)(ms|s)$/i.exec(raw.trim());
  if (!match) throw new Error(`Invalid duration "${raw}"; use ms or s`);
  const value = Number(match[1]) * (match[2].toLowerCase() === 's' ? 1000 : 1);
  if (!Number.isFinite(value) || value < 0 || value > 120_000) {
    throw new Error(`Duration out of range: ${raw}`);
  }
  return Math.round(value);
}

function parsePosition(raw) {
  const match = /^(-?\d+(?:\.\d+)?)(%|px)?$/i.exec(raw.trim());
  if (!match) throw new Error(`Invalid scroll position: ${raw}`);
  return { value: Number(match[1]), unit: (match[2] || '%').toLowerCase() };
}

/**
 * The grammar is deliberately tiny. It exists to reproduce ONE interaction reliably,
 * not to be a test framework: anything richer belongs in `/melzi explore`, which
 * drives the real app. Malformed scripts throw here, before a browser is launched, so
 * a typo costs milliseconds rather than a full Chromium boot.
 */
export function parseScript(source) {
  const statements = source.split(';').map((part) => part.trim()).filter(Boolean);
  if (statements.length === 0) throw new Error('Interaction script is empty');

  return statements.map((statement) => {
    let match;
    if ((match = /^wait\s+(\S+)$/i.exec(statement))) {
      return { type: 'wait', durationMs: parseDuration(match[1]), source: statement };
    }
    if ((match = /^scroll\s+([^\s.]+(?:\.\d+)?(?:%|px)?)\.\.([^\s]+)\s+over\s+(\S+)$/i.exec(statement))) {
      const from = parsePosition(match[1]);
      const to = parsePosition(match[2]);
      if (from.unit !== to.unit) throw new Error(`Scroll units must match: ${statement}`);
      return { type: 'scroll', from, to, durationMs: parseDuration(match[3]), source: statement };
    }
    if ((match = /^hover\s+(.+?)(?:\s+for\s+(\S+))?$/i.exec(statement))) {
      return { type: 'hover', selector: match[1], durationMs: parseDuration(match[2] || '750ms'), source: statement };
    }
    if ((match = /^click\s+(.+?)(?:\s+then\s+(\S+))?$/i.exec(statement))) {
      return { type: 'click', selector: match[1], durationMs: parseDuration(match[2] || '750ms'), source: statement };
    }
    throw new Error(`Unsupported interaction: ${statement}`);
  });
}

async function exists(path) {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function resolveTarget(raw) {
  if (/^https?:\/\//i.test(raw) || /^file:\/\//i.test(raw)) return raw;
  const path = resolve(raw);
  if (!(await exists(path))) throw new Error(`Local target does not exist: ${path}`);
  return pathToFileURL(path).href;
}

/**
 * Resolution order, widest reach first, because the installed skill has no
 * node_modules of its own: an explicit override, this script's own tree (the repo
 * checkout), the user project the agent is standing in, then the npx cache that
 * `npx playwright` leaves behind. Nothing here installs anything.
 */
async function playwrightCandidates() {
  const candidates = [];
  if (process.env.MOTION_EYES_PLAYWRIGHT_PATH) candidates.push(process.env.MOTION_EYES_PLAYWRIGHT_PATH);
  candidates.push('playwright');

  const projectPackage = join(process.cwd(), 'node_modules', 'playwright');
  if (await exists(join(projectPackage, 'package.json'))) candidates.push(projectPackage);

  const npxRoot = join(homedir(), '.npm', '_npx');
  try {
    const entries = await readdir(npxRoot, { withFileTypes: true });
    const cached = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const packageDir = join(npxRoot, entry.name, 'node_modules', 'playwright');
      try {
        const info = await stat(join(packageDir, 'package.json'));
        cached.push({ packageDir, mtimeMs: info.mtimeMs });
      } catch {
        // Not a Playwright npx cache entry.
      }
    }
    cached.sort((a, b) => b.mtimeMs - a.mtimeMs);
    candidates.push(...cached.map(({ packageDir }) => packageDir));
  } catch {
    // The npx cache is an optional fallback.
  }
  return [...new Set(candidates)];
}

async function loadPlaywright() {
  const failures = [];
  for (const candidate of await playwrightCandidates()) {
    try {
      const playwright = require(candidate);
      const packagePath = candidate === 'playwright'
        ? require.resolve('playwright/package.json')
        : join(candidate, 'package.json');
      const metadata = JSON.parse(await readFile(packagePath, 'utf8'));
      return { playwright, version: metadata.version, source: dirname(packagePath) };
    } catch (error) {
      failures.push(`${candidate}: ${error.message}`);
    }
  }
  throw new Error(
    "Playwright's Node library is not importable. Install it locally with `npm install playwright`, "
    + 'or set MOTION_EYES_PLAYWRIGHT_PATH to its package directory. Attempts: ' + failures.join(' | '),
  );
}

const sleep = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));

async function runAction(page, action) {
  if (action.type === 'wait') {
    await sleep(action.durationMs);
    return;
  }
  if (action.type === 'hover') {
    await page.locator(action.selector).first().hover({ timeout: 10_000 });
    await sleep(action.durationMs);
    return;
  }
  if (action.type === 'click') {
    await page.locator(action.selector).first().click({ timeout: 10_000 });
    await sleep(action.durationMs);
    return;
  }
  if (action.type === 'scroll') {
    await page.evaluate(async ({ from, to, durationMs }) => {
      const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      const toPixels = (position) => position.unit === 'px'
        ? position.value
        : maxScroll * position.value / 100;
      const start = toPixels(from);
      const end = toPixels(to);
      window.scrollTo(0, start);
      if (durationMs === 0) {
        window.scrollTo(0, end);
        return;
      }
      await new Promise((resolveAnimation) => {
        const began = performance.now();
        const tick = (now) => {
          const progress = Math.min(1, (now - began) / durationMs);
          window.scrollTo(0, start + (end - start) * progress);
          if (progress < 1) requestAnimationFrame(tick);
          else resolveAnimation();
        };
        requestAnimationFrame(tick);
      });
    }, action);
  }
}

async function screenshotWithRetry(page, path) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.screenshot({ path, type: 'png', animations: 'allow' });
      return;
    } catch (error) {
      lastError = error;
      await sleep(80);
    }
  }
  throw lastError;
}

/**
 * Frames are sampled on a clock, not after each action, so the sheet shows the run at
 * even intervals instead of only at the moments the script happens to name. `animations:
 * 'allow'` matters: Playwright's default freezes CSS animations for stable screenshots,
 * which would make every frame of a motion review a lie.
 */
async function captureTimeline(page, actions, frameCount, framesDir) {
  const plannedDurationMs = Math.max(1, actions.reduce((sum, action) => sum + action.durationMs, 0));
  const timestamps = [];
  const started = performance.now();

  const capture = async (index) => {
    const path = join(framesDir, `${String(index).padStart(3, '0')}.png`);
    await screenshotWithRetry(page, path);
    timestamps.push({ path, timestampMs: Math.round(performance.now() - started) });
  };

  await capture(0);
  const actionPromise = (async () => {
    for (const action of actions) await runAction(page, action);
  })();
  const capturePromise = (async () => {
    for (let index = 1; index < frameCount; index += 1) {
      const targetMs = plannedDurationMs * index / (frameCount - 1);
      const remainingMs = targetMs - (performance.now() - started);
      if (remainingMs > 0) await sleep(remainingMs);
      await capture(index);
    }
  })();

  await Promise.all([actionPromise, capturePromise]);
  return { timestamps, durationMs: Math.round(performance.now() - started), plannedDurationMs };
}

async function renderContactSheet(browser, frames, outputPath, viewport) {
  const columns = Math.ceil(Math.sqrt(frames.length));
  const rows = Math.ceil(frames.length / columns);
  const cellWidth = Math.min(640, viewport.width);
  const imageHeight = Math.round(cellWidth * viewport.height / viewport.width);
  const captionHeight = 42;
  const gap = 10;
  const padding = 14;
  const sheetWidth = padding * 2 + columns * cellWidth + (columns - 1) * gap;
  const sheetHeight = padding * 2 + rows * (imageHeight + captionHeight) + (rows - 1) * gap;
  const cards = [];
  for (const [index, frame] of frames.entries()) {
    const encoded = (await readFile(frame.path)).toString('base64');
    cards.push(`<figure><img src="data:image/png;base64,${encoded}" alt="Frame ${index + 1}"><figcaption>${index + 1} · ${frame.timestampMs} ms</figcaption></figure>`);
  }
  const html = `<!doctype html><meta charset="utf-8"><style>
    * { box-sizing: border-box; }
    html, body { margin: 0; width: ${sheetWidth}px; min-height: ${sheetHeight}px; background: #111; }
    body { padding: ${padding}px; color: #fff; font: 600 20px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { display: grid; grid-template-columns: repeat(${columns}, ${cellWidth}px); gap: ${gap}px; }
    figure { width: ${cellWidth}px; margin: 0; background: #1d1d1d; border: 1px solid #444; overflow: hidden; }
    img { display: block; width: ${cellWidth}px; height: ${imageHeight}px; object-fit: cover; }
    figcaption { height: ${captionHeight}px; padding: 9px 12px; }
  </style><main aria-label="Motion contact sheet">${cards.join('')}</main>`;

  const context = await browser.newContext({ viewport: { width: sheetWidth, height: sheetHeight }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.setContent(html, { waitUntil: 'load' });
  await page.screenshot({ path: outputPath, type: 'png', fullPage: true, animations: 'disabled' });
  await context.close();
  return { width: sheetWidth, height: sheetHeight, columns, rows };
}

async function ensureOutputs(paths, overwrite) {
  const collisions = [];
  for (const path of paths) if (await exists(path)) collisions.push(path);
  if (collisions.length && !overwrite) {
    throw new Error(`Output exists; choose another --name or pass --overwrite: ${collisions.join(', ')}`);
  }
  if (overwrite) {
    for (const path of collisions) await rm(path, { force: true });
  }
}

export async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(helpText());
    return;
  }

  const actions = parseScript(options.script);
  const targetUrl = await resolveTarget(options.target);
  const outputDir = resolve(options.outputDir);
  const videoPath = join(outputDir, `${options.name}.webm`);
  const contactSheetPath = join(outputDir, `${options.name}-frames.png`);
  await mkdir(outputDir, { recursive: true });
  await ensureOutputs([videoPath, contactSheetPath], options.overwrite);

  const tempRoot = await mkdtemp(join(tmpdir(), 'motion-eyes-'));
  const videoDir = join(tempRoot, 'video');
  const framesDir = join(tempRoot, 'frames');
  await mkdir(videoDir);
  await mkdir(framesDir);

  const consoleErrors = [];
  let browser;
  try {
    const loaded = await loadPlaywright();
    browser = await loaded.playwright.chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: options.width, height: options.height },
      deviceScaleFactor: 1,
      recordVideo: { dir: videoDir, size: { width: options.width, height: options.height } },
    });
    const page = await context.newPage();
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      consoleErrors.push({ type: 'console', message: message.text(), location: message.location() });
    });
    page.on('pageerror', (error) => {
      consoleErrors.push({ type: 'pageerror', message: error.message });
    });

    const response = await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    if (response && !response.ok()) {
      consoleErrors.push({ type: 'navigation', message: `HTTP ${response.status()} ${response.statusText()}` });
    }
    await sleep(300);

    const video = page.video();
    const timeline = await captureTimeline(page, actions, options.frames, framesDir);
    // Hash the frames before the temp dir is removed. A run where every frame is
    // byte-identical produced a sheet that LOOKS like evidence and proves nothing:
    // the page never moved, or the capture never saw it move.
    const frameHashes = await Promise.all(timeline.timestamps.map(async ({ path }) =>
      createHash('sha256').update(await readFile(path)).digest('hex'),
    ));
    await context.close();
    if (!video) throw new Error('Playwright did not create a video object');
    await video.saveAs(videoPath);

    const sheet = await renderContactSheet(browser, timeline.timestamps, contactSheetPath, {
      width: options.width,
      height: options.height,
    });
    await browser.close();
    browser = undefined;

    const summary = {
      ok: true,
      targetUrl,
      script: options.script,
      frameCount: timeline.timestamps.length,
      uniqueFrameCount: new Set(frameHashes).size,
      frameTimestampsMs: timeline.timestamps.map(({ timestampMs }) => timestampMs),
      durationMs: timeline.durationMs,
      plannedDurationMs: timeline.plannedDurationMs,
      outputPaths: {
        video: videoPath,
        contactSheet: contactSheetPath,
      },
      contactSheet: sheet,
      consoleErrors,
      playwright: { version: loaded.version, source: loaded.source },
    };
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    await rm(tempRoot, { recursive: true, force: true });
  }
}

const isMainModule = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMainModule) {
  main().catch((error) => {
    process.stderr.write(`motion-eyes: ${error.message}\n`);
    process.stdout.write(`${JSON.stringify({ ok: false, error: error.message })}\n`);
    process.exitCode = 1;
  });
}
