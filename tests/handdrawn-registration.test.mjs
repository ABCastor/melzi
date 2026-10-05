import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { MELZI_SUB_COMMANDS, readSourceFiles, replacePlaceholders } from '../scripts/lib/utils.js';
import { SKILL_CATEGORIES } from '../scripts/lib/skill-categories.js';
import { createTransformer, PROVIDERS } from '../scripts/lib/transformers/index.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('handdrawn stays registered at every point while the canonical table holds 21 commands', () => {
  const source = read('skill/SKILL.src.md');
  const rows = source.match(/^\| `[^`]+` \|/gm) || [];
  assert.equal(rows.length, 21);
  assert.match(source, /^\| `handdrawn \[target\]` \| Create \|[^\n]+reference\/handdrawn\.md[^\n]+reference\/imagegen\.md/m);
  assert.equal(MELZI_SUB_COMMANDS.filter((name) => name === 'handdrawn').length, 1);
  assert.match(replacePlaceholders('{{available_commands}}', 'claude-code', []), /\/melzi handdrawn\b/);
  assert.equal(SKILL_CATEGORIES.handdrawn, 'create');

  const metadata = JSON.parse(read('skill/scripts/command-metadata.json')).handdrawn;
  assert.ok(metadata?.description.length > 80);
  assert.match(metadata.description, /mascot|illustration/);
  assert.match(metadata.description, /SVG|vector/);
  assert.equal(metadata.argumentHint, '[target]');

  // The Rust regression exercises pin/unpin. This assertion also catches a
  // registry dropped by an upstream merge without requiring a release binary.
  const pin = read('crates/context/src/pin.rs').match(/pub const VALID_COMMANDS: \[&str; (\d+)\] = \[([\s\S]*?)\];/);
  assert.equal(Number(pin?.[1]), 21);
  assert.match(pin[2], /"handdrawn"/);

  // The no-argument menu now reads the router table instead of duplicating it.
  assert.match(source, /\[routing\.md\]\(reference\/routing\.md\)/);
  assert.match(read('skill/reference/routing.md'), /full menu \(the Commands table in SKILL\.md, grouped by category\)/);
  assert.match(read('README.md'), /\| `\/melzi handdrawn` \|/);
  for (const file of ['README.md', 'README.npm.md', '.claude-plugin/plugin.json', '.claude-plugin/marketplace.json']) {
    const counts = [...read(file).matchAll(/\b(\d+)\s+canonical commands\b/gi)];
    assert.ok(counts.length > 0, `${file} has no canonical count`);
    for (const count of counts) assert.equal(Number(count[1]), 21, file);
  }
});

test('drawing references are portable and retain their technique and diagnosis routes', () => {
  const handdrawn = read('skill/reference/handdrawn.md');
  const imagegen = read('skill/reference/imagegen.md');
  assert.match(handdrawn, /\{\{scripts_path\}\}\/melzi\/pen\.py/);
  assert.match(handdrawn, /\[imagegen\.md\]\(imagegen\.md\)/);
  assert.match(imagegen, /\[handdrawn\.md\]\(handdrawn\.md\)/);
  for (const token of ['wmid', 'bias', 'centreline', 'polylen', 'stroke-dashoffset', 'prefers-reduced-motion', '1500ms', '24px']) {
    assert.ok(handdrawn.includes(token), `missing drawing technique: ${token}`);
  }
  for (const token of ['gpt-image-2', 'Gemini', 'Recraft', 'shape budget', 'alphamax', 'turdsize', 'LoRA', '0.47', '0.56', '753,514', '1,572,516']) {
    assert.ok(imagegen.includes(token), `missing image guidance: ${token}`);
  }
  for (const reference of [handdrawn, imagegen]) {
    assert.doesNotMatch(reference, /—|&mdash;|&#8212;|&#x2014;/i);
    assert.doesNotMatch(reference, /~\/|\/Users\/|[A-Z]:\\Users\\|gemini-image\.sh|orchestrator\/|on this machine|run 20\d\d-\d\d-\d\d|the user's rule/i);
    assert.doesNotMatch(reference, /\b(?:Castor|beaver)\b/i);
    assert.doesNotMatch(reference, /load-bearing|highest-leverage|biggest unlock|reflex defaults|collapses into monoculture|data-driven|delve|tapestry|in today's|gone are the days|let's dive in|in summary|in conclusion/i);
  }
});

test('every provider build ships the pen helper and resolves the reference to that copy', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'melzi-handdrawn-build-'));
  try {
    const { skills } = readSourceFiles(ROOT);
    const original = read('skill/scripts/melzi/pen.py');
    for (const config of Object.values(PROVIDERS)) {
      createTransformer(config)(skills, dir);
      const skillDir = path.join(dir, config.provider, config.configDir, 'skills/melzi');
      assert.equal(fs.readFileSync(path.join(skillDir, 'scripts/melzi/pen.py'), 'utf8'), original, config.provider);
      const reference = fs.readFileSync(path.join(skillDir, 'reference/handdrawn.md'), 'utf8');
      assert.ok(reference.includes(`${config.configDir}/skills/melzi/scripts/melzi/pen.py`), config.provider);
      assert.doesNotMatch(reference, /\{\{scripts_path\}\}/);
      assert.ok(fs.existsSync(path.join(skillDir, 'reference/imagegen.md')), config.provider);
      assert.match(fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8'), /^\| `handdrawn \[target\]` \| Create \|/m);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('pen.pen returns a finite closed SVG path with tapered geometry when python3 is available', (t) => {
  const python = spawnSync('python3', ['--version'], { encoding: 'utf8' });
  if (python.error?.code === 'ENOENT') return t.skip('python3 is not installed');
  assert.equal(python.status, 0, python.stderr);
  const result = spawnSync('python3', ['-B', '-c', `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location('pen', sys.argv[1])
pen = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pen)
points = [(0, 0), (10, 0), (20, 0)]
print(json.dumps({'d': pen.pen(points, w0=1, w1=1, wmid=4, bias=0.5),
                  'centreline': pen.centreline(points), 'length': pen.polylen(points)}))
`, path.join(ROOT, 'skill/scripts/melzi/pen.py')], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(typeof output.d, 'string');
  assert.match(output.d, /^M0\.00 0\.50L.+Z$/);
  assert.match(output.d, /L10\.00 2\.00/);
  assert.doesNotMatch(output.d, /nan|inf/i);
  assert.match(output.centreline, /^M0\.00 0\.00L/);
  assert.ok(Math.abs(output.length - 20) < 0.000001);
});
