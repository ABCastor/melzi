import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const ANTIPATTERNS = JSON.parse(read('crates/live/assets/antipatterns.json'));

describe('published detector counts', () => {
  it('binds the Chrome store listing to the registry and the build validator', () => {
    const count = new Set(ANTIPATTERNS.map((rule) => rule.id)).size;
    const listing = read('extension/STORE_LISTING.md');
    const build = read('scripts/build.js');

    assert.match(listing, new RegExp(`\\b${count} common UI anti-patterns\\b`));
    assert.match(build, /['"]extension\/STORE_LISTING\.md['"]/);
    assert.match(build, /const detectPattern = [^\n]*anti-patterns/);
  });
});

/**
 * The brand guard for text the END USER sees.
 *
 * `scripts/rebrand.mjs` re-applies our brand after every upstream merge, but it is a
 * literal-text transform and its own header says prose is beyond it: "A newer Impeccable
 * is available" is indistinguishable by regex from the English adjective we deliberately
 * keep. So `--check` reports no drift while user-facing prose still says Impeccable.
 *
 * That gap is what this file covers. Without it, the next `merge upstream -> re-run
 * rebrand -> verify green` silently reverts these strings and nothing notices.
 *
 * Scope is deliberately narrow: only STRING LITERALS that read as prose. Comments,
 * internal `impeccable-*` markers, the `.impeccable/` config dir, the live Freeform action
 * `'impeccable'`, upstream attribution, and the English adjective stay as they are -- see
 * the KEEP list in scripts/rebrand.mjs.
 *
 * It finds LITERALS first and only then splits them into lines, and it needs both halves.
 * Scanning raw lines missed live-browser.js's
 * `setAttribute('aria-label', connected ? 'Impeccable live mode' : ...)` because the strings
 * sit on different lines from the call. Judging a whole literal at once fails the opposite
 * way: a server that renders a page holds the entire document in one backtick literal, so
 * one KEEP form anywhere inside it would vouch for every other line, and a file added to
 * FILES would report coverage while checking nothing. Literals for boundaries, lines for
 * granularity. The self-test at the bottom holds both properties down.
 */

// Each alternative is a form the KEEP list protects; a literal matching any of them is
// skipped before the brand check runs.
const KEEP_FORMS = new RegExp([
  'impeccable-',            // internal markers, CSS classes, hook sentinels, filenames
  'data-impeccable',        // DOM markers
  'dataset\\.impeccable',   // the same markers read back
  '__impeccable',           // internal anchor properties
  'impeccableTriedUrls',    // internal Error property in the injected browser bundle (2026-08-01 sync)
  '\\.impeccable/',         // the config dir (runtime contract)
  'IMPECCABLE_',            // env vars + the interpolated command constant
  'impeccable\\.style',     // upstream's domain
  '@impeccable_ai',         // upstream's handle
  'pbakaus/impeccable',     // upstream attribution
  'upstream/impeccable',    // upstream's git remote
  'impeccable:',            // the npm script contract
  'i-impeccable',           // legacy harness install dir we still detect
  'annotate-click',         // the postMessage protocol property `impeccable: 'annotate-click'`
  'impeccableSketch',       // the sketch frame's postMessage key; page and frame must agree (2026-10-11 sync)
  'impeccable frontend',    // the English adjective
  'impeccable design',      // the English adjective
].join('|'), 'i');

/** Parse JavaScript so comments, regex bodies and interpolation code cannot become prose. */
function javascriptLiterals(source) {
  const literals = [];
  const ast = parse(source, { sourceType: 'unambiguous', allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true });
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'StringLiteral') literals.push(node.value);
    if (node.type === 'TemplateLiteral') {
      // Keep the sentence across substitutions, without letting an internal identifier
      // in the expression whitelist the prose. Walk expressions for nested literals too.
      literals.push(node.quasis.map((part) => part.value.cooked ?? part.value.raw).join('${…}'));
    }
    for (const [key, value] of Object.entries(node)) {
      if (['comments', 'leadingComments', 'trailingComments', 'innerComments', 'tokens', 'extra', 'loc'].includes(key)) continue;
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  }
  visit(ast);
  return literals;
}

/** Rust strings, including r###"..."###, without quotes in comments or character literals. */
function rustLiterals(source) {
  const literals = [];
  let i = 0;
  while (i < source.length) {
    if (source.startsWith('//', i)) {
      const end = source.indexOf('\n', i + 2);
      i = end < 0 ? source.length : end + 1;
      continue;
    }
    if (source.startsWith('/*', i)) {
      let depth = 1;
      i += 2;
      while (i < source.length && depth) {
        if (source.startsWith('/*', i)) { depth++; i += 2; }
        else if (source.startsWith('*/', i)) { depth--; i += 2; }
        else i++;
      }
      assert.equal(depth, 0, 'unterminated Rust block comment');
      continue;
    }
    const raw = /^(?:br|cr|r)(#*)"/.exec(source.slice(i));
    if (raw && (i === 0 || !/[\w]/.test(source[i - 1]))) {
      const start = i + raw[0].length;
      const end = source.indexOf('"' + raw[1], start);
      assert.ok(end >= 0, 'unterminated Rust raw string');
      literals.push(source.slice(start, end));
      i = end + 1 + raw[1].length;
      continue;
    }
    if (source[i] === "'") {
      // Lifetimes such as 'static are not character literals.
      const character = /^'(?:\\(?:u\{[0-9a-fA-F_]+\}|x[0-9a-fA-F]{2}|.)|[^'\\\n])'/u.exec(source.slice(i));
      if (character) { i += character[0].length; continue; }
    }
    if (source[i] !== '"') { i++; continue; }
    let value = '';
    let closed = false;
    i++;
    while (i < source.length) {
      const ch = source[i++];
      if (ch === '"') { closed = true; break; }
      if (ch !== '\\') { value += ch; continue; }
      const escaped = source[i++];
      const escapes = { n: '\n', r: '\r', t: '\t', '0': '\0', '\\': '\\', '"': '"', "'": "'" };
      if (escaped in escapes) value += escapes[escaped];
      else if (escaped === '\n' || escaped === '\r') {
        while (/\s/.test(source[i] ?? '') && i < source.length) i++;
      } else if (escaped === 'x') {
        value += String.fromCodePoint(parseInt(source.slice(i, i + 2), 16));
        i += 2;
      } else if (escaped === 'u' && source[i] === '{') {
        const end = source.indexOf('}', i);
        assert.ok(end >= 0, 'unterminated Rust Unicode escape');
        value += String.fromCodePoint(parseInt(source.slice(i + 1, end).replaceAll('_', ''), 16));
        i = end + 1;
      } else {
        assert.fail(`unsupported Rust string escape: ${escaped}`);
      }
    }
    assert.ok(closed, 'unterminated Rust string');
    literals.push(value);
  }
  return literals;
}

// The extension's JS prose is here now; its rebrand landed. Only the two files with prose
// are listed. The extension's window titles (manifest.json, panel.html, popup.html,
// devtools.js, sidebar.html) are deliberately NOT guarded here and belong to
// scripts/rebrand.mjs's IDENTITY_RULES instead: this file scans quoted string LITERALS, and
// `<h1>Impeccable</h1>` has no quotes for it to find. A rule plus `--check` covers what
// markup puts beyond a literal scan. Rule what a rule can safely reach; guard here only the
// prose no safe rule can match, because prose is indistinguishable by regex from the
// English adjective the KEEP list keeps.
//
// The store listing's detector number is guarded separately above against the live
// registry and the build validator, even while publication remains parked.
const FILES = [
  'crates/context/src/serve_question.rs',
  'crates/context/src/question_page.rs',
  'crates/context/src/pin.rs',
  'skill/scripts/melzi/serve-compare.mjs',
  'skill/scripts/live-browser.js',
  'crates/live/src/live_server.rs',
  'crates/live/src/server.rs',
  'crates/live/src/live_http.rs',
  'browser-bundle/10-probe.js',
  'browser-bundle/15-snapshot.js',
  'browser-bundle/30-scan-common.js',
  'browser-bundle/35-visual.js',
  'browser-bundle/40-overlay.js',
  'browser-bundle/50-scan.js',
  'extension/devtools/panel.js',
  'extension/background/service-worker.js',
];

/** Remove only the executable token in documented command positions, never the whole line. */
function withoutCliExecutable(line) {
  return line
    .replace(/^(\s*(?:Usage:|Stop:|Command failed:)\s+)impeccable(?= (?:pin|live-server|live-inject)\b)/, '$1<engine>')
    .replace(/^(\s*Inject: managed by )impeccable(?= live-inject;)/, '$1<engine>')
    .replace(/(`<skill-base-dir>\/scripts\/)impeccable(?= context`)/g, '$1<engine>')
    // The engine binary keeps upstream's name (scripts/rebrand.mjs, engine names); a
    // backticked `impeccable generate-image` is that executable, not the product's name.
    .replace(/`impeccable(?= generate-image\b)/g, '`<engine>');
}

/**
 * A leak is a string literal that names the brand and reads as prose. The space test is
 * what separates a sentence a human reads from an identifier like the Freeform action
 * `'impeccable'` or a marker token.
 */
function leaksIn(source, language = 'javascript') {
  const found = new Set();
  for (const lit of language === 'rust' ? rustLiterals(source) : javascriptLiterals(source)) {
    if (!/impeccable/i.test(lit)) continue;
    // The unit of judgement is the LINE, not the literal, and that is the whole
    // point of this loop. A backtick literal in a server that renders a page is
    // frequently the ENTIRE page, thousands of lines long. Judged as one string,
    // a single KEEP form anywhere inside it (the annotate-click protocol, say)
    // whitelists every other line in the document, so adding such a file to FILES
    // below would report coverage while checking nothing. Splitting first means a
    // protocol marker on one line cannot vouch for a wordmark on another.
    for (const original of lit.split('\n')) {
      const line = withoutCliExecutable(original);
      if (!/impeccable/i.test(line)) continue;
      if (KEEP_FORMS.test(line)) continue;
      // Same prose test as before, now per line: an identifier is one token, a
      // sentence a human reads has spaces in it.
      if (!/\s/.test(line.trim())) continue;
      found.add(original.replace(/\s+/g, ' ').trim());
    }
  }
  return [...found];
}

describe('brand: text the user sees says Melzi, not Impeccable', () => {
  for (const rel of FILES) {
    it(`${rel} has no user-visible Impeccable branding`, () => {
      const leaks = leaksIn(read(rel), rel.endsWith('.rs') ? 'rust' : 'javascript');
      assert.deepEqual(
        leaks,
        [],
        `event=brand.user_visible_leak actor=end_user operation=read_console_or_screenreader `
        + `risk=product_announces_two_brands expected=Melzi actual=Impeccable\n`
        + `rebrand.mjs cannot catch these (prose is indistinguishable from the English `
        + `adjective it keeps), so this guard reports any prose that still needs a reviewed brand rule:\n`
        + leaks.join('\n'),
      );
    });
  }

  it('the guard catches prose leaks and spares every KEEP form', () => {
    // Without this, an over-eager KEEP_FORMS edit could make every assertion above
    // vacuously green while the leaks ship.
    const mustFlag = [
      `console.log(\`\\nImpeccable live server running on \${url}\`);`,
      `brand.setAttribute('aria-label', 'Impeccable live mode - agent not polling');`,
      `setAttribute('aria-label', connected\n ? 'Impeccable live mode'\n : 'Impeccable live mode - agent not polling');`,
      `console.log('No harness directories with impeccable installed found.');`,
      `console.log(\`Use Impeccable's workflow directly to access it.\`);`,
    ];
    for (const s of mustFlag) {
      assert.ok(leaksIn(s).length > 0, `guard must flag the prose leak: ${s}`);
    }

    const mustSpare = [
      `console.warn('[melzi] Invalid data-impeccable-params JSON:', err.message);`,
      `selectedAction = 'impeccable';`,
      `console.log('run .impeccable/ setup first');`,
      `console.log(\`Use \${IMPECCABLE_COMMAND} document to generate the sidecar\`);`,
      `const dir = join(skillsDir, 'i-impeccable');`,
      `console.log('a fork of pbakaus/impeccable, Apache-2.0');`,
      `console.log('ships impeccable frontend design by default');`,
    ];
    for (const s of mustSpare) {
      assert.deepEqual(leaksIn(s), [], `guard must spare the KEEP form: ${s}`);
    }
  });
});

describe('brand literal scanner regressions', () => {
  it('ignores JavaScript comments and regexes while checking nested template expressions', () => {
    const inert = String.raw`
      // A comment with an unmatched backtick: \` 'Impeccable live mode'
      /* "Impeccable live mode" and another \` */
      const matcher = /["'\x60]Impeccable live mode/;
      const quotient = 10 / 2;
      const marker = 'impeccable';
    `;
    assert.deepEqual(leaksIn(inert), []);
    const nested = 'const text = `A ${ready ? "Impeccable live mode" : `nested ${value}`} choice`;';
    assert.deepEqual(leaksIn(nested), ['Impeccable live mode']);
    assert.deepEqual(leaksIn('const text = `Impeccable${IMPECCABLE_COMMAND} live mode`;'), ['Impeccable${…} live mode']);
    assert.deepEqual(leaksIn(String.raw`const text = 'Impeccable\nLive mode';`), [], 'decoded line boundaries keep the per-line prose test');
  });

  it('a marker in one template line does not whitelist another line', () => {
    const source = 'const html = `<div data-impeccable="marker">\n<span>Impeccable live mode</span>\n</div>`;';
    assert.deepEqual(leaksIn(source), ['<span>Impeccable live mode</span>']);
  });

  it('reads Rust raw strings, escapes and lifetimes without consuming comments as literals', () => {
    const source = String.raw`
      // "Impeccable commented prose"
      /* "Impeccable comment" /* r#"nested comment"# */ */
      fn demo<'a>(label: &'a str) {
        let quote = '"';
        let escaped = '\'';
        let text = r##"<span title="Impeccable live mode">"##;
        let regular = "Impeccable \"decision\" page\ninternal impeccable-token";
      }
    `;
    assert.deepEqual(leaksIn(source, 'rust'), [
      '<span title="Impeccable live mode">',
      'Impeccable "decision" page',
    ]);
    assert.deepEqual(leaksIn(String.raw`let title = "\u{49}mpeccable live mode";`, 'rust'), ['Impeccable live mode']);
    assert.throws(() => rustLiterals('let broken = r#"unterminated;'), /unterminated Rust raw string/);
  });

  it('distinguishes lowercase executable syntax without hiding adjacent branding', () => {
    const commands = [
      'Usage: impeccable pin <pin|unpin> <command>',
      'Usage: impeccable live-server [options]',
      'Stop:   impeccable live-server stop',
      'Command failed: impeccable live-inject --remove',
      'Inject: managed by impeccable live-inject; Astro tags need is:inline.',
      'Run `<skill-base-dir>/scripts/impeccable context` before continuing.',
    ];
    for (const command of commands) {
      assert.deepEqual(leaksIn(`console.log(${JSON.stringify(command)});`), []);
      const mixed = `${command}. Impeccable live mode`;
      assert.deepEqual(leaksIn(`console.log(${JSON.stringify(mixed)});`), [mixed.replace(/\s+/g, ' ')]);
    }
    for (const prose of ['Impeccable live mode', 'impeccable live mode', 'Usage: Impeccable live-server']) {
      assert.deepEqual(leaksIn(`console.log(${JSON.stringify(prose)});`), [prose]);
    }
  });

  it('the live-browser mutation turns a clean guard assertion red', () => {
    const source = read('skill/scripts/live-browser.js');
    assert.deepEqual(leaksIn(source), [], 'the original live-browser source must pass');
    const mutated = `${source}\nconsole.log('Impeccable live mode');\n`;
    assert.deepEqual(leaksIn(mutated), ['Impeccable live mode']);
    assert.throws(() => assert.deepEqual(leaksIn(mutated), []), {
      code: 'ERR_ASSERTION',
      message: /Impeccable live mode/,
    }, 'the actual no-leaks assertion must reject the mutated source');
  });
});
