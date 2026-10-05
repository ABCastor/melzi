/** Signature fallback through the Rust detect and hook commands.
 * Fixtures use isolated homes; the real signature is never read or written.
 * Run: IMPECCABLE_BIN=target/release/impeccable node --test tests/signature-binding.test.mjs
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { findEngineBinary, engineEnv, ENGINE_MISSING_MESSAGE } from './lib/engine-bin.mjs';

const ENGINE = findEngineBinary();
const suite = (name, fn) => describe(name, { skip: !ENGINE && ENGINE_MISSING_MESSAGE }, fn);

const tempDirs = [];

function mkTmp(prefix = 'impeccable-signature-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

after(() => {
  for (const dir of tempDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});

const SIGNATURE = {
  schemaVersion: 1,
  oneLine: 'One bold warm colour leading a near-silent greyscale field.',
  invariants: {
    coral: {
      value: '#FD4E5A',
      textSafe: '#E23742',
      role: 'leads: the identity colour and the pay-attention colour',
    },
    klein: {
      light: '#2426E0',
      dark: '#5A5CF5',
      role: 'the spark, and only the favourable signal; never a second lead',
    },
    neutrals: {
      bgLight: '#FFFFFF',
      bgDark: '#1A1A1A',
      textLight: '#1A1A1A',
      textDark: '#D4D4D4',
      secondaryLight: '#555555',
      secondaryDark: '#999999',
      hairlineLight: '#DDDDDD',
      hairlineDark: '#333333',
      note: 'a near-silent greyscale field; dark is soft charcoal, never black',
    },
    danger: {
      light: '#B01526',
      dark: '#D9434E',
      note: 'kept clearly distinct from coral so delete never reads as brand',
    },
    type: {
      content: 'Source Serif 4',
      data: 'monospace',
      concept: 'content set like a well-made document, data like an instrument readout',
    },
    ratio: 'roughly 70/30: coral leads, Klein lifts; never a 50/50 split',
  },
  free: ['layout', 'composition', 'density', 'texture', 'motion'],
};

/** A home whose `.impeccable/signature.json` holds `body` verbatim. */
function homeWithRaw(body) {
  const home = mkTmp('impeccable-signature-home-');
  fs.mkdirSync(path.join(home, '.impeccable'));
  fs.writeFileSync(path.join(home, '.impeccable', 'signature.json'), body);
  return home;
}

function homeWithSignature(signature = SIGNATURE) {
  return homeWithRaw(JSON.stringify(signature, null, 2));
}

/** A home with no `.impeccable` at all. */
function bareHome() {
  return mkTmp('impeccable-signature-nohome-');
}

/**
 * A scratch folder with no DESIGN.md: the vacuum the fallback is for. Under
 * os.tmpdir() so the walk-up finds nothing above it.
 *
 * It carries a PRODUCT.md, because the fallback is deliberately scoped to
 * projects impeccable was actually run in. Without that marker his signature
 * would start measuring every colour in every unrelated folder on the machine,
 * including vendored code and other people's repos, and report the difference
 * as drift. Pass `{ initialized: false }` for the un-run case.
 */
function scratchProject(files = {}, { initialized = true } = {}) {
  const dir = mkTmp('impeccable-signature-project-');
  if (initialized) fs.writeFileSync(path.join(dir, 'PRODUCT.md'), '# PRODUCT\n\n## Platform\n\nweb\n');
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  return dir;
}

function designFindings(findings) {
  return findings.filter((f) => String(f.antipattern || '').startsWith('design-system-'));
}

function run(verb, args, { home, project, input, env = {} }) {
  const result = spawnSync(ENGINE, [verb, ...args], {
    cwd: project, encoding: 'utf8', input: input && JSON.stringify(input),
    env: engineEnv(ENGINE, { HOME: home, USERPROFILE: home, IMPECCABLE_NO_SIGNATURE_FALLBACK: '', ...env }),
  });
  assert.ifError(result.error);
  assert.ok([0, 1, 2].includes(result.status), `${verb} exited ${result.status}: ${result.stderr}`);
  return result;
}

function detect(file, { home, project, env } = {}) {
  const result = run('detect', [file, '--json'], { home, project, env });
  const data = JSON.parse(result.stdout);
  return designFindings(Array.isArray(data) ? data : data.findings);
}

function scan(css, { home, project, name = 'screen.css', env } = {}) {
  const dir = project || scratchProject();
  const file = path.join(dir, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, css);
  return detect(file, { home, project: dir, env });
}

function hook(css, { home, project, name = 'screen.css', before = false }) {
  const file = path.join(project, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!before) fs.writeFileSync(file, css);
  const result = run(before ? 'hook-before-edit' : 'hook', [], { home, project, input: {
    session_id: 'signature-test', conversation_id: 'signature-test', cwd: project,
    workspace_roots: [project], hook_event_name: before ? 'preToolUse' : 'PostToolUse',
    tool_name: 'Write', tool_input: { file_path: file, content: css },
  } });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout || '{}');
}

function ids(findings) {
  return findings.map((f) => `${f.antipattern}: ${f.snippet}`);
}

// A project that declares its own, deliberately different, system.
const PROJECT_DESIGN_MD = `---
name: Someone Else
colors:
  ink: "#241f1a"
  paper: "#f7f4ee"
  accent: "#b8422e"
typography:
  body:
    fontFamily: "IBM Plex Sans, Arial, sans-serif"
    fontSize: "16px"
---

Body prose.
`;

suite('signature fallback: a project that declares nothing', () => {
  it('does not flag his coral, in any spelling', () => {
    const home = homeWithSignature();
    // Same colour, four ways. The oklch is the accurate conversion of #FD4E5A
    // (verified against the reference sRGB->OKLab matrices); the engine
    // normalizes every format to RGB and allows +/-6 per channel, which is the
    // same tolerance a project DESIGN.md gets.
    const findings = scan(
      `
      .a { color: #FD4E5A; }
      .b { color: #fd4e5a; }
      .c { color: rgb(253, 78, 90); }
      .d { background: oklch(0.6727 0.2105 21.21); }
      `,
      { home },
    );
    assert.deepEqual(ids(findings), []);
  });

  it('does not flag the rest of his locked palette', () => {
    const home = homeWithSignature();
    const findings = scan(
      `
      .text-safe { color: #E23742; }
      .klein { color: #2426E0; }
      .klein-dark { color: #5A5CF5; }
      .ground { background: #FFFFFF; color: #1A1A1A; }
      .quiet { color: #555555; border-bottom: 1px solid #DDDDDD; }
      .danger { color: #B01526; }
      `,
      { home },
    );
    assert.deepEqual(ids(findings), []);
  });

  it('does not flag Source Serif 4, quoted or not, in any case', () => {
    const home = homeWithSignature();
    const findings = scan(
      `
      .a { font-family: 'Source Serif 4', Georgia, serif; }
      .b { font-family: "source serif 4", serif; }
      .c { font-family: Source Serif 4, serif; }
      `,
      { home },
    );
    assert.deepEqual(ids(findings), []);
  });

  it('reads "monospace" as a family, so any mono face satisfies it', () => {
    const home = homeWithSignature();
    // Two independent proxies for "is this a monospace": the face name carries
    // the family's own word, or the declaration falls back to the family.
    const findings = scan(
      `
      .a { font-family: "JetBrains Mono", monospace; }
      .b { font-family: 'IBM Plex Mono'; }
      .c { font-family: SFMono-Regular, monospace; }
      .d { font-family: Consolas, monospace; }
      `,
      { home },
    );
    assert.deepEqual(ids(findings), []);
  });

  it('still flags a colour and a face outside both systems', () => {
    const home = homeWithSignature();
    const findings = scan(
      `
      .weird { color: #7CFC00; font-family: 'Comic Sans MS', cursive; }
      `,
      { home },
    );
    const kinds = findings.map((f) => f.antipattern).sort();
    assert.deepEqual(kinds, ['design-system-color', 'design-system-font']);
    assert.match(findings.find((f) => f.antipattern === 'design-system-color').snippet, /#7CFC00/);
    assert.match(findings.find((f) => f.antipattern === 'design-system-font').snippet, /Comic Sans/i);
  });

  it('says nothing about radius or type scale, which the signature leaves free', () => {
    const home = homeWithSignature();
    const findings = scan(
      `
      .shape { border-radius: 37px; font-size: 13.3px; }
      `,
      { home },
    );
    assert.deepEqual(ids(findings), []);
  });

  it('names the signature rather than a DESIGN.md that does not exist', () => {
    const home = homeWithSignature();
    const findings = scan('.weird { color: #7CFC00; }', { home });
    assert.equal(findings.length, 1);
    assert.match(findings[0].snippet, /your signature/);
    assert.doesNotMatch(findings[0].snippet, /DESIGN\.md/);
  });

  it('applies inside a project boundary that carries no DESIGN.md', () => {
    const home = homeWithSignature();
    const project = scratchProject({ '.git/HEAD': 'ref: refs/heads/main\n', 'src/keep.txt': '' });
    const findings = scan('.weird { color: #7CFC00; }', { home, project, name: 'src/a.css' });
    assert.equal(findings.length, 1);
    assert.equal(findings[0].antipattern, 'design-system-color');
  });

  it('reaches the hook path with both allowed and foreign values', () => {
    const home = homeWithSignature();
    const good = hook('.ok { color: #FD4E5A; font-family: "Source Serif 4", serif; }', { home, project: scratchProject() });
    assert.doesNotMatch(JSON.stringify(good), /design-system-(color|font)/);
    const bad = hook('.bad { color: #7CFC00; font-family: "Comic Sans MS", cursive; }', { home, project: scratchProject() });
    assert.match(JSON.stringify(bad), /design-system-font/);
  });

  it('carries through the static-HTML engine, which judges computed styles', async () => {
    const home = homeWithSignature();
    const project = scratchProject({
      'index.html': `<!doctype html><html><head><style>
        body { font-family: 'Source Serif 4', Georgia, serif; color: #1A1A1A; background: #FFFFFF; }
        .lead { color: #FD4E5A; }
        .figure { font-family: 'IBM Plex Mono', monospace; }
        .foreign { color: #7CFC00; font-family: 'Comic Sans MS', cursive; }
      </style></head><body>
        <h1 class="lead">Coral</h1>
        <p>Body copy</p>
        <code class="figure">42</code>
        <span class="foreign">nope</span>
      </body></html>`,
    });
    const file = path.join(project, 'index.html');
    const findings = detect(file, { home, project });

    assert.equal(findings.length, 2, ids(findings).join('\n'));
    assert.ok(findings.every((f) => /nope|comic sans|124, 252, 0/i.test(f.snippet)), ids(findings).join('\n'));
    assert.ok(findings.every((f) => /your signature/.test(f.snippet)), ids(findings).join('\n'));
  });
});

suite('precedence: a project system always wins', () => {
  it('uses the project palette, and the signature does not widen it', () => {
    const home = homeWithSignature();
    const project = scratchProject({ 'DESIGN.md': PROJECT_DESIGN_MD });
    const findings = scan(
      `
      .ok { color: #241f1a; background: #f7f4ee; font-family: IBM Plex Sans, Arial, sans-serif; }
      .brand { color: #FD4E5A; }
      .brand-face { font-family: 'Source Serif 4', serif; }
      .brand-data { font-family: 'JetBrains Mono', monospace; }
      `,
      { home, project },
    );

    const flagged = ids(findings).join('\n');
    assert.match(flagged, /#FD4E5A/);
    assert.match(flagged, /Source Serif 4/i);
    assert.match(flagged, /JetBrains Mono/i);
    assert.doesNotMatch(flagged, /#241f1a|#f7f4ee|IBM Plex Sans/i);
    // And the wording stays upstream's, because this is a real DESIGN.md.
    assert.ok(findings.every((f) => /DESIGN\.md/.test(f.snippet)), flagged);
  });

  it('does not resurrect the signature for a project whose palette is silent', () => {
    const home = homeWithSignature();
    // A DESIGN.md that declares typography but no colours: the colour rule
    // abstains, as upstream intends. The signature must not fill that gap.
    const project = scratchProject({
      'DESIGN.md': `---
name: Type Only
typography:
  body:
    fontFamily: "IBM Plex Sans, Arial, sans-serif"
---
`,
    });
    const findings = scan('.weird { color: #7CFC00; }', { home, project });
    assert.deepEqual(ids(findings), []);
  });
});

suite('failure is silence, never a change of behaviour', () => {
  const FOREIGN = '.weird { color: #7CFC00; font-family: "Comic Sans MS", cursive; }';

  it('leaves today\'s behaviour exactly unchanged when there is no signature', () => {
    const home = bareHome();
    assert.deepEqual(ids(scan(FOREIGN, { home })), []);
  });

  it('leaves it unchanged when the signature is not valid JSON', () => {
    const home = homeWithRaw('{ "invariants": { "coral": ');
    assert.deepEqual(ids(scan(FOREIGN, { home })), []);
  });

  it('leaves it unchanged when the signature is valid JSON of the wrong shape', () => {
    for (const body of ['[]', 'null', '"a string"', '{}', '{"invariants":{}}', '{"invariants":"coral"}']) {
      const home = homeWithRaw(body);
      assert.deepEqual(ids(scan(FOREIGN, { home })), [], `expected silence for ${body}`);
    }
  });

  it('leaves it unchanged when the signature holds prose but no values', () => {
    const home = homeWithSignature({
      invariants: { ratio: 'coral leads, Klein lifts', mood: { note: 'quiet', role: 'the field' } },
    });
    assert.deepEqual(ids(scan(FOREIGN, { home })), []);
  });

  it('honours IMPECCABLE_NO_SIGNATURE_FALLBACK as the escape hatch', () => {
    assert.deepEqual(ids(scan(FOREIGN, { home: homeWithSignature(), env: { IMPECCABLE_NO_SIGNATURE_FALLBACK: '1' } })), []);
  });

});

suite('signature scope: his projects, not every folder on the machine', () => {
  const FOREIGN = '.weird { color: #7CFC00; font-family: "Comic Sans MS", cursive; }';

  it('stays out of a folder impeccable was never run in', () => {
    const home = homeWithSignature();
    // No PRODUCT.md and no .impeccable: a vendored dependency, a stranger's
    // checkout, a scratch directory. Silence here is the whole point. Without
    // it every colour in every unrelated repo reads as drift from his palette,
    // which is noise dressed as enforcement.
    const stranger = scratchProject({}, { initialized: false });
    assert.deepEqual(ids(scan(FOREIGN, { home, project: stranger })), []);
  });

  it('binds in a project that carries PRODUCT.md', () => {
    const home = homeWithSignature();
    const mine = scratchProject();
    assert.ok(ids(scan(FOREIGN, { home, project: mine })).length > 0);
  });

  it('is not triggered by the hook\'s own .impeccable cache directory', () => {
    const home = homeWithSignature();
    const mine = scratchProject({}, { initialized: false });
    // The hook writes hook.cache.json here on any fire, so treating the
    // directory as the marker would make the gate self-triggering: one scan of
    // a stranger's repo would enrol it forever. PRODUCT.md is the intent.
    fs.mkdirSync(path.join(mine, '.impeccable'), { recursive: true });
    fs.writeFileSync(path.join(mine, '.impeccable', 'hook.cache.json'), '{}');
    assert.deepEqual(scan(FOREIGN, { home, project: mine }), []);
  });

  it('finds the marker from a nested file, not only the project root', () => {
    const home = homeWithSignature();
    const mine = scratchProject();
    const nested = path.join(mine, 'src', 'components');
    fs.mkdirSync(nested, { recursive: true });
    assert.equal(scan(FOREIGN, { home, project: mine, name: 'src/components/Card.css' }).length, 2);
  });
});

suite('cross-project contamination: detect and both hook paths', () => {
  for (const before of [false, true]) {
    it(`${before ? 'before-edit' : 'post-edit'} uses the edited child system, not the session design`, () => {
      const home = homeWithSignature();
      const project = scratchProject({
        'DESIGN.md': PROJECT_DESIGN_MD,
        'child/PRODUCT.md': '# Child',
        'child/package.json': '{}',
        'child/DESIGN.md': '---\ntypography:\n  body:\n    fontFamily: "Source Serif 4"\n---\n',
      });
      const good = hook('.ok { font-family: "Source Serif 4", serif; }', { home, project, before, name: 'child/ok.css' });
      assert.doesNotMatch(JSON.stringify(good), /design-system-font/);
      const bad = hook('.bad { font-family: "Comic Sans MS", cursive; }', { home, project, before, name: 'child/bad.css' });
      assert.match(JSON.stringify(bad), /design-system-font/);
    });
  }

  for (const before of [false, true]) {
    it(`${before ? 'before-edit' : 'post-edit'} finds the nested PRODUCT signature without a repo DESIGN`, () => {
      const home = homeWithSignature();
      const project = scratchProject({
        'package.json': '{"workspaces":["apps/*"]}',
        'apps/web/package.json': '{}',
        'apps/web/PRODUCT.md': '# Web',
      }, { initialized: false });
      const bad = hook('.bad { font-family: "Comic Sans MS", cursive; }', { home, project, before, name: 'apps/web/bad.css' });
      assert.match(JSON.stringify(bad), /design-system-font/);
    });
  }

  for (const before of [false, true]) {
    it(`${before ? 'before-edit' : 'post-edit'} does not inherit signature scope across a nested package`, () => {
      const home = homeWithSignature();
      const project = scratchProject({ 'child/package.json': '{}' });
      const result = hook('.bad { font-family: "Comic Sans MS", cursive; }', { home, project, before, name: 'child/bad.css' });
      assert.doesNotMatch(JSON.stringify(result), /design-system-font/);
    });
  }

  it('does not apply the session DESIGN.md to a separate detect target', () => {
    const home = homeWithSignature();
    const session = scratchProject({ 'DESIGN.md': PROJECT_DESIGN_MD });
    const target = scratchProject({ 'a.css': '.ok { color: #FD4E5A; }' });
    assert.deepEqual(detect(path.join(target, 'a.css'), { home, project: session }), []);
  });

  it('stops signature scope at a nested project boundary', () => {
    const home = homeWithSignature();
    const project = scratchProject({ 'child/package.json': '{}' });
    assert.deepEqual(scan('.bad { color: #7CFC00; }', { home, project, name: 'child/a.css' }), []);
  });

  it('does not fill a declared but unreadable DESIGN.md with the signature', () => {
    const home = homeWithSignature();
    const project = scratchProject({ 'DESIGN.md': '# A prose-only design' });
    assert.deepEqual(scan('.bad { color: #7CFC00; }', { home, project }), []);
  });
});
