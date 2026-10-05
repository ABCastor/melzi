import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { stageOpenAIPlugin } from '../scripts/lib/openai-plugin.js';
import { buildCodexPluginManifest } from '../scripts/lib/codex-plugin.js';
import { buildCodexPluginHooksManifest } from '../scripts/lib/transformers/hooks.js';

function write(root, rel, contents) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, contents);
}

describe('buildCodexPluginManifest: optional homepage', () => {
  const base = {
    name: 'melzi',
    version: '3.9.1',
    repository: 'https://github.com/pbakaus/impeccable',
  };

  // This fork has no published site, so the root manifest carries no homepage.
  // Every URL built from it must be dropped, never emitted as the literal
  // string "undefined/privacy" into a store submission manifest.
  it('omits homepage-derived URLs when there is no homepage', () => {
    const m = buildCodexPluginManifest(base);
    assert.equal('homepage' in m, false);
    assert.equal('url' in m.author, false);
    assert.equal('websiteURL' in m.interface, false);
    assert.equal('privacyPolicyURL' in m.interface, false);
    assert.doesNotMatch(JSON.stringify(m), /undefined/);
    // Non-homepage fields still render.
    assert.equal(m.interface.displayName, 'Melzi');
    assert.match(m.interface.termsOfServiceURL, /^https:\/\/github\.com\//);
  });

  it('emits homepage-derived URLs when a homepage is present', () => {
    const m = buildCodexPluginManifest({ ...base, homepage: 'https://example.invalid' });
    assert.equal(m.homepage, 'https://example.invalid');
    assert.equal(m.author.url, 'https://example.invalid');
    assert.equal(m.interface.websiteURL, 'https://example.invalid');
    assert.equal(m.interface.privacyPolicyURL, 'https://example.invalid/privacy');
  });
});

describe('OpenAI plugin staging', () => {
  let root;
  let dist;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-openai-plugin-'));
    dist = path.join(root, 'dist');

    write(root, '.claude-plugin/plugin.json', JSON.stringify({
      name: 'melzi',
      version: '3.9.1',
      author: {
        name: 'Paul Bakaus',
        email: 'paul@example.com',
      },
      homepage: 'https://example.invalid',
      repository: 'https://github.com/pbakaus/impeccable',
    }));
    write(root, 'scripts/lib/assets/plugin-icon.png', 'icon');
    write(root, 'LICENSE', 'license');
    write(root, 'NOTICE.md', 'upstream notice');

    write(
      root,
      'dist/codex/.codex/skills/melzi/SKILL.md',
      '---\nname: melzi\n---\n\nUse $melzi. Run .codex/skills/melzi/scripts/context.mjs.\n',
    );
    write(
      root,
      'dist/codex/.codex/skills/melzi/agents/openai.yaml',
      'interface:\n  display_name: Impeccable\n',
    );
    write(
      root,
      'dist/codex/.codex/skills/melzi/agents/impeccable_asset_producer.toml',
      'name = "impeccable_asset_producer"\n',
    );

    // A Claude payload exists too. The OpenAI stage must never read it.
    write(
      root,
      'dist/claude-code/.claude/skills/melzi/SKILL.md',
      '---\nname: melzi\n---\n\nUse /melzi. Run .claude/skills/melzi/scripts/context.mjs.\n',
    );
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('packages the Codex skill, agents, manifest, icon, and compatible hook', () => {
    const pluginRoot = stageOpenAIPlugin(root, dist);
    const skill = fs.readFileSync(path.join(pluginRoot, 'skills/melzi/SKILL.md'), 'utf8');
    const manifest = JSON.parse(fs.readFileSync(path.join(pluginRoot, '.codex-plugin/plugin.json'), 'utf8'));
    const hooks = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'hooks/hooks.json'), 'utf8'));

    assert.match(skill, /\$melzi/);
    assert.match(skill, /\.codex\/skills\/melzi/);
    assert.doesNotMatch(skill, /(?:^|[\s`(])\/melzi\b/m);
    assert.doesNotMatch(skill, /\.claude\/skills\/melzi/);

    assert.ok(fs.existsSync(path.join(pluginRoot, 'skills/melzi/agents/openai.yaml')));
    assert.ok(fs.existsSync(path.join(
      pluginRoot,
      'skills/melzi/agents/impeccable_asset_producer.toml',
    )));
    assert.ok(fs.existsSync(path.join(pluginRoot, 'assets/icon.png')));

    assert.equal(manifest.skills, './skills/');
    assert.deepEqual(manifest.author, {
      name: 'Renaissance Geek Inc',
      url: 'https://example.invalid',
    });
    assert.equal('email' in manifest.author, false);
    assert.equal(manifest.interface.shortDescription, 'Design and refine interfaces');
    assert.equal(manifest.interface.category, 'Creativity');
    assert.deepEqual(hooks, buildCodexPluginHooksManifest());
    assert.match(hooks.hooks.PostToolUse[0].hooks[0].command, /\$\{PLUGIN_ROOT\}/);
    assert.doesNotMatch(hooks.hooks.PostToolUse[0].hooks[0].command, /CLAUDE_PLUGIN_ROOT/);
  });
});
