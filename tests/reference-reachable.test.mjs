import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REF_DIR = path.join(ROOT, 'skill/reference');

/**
 * Every file in skill/reference/ must be REACHABLE by an agent.
 *
 * The skill routes by reading files: SKILL.src.md names a command's reference, and a
 * reference names any deeper reference it needs (audit.native.md -> ios.md, typeset.md ->
 * its inlined typography). A file nobody names is a file no agent ever opens.
 *
 * rigor.md was exactly that. 53 lines of the evidence discipline that is supposed to be
 * MANDATORY for critique and audit, written, reviewed, copied into all 13 harness dirs by
 * every release, and reachable by nobody for months. Nothing failed: the build was green,
 * --check reported no drift, and the file shipped to every user as dead weight while the
 * commands it governs ran without it. The repo's signature failure again -- no error, exit
 * 0, wrong -- and no test could see it, because "unreferenced" is not a syntax error.
 *
 * This is the guard. An orphan is either wired or deleted, never left to rot quietly.
 */
function reachableSet() {
  const files = readdirSync(REF_DIR).filter((f) => f.endsWith('.md'));
  const body = (f) => readFileSync(path.join(REF_DIR, f), 'utf8');
  const skill = readFileSync(path.join(ROOT, 'skill/SKILL.src.md'), 'utf8');

  // Seed with whatever the router itself names, then close over reference-to-reference
  // links until nothing new appears.
  const reachable = new Set(files.filter((f) => skill.includes(f)));
  for (let grew = true; grew;) {
    grew = false;
    for (const from of [...reachable]) {
      const text = body(from);
      for (const cand of files) {
        if (reachable.has(cand) || cand === from) continue;
        if (text.includes(cand)) { reachable.add(cand); grew = true; }
      }
    }
  }
  return { files, reachable };
}

describe('skill/reference: every file is reachable by an agent', () => {
  it('has no orphaned reference files', () => {
    const { files, reachable } = reachableSet();
    const orphans = files.filter((f) => !reachable.has(f));
    assert.deepEqual(
      orphans, [],
      `event=skill.orphaned_reference actor=agent operation=route risk=guidance_ships_but_never_loads `
      + `expected=none actual=${orphans.join(', ')}. A reference nobody names is never read: it ships `
      + `to all 13 harness dirs and silently does nothing. Either name it from SKILL.src.md or from `
      + `the command reference that needs it, or delete it.`,
    );
  });

  it('the walk can actually see an orphan (it is not vacuously green)', () => {
    // If the closure ever over-reaches (e.g. matching every file against every file), the
    // assertion above passes forever and this guard is theatre.
    const { files, reachable } = reachableSet();
    assert.ok(files.length > 20, 'expected a real reference tree');
    assert.ok(reachable.size <= files.length);
    assert.ok(
      !reachable.has('definitely-not-a-real-reference.md'),
      'the walk must not mark a non-existent file reachable',
    );
  });

  it('rigor.md is reachable from the commands it calls mandatory', () => {
    // rigor.md names critique and audit as mandatory. That claim has to be true from the
    // command's side, not just asserted inside rigor.md, or it is a comment.
    const rigor = readFileSync(path.join(REF_DIR, 'rigor.md'), 'utf8');
    assert.match(rigor, /mandatory/i, 'rigor.md still claims to be mandatory somewhere');

    for (const cmd of ['critique.md', 'audit.md', 'audit.native.md']) {
      const text = readFileSync(path.join(REF_DIR, cmd), 'utf8');
      assert.match(
        text, /rigor\.md/,
        `event=skill.rigor_unwired actor=agent operation=${cmd.replace('.md', '')} `
        + `risk=claims_reported_without_evidence_labels expected=links_rigor.md actual=missing. `
        + `rigor.md calls itself mandatory for this command; the command has to say so too.`,
      );
    }
  });
});
