import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  exitCodeFor,
  formatSummary,
  isFailure,
  shortenCommand,
  summarize,
} from '../scripts/test-report.mjs';

const pass = (suite, command) => ({ suite, command, status: 0 });
const fail = (suite, command) => ({ suite, command, status: 1 });
const skip = (suite, command) => ({ suite, command, skipped: true });

describe('test report', () => {
  it('treats a non-zero status as a failure and a skip as neither', () => {
    assert.equal(isFailure(pass('core', 'a')), false);
    assert.equal(isFailure(fail('core', 'a')), true);
    assert.equal(isFailure(skip('core', 'a')), false);
  });

  it('counts a spawn error as a failure', () => {
    const results = [{ suite: 'core', command: 'bun test', status: null, error: 'ENOENT' }];
    assert.equal(exitCodeFor(results), 1);
    assert.match(formatSummary(results), /ENOENT/);
  });

  it('exits non-zero when any suite failed, whatever ran after it', () => {
    const results = [fail('core', 'a'), pass('detector', 'b'), pass('live', 'c')];
    assert.equal(exitCodeFor(results), 1);
  });

  it('exits zero when everything passed', () => {
    assert.equal(exitCodeFor([pass('core', 'a'), pass('live', 'b')]), 0);
  });

  it('rolls processes up per suite and names every failing suite', () => {
    const report = summarize([
      pass('core', 'a'),
      fail('core', 'b'),
      pass('detector', 'c'),
      fail('live', 'd'),
    ]);

    assert.deepEqual(report.failedSuites, ['core', 'live']);
    assert.equal(report.totals.ran, 4);
    assert.equal(report.totals.failed, 2);
    assert.equal(report.ok, false);

    const core = report.suites.find((suite) => suite.name === 'core');
    assert.equal(core.ran, 2);
    assert.equal(core.failed, 1);
    assert.deepEqual(core.failures, ['b']);
  });

  it('reports suites that ran after an earlier failure, the whole point of the fork delta', () => {
    const summary = formatSummary([fail('core', 'a'), pass('detector', 'b'), pass('framework', 'c')]);

    assert.match(summary, /core .*FAIL/);
    assert.match(summary, /detector .*ok/);
    assert.match(summary, /framework .*ok/);
    assert.match(summary, /Failing suites: core/);
  });

  it('separates "not run" from "passed" so a bailed run cannot read as full coverage', () => {
    const results = [fail('core', 'a'), skip('live', 'b'), skip('live', 'c')];
    const report = summarize(results);
    const live = report.suites.find((suite) => suite.name === 'live');

    assert.equal(live.ran, 0);
    assert.equal(live.skipped, 2);
    assert.equal(report.totals.ran, 1);

    const summary = formatSummary(results, { bail: true });
    assert.match(summary, /live .*SKIP .*0 ran, 2 not run/);
    assert.match(summary, /not full coverage/);
  });

  it('keeps a short command intact', () => {
    assert.equal(shortenCommand('node --test tests/pin.test.mjs'), 'node --test tests/pin.test.mjs');
  });

  it('collapses a multi-file bun command instead of dumping every filename', () => {
    const command = 'bun test tests/build.test.js tests/cli-ignores.test.js tests/lib/utils.test.js';
    assert.equal(shortenCommand(command, 40), 'bun test tests/build.test.js +2 more');
  });

  it('truncates a long single-file command rather than growing the summary', () => {
    const command = `node --test tests/${'x'.repeat(90)}.mjs`;
    const short = shortenCommand(command, 40);
    assert.equal(short.length, 40);
    assert.match(short, /\.\.\.$/);
  });

  it('says so plainly when everything passed', () => {
    const summary = formatSummary([pass('core', 'a'), pass('live', 'b')]);
    assert.match(summary, /All requested suites passed\./);
    assert.doesNotMatch(summary, /Failing suites/);
  });
});
