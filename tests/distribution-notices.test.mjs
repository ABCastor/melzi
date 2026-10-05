import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { zipSync } from 'fflate';
import { checkDistributionArchive } from '../scripts/check-distribution-notices.mjs';

describe('distribution attribution contract', () => {
  let root;
  const license = Buffer.from('Complete Apache license fixture\n');
  const notice = Buffer.from('Retained upstream copyright and notices\n');
  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'melzi-notices-'));
    fs.writeFileSync(path.join(root, 'LICENSE'), license);
    fs.writeFileSync(path.join(root, 'NOTICE.md'), notice);
  });
  after(() => fs.rmSync(root, { recursive: true, force: true }));
  function archive(entries, extension = 'zip') {
    const file = path.join(root, `fixture.${extension}`);
    fs.writeFileSync(file, zipSync(entries));
    return file;
  }
  it('requires complete byte-identical notices in the actual archive and each installable skill', () => {
    const entries = { LICENSE: license, 'NOTICE.md': notice,
      '.agents/skills/melzi/SKILL.md': Buffer.from('skill'),
      '.agents/skills/melzi/LICENSE': license, '.agents/skills/melzi/NOTICE.md': notice };
    assert.equal(checkDistributionArchive(archive(entries), root), 1);
    const withoutNotice = { ...entries }; delete withoutNotice['NOTICE.md'];
    assert.throws(() => checkDistributionArchive(archive(withoutNotice), root), /NOTICE.md/);
    const withoutSkillNotice = { ...entries }; delete withoutSkillNotice['.agents/skills/melzi/NOTICE.md'];
    assert.throws(() => checkDistributionArchive(archive(withoutSkillNotice), root), /skills\/melzi\/NOTICE.md/);
    assert.throws(() => checkDistributionArchive(archive({ ...entries, 'NOTICE.md': Buffer.from('shortened notice') }), root), /NOTICE.md/);
  });
  it('checks the extension namespace used by real VSIX archives', () => {
    const entries = { 'extension/LICENSE': license, 'extension/NOTICE.md': notice };
    assert.equal(checkDistributionArchive(archive(entries, 'vsix'), root), 0);
    delete entries['extension/NOTICE.md'];
    assert.throws(() => checkDistributionArchive(archive(entries, 'vsix'), root), /extension\/NOTICE.md/);
  });
});
