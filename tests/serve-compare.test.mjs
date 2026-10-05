// The comparison table. FORK-ONLY (skill/scripts/melzi/serve-compare.mjs).
//
// What these tests are really guarding: this is the surface the owner asked for most
// directly, in his own words, "so I can click on something and write something for
// you to steer on there". So the assertions follow the whole path of one piece of
// pointing: the screen is served WITH the annotation script and the file on disk is
// still byte-for-byte what the build wrote, a click's annotation reaches the server,
// survives into the verdict, and comes back out of --wait in his words. Plus the two
// things that would quietly destroy the signal: an unsigned POST forging feedback
// from inside a framed screen, and a scoring control that is not binary.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'skill', 'scripts', 'melzi', 'serve-compare.mjs');

// The taste store lives in the home dir, so a test run must never reach the real
// one. HOME is redirected as a mechanism and not just as an opt-out flag: the next
// home-writing module wired in here must not find the real home from this test.
const FAKE_HOME = mkdtempSync(path.join(tmpdir(), 'serve-compare-home-'));
const ENV = { ...process.env, HOME: FAKE_HOME, IMPECCABLE_NO_TASTE_LEDGER: '1' };

/** The page embeds a per-server nonce; only requests carrying it may write. */
const nonceOf = (html) => html.match(/const NONCE = '([0-9a-f]+)'/)?.[1];

// Deliberately shaped: a </body> to inject before, a non-ASCII character so a byte
// comparison is a real one, and headings the selector path can bite on.
const SCREEN_A = '<!doctype html><html><head><meta charset="utf-8"><title>Departures</title></head><body><main><h1>DEPARTURES · GLEIS 7</h1><section><h2>Layers</h2></section><section><h2>Triangles</h2></section></main></body></html>\n';
// No </body> at all: the injection must still land, and the raw route must still
// give back exactly these bytes.
const SCREEN_B = '<!doctype html><meta charset="utf-8"><title>Arrivals</title><main><h1>ARRIVALS</h1></main>\n';

/** A tmp workspace holding two screens; the server's cwd, so .impeccable lands here. */
function workspace(payload = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'serve-compare-'));
  const a = path.join(dir, 'a.html');
  const b = path.join(dir, 'b.html');
  writeFileSync(a, SCREEN_A);
  writeFileSync(b, SCREEN_B);
  const payloadPath = path.join(dir, 'compare.json');
  writeFileSync(payloadPath, JSON.stringify({
    title: 'Which one is closer?',
    question: 'Two candidates for the same screen.',
    a: { id: 'wpa-park-poster', label: 'WPA Park Poster', lineage: '1930s WPA national park posters', screen: a },
    b: { id: 'swiss-timetable', label: 'Swiss Timetable', lineage: 'SBB departure boards', screen: b },
    ...payload,
  }));
  return { dir, a, b, payloadPath };
}

const run = (dir, args, env = ENV) => new Promise((resolve) => {
  const child = spawn(process.execPath, [SCRIPT, ...args], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (chunk) => { out += chunk; });
  child.stderr.on('data', (chunk) => { out += chunk; });
  child.on('exit', (code) => resolve({ code, out }));
});

/** Daemonize and hand back the URL, mirroring how the agent drives this. */
async function start(dir, payloadPath, key, extraArgs = [], env = ENV) {
  const started = await run(dir, ['--start', '--payload', payloadPath, '--no-open', '--key', key, ...extraArgs], env);
  assert.equal(started.code, 0, started.out);
  const url = started.out.match(/COMPARE URL: (\S+)/)?.[1];
  assert.ok(url, started.out);
  return url;
}

/** Start the blocking server and retain its stdout through the verdict. */
async function startBlocking(dir, payloadPath, extraArgs = [], env = ENV) {
  const child = spawn(process.execPath, [SCRIPT, '--payload', payloadPath, '--no-open', ...extraArgs], {
    cwd: dir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  let settled = false;
  let resolveReady;
  let rejectReady;
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const collect = (chunk) => {
    out += chunk;
    const url = out.match(/COMPARE URL: (\S+)/)?.[1];
    if (!settled && url) {
      settled = true;
      resolveReady(url);
    }
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  const done = new Promise((resolve) => {
    child.on('exit', (code) => {
      if (!settled) {
        settled = true;
        rejectReady(new Error(out || `serve-compare exited ${code}`));
      }
      resolve({ code, out });
    });
  });
  return { url: await ready, done, child };
}

const comparisonFile = (home = FAKE_HOME) => path.join(home, '.impeccable', 'taste', 'comparisons.jsonl');
const comparisons = (home = FAKE_HOME) => {
  try {
    return readFileSync(comparisonFile(home), 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
};

async function waitFor(check, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return false;
}

const post = (url, route, body) => fetch(new URL(route, url), {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

describe('serve-compare', () => {
  it('loads taste recording only inside the answer handler and forwards --no-record to a detached server', () => {
    const source = readFileSync(SCRIPT, 'utf8');
    assert.doesNotMatch(source, /^import .*taste-session\.mjs/m, 'the taste store is not a static server dependency');
    assert.match(source, /await import\(['"]\.\/taste-session\.mjs['"]\)/);
    assert.match(source, /hasFlag\(['"]no-record['"]\)[\s\S]{0,120}\['--no-record'\]/);
    assert.match(source, /state\.recordMessage = recordMessage/);
    assert.match(source, /if \(recordMessage\) console\.log\(recordMessage\)/);
  });

  it('frames both screens live, injects the annotation script into the response only, and leaves the file untouched', async () => {
    const { dir, a, b, payloadPath } = workspace();
    const url = await start(dir, payloadPath, 'inj');
    try {
      const html = await (await fetch(url)).text();
      // Two live pages, not two pictures, and sandboxed so a screen's own JS cannot
      // reach this page's origin.
      assert.match(html, /<iframe class="screen" src="\/screen\/0" sandbox="allow-scripts" title="WPA Park Poster">/);
      assert.match(html, /<iframe class="screen" src="\/screen\/1" sandbox="allow-scripts" title="Swiss Timetable">/);
      // A lazy frame under a transformed card renders blank in Chrome; there is no
      // reason for one here and its absence is the guard.
      assert.doesNotMatch(html, /loading="lazy"/);

      const served = await (await fetch(new URL('/screen/0', url))).text();
      assert.match(served, /impeccable: 'annotate-click'/, 'the served screen can report a click');
      assert.match(served, /selectorFor/);
      assert.ok(served.includes('</body>'), 'the injection goes before the closing body tag');
      assert.ok(served.startsWith('<!doctype html><html><head>'), 'everything above the injection is the file');

      // The pristine route: not merely "different", byte-identical to the source.
      const rawRes = await fetch(new URL('/screen/0/raw', url));
      assert.equal(rawRes.status, 200);
      assert.match(rawRes.headers.get('content-type'), /text\/html/);
      const rawBytes = Buffer.from(await rawRes.arrayBuffer());
      assert.equal(Buffer.compare(rawBytes, readFileSync(a)), 0, 'the raw route is the file, byte for byte');
      assert.equal(rawBytes.includes('annotate-click'), false, 'no injection on the raw route');

      // And the file on disk never learned about any of this.
      assert.equal(readFileSync(a, 'utf8'), SCREEN_A, 'the candidate file is untouched by being served');

      // A screen with no </body> still gets the script, appended.
      const servedB = await (await fetch(new URL('/screen/1', url))).text();
      assert.ok(servedB.startsWith(SCREEN_B.trimEnd()), 'the file leads');
      assert.match(servedB, /impeccable: 'annotate-click'/);
      assert.equal(Buffer.compare(Buffer.from(await (await fetch(new URL('/screen/1/raw', url))).arrayBuffer()), readFileSync(b)), 0);

      // Only a registered screen is servable: this is not a reader of local files.
      assert.equal((await fetch(new URL('/screen/2', url))).status, 404);
      assert.equal((await fetch(new URL('/screen/2/raw', url))).status, 404);
    } finally {
      await run(dir, ['--stop', '--key', 'inj']);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('records a pinned annotation, carries it into the verdict, and reports it in his words', async () => {
    const { dir, payloadPath } = workspace({ profile: 'prefers generous whitespace\ndislikes three-column layouts', comparisons: 4, steer: true });
    const before = comparisons().length;
    const url = await start(dir, payloadPath, 'ann');
    try {
      const html = await (await fetch(url)).text();
      const nonce = nonceOf(html);
      assert.ok(nonce, 'the page embeds its write nonce');

      // The six chips exist because typing is friction, and the free-text field
      // exists because his real feedback does not fit six buttons.
      for (const label of ['Keep this', 'Too loud', 'Too big', 'Too small', 'Remove this', 'Confusing']) {
        assert.ok(html.includes(label), `${label} chip is offered`);
      }
      assert.match(html, /class="pop-text"/);

      // A chip pin: one click, one statement.
      const chipped = await post(url, '/annotate', {
        nonce, candidate: 'wpa-park-poster', frame: 0, kind: 'dislike', text: 'too loud',
        point: { x: 0.5, y: 0.12 },
        target: { selector: 'main > h1', text: 'DEPARTURES · GLEIS 7', rect: { x: 0.1, y: 0.05, w: 0.8, h: 0.09 } },
      });
      assert.equal(chipped.status, 200);
      const first = (await chipped.json()).pin;
      assert.equal(first.n, 1, 'pins are numbered so he can refer to one');
      assert.equal(first.kind, 'dislike');

      // The free-text pin: the feedback that no button covers.
      const typed = await post(url, '/annotate', {
        nonce, candidate: 'swiss-timetable', frame: 1, kind: 'note',
        text: "I don't like the two triangles at the top, but I really like how the layers move between each other",
        point: { x: 0.31, y: 0.44 },
        target: { selector: 'main > section:nth-of-type(2) > h2', text: 'Triangles', rect: { x: 0.2, y: 0.4, w: 0.3, h: 0.06 } },
      });
      const second = (await typed.json()).pin;
      assert.equal(second.n, 2);

      // A third pin, then deleted: he must be able to take back a pin.
      const spare = (await (await post(url, '/annotate', {
        nonce, candidate: 'swiss-timetable', frame: 1, kind: 'keep', text: 'keep this', point: { x: 0.7, y: 0.7 },
        target: { selector: 'main', text: 'ARRIVALS', rect: { x: 0, y: 0, w: 1, h: 1 } },
      })).json()).pin;
      assert.equal(spare.n, 3);
      const dropped = await post(url, '/annotation/delete', { nonce, id: spare.id });
      assert.equal((await dropped.json()).removed, 1);

      const remaining = (await (await fetch(new URL('/annotations', url))).json()).annotations;
      assert.deepEqual(remaining.map((x) => x.text), ['too loud', second.text]);
      // Deleting pin 3 must not renumber the survivors under him.
      const fourth = (await (await post(url, '/annotate', {
        nonce, candidate: 'wpa-park-poster', frame: 0, kind: 'keep', text: 'keep this', point: { x: 0.2, y: 0.9 },
        target: { selector: 'main > section:nth-of-type(1)', text: 'Layers', rect: { x: 0, y: 0.8, w: 1, h: 0.2 } },
      })).json()).pin;
      assert.equal(fourth.n, 4, 'pin numbers are a counter, not an array index');

      const answered = await post(url, '/answer', { nonce, outcome: 'b', steer: '  keep the density  ' });
      assert.equal(answered.status, 200);

      const collected = await run(dir, ['--wait', '--key', 'ann', '--poll', '8']);
      assert.equal(collected.code, 0, collected.out);
      const line = collected.out.match(/^COMPARISON: (.+)$/m)?.[1];
      assert.ok(line, collected.out);
      const verdict = JSON.parse(line);

      assert.equal(verdict.outcome, 'b');
      assert.equal(verdict.a, 'wpa-park-poster');
      assert.equal(verdict.b, 'swiss-timetable');
      assert.equal(verdict.steer, 'keep the density');
      assert.equal(verdict.annotations.length, 3, 'the deleted pin is gone, the rest travel with the verdict');

      // The exact contract shape, because the store and the recombination brief
      // read these and nothing renames them on the way through.
      assert.deepEqual(Object.keys(verdict.annotations[0]).sort(), ['candidate', 'kind', 'target', 'text']);
      assert.deepEqual(verdict.annotations[0], {
        candidate: 'wpa-park-poster',
        kind: 'dislike',
        target: { selector: 'main > h1', text: 'DEPARTURES · GLEIS 7', rect: { x: 0.1, y: 0.05, w: 0.8, h: 0.09 } },
        text: 'too loud',
      });
      assert.equal(verdict.annotations[1].candidate, 'swiss-timetable');
      assert.match(verdict.annotations[1].text, /two triangles at the top/);

      // A model reading this stdout should not have to parse a blob to find the one
      // sentence that decides the next build.
      assert.match(collected.out, /HIS WORDS: #2 swiss-timetable \(note\) @ main > section:nth-of-type\(2\) > h2 "Triangles" :: I don't like the two triangles/);
      assert.match(collected.out, /outrank any general taste profile/);
      assert.match(collected.out, /^serve-compare: verdict recorded in the taste store$/m);

      assert.equal(await waitFor(() => comparisons().length === before + 1), true, 'the detached handler closes the taste loop');
      const recorded = comparisons().at(-1);
      assert.equal(recorded.outcome, 'b');
      assert.equal(recorded.a, 'wpa-park-poster');
      assert.equal(recorded.b, 'swiss-timetable');
      assert.equal(recorded.annotations.length, 3);
    } finally {
      await run(dir, ['--stop', '--key', 'ann']);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses an unsigned write, so a framed screen cannot forge his feedback or his verdict', async () => {
    const { dir, payloadPath } = workspace();
    const url = await start(dir, payloadPath, 'gate');
    try {
      // Exactly what a hostile or careless framed screen can do: a fire-and-forget
      // POST needing no preflight. It has no nonce, because the nonce only ever
      // exists on the comparison page.
      const forgedPin = await post(url, '/annotate', {
        candidate: 'wpa-park-poster', frame: 0, kind: 'keep', text: 'forged from a frame', point: { x: 0.5, y: 0.5 },
      });
      assert.equal(forgedPin.status, 403);

      const forgedVerdict = await post(url, '/answer', { outcome: 'a', steer: 'forged from a frame' });
      assert.equal(forgedVerdict.status, 403);

      const forgedDelete = await post(url, '/annotation/delete', { id: 'whatever' });
      assert.equal(forgedDelete.status, 403);

      // Nothing was recorded, and the server is still up waiting for the real one.
      assert.deepEqual((await (await fetch(new URL('/annotations', url))).json()).annotations, []);
      assert.equal(existsSync(path.join(dir, '.impeccable', 'compare', 'gate.answer.json')), false);

      // A pin that says nothing is not feedback, even correctly signed.
      const nonce = nonceOf(await (await fetch(url)).text());
      assert.equal((await post(url, '/annotate', { nonce, frame: 0, kind: 'note', text: '   ', point: { x: 0.1, y: 0.1 } })).status, 400);
      // And a verdict has to be one of the three.
      assert.equal((await post(url, '/answer', { nonce, outcome: 7 })).status, 400);
    } finally {
      await run(dir, ['--stop', '--key', 'gate']);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('offers exactly three verdicts and no way to score, and shows the taste profile with an honest count', async () => {
    const { dir, payloadPath } = workspace({ profile: 'prefers generous whitespace\nneutral on serif vs sans', comparisons: 1 });
    const url = await start(dir, payloadPath, 'vd');
    try {
      const html = await (await fetch(url)).text();
      assert.match(html, /<button id="prefer-a">Prefer left<\/button>/);
      assert.match(html, /<button id="tie">Tie<\/button>/);
      assert.match(html, /<button id="prefer-b">Prefer right<\/button>/);
      // The rule that must never soften: asked to score, a non-designer produces
      // noise dressed as data; asked to choose, he produces a real bit.
      assert.doesNotMatch(html, /type="range"/);
      assert.doesNotMatch(html, /<input[^>]*type="number"/);
      assert.doesNotMatch(html, /Intuition session/, 'a plain serve-compare invocation stays untimed');

      // He watches his own taste form as he clicks, and the count next to it is the
      // honest one, so a profile built on one comparison cannot read as settled.
      assert.match(html, /prefers generous whitespace\nneutral on serif vs sans/);
      assert.match(html, /class="profile-count">1 comparison</);
    } finally {
      await run(dir, ['--stop', '--key', 'vd']);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('makes intuition opt-in, tracks a timed choice, and keeps a timer-off session deliberate', async () => {
    const home = mkdtempSync(path.join(tmpdir(), 'serve-compare-intuition-home-'));
    const env = { ...ENV, HOME: home };
    const { dir, payloadPath } = workspace();
    const url = await start(dir, payloadPath, 'intuition', [
      '--intuition', '--intuition-session', 'first-pass', '--intuition-seconds', '0', '--intuition-cap', '2',
    ], env);
    try {
      const html = await (await fetch(url)).text();
      assert.match(html, /Intuition session/);
      assert.match(html, /Timer off for this session/);
      assert.match(html, /const INTUITION = \{"session":"first-pass","timerSeconds":0,"cap":2,"completed":0\}/);
      const nonce = nonceOf(html);
      const invalidTimeout = await post(url, '/answer', { nonce, outcome: 'a', responseMs: 3000, timedOut: true });
      assert.equal(invalidTimeout.status, 400, 'a timeout cannot be filed as a win');
      assert.equal((await post(url, '/answer', { nonce, outcome: 'a', responseMs: 240 })).status, 200);
      const collected = await run(dir, ['--wait', '--key', 'intuition', '--poll', '8'], env);
      assert.equal(collected.code, 0, collected.out);
      const recorded = comparisons(home).at(-1);
      assert.equal(recorded.responseMs, 240);
      assert.equal(recorded.weight, 1.25);
      assert.equal(recorded.timedOut, undefined);
      assert.deepEqual(recorded.intuition, { session: 'first-pass', timerSeconds: 0, cap: 2 });
    } finally {
      await run(dir, ['--stop', '--key', 'intuition'], env);
      rmSync(dir, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('ends an intuition session at its configured fatigue cap before opening another pair', async () => {
    const home = mkdtempSync(path.join(tmpdir(), 'serve-compare-cap-home-'));
    const env = { ...ENV, HOME: home };
    const { dir, payloadPath } = workspace();
    const file = comparisonFile(home);
    mkdirSync(path.dirname(file), { recursive: true });
    const row = (at) => JSON.stringify({
      v: 1, at, a: 'wpa-park-poster', b: 'swiss-timetable', outcome: 'tie', source: 'timeout', annotations: [],
      responseMs: 3000, timedOut: true, weight: 0.35, intuition: { session: 'capped', timerSeconds: 3, cap: 2 },
    });
    writeFileSync(file, `${row('2026-07-29T10:00:00.000Z')}\n${row('2026-07-29T10:01:00.000Z')}\n`);
    try {
      const capped = await run(dir, [
        '--start', '--payload', payloadPath, '--no-open', '--key', 'capped',
        '--intuition', '--intuition-session', 'capped', '--intuition-seconds', '3', '--intuition-cap', '2',
      ], env);
      assert.equal(capped.code, 0, capped.out);
      assert.match(capped.out, /ended after 2 choices \(cap 2\) to prevent fatigue/);
      assert.equal(existsSync(path.join(dir, '.impeccable', 'compare', 'capped.state.json')), false, 'a capped session starts no server');
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  // Found by driving the real page in Chromium, not by any assertion here: a
  // free-text annotation's kind is literally "note", so an unprefixed class made the
  // pin dot a `.note`, and the note-list box styling below it in the sheet won on
  // equal specificity. His own words are the annotation that matters most and their
  // pin was the one that rendered wrong. This is implementation-coupled on purpose:
  // it guards one collision that already happened, in the one place it can happen.
  it('pin kind classes are namespaced, so a "note" pin cannot inherit the note-list box', async () => {
    const { dir, payloadPath } = workspace();
    const url = await start(dir, payloadPath, 'cls');
    try {
      const html = await (await fetch(url)).text();
      assert.match(html, /dot\.className = 'pin k-' \+ pin\.kind/);
      assert.match(html, /\.pin\.k-keep \{/);
      assert.match(html, /\.pin\.k-dislike \{/);
      assert.doesNotMatch(html, /\.pin\.(keep|dislike|note|ghost) \{/, 'no bare kind class can collide with a layout class');
    } finally {
      await run(dir, ['--stop', '--key', 'cls']);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a zero-comparison profile says so rather than showing a confident blank', async () => {
    const { dir, payloadPath } = workspace();
    const url = await start(dir, payloadPath, 'zero');
    try {
      const html = await (await fetch(url)).text();
      assert.match(html, /Nothing learned yet/);
      assert.match(html, /class="profile-count">0 comparisons</);
    } finally {
      await run(dir, ['--stop', '--key', 'zero']);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('records in blocking mode and says plainly that the taste loop closed', async () => {
    const { dir, payloadPath } = workspace();
    const before = comparisons().length;
    const blocking = await startBlocking(dir, payloadPath);
    try {
      const nonce = nonceOf(await (await fetch(blocking.url)).text());
      assert.equal((await post(blocking.url, '/answer', { nonce, outcome: 'a' })).status, 200);
      const result = await blocking.done;
      assert.equal(result.code, 0, result.out);
      assert.match(result.out, /^COMPARISON: /m);
      assert.match(result.out, /^serve-compare: verdict recorded in the taste store$/m);
      assert.equal(comparisons().length, before + 1);
    } finally {
      blocking.child.kill();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // The detached path is the one he actually uses: a table left running under a key,
  // collected later with --wait. Blocking mode being covered is not coverage of this,
  // and the failure and --no-record cases below both assert an ABSENCE, which a broken
  // recorder would satisfy just as well as a working one. This is the only test that
  // fails if detached recording silently stops working.
  it('records in detached mode, which is the flow he uses', async () => {
    const { dir, payloadPath } = workspace();
    const before = comparisons().length;
    const url = await start(dir, payloadPath, 'detached-record');
    try {
      const nonce = nonceOf(await (await fetch(url)).text());
      assert.equal((await post(url, '/answer', { nonce, outcome: 'a' })).status, 200);
      const collected = await run(dir, ['--wait', '--key', 'detached-record', '--poll', '8']);
      assert.equal(collected.code, 0, collected.out);
      assert.match(collected.out, /^COMPARISON: /m);
      assert.match(collected.out, /^serve-compare: verdict recorded in the taste store$/m);
      assert.equal(comparisons().length, before + 1);
      assert.equal(comparisons().at(-1).outcome, 'a');
    } finally {
      await run(dir, ['--stop', '--key', 'detached-record']);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps the detached answer file when the taste store cannot write, and names the failure', async () => {
    const { dir, payloadPath } = workspace();
    const unusableHome = path.join(dir, 'home-is-a-file');
    writeFileSync(unusableHome, 'not a directory');
    const badEnv = { ...ENV, HOME: unusableHome };
    const url = await start(dir, payloadPath, 'bad-home', [], badEnv);
    try {
      const nonce = nonceOf(await (await fetch(url)).text());
      assert.equal((await post(url, '/answer', { nonce, outcome: 'tie' })).status, 200);
      const collected = await run(dir, ['--wait', '--key', 'bad-home', '--poll', '8'], badEnv);
      assert.equal(collected.code, 0, collected.out);
      assert.match(collected.out, /^COMPARISON: /m, 'the existing detached answer file survives');
      assert.match(collected.out, /^serve-compare: verdict was not recorded: .+$/m);
      assert.equal(existsSync(comparisonFile(unusableHome)), false);
    } finally {
      await run(dir, ['--stop', '--key', 'bad-home'], badEnv);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('--no-record skips the store while preserving the detached answer file path', async () => {
    const { dir, payloadPath } = workspace();
    const before = comparisons().length;
    const url = await start(dir, payloadPath, 'skip', ['--no-record']);
    try {
      const nonce = nonceOf(await (await fetch(url)).text());
      assert.equal((await post(url, '/answer', { nonce, outcome: 'b' })).status, 200);
      const collected = await run(dir, ['--wait', '--key', 'skip', '--poll', '8']);
      assert.equal(collected.code, 0, collected.out);
      assert.match(collected.out, /^COMPARISON: /m);
      assert.match(collected.out, /^serve-compare: verdict recording skipped \(--no-record\)$/m);
      await new Promise((resolve) => setTimeout(resolve, 250));
      assert.equal(comparisons().length, before);
    } finally {
      await run(dir, ['--stop', '--key', 'skip']);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('--stop kills the server and clears its state, and --wait then reports it gone', async () => {
    const { dir, payloadPath } = workspace();
    const url = await start(dir, payloadPath, 'st');
    const state = path.join(dir, '.impeccable', 'compare', 'st.state.json');
    assert.equal(existsSync(state), true);

    const stopped = await run(dir, ['--stop', '--key', 'st']);
    assert.equal(stopped.code, 0, stopped.out);
    assert.match(stopped.out, /stopped/);
    assert.equal(existsSync(state), false, 'no state file left behind to confuse the next round');

    await assert.rejects(fetch(url), 'the port is closed');

    const orphaned = await run(dir, ['--wait', '--key', 'st', '--poll', '3']);
    assert.equal(orphaned.code, 2, orphaned.out);
    assert.match(orphaned.out, /gone with no verdict/);
    rmSync(dir, { recursive: true, force: true });
  });

  it('refuses to open a table it cannot actually compare', async () => {
    const { dir, a } = workspace();
    const half = path.join(dir, 'half.json');
    writeFileSync(half, JSON.stringify({ a: { id: 'one', screen: a } }));
    const missing = path.join(dir, 'missing.json');
    writeFileSync(missing, JSON.stringify({ a: { id: 'one', screen: a }, b: { id: 'two', screen: path.join(dir, 'gone.html') } }));
    try {
      // A one-sided table would present as a comparison and collect a verdict about
      // nothing, which is worse than not opening.
      const oneSided = await run(dir, ['--payload', half, '--no-open']);
      assert.equal(oneSided.code, 1, oneSided.out);
      assert.match(oneSided.out, /needs both a and b/);

      const ghost = await run(dir, ['--payload', missing, '--no-open']);
      assert.equal(ghost.code, 1, ghost.out);
      assert.match(ghost.out, /candidate b needs an existing screen file/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('--schema teaches the binary verdict and the annotation shape', async () => {
    const { dir } = workspace();
    try {
      const schema = await run(dir, ['--schema']);
      assert.equal(schema.code, 0, schema.out);
      assert.match(schema.out, /"screen": "\/abs\/path\/a\.html"/);
      assert.match(schema.out, /"outcome":"a"\|"b"\|"tie"/);
      assert.match(schema.out, /kind:"keep"\|"dislike"\|"note"/);
      assert.match(schema.out, /two live pages, not two pictures/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
