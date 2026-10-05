// Real rendered screens on the decision page. FORK-ONLY delta inside
// skill/scripts/serve-question.mjs.
//
// What these tests are really guarding: the decision round asks him to choose a
// direction, and a card is a picture of one. When the run has actually built the
// first viewport, the card should show that page, live, and the answer should hand
// the file back so the build matches what he approved instead of reinterpreting
// art. So the assertions are about the whole path of one screen: registered at
// load, framed on the card, servable as html and only from the registry, and named
// in the ANSWER with the directive that it outranks the card.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync, mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { findEngineBinary, engineEnv, ENGINE_MISSING_MESSAGE } from './lib/engine-bin.mjs';
import { armLiveServerReaper } from './lib/live-servers.mjs';

armLiveServerReaper();

const BIN = findEngineBinary();

// The real ledger lives in the home dir, so a test run must never append to it.
// HOME is also pointed at a scratch dir as a mechanism, not just an opt-out flag:
// the next home-writing module wired into serve-question must not reach the real
// home from this test either.
const FAKE_HOME = mkdtempSync(path.join(tmpdir(), 'serve-question-home-'));
const ENV = engineEnv(BIN, { HOME: FAKE_HOME, USERPROFILE: FAKE_HOME, IMPECCABLE_NO_TASTE_LEDGER: '1' });
after(() => rmSync(FAKE_HOME, { recursive: true, force: true }));

/** The page embeds a per-server nonce; only requests carrying it may answer. */
const nonceOf = (html) => html.match(/const NONCE = '([0-9a-f]+)'/)?.[1];

const SCREEN_A = '<!doctype html><meta charset="utf-8"><title>Departures</title><main><h1>DEPARTURES</h1></main>';
const SCREEN_B = '<!doctype html><meta charset="utf-8"><title>Arrivals</title><main><h1>ARRIVALS</h1></main>';
// Never fetched by anything here: it only has to survive into the markup verbatim.
const HERO_URL = 'https://impeccable.style/worlds/cards/fillmore-handbill-hero.webp';

/** A tmp workspace holding two screens; the server's cwd, so .impeccable lands here. */
function workspace() {
  const dir = mkdtempSync(path.join(tmpdir(), 'serve-question-screen-'));
  const a = path.join(dir, 'a.html');
  const b = path.join(dir, 'b.html');
  writeFileSync(a, SCREEN_A);
  writeFileSync(b, SCREEN_B);
  return { dir, a, b };
}

const run = (dir, args, extraEnv = {}) => new Promise((resolve) => {
  const child = spawn(BIN, ['serve-question', ...args], { cwd: dir, env: { ...ENV, ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (chunk) => { out += chunk; });
  child.stderr.on('data', (chunk) => { out += chunk; });
  child.on('exit', (code) => resolve({ code, out }));
});

/** Blocking mode: the URL arrives on stdout and the caller owns the process. */
function serveBlocking(dir, payloadPath) {
  const child = spawn(BIN, ['serve-question', '--payload', payloadPath, '--no-open', '--timeout', '20'], {
    cwd: dir, env: ENV, stdio: ['ignore', 'pipe', 'ignore'],
  });
  return new Promise((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => reject(new Error(`no URL in output: ${out}`)), 10000);
    child.stdout.on('data', (chunk) => {
      out += chunk;
      const match = out.match(/QUESTION URL: (http:\/\/127\.0\.0\.1:\d+\/)/);
      if (match) { clearTimeout(timer); resolve({ child, url: match[1] }); }
    });
  });
}

describe('serve-question rendered screens', { skip: !BIN && ENGINE_MISSING_MESSAGE }, () => {
  it('frames the live screen, serves it as html, and returns it as the build reference', async () => {
    const { dir, a } = workspace();
    const payloadPath = path.join(dir, 'q.json');
    writeFileSync(payloadPath, JSON.stringify({
      title: 'Choose the visual world',
      question: 'One is built, one is dealt.',
      options: [
        { id: 'built', label: 'Swiss Timetable', lineage: 'SBB departure boards', screen: a, hero: HERO_URL },
        { id: 'dealt', label: 'Fillmore Handbill', kicker: 'THE ROLL', hero: HERO_URL },
      ],
      steer: true,
    }));

    const started = await run(dir, ['--start', '--payload', payloadPath, '--no-open', '--key', 'sk']);
    assert.equal(started.code, 0, started.out);
    const url = started.out.match(/QUESTION URL: (\S+)/)?.[1];
    assert.ok(url, started.out);

    try {
      const html = await (await fetch(url)).text();
      // The screen card shows the page itself, in the media box, with its own way
      // in, and the frame is sandboxed so the screen's JS cannot reach this page.
      assert.match(html, /<div class="media screen">/);
      assert.match(html, /<iframe src="\/screen\/0" sandbox="allow-scripts" title="Swiss Timetable">/);
      assert.match(html, /Full screen/);
      // Full screen opens the same untrusted page as a tab: no opener handle back to this page.
      assert.match(html, /window\.open\(b\.dataset\.src, '_blank', 'noopener'\)/);
      // The build-path toggle carries the nonce the server now requires in screen rounds.
      assert.match(html, /JSON\.stringify\(\{ value, nonce: NONCE \}\)/);
      assert.match(html, /\.media\.screen \{[^}]*aspect-ratio: 16\/9/);
      assert.match(html, /width: 1280px; height: 720px/);
      assert.match(html, /String\(w \/ 1280\)/);
      assert.doesNotMatch(html.match(/<iframe[^>]+>/)?.[0] || '', /loading="lazy"/);
      assert.doesNotMatch(html, /M5 2\.5 L13\.5|class="brand-logo"/);
      assert.match(html, /class="wordmark"/);
      assert.match(html, /fetch\('\/answer' \+ keyQ/);
      assert.match(html, /nonce: NONCE/);
      const builtFront = html.match(/data-id="built"[\s\S]*?<div class="face front[\s\S]*?<div class="body">/)?.[0];
      assert.ok(builtFront);
      assert.doesNotMatch(builtFront, /<img/);
      // The dealt card is untouched by the delta: same img, same source string.
      assert.ok(html.includes(`<img src="${HERO_URL}" alt="">`), html.slice(0, 400));

      const served = await fetch(new URL('/screen/0', url));
      assert.equal(served.status, 200);
      assert.match(served.headers.get('content-type'), /text\/html/);
      // Opened as a top-level tab, the screen must still run sandboxed, never with this origin.
      assert.match(served.headers.get('content-security-policy') || '', /sandbox allow-scripts/);
      assert.equal((await served.text()).trim(), SCREEN_A);

      // b.html sits in the same directory and no card points at it. The per-round
      // registry is the allow-list, so the server is not a reader of local files.
      assert.equal((await fetch(new URL('/screen/1', url))).status, 404);

      // A screen round refuses an answer without the page's nonce: a framed
      // screen firing a bare POST cannot forge his choice. The key rides along
      // so this reaches OUR nonce gate rather than stopping at upstream's
      // session-key check (401), which only guards the detached mode; without
      // --key the nonce is the whole defence.
      assert.equal((await fetch(new URL('/answer', url), {
        method: 'POST', body: JSON.stringify({ optionId: 'built', nonce: nonceOf(html) }),
      })).status, 401, 'the detached key gate runs before the nonce');
      const forged = await fetch(new URL('/answer?key=sk', url), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ optionId: 'dealt', steer: 'forged from a frame' }),
      });
      assert.equal(forged.status, 403);
      // The build-path flip is the other POST a framed screen could fire; same gate.
      const forgedFlip = await fetch(new URL('/build-path?key=sk', url), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ value: 'comp' }),
      });
      assert.equal(forgedFlip.status, 403);

      const nonce = nonceOf(html);
      assert.ok(nonce, 'the page embeds its answer nonce');
      const answered = await fetch(new URL('/answer?key=sk', url), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ optionId: 'built', steer: 'keep the density', nonce }),
      });
      assert.equal(answered.status, 200);

      const collected = await run(dir, ['--wait', '--key', 'sk', '--poll', '5']);
      assert.equal(collected.code, 0, collected.out);
      // The ORIGINAL path, not the /screen/N route: the caller reads the file
      // after this server is gone.
      assert.ok(collected.out.includes(`"screen":"${a}"`), collected.out);
      assert.ok(collected.out.includes(`CHOSEN SCREEN: ${a}`), collected.out);
      assert.match(collected.out, /outranks any card/);
      assert.ok(collected.out.indexOf('CHOSEN SCREEN:') < collected.out.indexOf('CHOSEN CARD:'));
    } finally {
      const stopped = await run(dir, ['--stop', '--key', 'sk']);
      assert.equal(stopped.code, 0, stopped.out);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a screen path that is not there leaves a text card, not a broken frame', async () => {
    const { dir } = workspace();
    const payloadPath = path.join(dir, 'q.json');
    writeFileSync(payloadPath, JSON.stringify({
      options: [{ id: 'ghost', label: 'Missing Screen', body: 'the text still reads', screen: path.join(dir, 'gone.html') }],
    }));
    const { child, url } = await serveBlocking(dir, payloadPath);
    try {
      const html = await (await fetch(url)).text();
      assert.doesNotMatch(html, /<iframe/);
      assert.match(html, /class="face front lead text-only"/);
      assert.match(html, /Missing Screen/);
      assert.equal((await fetch(new URL('/screen/0', url))).status, 404);
    } finally {
      child.kill();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('--update re-registers screens for the new round', async () => {
    // The exact mutation a refactor makes: dropping the registry reset in
    // loadRound would ship round 1's screen behind round 2's card.
    const { dir, a, b } = workspace();
    const p1 = path.join(dir, 'q1.json');
    const p2 = path.join(dir, 'q2.json');
    writeFileSync(p1, JSON.stringify({ options: [{ id: 'one', label: 'Round One', screen: a }], reroll: true }));
    writeFileSync(p2, JSON.stringify({ options: [{ id: 'two', label: 'Round Two', screen: b }] }));

    const started = await run(dir, ['--start', '--payload', p1, '--no-open', '--key', 'uk']);
    assert.equal(started.code, 0, started.out);
    const url = started.out.match(/QUESTION URL: (\S+)/)?.[1];
    assert.ok(url, started.out);

    try {
      const round1 = await (await fetch(url)).text();
      assert.equal((await (await fetch(new URL('/screen/0', url))).text()).trim(), SCREEN_A);

      const rerolled = await fetch(new URL('/answer?key=uk', url), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ optionId: 'reroll', nonce: nonceOf(round1) }),
      });
      assert.equal(rerolled.status, 200);
      const updated = await run(dir, ['--update', '--key', 'uk', '--payload', p2]);
      assert.equal(updated.code, 0, updated.out);

      // The reload consumes the pending round and rebuilds the registry.
      const round2 = await (await fetch(url)).text();
      assert.match(round2, /Round Two/);
      assert.equal(nonceOf(round2), nonceOf(round1));
      assert.equal((await (await fetch(new URL('/screen/0', url))).text()).trim(), SCREEN_B);
      assert.equal((await fetch(new URL('/screen/1', url))).status, 404);
    } finally {
      const stopped = await run(dir, ['--stop', '--key', 'uk']);
      assert.equal(stopped.code, 0, stopped.out);
      rmSync(dir, { recursive: true, force: true });
    }
  });


  it('attached screens reject forged answers and both asset routes survive vanished files', async () => {
    const { dir, a } = workspace();
    const image = path.join(dir, 'hero.svg');
    const payloadPath = path.join(dir, 'q.json');
    writeFileSync(image, '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    writeFileSync(payloadPath, JSON.stringify({ options: [{ id: 'built', label: 'Built', screen: a, hero: image }] }));
    const { child, url } = await serveBlocking(dir, payloadPath);
    try {
      const html = await (await fetch(url)).text();
      assert.equal((await fetch(new URL('/answer', url), { method: 'POST', body: '{"optionId":"built"}' })).status, 403);
      assert.equal((await fetch(new URL('/img/0', url))).status, 200);
      assert.equal((await fetch(new URL('/screen/0', url))).status, 200);
      rmSync(a);
      rmSync(image);
      assert.equal((await fetch(new URL('/img/0', url))).status, 404);
      assert.equal((await fetch(new URL('/screen/0', url))).status, 404);
      assert.equal((await fetch(url)).status, 200, 'vanished assets leave the server alive');
      assert.equal((await fetch(new URL('/answer', url), {
        method: 'POST', body: JSON.stringify({ optionId: 'built', nonce: nonceOf(html) }),
      })).status, 200);
    } finally {
      child.kill();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('card-only answers remain open and taste recording retains the JS ledger shape', async () => {
    const { dir } = workspace();
    const payloadPath = path.join(dir, 'q.json');
    const options = [{ id: 'one', label: 'One', lineage: 'Rail' }, { id: 'two', label: 'Two' }];
    writeFileSync(payloadPath, JSON.stringify({ title: 'Taste', options }));
    try {
      for (const mode of ['record', 'opt-out', 'unwritable']) {
        const home = path.join(dir, mode);
        if (mode === 'unwritable') writeFileSync(home, 'not a directory');
        const extra = { HOME: home, USERPROFILE: home, IMPECCABLE_NO_TASTE_LEDGER: mode === 'opt-out' ? '1' : '' };
        const started = await run(dir, ['--start', '--payload', payloadPath, '--no-open', '--key', mode], extra);
        assert.equal(started.code, 0, started.out);
        const url = started.out.match(/QUESTION URL: (\S+)/)?.[1];
        try {
          assert.equal((await fetch(new URL('/answer?key=' + mode, url), {
            method: 'POST', body: JSON.stringify({ optionId: 'one', steer: '  keep density  ' }),
          })).status, 200, 'card-only rounds need no nonce');
          const collected = await run(dir, ['--wait', '--key', mode, '--poll', '5'], extra);
          assert.equal(collected.code, 0, collected.out);
          assert.match(collected.out, /"optionId":"one"/);
          const ledger = path.join(home, '.impeccable', 'taste.jsonl');
          if (mode === 'record') {
            const entry = JSON.parse(readFileSync(ledger, 'utf8'));
            const { buildEntry } = await import('../skill/scripts/melzi/taste-ledger.mjs');
            assert.deepEqual(entry, buildEntry({ optionId: 'one', steer: '  keep density  ', options, title: 'Taste', project: realpathSync(dir), at: entry.at }));
          } else {
            assert.equal(existsSync(ledger), false);
          }
        } finally {
          await run(dir, ['--stop', '--key', mode], extra);
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('--schema teaches the screen field and what it outranks', async () => {
    const { dir } = workspace();
    try {
      const schema = await run(dir, ['--schema']);
      assert.equal(schema.code, 0, schema.out);
      assert.match(schema.out, /"screen": "\/abs\/path\/swiss-timetable\.html"/);
      assert.match(schema.out, /wins the face over hero\/board/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
