import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  transform, hasBrand, inIncludeSet, UPSTREAM_REFS, INCLUDE_FILES, SELF,
} from '../scripts/rebrand.mjs';
import { PROVIDERS } from '../scripts/lib/transformers/providers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * scripts/rebrand.mjs re-applies our brand after every upstream merge. It rewrites 200+
 * files and it is the whole reason merging upstream stays "merge, re-run, verify" instead
 * of archaeology. It also had NO tests until 2026-07-16, because the loop and process.exit
 * ran at module top level and `import` meant "rebrand the repo, then kill the test runner".
 *
 * Three bugs of the IDENTICAL shape shipped in it -- exit 0, no error, wrong -- and each
 * was found by accident, weeks apart, by a different task:
 *
 *   1. `upstream/impeccable` was unprotected, so our own tooling announced
 *      "upstream/melzi shipped 40 commit(s)", crediting pbakaus's work to this fork.
 *   2. The Chrome Web Store URL of pbakaus's PUBLISHED extension was rewritten to our
 *      slug. The ID still resolved, so the site's "Install Melzi" button worked and
 *      served THEIR product under OUR name. A working link is worse than a broken one.
 *   3. The fast path was case-sensitive, so `--check` reported "no drift" about 23 files
 *      it had never read.
 *
 * Each is a regression test below. The point is not the three; it is that the fourth gets
 * caught here rather than by someone stumbling over it in a diff.
 */
describe('rebrand: the transform is honest about what it owns', () => {
  it('importing the module does not rewrite the repo', () => {
    // The whole reason this suite can exist. If someone moves the loop back to top level,
    // every other test here starts mutating the working tree as a side effect of import.
    const src = readFileSync(path.join(ROOT, 'scripts/rebrand.mjs'), 'utf8');
    assert.match(src, /function main\(\)/, 'the CLI must stay inside main()');
    assert.match(
      src,
      /if \(process\.argv\[1\][\s\S]*?\)\s*\{\s*\n?\s*main\(\);/,
      'main() must run only when invoked as a CLI',
    );
  });

  describe('things upstream owns survive the transform untouched', () => {
    // COMMAND_RE's lookahead deliberately allows a following `/` (so `skills/impeccable/`
    // renames). That means ANY `<owner>/impeccable/<path>` looks like our command. The
    // only thing standing between that rule and pbakaus's identity is UPSTREAM_REFS.
    const UPSTREAM_OWNED = [
      'https://github.com/pbakaus/impeccable',
      'https://github.com/pbakaus/impeccable.git',
      'https://github.com/pbakaus/impeccable/issues/107',
      'https://github.com/pbakaus/impeccable/blob/main/LICENSE',
      'https://github.com/pbakaus/impeccable/pull/123',
      'upstream/impeccable',
      'git fetch upstream/impeccable --tags',
      'https://chromewebstore.google.com/detail/impeccable/bdkgmiklpdmaojlpflclinlofgjfpabf',
      'chromewebstore.google.com/detail/impeccable',
      'https://impeccable.style',
      'https://impeccable.style/docs/audit',
      'https://x.com/impeccable_ai',
      'Base work: **Impeccable** by Paul Bakaus',
      'a fork of Impeccable, Apache-2.0',
      '// Modified from Impeccable: typed Melzi launcher and distribution contracts.',
      'Melzi is a modified fork of [Impeccable](https://github.com/pbakaus/impeccable) by Paul Bakaus.',
      'Apache-2.0; a modified fork of Impeccable by Paul Bakaus.',
      'It does not install upstream Impeccable engine packages.',
      "Do not reuse upstream Impeccable's signing identity or certificate claims.",
      "the launcher does not automatically install or download Impeccable's engine.",
      "This document describes Impeccable's retained verification protocol.",
      'impeccable frontend design',
    ];
    for (const s of UPSTREAM_OWNED) {
      it(`no-op: ${s}`, () => {
        assert.equal(
          transform(s), s,
          `event=rebrand.upstream_misattribution actor=rebrand.mjs operation=transform `
          + `risk=we_present_pbakaus_work_as_ours expected=unchanged actual=rewritten. `
          + `If this fails, add the form to UPSTREAM_REFS -- do NOT teach COMMAND_RE to `
          + `recognise it (the header explains why).`,
        );
      });
    }
  });

  describe('things we own still rename', () => {
    // The mirror image. Without these the suite above could be satisfied by a transform
    // that does nothing at all.
    const OURS = [
      ['/impeccable audit', '/melzi audit'],
      ['skills/impeccable/scripts/config.json', 'skills/melzi/scripts/config.json'],
      ['npx impeccable detect', 'npx melzi detect'],
      ["console.warn('[impeccable] scan failed', err)", "console.warn('[melzi] scan failed', err)"],
      ["console.log('[impeccable.steer]', reason)", "console.log('[melzi.steer]', reason)"],
      ['"name": "impeccable"', '"name": "melzi"'],
      ['"name": "Impeccable"', '"name": "Melzi"'],
      ['<h1>Impeccable</h1>', '<h1>Melzi</h1>'],
      // The skill directory renames even when the launcher inside it does not.
      ['.claude/skills/impeccable/scripts/impeccable hook', '.claude/skills/melzi/scripts/impeccable hook'],
    ];
    for (const [from, to] of OURS) {
      it(`renames: ${from}`, () => assert.equal(transform(from), to));
    }
  });

  describe('internal protocol strings are never renamed', () => {
    // Writers and readers must agree; renaming one half only desyncs them.
    const KEEP = [
      'data-impeccable-params',
      'impeccable-live-bar',
      'impeccable-variants-start',
      'impeccable-carbonize-end',
      'impeccable-disable',
      '.impeccable/design.json',
      '**/.impeccable/hook.cache.json',
      // The provider hook manifests. One writer (transformers/providers.js), six
      // readers; a rename to one half is a silent desync, which is what the
      // 2026-07-27 upstream sync found in the GitHub entry.
      'hooks/impeccable.json',
      '.github/hooks/impeccable.json',
      '.grok/hooks/impeccable.json',
      'IMPECCABLE_COMMAND_PREFIX',
      "selectedAction = 'impeccable'",
      'impeccable:manual-edit-validate',
      'lib/impeccable-config.mjs',
      'impeccable_asset_producer.toml',
      'impeccable-logo-on-dark.svg',
      // The engine launcher and binary names (2026-09-14, Rust engine). The build,
      // the launcher, the hook manifests, and the binary's install detection all
      // agree on `impeccable`; a rename to any one of them is a silent desync.
      '{{scripts_path}}/impeccable context',
      'skill/scripts/impeccable',
      'skill/scripts/bin/darwin-arm64/impeccable',
      '~/.impeccable/bin/0.1.5/impeccable',
      'target/release/impeccable',
      '"$cache_root/bin/$version/impeccable$exe"',
    ];
    for (const s of KEEP) {
      it(`keeps: ${s}`, () => assert.equal(transform(s), s));
    }
  });

  it('is idempotent: transforming twice equals transforming once', () => {
    const sample = [
      '/impeccable audit and npx impeccable detect',
      "console.warn('[impeccable] x'); // see https://github.com/pbakaus/impeccable/issues/1",
      'src/lib/impeccable/ImpeccableLiveRoot.svelte',
      '"name": "Impeccable"',
      'upstream/impeccable + chromewebstore.google.com/detail/impeccable/abc',
    ].join('\n');
    const once = transform(sample);
    assert.equal(transform(once), once, 'a second run must be a no-op');
  });

  // Two-sided on purpose. Asserting only the exclusion would let someone delete it as
  // dead weight; asserting only the appetite would not stop the run. Together they say
  // "this file is still dangerous to itself, and here is the line that holds it off".
  //
  // The exclusion used to be an accident: isBinary() skips anything containing a NUL,
  // and SENTINEL was written as literal NUL bytes, so rebrand.mjs fell out of its own
  // scan without anyone deciding that. --check therefore reported "no drift" while
  // never reading the transform it was checking. Escaping those bytes on 2026-07-29
  // made the file greppable again and removed the accident, which is what made an
  // explicit exclusion necessary.
  describe('it never transforms itself', () => {
    it('excludes its own path from the scan', () => {
      assert.equal(SELF, 'scripts/rebrand.mjs');
      assert.equal(
        inIncludeSet(SELF), false,
        'event=rebrand.self_transform actor=rebrand.mjs operation=listFiles '
        + 'risk=rules_rewritten_into_their_own_output expected=excluded actual=included. '
        + 'scripts/ is in INCLUDE_DIRS, so without the SELF check this file scans itself.',
      );
    });

    it('still WANTS to rewrite itself, so the exclusion is not decoration', () => {
      const source = readFileSync(path.join(ROOT, SELF), 'utf8');
      assert.notEqual(
        transform(source), source,
        'event=rebrand.self_transform actor=rebrand.mjs operation=transform '
        + 'risk=exclusion_looks_unnecessary_and_gets_deleted expected=differs actual=identical. '
        + 'If this ever passes, the rules no longer match their own source and the SELF '
        + 'exclusion can be reconsidered. Until then, deleting it lets `node scripts/rebrand.mjs` '
        + 'rewrite every rule into a no-op and stop hasBrand from matching the brand.',
      );
    });
  });

  it('the fast-path skip is case-insensitive', () => {
    // The bug: `!includes('impeccable') && !includes('IMPECCABLE')` skipped title-case
    // files entirely, so --check reported no drift about files it never opened.
    assert.equal(hasBrand('Impeccable'), true, 'title-case must not be skipped');
    assert.equal(hasBrand('IMPECCABLE'), true);
    assert.equal(hasBrand('impeccable'), true);
    assert.equal(hasBrand('iMpEcCaBlE'), true);
    assert.equal(hasBrand('melzi only'), false);
  });

  describe('the include set reaches every file that carries a brand-coupled PATH', () => {
    it('.gitignore is in the include set', () => {
      // It must ignore exactly what live mode writes. While it sat outside the set, the
      // command rule renamed live-inject.mjs's `src/lib/impeccable/` to
      // `src/lib/melzi/` and .gitignore kept the old path, so the tool's own output
      // stopped being ignored -- and --check never said a word, because it never read it.
      assert.ok(INCLUDE_FILES.includes('.gitignore'));
      assert.ok(inIncludeSet('.gitignore'));
    });

    it('.gitignore ignores the live-mode paths the tool actually writes', () => {
      // The real contract, checked against the real writer rather than a remembered path.
      // The writer is the Rust live crate since the 2026-09-14 engine adoption; the JS
      // live-inject.mjs this used to read is gone. Same contract, current writer.
      const injectSrc = readFileSync(path.join(ROOT, 'crates/live/src/gitignore.rs'), 'utf8');
      const written = [...injectSrc.matchAll(/"(src\/lib\/[^"]+)"/g)].map((m) => m[1]);
      assert.ok(written.length > 0, 'expected crates/live/src/gitignore.rs to declare src/lib paths');

      const ignored = readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
      for (const p of written) {
        const dir = p.split('/').slice(0, 3).join('/');
        assert.ok(
          ignored.includes(dir),
          `event=rebrand.gitignore_desync actor=git operation=ignore risk=tool_output_gets_committed `
          + `expected=.gitignore covers ${dir} actual=missing. live-inject.mjs writes ${p}; `
          + `.gitignore must keep step with it.`,
        );
      }
    });

    it('.gitignore covers every framework adapter\'s managed component dir', () => {
      // The check above reads ONE writer and only its `src/lib/` paths, so a per-framework
      // adapter is invisible to it. Upstream v4 added the TanStack adapter with
      // TANSTACK_COMPONENT_DIR = 'src/melzi' and no matching ignore line, which meant
      // live mode's own generated component was committable in any TanStack project.
      // Adapters declare their dir as an exported constant; that is what this reads.
      // Adapters are Rust modules under crates/live/src/inject/ since 2026-09-14, declaring
      // the same constant as `pub const *_COMPONENT_DIR: &str`. Same contract, current writer.
      const adapters = readdirSync(path.join(ROOT, 'crates/live/src/inject'))
        .filter((f) => f.endsWith('.rs'));
      const ignored = readFileSync(path.join(ROOT, '.gitignore'), 'utf8');

      let checked = 0;
      for (const file of adapters) {
        const src = readFileSync(path.join(ROOT, 'crates/live/src/inject', file), 'utf8');
        for (const m of src.matchAll(/^pub const \w*COMPONENT_DIR:\s*&str\s*=\s*"([^"]+)"/gm)) {
          checked += 1;
          assert.ok(
            ignored.includes(m[1]),
            `event=rebrand.gitignore_desync actor=git operation=ignore `
            + `risk=tool_output_gets_committed expected=.gitignore covers ${m[1]} `
            + `actual=missing. skill/scripts/live/${file} writes its managed component `
            + `into ${m[1]}; .gitignore must keep step with it.`,
          );
        }
      }
      assert.ok(checked > 0, 'expected at least one adapter to export a COMPONENT_DIR');
    });

    it('no tracked file outside the include set carries a command or CLI invocation', () => {
      // The generalisation of the .gitignore bug: a brand string the transform never reads
      // can never be kept in step, and --check stays silent about it forever.
      //
      // Three kinds of file are outside the set on purpose, and each for a different
      // reason -- they are not one "skip" bucket:
      //   tests/        a JS regex literal opens with `/`, so the command rule rewrites the
      //                 ASSERTION but not the source it asserts against (tried, reverted).
      //   harness dirs  generated mirrors; they regenerate from source via build:release.
      //   pollux-uxui/  the engineering record. Its JOB is to quote the OLD name verbatim
      //                 ("`/impeccable` -> `/melzi`", "fe1e0357 rewrote the Web Store
      //                 URL"). Transforming it would rewrite that to "`/melzi` ->
      //                 `/melzi`" and destroy the reason the rule exists. Docs ABOUT
      //                 a rename are a third category, neither "rebrand" nor "KEEP".
      // Derived from PROVIDERS, not spelled out. The literal version of this list
      // went stale the moment upstream v4 added `.grok` and `.vibe`: two generated
      // trees the guard then reported as source blind spots. A guard whose own
      // inventory is hand-maintained fails the same way as the thing it guards.
      const HARNESS = new RegExp(
        `^(${[...new Set(Object.values(PROVIDERS).map((p) => p.configDir))]
          .map((d) => d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
          .join('|')}|plugin)/`,
      );
      // Mirrors COMMAND_RE in scripts/rebrand.mjs, including its launcher and binary
      // KEEP rows (2026-09-14): `scripts/impeccable` and `bin/impeccable` name the engine,
      // not a command, so a file carrying only those is not a blind spot.
      const STALE = /(?<!(?:scripts|bin|debug|release|custom|tools|arm64|x64|[\d}>*]|\$version|\$arch)\\?)\/impeccable(?![-A-Za-z0-9._])|npx impeccable|IMPECCABLE_SUB_COMMANDS/;

      const tracked = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' })
        .split('\n').filter(Boolean);

      const offenders = [];
      for (const f of tracked) {
        if (inIncludeSet(f)) continue;
        if (HARNESS.test(f)) continue;
        if (f.startsWith('tests/')) continue;
        if (f.startsWith('pollux-uxui/')) continue;
        // The one honest exception to this rule. rebrand.mjs sits outside the include
        // set on purpose (see SELF), and the command strings it carries ARE the rules,
        // not documentation that could rot: `npx impeccable` appears here as the LEFT
        // side of the rename that produces `npx melzi`. Covering it would ask the
        // transform to rewrite its own rules into no-ops. The `it never transforms
        // itself` pair above is what guards this file instead.
        if (f === SELF) continue;
        let text;
        try { text = readFileSync(path.join(ROOT, f), 'utf8'); } catch { continue; }
        if (!hasBrand(text)) continue;
        // UPSTREAM_REFS name pbakaus's things; they are supposed to say impeccable.
        const stripped = UPSTREAM_REFS.reduce((acc, ref) => acc.split(ref).join(''), text);
        if (STALE.test(stripped)) offenders.push(f);
      }

      assert.deepEqual(
        offenders, [],
        `event=rebrand.blind_spot actor=rebrand.mjs operation=listFiles `
        + `risk=documents_a_dead_command_forever expected=none actual=${offenders.join(', ')}. `
        + `These carry a command or CLI invocation but sit outside INCLUDE_DIRS/INCLUDE_FILES, `
        + `so the transform cannot keep them in step and --check reports no drift. Add the file `
        + `to INCLUDE_FILES, or move the string.`,
      );
    });
  });
});
