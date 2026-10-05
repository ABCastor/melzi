import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PROVIDERS } from '../scripts/lib/transformers/providers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * No source file may carry a C0 control byte other than tab, newline, or carriage
 * return.
 *
 * WHY THIS IS A TEST AND NOT A NOTE. Two NUL bytes anywhere in a file make `file(1)`
 * classify the whole thing as binary, and from then on plain grep prints NOTHING and
 * exits 1. Not "no match": silence. ripgrep at least says "binary file matches" but
 * still withholds the line, and an agent's search tool reports the same emptiness a
 * genuinely absent string would. On 2026-07-29 that cost three separate readings of
 * "the feature is missing" against code that was sitting right there, because
 * skill/scripts/melzi/taste-store.mjs held a NUL separator inside `pairKey`.
 *
 * The obvious response, a line in the docs saying "use grep -a on that file", was
 * already written and had already failed: you only reach that note if you ALREADY
 * suspect the file, and the whole failure is that nothing looks suspicious. A warning
 * legible only after you have been caught is not a guard.
 *
 * The scale is what makes it a repo rule rather than a one-line fix. Three unrelated
 * authors reached for NUL for three unrelated reasons inside one week: a map key here,
 * a placeholder sentinel in scripts/rebrand.mjs, and a fake PNG header in a fixture.
 * That is a reflex, not a slip, so the fix has to sit where the reflex is caught.
 *
 * A NUL is still allowed as a runtime VALUE. `rebrand.mjs` needs one, because the byte
 * that cannot appear in source is exactly what a collision-proof placeholder wants.
 * Write it as the escape `\0` and the runtime string is byte-identical while the file
 * on disk stays greppable text. Only the raw byte in the file is banned.
 *
 * There is a second, quieter failure this also closes. git sniffs only the first 8000
 * bytes when deciding whether a file is binary, and rebrand.mjs's NULs sat at offset
 * 8001, one byte outside the window. Every diff and blame on the fork's brand
 * transform was one added line away from becoming "Binary files differ" forever.
 */

// Generated output regenerates from source, so guarding source is what stops the byte
// from existing at all. The harness half is DERIVED from PROVIDERS for the reason
// spelled out beside EXCLUDE_RE in scripts/rebrand.mjs: a hand-written list rots
// silently the next time a provider is added, and treats a generated tree as source.
const GENERATED = new RegExp(
  `^(${[...new Set(Object.values(PROVIDERS).map((p) => p.configDir))]
    .map((d) => d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')}|dist|build|plugin)/`,
);

// Real binaries, where a control byte is the content rather than a mistake.
const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.icns', '.bmp', '.tiff',
  '.zip', '.gz', '.pdf', '.woff', '.woff2', '.ttf', '.otf', '.mp4', '.mov',
]);

const ALLOWED_CONTROL = new Set([0x09, 0x0a, 0x0d]);

function trackedSourceFiles() {
  return execSync('git ls-files', { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
    .split('\n')
    .filter(Boolean)
    .filter((f) => !GENERATED.test(f))
    .filter((f) => !BINARY_EXT.has(path.extname(f).toLowerCase()));
}

/** Byte offset -> 1-indexed line, so an offender is reported where it can be opened. */
function lineOf(bytes, offset) {
  let line = 1;
  for (let i = 0; i < offset; i += 1) if (bytes[i] === 0x0a) line += 1;
  return line;
}

describe('source bytes', () => {
  it('no source file carries a control byte that makes grep go silent', () => {
    const offenders = [];

    for (const file of trackedSourceFiles()) {
      let bytes;
      try { bytes = readFileSync(path.join(ROOT, file)); } catch { continue; }

      for (let i = 0; i < bytes.length; i += 1) {
        const byte = bytes[i];
        if (byte >= 0x20 || ALLOWED_CONTROL.has(byte)) continue;
        offenders.push(`${file}:${lineOf(bytes, i)} (0x${byte.toString(16).padStart(2, '0')})`);
        break; // one report per file is enough to send someone to the right place
      }
    }

    assert.deepEqual(
      offenders, [],
      'event=source_bytes.control_byte actor=source_file operation=grep '
      + `risk=file_reads_as_binary_and_search_returns_silence expected=none actual=${offenders.join(', ')}. `
      + 'A control byte in the file makes file(1) call it binary, so plain grep prints nothing '
      + 'and exits 1 rather than reporting no match, and an agent reads that as "the string is '
      + 'absent". If the byte is needed at RUNTIME, write it as an escape (\\0, \\x1f) so the '
      + 'value is unchanged and the file stays text. If it is a separator, prefer a printable '
      + 'one that cannot collide, such as the length-prefixed key in taste-store.mjs pairKey.',
    );
  });

  it('every source file is valid UTF-8', () => {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const offenders = [];

    for (const file of trackedSourceFiles()) {
      let bytes;
      try { bytes = readFileSync(path.join(ROOT, file)); } catch { continue; }
      try { decoder.decode(bytes); } catch { offenders.push(file); }
    }

    assert.deepEqual(
      offenders, [],
      'event=source_bytes.bad_encoding actor=source_file operation=read '
      + `risk=tools_disagree_about_the_contents expected=none actual=${offenders.join(', ')}. `
      + 'Re-save the file as UTF-8.',
    );
  });
});
