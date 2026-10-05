// The taste ledger. FORK-ONLY (skill/scripts/melzi/taste-ledger.mjs).
//
// What these tests are really guarding: the visual-direction round is the only
// place the owner's own taste enters the tool as data, and it used to be deleted
// moments after being read. So the assertions are about the SHAPE of the recorded
// line, especially that the REFUSED options survive. A pick is one bit about a hand
// of three; the refusals are the rest, and a re-roll refuses the whole hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildEntry, recordChoice, readLedger, ledgerPath, LEDGER_VERSION } from '../skill/scripts/melzi/taste-ledger.mjs';

const AT = '2026-07-28T09:00:00.000Z';

const HAND = [
  { id: 'assigned', label: 'Fillmore Handbill', lineage: '1966-71 Fillmore psychedelic handbills', hero: 'https://x/h.webp', board: 'https://x/b.webp', body: 'long prose' },
  { id: 'challenger-teletext', label: 'Teletext Service', lineage: 'broadcast teletext magazines' },
  { id: 'challenger-swiss', label: 'Swiss Timetable', lineage: 'SBB timetables' },
];

function withHome(fn) {
  const home = mkdtempSync(join(tmpdir(), 'melzi-taste-'));
  try { return fn(home); } finally { rmSync(home, { recursive: true, force: true }); }
}

test('a pick records the chosen world AND every refused one, by name', () => {
  const entry = buildEntry({ optionId: 'challenger-teletext', steer: '', options: HAND, title: 'Choose the visual world', project: '/p/app', at: AT });

  assert.equal(entry.v, LEDGER_VERSION);
  assert.equal(entry.kind, 'pick');
  assert.equal(entry.at, AT);
  assert.deepEqual(entry.chosen, { id: 'challenger-teletext', label: 'Teletext Service', lineage: 'broadcast teletext magazines' });

  // The whole point. Without this the ledger is one bit about a hand of three.
  assert.deepEqual(entry.refused.map((o) => o.label), ['Fillmore Handbill', 'Swiss Timetable']);
  assert.equal(entry.project, '/p/app');
  assert.equal(entry.title, 'Choose the visual world');
});

test('card art and body copy are dropped; only identifying fields are kept', () => {
  const entry = buildEntry({ optionId: 'assigned', options: HAND, at: AT });
  assert.deepEqual(Object.keys(entry.chosen).sort(), ['id', 'label', 'lineage']);
  assert.equal('hero' in entry.chosen, false);
  assert.equal('body' in entry.chosen, false);
});

test('a genesis screen path is identity, not noise, and survives into the record', () => {
  const withScreen = [{ id: 'built', label: 'Round One', screen: '/tmp/x/screen-built.html' }, HAND[1]];
  const entry = buildEntry({ optionId: 'built', options: withScreen, at: AT });
  assert.equal(entry.chosen.screen, '/tmp/x/screen-built.html');
  assert.equal('screen' in entry.refused[0], false, 'options without one gain nothing');
});

// A re-roll is the strongest signal the table can produce: he looked at the whole
// hand and rejected all of it. Recording it as a pick of nothing would lose that.
test('a re-roll refuses the ENTIRE hand and chooses nothing', () => {
  const entry = buildEntry({ optionId: 'reroll', options: HAND, at: AT });
  assert.equal(entry.kind, 'reroll');
  assert.equal(entry.chosen, null);
  assert.deepEqual(entry.refused.map((o) => o.id), ['assigned', 'challenger-teletext', 'challenger-swiss']);
});

test('canon refuses every offered world in favour of the category standard', () => {
  const entry = buildEntry({ optionId: 'canon', options: HAND, at: AT });
  assert.equal(entry.kind, 'canon');
  assert.equal(entry.chosen, null);
  assert.equal(entry.refused.length, 3);
});

test('a typed steer is kept, an empty or blank one is not a signal', () => {
  assert.equal(buildEntry({ optionId: 'assigned', steer: '  less brown, more contrast ', options: HAND, at: AT }).steer, 'less brown, more contrast');
  assert.equal('steer' in buildEntry({ optionId: 'assigned', steer: '   ', options: HAND, at: AT }), false);
  assert.equal('steer' in buildEntry({ optionId: 'assigned', options: HAND, at: AT }), false);
});

test('recordChoice appends one line per choice and round-trips', () => withHome((home) => {
  assert.equal(recordChoice({ optionId: 'assigned', options: HAND, project: '/p/a' }, { home, now: AT }), true);
  assert.equal(recordChoice({ optionId: 'reroll', options: HAND, project: '/p/b' }, { home, now: AT }), true);

  const raw = fs.readFileSync(ledgerPath(home), 'utf8');
  assert.equal(raw.split('\n').filter(Boolean).length, 2, 'append-only, one line per choice');
  assert.ok(raw.endsWith('\n'), 'trailing newline so the next append cannot corrupt the last line');

  const rows = readLedger({ home });
  assert.deepEqual(rows.map((r) => r.kind), ['pick', 'reroll']);
  assert.deepEqual(rows.map((r) => r.project), ['/p/a', '/p/b']);
}));

test('the ledger lives in the HOME dir, so taste compounds across projects', () => {
  assert.match(ledgerPath('/Users/x'), /^\/Users\/x\/\.impeccable\/taste\.jsonl$/);
});

test('a missing ledger reads as empty rather than throwing', () => withHome((home) => {
  assert.deepEqual(readLedger({ home }), []);
}));

test('a truncated final line is tolerated, not fatal', () => withHome((home) => {
  recordChoice({ optionId: 'assigned', options: HAND }, { home, now: AT });
  fs.appendFileSync(ledgerPath(home), '{"v":1,"kind":"pi');
  assert.equal(readLedger({ home }).length, 1, 'the intact line still reads');
}));

// Never cost him his answer. The question flow must survive a broken ledger.
test('recordChoice never throws, and reports false instead', () => withHome((home) => {
  assert.equal(recordChoice(null, { home }), false);
  assert.equal(recordChoice({ steer: 'x', options: HAND }, { home }), false, 'no optionId means no answer');

  // Home path occupied by a FILE, so mkdir of .impeccable must fail.
  const wedged = join(home, 'wedged');
  fs.mkdirSync(wedged);
  fs.writeFileSync(join(wedged, '.impeccable'), 'not a directory');
  assert.equal(recordChoice({ optionId: 'assigned', options: HAND }, { home: wedged }), false);
}));

test('the opt-out env var disables recording', () => withHome((home) => {
  const prev = process.env.IMPECCABLE_NO_TASTE_LEDGER;
  process.env.IMPECCABLE_NO_TASTE_LEDGER = '1';
  try {
    assert.equal(recordChoice({ optionId: 'assigned', options: HAND }, { home }), false);
    assert.equal(fs.existsSync(ledgerPath(home)), false);
  } finally {
    if (prev === undefined) delete process.env.IMPECCABLE_NO_TASTE_LEDGER;
    else process.env.IMPECCABLE_NO_TASTE_LEDGER = prev;
  }
}));

test('a hand with no options still records the action without inventing refusals', () => {
  const entry = buildEntry({ optionId: 'reroll', options: undefined, at: AT });
  assert.deepEqual(entry.refused, []);
  assert.equal(entry.chosen, null);
});
