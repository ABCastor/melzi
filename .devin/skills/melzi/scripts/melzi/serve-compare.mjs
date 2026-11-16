#!/usr/bin/env node
/**
 * The comparison table: two live screens side by side, and a page he can point at.
 *
 * FORK-ONLY. This is its own server, not an extension of serve-question.mjs.
 * serve-question is upstream's file and already carries a fork delta; adding a
 * second mode to it would widen that delta every release. It reuses the mechanics
 * that file proved (daemonize via --start, state + answer files, heartbeat,
 * --wait/--stop, the answer nonce, the scaled live-screen card) and shares its
 * visual language, so the two pages read as one tool.
 *
 * WHY THIS EXISTS. The owner cannot review a design and has said so plainly. What he
 * CAN do, reliably, is say which of these two, and point at a thing he does not
 * like. The old surface gave him neither: the screens arrived as pictures and the
 * only feedback channel was a single text box at the end of the round. His words for
 * what was wrong: "the feedback system to steer you needs to be more connected to
 * the page itself, so I can click on something and write something for you to steer
 * on there, and maybe give me options. It needs to be a lot more interactive. Not
 * just at the end a little prompt that says what should be different or kept."
 *
 * So the annotation layer is not a side feature, it is the product. Clicking
 * anywhere in either screen drops a numbered pin exactly where he clicked and opens
 * a popover with six quick chips and a free-text field. The chips exist because
 * typing is friction and most of his feedback fits six buttons. The free text exists
 * because his actual feedback does not: "I don't like the two triangles at the top,
 * but I really like how the layers move between each other" is not a button.
 *
 * ONE CLICK IS ONE STATEMENT. A chip commits its pin immediately and the popover
 * stays open with the text field focused, so a second chip or a typed note about the
 * same spot is one more click, not a re-open. Stacked pins nudge sideways so the
 * count at a spot is visible. Nothing is committed by a click that says nothing.
 *
 * THE VERDICT IS BINARY, FOREVER. Prefer left, Tie, Prefer right. No slider, no
 * 1-10. A non-designer asked to score gives you noise dressed as data; asked to
 * choose, he gives you a real bit. The pairwise fit downstream needs exactly that.
 *
 * INJECTION, AND WHY THE FILE ON DISK IS NEVER TOUCHED. The annotation script goes
 * into the /screen/N RESPONSE only. The candidate screen is a build artifact that
 * later steps read, diff and ship; rewriting it to make this page work would make
 * the tool's own instrumentation part of the deliverable. /screen/N/raw serves the
 * pristine bytes, and it is what the "Full screen" chip opens, so the thing he can
 * inspect at full size is the real file.
 *
 * THE ORIGIN CHECK THAT IS NOT A CHECK. The frames are sandbox="allow-scripts" with
 * no allow-same-origin, which makes them opaque-origin: every message they send
 * arrives with event.origin === "null". Comparing that string proves nothing, since
 * any other opaque-origin frame produces the same value. The parent verifies
 * event.source against its own iframes' contentWindow instead, which is identity
 * rather than a label. The POST routes are nonce-gated for the same reason
 * serve-question gates its answer: a framed screen runs real JS by design.
 *
 * FAILURE POLICY. Losing a pin must never cost him the comparison. Every write is
 * defensive and the verdict path never depends on the annotation path having worked.
 */
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readComparisons } from './taste-store.mjs';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : fallback;
}
const hasFlag = (name) => process.argv.includes(`--${name}`);

if (process.env.IMPECCABLE_QUESTION_DISABLED) {
  console.log('serve-compare: disabled in this session (no browser); ask the two-way question in text instead.');
  process.exit(2);
}
// Headless self-detection, applied only where a browser is actually wanted, exactly
// as serve-question scopes it: --wait polls a daemon whose browser was settled at
// --start, --stop kills one, --schema prints text. A spurious exit 2 from those
// would break the documented poll loop.
const wantsBrowser = !hasFlag('no-open') && !hasFlag('wait') && !hasFlag('stop') && !hasFlag('schema');
if (wantsBrowser && !process.env.IMPECCABLE_QUESTION_FORCE) {
  const headless =
    process.env.CI ||
    (process.env.SSH_CONNECTION && !process.env.DISPLAY) ||
    (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY);
  if (headless) {
    console.log('serve-compare: no browser detected in this environment (CI/headless/remote). Set IMPECCABLE_QUESTION_FORCE=1 to serve anyway.');
    process.exit(2);
  }
}

const payloadPath = arg('payload');
const timeoutSec = Number(arg('timeout', '1800'));
const portArg = Number(arg('port', '0'));
const COMPARE_DIR = path.join(process.cwd(), '.impeccable', 'compare');
const stateFile = (key) => path.join(COMPARE_DIR, `${key}.state.json`);
const answerFile = (key) => path.join(COMPARE_DIR, `${key}.answer.json`);
const DEFAULT_INTUITION_SECONDS = 3;
const DEFAULT_INTUITION_CAP = 8;

function boundedNumber(value, fallback, { min, max, integer = false } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max || (integer && !Number.isInteger(number))) return fallback;
  return number;
}

function intuitionConfig(input = {}) {
  const supplied = input?.intuition && typeof input.intuition === 'object' ? input.intuition : null;
  if (!hasFlag('intuition') && !supplied) return null;
  const session = arg('intuition-session', supplied?.session);
  if (typeof session !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(session)) {
    throw new Error('intuition mode needs --intuition-session <letters, numbers, _ or -> so its fatigue cap has a real session boundary');
  }
  const timerSeconds = boundedNumber(arg('intuition-seconds', supplied?.timerSeconds ?? DEFAULT_INTUITION_SECONDS), DEFAULT_INTUITION_SECONDS, { min: 0, max: 60 });
  const cap = boundedNumber(arg('intuition-cap', supplied?.cap ?? DEFAULT_INTUITION_CAP), DEFAULT_INTUITION_CAP, { min: 1, max: 50, integer: true });
  const completed = readComparisons().filter((row) => row?.intuition?.session === session).length;
  const stopping = supplied?.stopping && typeof supplied.stopping.session === 'string'
    ? { session: supplied.stopping.session }
    : null;
  return { session, timerSeconds, cap, completed, ...(stopping ? { stopping } : {}) };
}

function intuitionCompleteMessage(config) {
  return `serve-compare: intuition session ${config.session} ended after ${config.completed} choice${config.completed === 1 ? '' : 's'} (cap ${config.cap}) to prevent fatigue. Start a new session or run without --intuition.`;
}

function forwardedIntuitionArgs() {
  const out = [];
  if (hasFlag('intuition')) out.push('--intuition');
  for (const name of ['intuition-session', 'intuition-seconds', 'intuition-cap']) {
    const value = arg(name);
    if (value !== null) out.push(`--${name}`, value);
  }
  return out;
}

/** The six chips, and the annotation kind each one produces. */
const CHIPS = [
  { label: 'Keep this', kind: 'keep', text: 'keep this' },
  { label: 'Too loud', kind: 'dislike', text: 'too loud' },
  { label: 'Too big', kind: 'dislike', text: 'too big' },
  { label: 'Too small', kind: 'dislike', text: 'too small' },
  { label: 'Remove this', kind: 'dislike', text: 'remove this' },
  { label: 'Confusing', kind: 'dislike', text: 'confusing' },
];
const KINDS = new Set(['keep', 'dislike', 'note']);

// Both answer channels (blocking stdout and --wait collection) print through this.
// The annotations are printed in plain language as well as JSON: they are the
// steer, they are in his own words, and a model reading this stdout should not have
// to parse a blob to find the one sentence that decides the next build.
function printComparison(raw) {
  console.log(`COMPARISON: ${raw}`);
  try {
    const parsed = JSON.parse(raw);
    const annotations = Array.isArray(parsed.annotations) ? parsed.annotations : [];
    annotations.forEach((a, i) => {
      const where = a.target?.selector ? ` @ ${a.target.selector}` : '';
      const what = a.target?.text ? ` "${a.target.text}"` : '';
      console.log(`HIS WORDS: #${i + 1} ${a.candidate} (${a.kind})${where}${what} :: ${a.text}`);
    });
    if (annotations.length) {
      console.log('Those are regions he pointed at on the actual screen, in his own words. Treat a keep as a region to carry into the next candidate verbatim, and a dislike as a constraint. They outrank any general taste profile, because they are about this page.');
    }
    if (parsed.outcome === 'tie') {
      console.log('TIE: he could not separate them, so nothing about the pair is settled. Do not read a tie as approval of either; the annotations are the whole signal from this round.');
    }
  } catch { /* raw answer */ }
}

if (hasFlag('schema')) {
  console.log(JSON.stringify({
    title: 'Which one is closer?',
    question: 'Two candidates for the same screen. Click anything in either one to say what you think of it.',
    a: { id: 'wpa-park-poster', label: 'WPA Park Poster', lineage: '1930s WPA national park posters', screen: '/abs/path/a.html' },
    b: { id: 'swiss-timetable', label: 'Swiss Timetable', lineage: 'SBB departure boards', screen: '/abs/path/b.html' },
    profile: 'prefers generous whitespace\ndislikes three-column layouts\nneutral on serif vs sans',
    comparisons: 3,
    steer: true,
  }, null, 2));
  console.log('\nBoth a and b need an existing local .html file at "screen": this page compares two live pages, not two pictures.');
  console.log('"profile" is rendered verbatim in the taste panel; pass the output of taste-store --profile. "comparisons" is the honest count behind it and is shown next to it, including 0.');
  console.log('The answer is {"outcome":"a"|"b"|"tie","a":id,"b":id,"annotations":[...],"steer":"..."}. An annotation is {candidate,kind:"keep"|"dislike"|"note",target:{selector,text,rect},text}.');
  process.exit(0);
}

if (hasFlag('wait')) {
  const key = arg('key');
  if (!key) { console.error('serve-compare: --wait needs --key'); process.exit(1); }
  const pollSec = Number(arg('poll', '60'));
  const deadline = Date.now() + pollSec * 1000;
  const answered = () => fs.existsSync(answerFile(key));
  const alive = () => {
    try { process.kill(JSON.parse(fs.readFileSync(stateFile(key), 'utf8')).pid, 0); return true; }
    catch { return false; }
  };
  let sawClose = false;
  while (Date.now() < deadline) {
    if (answered()) break;
    if (!alive()) {
      console.log('serve-compare: the comparison server is gone with no verdict');
      process.exit(2);
    }
    try {
      const state = JSON.parse(fs.readFileSync(stateFile(key), 'utf8'));
      if (state.lastBeat && Date.now() - state.lastBeat > 15000) { sawClose = true; break; }
    } catch { /* state mid-write */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (sawClose && !answered()) {
    console.log('PAGE CLOSED: the comparison page went away without a verdict; re-present or reopen the URL');
    process.exit(4);
  }
  if (!answered()) { console.log(`WAITING: no verdict yet after ${pollSec}s; run --wait --key ${key} again`); process.exit(3); }
  const collected = fs.readFileSync(answerFile(key), 'utf8').trim();
  let recordMessage = null;
  try {
    const state = JSON.parse(fs.readFileSync(stateFile(key), 'utf8'));
    recordMessage = typeof state.recordMessage === 'string' ? state.recordMessage : null;
  } catch { /* the comparison answer still stands */ }
  printComparison(collected);
  if (recordMessage) console.log(recordMessage);
  try { fs.rmSync(answerFile(key)); } catch { /* already gone */ }
  try { fs.rmSync(stateFile(key)); } catch { /* already gone */ }
  process.exit(0);
}

if (hasFlag('stop')) {
  const key = arg('key');
  if (!key) { console.error('serve-compare: --stop needs --key'); process.exit(1); }
  try { process.kill(JSON.parse(fs.readFileSync(stateFile(key), 'utf8')).pid); } catch { /* dead already */ }
  try { fs.rmSync(answerFile(key)); } catch {}
  try { fs.rmSync(stateFile(key)); } catch {}
  console.log('stopped');
  process.exit(0);
}

if (hasFlag('start')) {
  if (!payloadPath) { console.error('serve-compare: --start needs --payload <file>'); process.exit(1); }
  let startPayload;
  try { startPayload = JSON.parse(fs.readFileSync(payloadPath, 'utf8')); } catch (error) { console.error(`serve-compare: ${error.message}`); process.exit(1); }
  try {
    const config = intuitionConfig(startPayload);
    if (config && config.completed >= config.cap) { console.log(intuitionCompleteMessage(config)); process.exit(0); }
  } catch (error) { console.error(`serve-compare: ${error.message}`); process.exit(1); }
  fs.mkdirSync(COMPARE_DIR, { recursive: true });
  const key = arg('key') || Math.random().toString(16).slice(2, 10);
  const child = spawn(process.execPath, [
    fileURLToPath(import.meta.url), '--payload', payloadPath, '--detached-serve', '--key', key,
    '--timeout', String(timeoutSec), ...(hasFlag('open') ? [] : ['--no-open']),
    ...(hasFlag('no-record') ? ['--no-record'] : []),
    ...forwardedIntuitionArgs(),
  ], { detached: true, stdio: 'ignore' });
  child.unref();
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline && !fs.existsSync(stateFile(key))) await new Promise((r) => setTimeout(r, 100));
  if (!fs.existsSync(stateFile(key))) { console.error('serve-compare: server failed to start'); process.exit(1); }
  const state = JSON.parse(fs.readFileSync(stateFile(key), 'utf8'));
  console.log(`COMPARE URL: ${state.url}`);
  console.log(`COMPARE KEY: ${key}`);
  console.log('Open the URL for the user now: in-app browser when the harness has one, otherwise the system opener (macOS `open`, Linux `xdg-open`), otherwise show the URL.');
  console.log(`Then collect the verdict with: node ${fileURLToPath(import.meta.url)} --wait --key ${key}`);
  process.exit(0);
}

let raw;
if (payloadPath) raw = fs.readFileSync(payloadPath, 'utf8');
else raw = fs.readFileSync(0, 'utf8');

// Only the comparison page itself may annotate or answer. The screens are served
// same-origin to this server and run real JS by design, so without the page's nonce
// a framed screen could forge a verdict, the one outcome this whole surface exists
// to prevent. Minted per server, embedded only in page(), never in a served screen.
const ANSWER_NONCE = crypto.randomBytes(16).toString('hex');

let payload;
let candidates;
let intuition = null;
let stoppingRule = null;
/** The per-round allow-list: only a file a candidate points at is servable. */
let localScreens = [];

function loadRound(json) {
  const parsed = JSON.parse(json);
  payload = parsed;
  intuition = intuitionConfig(parsed);
  stoppingRule = parsed?.stoppingRule && typeof parsed.stoppingRule === 'object' ? parsed.stoppingRule : null;
  if (parsed?.terminal || parsed?.barReview) {
    candidates = [];
    localScreens = [];
    return;
  }
  const pair = [parsed?.a, parsed?.b];
  if (!pair[0] || !pair[1]) throw new Error('payload needs both a and b');
  localScreens = [];
  candidates = pair.map((candidate, index) => {
    const abs = candidate.screen ? path.resolve(candidate.screen) : null;
    // A missing screen is fatal here, unlike serve-question where a card can fall
    // back to text. There is nothing to compare without two live pages.
    if (!abs || !fs.existsSync(abs)) throw new Error(`candidate ${index === 0 ? 'a' : 'b'} needs an existing screen file`);
    localScreens.push(abs);
    return {
      id: String(candidate.id ?? (index === 0 ? 'a' : 'b')),
      label: candidate.label ?? candidate.id ?? (index === 0 ? 'Left' : 'Right'),
      lineage: candidate.lineage ?? null,
      screen: abs,
      screenSrc: `/screen/${index}`,
    };
  });
  if (intuition && intuition.completed >= intuition.cap) throw new Error(intuitionCompleteMessage(intuition));
}
try { loadRound(raw); } catch (error) { console.error(`serve-compare: ${error.message}`); process.exit(1); }
const detachedKey = hasFlag('detached-serve') ? arg('key') : null;

/**
 * Pins live here for the life of the server. `n` is a monotonic counter, never an
 * array index, so deleting pin 2 does not renumber pin 3 under him mid-session.
 *
 * The stored `annotation` is exactly the contract shape and nothing else: the pin
 * bookkeeping (id, n, frame, point) is this page's business and stays out of the
 * record the model and the store read. They are held in memory only; a server that
 * dies before the verdict loses them, which is the same bargain the question page
 * already makes and is honest for a surface he is looking at while he uses it.
 */
let pins = [];
let pinCounter = 0;

const clientPin = (pin) => ({
  id: pin.id, n: pin.n, frame: pin.frame, point: pin.point,
  kind: pin.annotation.kind, text: pin.annotation.text, target: pin.annotation.target,
});

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/** Safe to drop inside a <script>: the only sequence that can close it is escaped. */
const json = (value) => JSON.stringify(value).replace(/</g, '\\u003c');

/**
 * The script injected into a served screen. Never written to disk: the candidate
 * file stays exactly what the build produced.
 *
 * postMessage targets '*' because an opaque-origin frame cannot name its parent's
 * origin. That is not the security boundary and is not pretending to be: the parent
 * checks event.source identity against its own contentWindows.
 */
function annotateScript(index) {
  return `
<style>
  html { cursor: crosshair !important; }
  .__imp-hl { outline: 2px solid oklch(84% 0.19 80.46) !important; outline-offset: 2px !important; }
</style>
<script>(function(){
  if (window.__impAnnotate) return;
  window.__impAnnotate = true;
  var FRAME = ${index};
  var hot = null;

  // nth-of-type path. Stable enough to re-find the region in the source, cheap
  // enough to compute on every click, and readable by a human in the report.
  function selectorFor(el) {
    var parts = [], node = el, guard = 0;
    while (node && node.nodeType === 1 && node !== document.documentElement && guard++ < 8) {
      if (node.id && /^[A-Za-z][\\w-]*$/.test(node.id)) { parts.unshift('#' + node.id); break; }
      var part = node.tagName.toLowerCase(), parent = node.parentElement;
      if (parent) {
        var same = [], kids = parent.children;
        for (var i = 0; i < kids.length; i++) if (kids[i].tagName === node.tagName) same.push(kids[i]);
        if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(node) + 1) + ')';
      }
      parts.unshift(part);
      node = parent;
    }
    return parts.join(' > ') || 'body';
  }

  function norm(v) { return Math.round(Math.max(0, Math.min(1, v)) * 10000) / 10000; }

  function clearHot() {
    if (hot && hot.classList) hot.classList.remove('__imp-hl');
    hot = null;
  }
  document.addEventListener('mousemove', function (e) {
    var el = e.target && e.target.nodeType === 1 ? e.target : null;
    if (el === hot) return;
    clearHot();
    hot = el;
    if (hot && hot.classList) hot.classList.add('__imp-hl');
  }, true);
  // Without these the outline is stranded on whatever he last passed over, which
  // reads as a selection he did not make.
  document.documentElement.addEventListener('mouseleave', clearHot);
  window.addEventListener('blur', clearHot);

  // Capture phase, and cancelled: a click here means "I want to say something about
  // this", never "navigate". A link that took the frame somewhere else would lose
  // the thing he was pointing at.
  document.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    var el = e.target && e.target.nodeType === 1 ? e.target : document.body;
    if (!el) return;
    var r = el.getBoundingClientRect();
    var w = window.innerWidth || 1, h = window.innerHeight || 1;
    var text = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
    if (text.length > 80) text = text.slice(0, 79) + '\\u2026';
    try {
      parent.postMessage({
        impeccable: 'annotate-click',
        frame: FRAME,
        selector: selectorFor(el),
        text: text || null,
        rect: { x: norm(r.left / w), y: norm(r.top / h), w: norm(r.width / w), h: norm(r.height / h) },
        point: { x: norm(e.clientX / w), y: norm(e.clientY / h) }
      }, '*');
    } catch (err) { /* the screen keeps working even if the parent went away */ }
  }, true);

  document.addEventListener('submit', function (e) { e.preventDefault(); }, true);
})();<\/script>`;
}

function panel(candidate, index) {
  const side = index === 0 ? 'LEFT' : 'RIGHT';
  return `
    <section class="panel" data-frame="${index}">
      <div class="panel-head">
        <span class="side">${side}</span>
        <h2>${esc(candidate.label)}</h2>
        ${candidate.lineage ? `<p class="tier">${esc(candidate.lineage)}</p>` : ''}
      </div>
      <div class="stage">
        <iframe class="screen" src="${esc(candidate.screenSrc)}" sandbox="allow-scripts" title="${esc(candidate.label)}"></iframe>
        <div class="pins" aria-hidden="true"></div>
        <div class="popover" hidden>
          <p class="pop-target"></p>
          <div class="pop-chips">${CHIPS.map((c, i) => `<button type="button" class="pchip" data-chip="${i}">${esc(c.label)}</button>`).join('')}</div>
          <div class="pop-write">
            <input class="pop-text" placeholder="or say it in your own words">
            <button type="button" class="pop-add">Add</button>
          </div>
          <p class="pop-said"></p>
          <button type="button" class="pop-close" aria-label="Close">Done</button>
        </div>
        <div class="chips"><button type="button" class="chip full" data-src="${esc(candidate.screenSrc)}/raw">Full screen</button></div>
      </div>
      <div class="notes">
        <p class="notes-head">What you said about ${esc(candidate.label)} <span class="count">0</span></p>
        <ul class="note-list"></ul>
      </div>
    </section>`;
}

function page() {
  if (payload.terminal) {
    const winner = payload.winner?.label ?? payload.winner?.id ?? 'The selected candidate';
    return `<!doctype html><meta charset="utf-8"><title>Melzi · session complete</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#12110f;color:#f4f2eb;font:18px/1.5 system-ui;padding:2rem}.done{max-width:44rem;text-align:center}.wordmark{display:block;color:#e9bb46;font-size:12px;letter-spacing:.18em;text-transform:uppercase;margin-bottom:1rem}h1{font-size:2.6rem;margin:.2rem 0}p{color:#c5c2ba}</style><main class="done"><span class="wordmark">Melzi</span><h1>${esc(winner)}</h1><p>${esc(payload.question || 'The session is over.')}</p><p>Early candidates remain available. No further pair will be dealt in this session.</p></main>`;
  }
  if (payload.barReview) {
    const bar = stoppingRule?.derivedBar;
    const value = Number.isFinite(Number(bar?.value)) ? Number(bar.value) : '';
    const spread = Array.isArray(bar?.spread) && bar.spread.length
      ? `<ul>${bar.spread.map((row) => `<li>${esc(row.label)}: ${Number(row.score).toFixed(2)} ± ${Number(row.uncertainty).toFixed(2)}, cautious bound ${Number(row.lowerBound).toFixed(2)}</li>`).join('')}</ul>`
      : '<p>The calibration candidates could not be separated on shared recorded attributes.</p>';
    return `<!doctype html><meta charset="utf-8"><title>Melzi · set the bar</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#12110f;color:#f4f2eb;font:16px/1.55 system-ui;padding:2rem}main{max-width:48rem;border:1px solid #6d6658;padding:2rem}h1{margin-top:0}p,li{color:#c5c2ba}input,button{font:inherit;padding:.65rem}.row{display:flex;gap:.7rem;flex-wrap:wrap}button{background:#e9bb46;color:#17130d;border:0;cursor:pointer}</style><main><h1>Set the quality bar</h1><p>${esc(bar?.evidence || 'The calibration bar is unavailable.')}</p><p>Derived from: ${esc(bar?.method || 'no separable calibration bar')}.</p>${spread}<form id="bar"><div class="row"><input id="value" type="number" step="any" value="${esc(value)}" aria-label="Quality bar"><button>Fix this bar</button></div></form><p id="result" aria-live="polite"></p></main><script>const form=document.getElementById('bar');form.addEventListener('submit',async(e)=>{e.preventDefault();const response=await fetch('/bar',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({value:document.getElementById('value').value})});const body=await response.json();document.getElementById('result').textContent=body.ok?'Bar fixed. The agent can deal the next candidate.':'Could not fix the bar: '+(body.message||'unknown error');if(body.ok)form.querySelectorAll('input,button').forEach(x=>x.disabled=true);});</script>`;
  }
  const count = Number.isFinite(payload.comparisons) ? payload.comparisons : 0;
  const profileText = typeof payload.profile === 'string' ? payload.profile.trim() : '';
  const intuitionState = intuition ? {
    session: intuition.session,
    timerSeconds: intuition.timerSeconds,
    cap: intuition.cap,
    completed: intuition.completed,
  } : null;
  const intuitionNote = intuition
    ? `<aside class="intuition" aria-live="polite"><span>Intuition session</span><strong id="intuition-clock">${intuition.timerSeconds > 0 ? `${intuition.timerSeconds.toFixed(1)} seconds` : 'Timer off for this session'}</strong><small>${intuition.completed + 1} of ${intuition.cap}. It ends at the cap to prevent fatigue.</small></aside>`
    : '';
  const calibration = stoppingRule?.phase === 'calibration';
  const budgetHistory = Array.isArray(stoppingRule?.budgetChanges) && stoppingRule.budgetChanges.length
    ? ` Budget changed: ${stoppingRule.budgetChanges.map((change) => `${change.from} to ${change.to}`).join(', ')}.`
    : '';
  const stoppingNote = stoppingRule
    ? `<aside class="intuition stopping" aria-live="polite"><span>${calibration ? 'Calibration' : 'Selection'}</span><strong>${calibration ? `${stoppingRule.calibrationComparisonsRemaining} comparison${stoppingRule.calibrationComparisonsRemaining === 1 ? '' : 's'} before the bar is set` : `Candidate budget: ${stoppingRule.seenCandidates} of ${stoppingRule.candidateCap}`}</strong><small>${calibration ? 'Votes are recorded. Rankings and selection stay hidden until the bar exists.' : 'The bar is fixed for this session.'}${esc(budgetHistory)}</small></aside>`
    : '';
  return `<!doctype html>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(payload.title || 'Melzi · which one')}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Albert+Sans:wght@400;500;600&family=Alumni+Sans:wght@100;400&display=swap" rel="stylesheet">
<style>
  /* Neo kinpaku tokens, the same set the decision page carries, so the two surfaces
     read as one tool rather than two scripts that happen to share a repo. */
  :root {
    color-scheme: dark;
    --ks-kinpaku: oklch(84% 0.19 80.46);
    --ks-kinpaku-pale: oklch(86% 0.07 84);
    --ks-kinpaku-deep: oklch(61% 0.085 78);
    --ks-dark-ink: oklch(14% 0.018 95);
    --ks-patina: oklch(70% 0.12 188);
    --ks-vermilion: oklch(64% 0.18 30);
    --ks-lacquer: oklch(7% 0.006 95);
    --ks-lacquer-raised: oklch(11% 0.006 95);
    --ks-graphite: oklch(15% 0.008 95);
    --ks-champagne: oklch(91% 0 0);
    --ks-text: oklch(88% 0 0);
    --ks-text-muted: oklch(72% 0 0);
    --ks-text-faint: oklch(62% 0 0);
    --ks-rule: oklch(78% 0 0 / 0.16);
    --ks-font-display: "Alumni Sans", "Albert Sans", Arial, sans-serif;
    --ks-font: "Albert Sans", "Avenir Next", "Helvetica Neue", Arial, system-ui, sans-serif;
    --ks-mono: "SFMono-Regular", "Roboto Mono", "JetBrains Mono", Consolas, monospace;
  }
  * { box-sizing: border-box; margin: 0; }
  body { background: var(--ks-lacquer); color: var(--ks-text); font: 15px/1.55 var(--ks-font); padding: 1.6rem clamp(1rem, 4vw, 3rem) 2rem; min-height: 100dvh; display: flex; flex-direction: column; gap: 1.4rem; }
  header, main, footer { width: 100%; max-width: 108rem; margin: 0 auto; }
  /* Typographic wordmark only, matching the decision page: the borrowed logomark is
     gone and no Melzi glyph stands in for it, because a mark authored in passing is
     the one nobody re-examines. The colour lives on .wordmark rather than on .brand
     so the completion state, which has no .brand wrapper, reads the same. */
  .brand { display: flex; align-items: center; gap: .55rem; color: var(--ks-kinpaku); }
  .wordmark { font-family: var(--ks-font-display); font-weight: 400; font-size: 1.125rem; letter-spacing: 0.15em; text-transform: uppercase; line-height: 1; color: var(--ks-kinpaku); }
  h1 { font-family: var(--ks-font-display); font-weight: 100; font-size: clamp(2.4rem, 4.4vw, 3.8rem); letter-spacing: -0.01em; line-height: 1.02; color: var(--ks-champagne); margin-top: .5rem; }
  .question { color: var(--ks-text-muted); margin-top: .55rem; max-width: 54rem; }
  main { flex: 1; }
  .table { display: grid; gap: 1.4rem; grid-template-columns: repeat(auto-fit, minmax(min(26rem, 100%), 1fr)); }
  .panel { display: flex; flex-direction: column; gap: .75rem; }
  .panel-head { display: flex; flex-direction: column; gap: .15rem; }
  .side { font-family: var(--ks-mono); font-size: .625rem; letter-spacing: .28em; color: var(--ks-kinpaku); }
  .panel h2 { font-size: 1.15rem; font-weight: 500; color: var(--ks-champagne); }
  .tier { font-family: var(--ks-mono); font-size: .625rem; letter-spacing: .2em; text-transform: uppercase; color: var(--ks-text-faint); }
  /* 1280x900 is a real desktop viewport; the stage reserves that ratio and one
     uniform scale fits the frame exactly, measured on load and on resize because
     the grid is fluid. */
  .stage { position: relative; width: 100%; aspect-ratio: 1280/900; overflow: hidden; background: var(--ks-graphite); border: 1px solid var(--ks-rule); border-radius: 10px; }
  .stage iframe { position: absolute; top: 0; left: 0; width: 1280px; height: 900px; border: 0; background: var(--ks-champagne); transform: scale(var(--screen-scale, 0.4)); transform-origin: top left; }
  .pins { position: absolute; inset: 0; pointer-events: none; }
  /* The kind classes are namespaced k-*. Without the prefix a free-text pin, whose
     kind is literally "note", takes the .note list-item box below and renders as a
     grey lozenge instead of a dot. Chromium found that; the HTTP tests could not. */
  .pin { position: absolute; width: 22px; height: 22px; margin: -11px 0 0 -11px; border-radius: 50%; background: var(--ks-kinpaku); color: var(--ks-dark-ink); font-family: var(--ks-mono); font-size: .68rem; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 10px oklch(0% 0 0 / 0.55); pointer-events: auto; cursor: default; }
  .pin.k-keep { background: var(--ks-patina); }
  .pin.k-dislike { background: var(--ks-vermilion); color: var(--ks-champagne); }
  .pin.k-ghost { background: transparent; border: 2px dashed var(--ks-kinpaku); color: var(--ks-kinpaku); box-shadow: none; }
  .popover { position: absolute; z-index: 5; width: 20rem; max-width: calc(100% - 1.2rem); padding: .8rem; background: var(--ks-lacquer-raised); border: 1px solid var(--ks-kinpaku-deep); border-radius: 9px; box-shadow: 0 20px 50px oklch(0% 0 0 / 0.6); display: flex; flex-direction: column; gap: .55rem; }
  .popover[hidden] { display: none; }
  .pop-target { font-family: var(--ks-mono); font-size: .6rem; letter-spacing: .12em; color: var(--ks-text-faint); text-transform: uppercase; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pop-chips { display: flex; flex-wrap: wrap; gap: 5px; }
  .pchip { padding: 5px 10px; font-family: var(--ks-font); font-size: .8rem; color: var(--ks-text); background: transparent; border: 1px solid var(--ks-rule); border-radius: 999px; cursor: pointer; transition: color .15s, border-color .15s; }
  .pchip:hover { color: var(--ks-kinpaku); border-color: var(--ks-kinpaku-deep); }
  .pop-write { display: flex; gap: 6px; }
  .pop-text { flex: 1; min-width: 0; background: var(--ks-lacquer); color: var(--ks-text); border: 1px solid var(--ks-rule); border-radius: 6px; padding: .45rem .6rem; font: inherit; font-size: .86rem; }
  .pop-text:focus { outline: none; border-color: var(--ks-patina); }
  .pop-add, .pop-close { background: var(--ks-kinpaku); color: var(--ks-dark-ink); border: 0; border-radius: 6px; padding: .45rem .9rem; font: inherit; font-size: .82rem; cursor: pointer; }
  .pop-close { align-self: flex-end; background: transparent; color: var(--ks-text-faint); padding: .2rem .3rem; }
  .pop-said { font-size: .78rem; color: var(--ks-patina); min-height: 0; }
  .pop-said:empty { display: none; }
  .chips { position: absolute; z-index: 1; right: 10px; bottom: 10px; }
  .chip { padding: 4px 9px; font-family: var(--ks-mono); font-size: .625rem; letter-spacing: .18em; text-transform: uppercase; color: var(--ks-text); background: oklch(7% 0.006 95 / 0.72); border: 1px solid var(--ks-rule); border-radius: 5px; cursor: pointer; backdrop-filter: blur(4px); }
  .chip:hover { color: var(--ks-kinpaku); border-color: var(--ks-kinpaku-deep); }
  .notes-head { font-family: var(--ks-mono); font-size: .625rem; letter-spacing: .2em; text-transform: uppercase; color: var(--ks-text-faint); }
  .notes-head .count { color: var(--ks-kinpaku); }
  .note-list { list-style: none; padding: 0; margin: .5rem 0 0; display: flex; flex-direction: column; gap: .35rem; }
  .note { display: flex; gap: .55rem; align-items: baseline; padding: .4rem .55rem; background: var(--ks-lacquer-raised); border: 1px solid var(--ks-rule); border-radius: 7px; }
  .note .num { font-family: var(--ks-mono); font-size: .68rem; color: var(--ks-kinpaku); flex: none; }
  .note .said { flex: 1; font-size: .86rem; }
  .note .said em { color: var(--ks-text-faint); font-style: normal; font-family: var(--ks-mono); font-size: .68rem; }
  .note .drop { flex: none; background: transparent; border: 0; color: var(--ks-text-faint); cursor: pointer; font-size: 1rem; line-height: 1; padding: 0 .2rem; }
  .note .drop:hover { color: var(--ks-vermilion); }
  footer { display: flex; flex-direction: column; gap: 1rem; }
  .verdict { display: flex; gap: .8rem; justify-content: center; flex-wrap: wrap; }
  .verdict button { font-family: var(--ks-font); font-size: 1rem; font-weight: 500; padding: 11px 30px; border-radius: 6px; cursor: pointer; border: 1px solid var(--ks-kinpaku); background: var(--ks-kinpaku); color: var(--ks-dark-ink); transition: background .15s; }
  .verdict button:hover { background: var(--ks-kinpaku-pale); }
  .verdict button#tie { background: transparent; color: var(--ks-text-muted); border-color: var(--ks-rule); }
  .verdict button#tie:hover { color: var(--ks-kinpaku); border-color: var(--ks-kinpaku-deep); background: transparent; }
  .intuition { display: flex; align-items: baseline; justify-content: center; gap: .65rem; flex-wrap: wrap; padding: .7rem 1rem; border: 1px solid var(--ks-patina); border-radius: 7px; color: var(--ks-text-muted); }
  .intuition span, .intuition small { font-family: var(--ks-mono); font-size: .64rem; letter-spacing: .12em; text-transform: uppercase; }
  .intuition strong { color: var(--ks-patina); font-size: 1rem; font-weight: 500; }
  #steer { width: 100%; background: var(--ks-lacquer-raised); color: var(--ks-text); border: 1px solid var(--ks-rule); border-radius: 7px; padding: .6rem .85rem; font: inherit; }
  #steer:focus { outline: none; border-color: var(--ks-patina); }
  .profile { border-top: 1px solid var(--ks-rule); padding-top: .9rem; display: flex; gap: 1.4rem; flex-wrap: wrap; align-items: flex-start; }
  .profile h3 { font-family: var(--ks-mono); font-size: .625rem; letter-spacing: .2em; text-transform: uppercase; color: var(--ks-text-faint); font-weight: 400; flex: none; width: 12rem; }
  .profile-body { font-family: var(--ks-font); font-size: .9rem; color: var(--ks-text-muted); white-space: pre-wrap; flex: 1; min-width: 16rem; margin: 0; }
  .profile-count { font-family: var(--ks-mono); font-size: .68rem; color: var(--ks-kinpaku); flex: none; }
  .done { display: flex; flex-direction: column; align-items: center; gap: 1rem; padding: 7rem 1rem; font-family: var(--ks-font-display); font-size: 1.4rem; color: var(--ks-champagne); text-align: center; }
</style>
<header>
  <div class="brand">
    <span class="wordmark">Melzi</span>
  </div>
  <h1>${esc(payload.title || 'Which one is closer?')}</h1>
  <p class="question">${esc(payload.question || 'Click anything in either screen to say what you think of it. Then pick one, or call it a tie.')}</p>
</header>
<main>
  <div class="table">
${candidates.map(panel).join('\n')}
  </div>
</main>
<footer>
  ${intuitionNote}
  ${stoppingNote}
  <div class="verdict">
    <button id="prefer-a">Prefer left</button>
    <button id="tie">Tie</button>
    <button id="prefer-b">Prefer right</button>
  </div>
  ${payload.steer === false ? '' : '<input id="steer" placeholder="Anything about the pair as a whole? Optional.">'}
  ${calibration ? '' : `<div class="profile">
    <h3>Your taste so far</h3>
    <p class="profile-body">${profileText ? esc(profileText) : 'Nothing learned yet. It starts forming after the first comparison.'}</p>
    <span class="profile-count">${count === 1 ? '1 comparison' : `${count} comparisons`}</span>
  </div>`}
</footer>
<script>
  const NONCE = '${ANSWER_NONCE}';
  const INTUITION = ${json(intuitionState)};
  const CANDIDATES = ${json(candidates.map((c) => ({ id: c.id, label: c.label })))};
  const CHIPS = ${json(CHIPS)};
  let pins = ${json(pins.map(clientPin))};

  const beat = () => { try { navigator.sendBeacon('/heartbeat'); } catch { fetch('/heartbeat', { method: 'POST' }); } };
  beat();
  setInterval(beat, 5000);

  const panels = [...document.querySelectorAll('.panel')];
  const frames = panels.map(p => p.querySelector('iframe.screen'));

  // The frame lays out at 1280x900 and is scaled into the stage, so a click point
  // normalized against the frame viewport lands on the same spot of the stage box.
  const fit = () => panels.forEach(p => {
    const stage = p.querySelector('.stage');
    if (stage.clientWidth) stage.style.setProperty('--screen-scale', String(stage.clientWidth / 1280));
  });
  fit();
  addEventListener('resize', fit);

  document.querySelectorAll('.chip.full').forEach(b => b.addEventListener('click', () => window.open(b.dataset.src, '_blank')));

  // ---- pins -------------------------------------------------------------

  function renderPins() {
    panels.forEach((panel, frame) => {
      const mine = pins.filter(p => p.frame === frame);
      const layer = panel.querySelector('.pins');
      layer.innerHTML = '';
      mine.forEach(pin => {
        // Two pins about the same spot nudge apart so the count there is visible.
        const stacked = mine.filter(o => o.n < pin.n && Math.abs(o.point.x - pin.point.x) < 0.02 && Math.abs(o.point.y - pin.point.y) < 0.02).length;
        const dot = document.createElement('div');
        dot.className = 'pin k-' + pin.kind;
        dot.style.left = 'calc(' + (pin.point.x * 100) + '% + ' + (stacked * 15) + 'px)';
        dot.style.top = (pin.point.y * 100) + '%';
        dot.textContent = String(pin.n);
        dot.title = pin.text;
        layer.appendChild(dot);
      });
      const list = panel.querySelector('.note-list');
      panel.querySelector('.count').textContent = String(mine.length);
      list.innerHTML = '';
      mine.forEach(pin => {
        const li = document.createElement('li');
        li.className = 'note';
        const num = document.createElement('span');
        num.className = 'num';
        num.textContent = '#' + pin.n;
        const said = document.createElement('span');
        said.className = 'said';
        said.textContent = pin.text;
        if (pin.target && pin.target.text) {
          const where = document.createElement('em');
          where.textContent = '  on "' + pin.target.text + '"';
          said.appendChild(where);
        }
        const drop = document.createElement('button');
        drop.className = 'drop';
        drop.type = 'button';
        drop.setAttribute('aria-label', 'Delete pin ' + pin.n);
        drop.textContent = '\\u00d7';
        drop.addEventListener('click', () => dropPin(pin.id));
        li.append(num, said, drop);
        list.appendChild(li);
      });
    });
  }

  async function dropPin(id) {
    pins = pins.filter(p => p.id !== id);
    renderPins();
    try {
      await fetch('/annotation/delete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, nonce: NONCE }) });
    } catch { /* the page already reflects it; the verdict re-sends nothing */ }
  }

  // ---- the popover ------------------------------------------------------

  let open = null;   // { frame, selector, text, rect, point }

  function closePopover() {
    panels.forEach(p => { p.querySelector('.popover').hidden = true; });
    // A click that said nothing leaves nothing behind.
    pins = pins.filter(p => !p.provisional);
    open = null;
    renderPins();
  }

  function openPopover(frame, hit) {
    panels.forEach(p => { p.querySelector('.popover').hidden = true; });
    pins = pins.filter(p => !p.provisional);
    open = { frame, selector: hit.selector, text: hit.text, rect: hit.rect, point: hit.point };

    const panel = panels[frame];
    const stage = panel.querySelector('.stage');
    const pop = panel.querySelector('.popover');
    pop.querySelector('.pop-target').textContent = hit.text ? hit.text : hit.selector;
    pop.querySelector('.pop-said').textContent = '';
    pop.querySelector('.pop-text').value = '';
    pop.hidden = false;
    // Keep the popover inside the stage on both axes.
    const px = Math.min(Math.max(hit.point.x * stage.clientWidth + 16, 8), Math.max(stage.clientWidth - pop.offsetWidth - 8, 8));
    const py = Math.min(Math.max(hit.point.y * stage.clientHeight + 14, 8), Math.max(stage.clientHeight - pop.offsetHeight - 8, 8));
    pop.style.left = px + 'px';
    pop.style.top = py + 'px';

    // The pin appears the instant he clicks, before he has said anything, because
    // seeing the mark land is what makes the surface feel like pointing.
    pins.push({ id: 'provisional', n: '', frame, point: hit.point, kind: 'ghost', text: '', target: null, provisional: true });
    renderPins();
    pop.querySelector('.pop-text').focus();
  }

  async function commit(kind, text) {
    if (!open || !text) return;
    const body = {
      nonce: NONCE,
      candidate: CANDIDATES[open.frame].id,
      frame: open.frame,
      kind,
      text,
      point: open.point,
      target: { selector: open.selector, text: open.text, rect: open.rect },
    };
    let saved = null;
    try {
      const res = await fetch('/annotate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (res.ok) saved = (await res.json()).pin;
    } catch { /* fall through */ }
    if (!saved) return;
    pins = pins.filter(p => !p.provisional).concat(saved);
    renderPins();
    const pop = panels[open.frame].querySelector('.popover');
    pop.querySelector('.pop-said').textContent = 'Pin ' + saved.n + ': ' + saved.text;
    const field = pop.querySelector('.pop-text');
    field.value = '';
    field.focus();
    // The popover deliberately stays open: one click is one statement, and a second
    // thing about the same spot should cost one more click, not a re-open.
  }

  panels.forEach((panel, frame) => {
    const pop = panel.querySelector('.popover');
    pop.querySelectorAll('.pchip').forEach(b => b.addEventListener('click', () => {
      const chip = CHIPS[Number(b.dataset.chip)];
      commit(chip.kind, chip.text);
    }));
    const field = pop.querySelector('.pop-text');
    const add = () => { const v = field.value.trim(); if (v) commit('note', v); };
    pop.querySelector('.pop-add').addEventListener('click', add);
    field.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    pop.querySelector('.pop-close').addEventListener('click', closePopover);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePopover(); });

  // ---- the message gate -------------------------------------------------

  // The frames are opaque-origin (sandbox without allow-same-origin), so every
  // message arrives with origin "null" and checking that string proves nothing.
  // Identity is the check: the sender must BE one of our own frames.
  addEventListener('message', (event) => {
    const frame = frames.findIndex(f => f && f.contentWindow === event.source);
    if (frame === -1) return;
    const hit = event.data;
    if (!hit || hit.impeccable !== 'annotate-click' || !hit.point) return;
    openPopover(frame, hit);
  });

  // ---- the verdict ------------------------------------------------------

  const responseStartedAt = Date.now();
  let answering = false;
  let intuitionTimer = null;

  function stopIntuitionTimer() {
    if (intuitionTimer !== null) clearInterval(intuitionTimer);
    intuitionTimer = null;
  }

  function startIntuitionTimer() {
    if (!INTUITION || INTUITION.timerSeconds <= 0) return;
    const clock = document.getElementById('intuition-clock');
    const deadline = responseStartedAt + INTUITION.timerSeconds * 1000;
    const tick = () => {
      const remaining = Math.max(0, deadline - Date.now());
      if (clock) clock.textContent = (remaining / 1000).toFixed(1) + ' seconds';
      if (remaining <= 0) {
        stopIntuitionTimer();
        verdict('tie', { timedOut: true });
      }
    };
    tick();
    intuitionTimer = setInterval(tick, 50);
  }

  async function verdict(outcome, { timedOut = false } = {}) {
    if (answering) return;
    answering = true;
    stopIntuitionTimer();
    document.querySelectorAll('.verdict button').forEach((button) => { button.disabled = true; });
    const steer = document.getElementById('steer')?.value || '';
    const responseMs = Math.max(1, Date.now() - responseStartedAt);
    await fetch('/answer', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ outcome, steer, nonce: NONCE, responseMs: INTUITION ? responseMs : undefined, timedOut: INTUITION ? timedOut : undefined }) });
    const completed = INTUITION && INTUITION.completed + 1 >= INTUITION.cap;
    document.body.innerHTML = '<div class="done"><span class="wordmark">Melzi</span>' + (completed ? ${json(intuition ? 'Intuition session complete. It stopped at the cap to prevent fatigue.' : '')} : 'Recorded. The agent is resuming; you can close this tab.') + '</div>';
  }
  document.getElementById('prefer-a').addEventListener('click', () => verdict('a'));
  document.getElementById('prefer-b').addEventListener('click', () => verdict('b'));
  document.getElementById('tie').addEventListener('click', () => verdict('tie'));

  renderPins();
  startIntuitionTimer();
</script>`;
}

const readBody = (req) => new Promise((resolve) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve({}); } });
});

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(page());
    return;
  }
  if (req.method === 'POST' && req.url === '/heartbeat') {
    res.writeHead(204); res.end();
    if (detachedKey) {
      const now = Date.now();
      if (!server.lastBeatWrite || now - server.lastBeatWrite > 4000) {
        server.lastBeatWrite = now;
        try {
          const state = JSON.parse(fs.readFileSync(stateFile(detachedKey), 'utf8'));
          state.lastBeat = now;
          fs.writeFileSync(stateFile(detachedKey), JSON.stringify(state));
        } catch { /* state file recreated on next beat */ }
      }
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/bar') {
    const parsed = await readBody(req);
    try {
      const { lockStoppingBar } = await import('./taste-store.mjs');
      const result = lockStoppingBar(intuition?.stopping?.session ?? stoppingRule?.session, parsed.value);
      res.writeHead(result.ok ? 200 : 400, { 'content-type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end('{"ok":false,"message":"Could not save the stopping bar."}');
    }
    return;
  }

  // The pristine bytes. Checked FIRST so /raw never falls into the injected route,
  // and served straight from the file so a byte comparison against the source is
  // the honest test that the disk copy is untouched.
  const rawMatch = req.method === 'GET' && req.url?.match(/^\/screen\/(\d+)\/raw$/);
  if (rawMatch) {
    const abs = localScreens[Number(rawMatch[1])];
    if (!abs) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    fs.createReadStream(abs).on('error', () => res.destroy()).pipe(res);
    return;
  }
  const screenMatch = req.method === 'GET' && req.url?.match(/^\/screen\/(\d+)$/);
  if (screenMatch) {
    const index = Number(screenMatch[1]);
    const abs = localScreens[index];
    if (!abs) { res.writeHead(404); res.end(); return; }
    let source;
    try { source = fs.readFileSync(abs, 'utf8'); } catch { res.writeHead(404); res.end(); return; }
    const script = annotateScript(index);
    // Before </body> when there is one, appended when there is not. Either way the
    // script lands in the body and the document above it is byte-for-byte the file.
    const injected = source.includes('</body>')
      ? source.replace('</body>', `${script}\n</body>`)
      : source + script;
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(injected);
    return;
  }

  if (req.method === 'POST' && req.url === '/annotate') {
    const parsed = await readBody(req);
    if (parsed.nonce !== ANSWER_NONCE) { res.writeHead(403); res.end(); return; }
    const frame = parsed.frame === 1 ? 1 : 0;
    const text = typeof parsed.text === 'string' ? parsed.text.trim() : '';
    // A pin with nothing said is not feedback.
    if (!text) { res.writeHead(400); res.end('{"ok":false}'); return; }
    const t = parsed.target && typeof parsed.target === 'object' ? parsed.target : null;
    const pin = {
      id: crypto.randomBytes(8).toString('hex'),
      n: ++pinCounter,
      frame,
      point: {
        x: Number(parsed.point?.x) || 0,
        y: Number(parsed.point?.y) || 0,
      },
      annotation: {
        candidate: typeof parsed.candidate === 'string' && parsed.candidate ? parsed.candidate : candidates[frame].id,
        kind: KINDS.has(parsed.kind) ? parsed.kind : 'note',
        target: t ? {
          selector: typeof t.selector === 'string' ? t.selector : null,
          text: typeof t.text === 'string' && t.text ? t.text.slice(0, 80) : null,
          rect: t.rect && typeof t.rect === 'object' ? {
            x: Number(t.rect.x) || 0, y: Number(t.rect.y) || 0,
            w: Number(t.rect.w) || 0, h: Number(t.rect.h) || 0,
          } : null,
        } : null,
        text,
      },
    };
    pins.push(pin);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, pin: clientPin(pin) }));
    return;
  }

  if (req.method === 'POST' && req.url === '/annotation/delete') {
    const parsed = await readBody(req);
    if (parsed.nonce !== ANSWER_NONCE) { res.writeHead(403); res.end(); return; }
    const before = pins.length;
    pins = pins.filter((p) => p.id !== parsed.id);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, removed: before - pins.length }));
    return;
  }

  if (req.method === 'GET' && req.url === '/annotations') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ annotations: pins.map((p) => p.annotation) }));
    return;
  }

  if (req.method === 'POST' && req.url === '/answer') {
    const parsed = await readBody(req);
    if (parsed.nonce !== ANSWER_NONCE) { res.writeHead(403); res.end(); return; }
    const outcome = parsed.outcome === 'a' || parsed.outcome === 'b' || parsed.outcome === 'tie' ? parsed.outcome : null;
    if (!outcome) { res.writeHead(400); res.end('{"ok":false}'); return; }
    const timedOut = parsed.timedOut === true;
    const responseMs = Number(parsed.responseMs);
    if (timedOut && (!intuition || outcome !== 'tie')) { res.writeHead(400); res.end('{"ok":false}'); return; }
    if (intuition && (!Number.isFinite(responseMs) || responseMs <= 0)) { res.writeHead(400); res.end('{"ok":false}'); return; }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
    const answerObject = {
      outcome,
      a: candidates[0].id,
      b: candidates[1].id,
      annotations: pins.map((p) => p.annotation),
      steer: typeof parsed.steer === 'string' ? parsed.steer.trim() : '',
    };
    if (intuition) {
      answerObject.responseMs = responseMs;
      answerObject.timedOut = timedOut;
      answerObject.intuition = {
        session: intuition.session,
        timerSeconds: intuition.timerSeconds,
        cap: intuition.cap,
      };
    }
    const answer = JSON.stringify(answerObject);
    let recordMessage;
    if (hasFlag('no-record')) {
      recordMessage = 'serve-compare: verdict recording skipped (--no-record)';
    } else {
      try {
        const { recordVerdict } = await import('./taste-session.mjs');
        const recorded = recordVerdict(answerObject);
        if (!recorded) throw new Error('the taste store rejected the verdict');
        recordMessage = 'serve-compare: verdict recorded in the taste store';
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        recordMessage = `serve-compare: verdict was not recorded: ${reason}`;
      }
    }
    if (detachedKey) {
      fs.mkdirSync(COMPARE_DIR, { recursive: true });
      try {
        const state = JSON.parse(fs.readFileSync(stateFile(detachedKey), 'utf8'));
        state.recordMessage = recordMessage;
        fs.writeFileSync(stateFile(detachedKey), JSON.stringify(state));
      } catch { /* answer file remains the source of truth */ }
      fs.writeFileSync(answerFile(detachedKey), answer + '\n');
    } else {
      printComparison(answer);
    }
    console.log(recordMessage);
    setTimeout(() => process.exit(0), 150);
    return;
  }

  res.writeHead(404); res.end();
});

server.listen(portArg, '127.0.0.1', () => {
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}/`;
  if (hasFlag('detached-serve')) {
    fs.mkdirSync(COMPARE_DIR, { recursive: true });
    fs.writeFileSync(stateFile(arg('key')), JSON.stringify({ pid: process.pid, port, url }));
  } else {
    console.log(`COMPARE URL: ${url}`);
    console.log('Waiting for the verdict in the browser (Ctrl-C aborts)...');
  }
  if (!hasFlag('no-open')) {
    const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    try { spawn(opener, [url], { stdio: 'ignore', detached: true }).unref(); } catch { /* URL printed anyway */ }
  }
  if (timeoutSec > 0) {
    setTimeout(() => {
      console.log('serve-compare: timed out with no verdict');
      process.exit(2);
    }, timeoutSec * 1000).unref?.();
  }
});
