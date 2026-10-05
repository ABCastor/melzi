import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../.github/workflows/release-engine.yml', import.meta.url), 'utf8');
const workflow = Bun.YAML.parse(source);

describe('engine artifact boundary', () => {
  test('only a manual run builds artifacts with a read-only token', () => {
    expect(workflow.on).toEqual({ workflow_dispatch: null });
    expect(workflow.permissions).toEqual({ contents: 'read' });
    expect(Object.keys(workflow.jobs)).toEqual(['build']);
    expect(workflow.jobs.build.permissions).toBeUndefined();
    expect(source).not.toMatch(/gh release|id-token:|azure\/|Renaissance Geek|impeccable-signing/);
  });

  test('preserves all five native targets and labels every artifact unsigned', () => {
    const job = workflow.jobs.build;
    expect(job.strategy.matrix.include.map(row => row.short)).toEqual([
      'darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64', 'windows-x64',
    ]);
    expect(job.steps.find(step => step.name === 'Build').run).toContain('build --release -p impeccable');
    expect(job.steps.find(step => step.name === 'Smoke the binary').run).toContain('engine-probe');
    const upload = job.steps.find(step => step.uses?.startsWith('actions/upload-artifact@'));
    expect(upload.with.name).toContain('melzi-engine-unsigned-');
    expect(upload.with['if-no-files-found']).toBe('error');
    expect(upload.with.path).toContain('\nLICENSE\nNOTICE.md\ndocs/OFL-literata.txt');
  });

  test('every third-party action is pinned to a commit', () => {
    for (const job of Object.values(workflow.jobs)) {
      for (const step of job.steps) {
        if (step.uses) expect(step.uses).toMatch(/@[a-f0-9]{40}$/);
      }
    }
  });
});
