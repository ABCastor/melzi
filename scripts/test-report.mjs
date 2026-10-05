/**
 * Aggregate reporting for scripts/run-tests.mjs.
 *
 * Melzi fork delta. Upstream's runner exits on the first non-zero child,
 * so a red run never reaches the suites behind it and the printed counts
 * describe only the processes that happened to run before the first failure.
 * These helpers live outside run-tests.mjs to keep that upstream file's diff
 * small and mechanical at merge time.
 *
 * A result is one spawned process:
 *   { suite, command, status }            ran, status 0 means pass
 *   { suite, command, status: null, error } spawn itself failed
 *   { suite, command, skipped: true }     not run (--bail stopped earlier)
 */

export function isFailure(result) {
  return !result.skipped && result.status !== 0;
}

/**
 * One bun process can carry a dozen files, which makes the raw command
 * unreadable in a summary. Name the first file and count the rest; the
 * runner already echoed the full command above, and bun's own output
 * names the failing test.
 */
export function shortenCommand(command, limit = 72) {
  if (!command || command.length <= limit) return command;

  const parts = command.split(' ');
  const files = parts.filter((part) => part.endsWith('.test.js') || part.endsWith('.test.mjs'));
  if (files.length > 1) {
    const head = parts.slice(0, parts.indexOf(files[0]) + 1).join(' ');
    return `${head} +${files.length - 1} more`;
  }

  return `${command.slice(0, limit - 3)}...`;
}

export function exitCodeFor(results) {
  return results.some(isFailure) ? 1 : 0;
}

export function summarize(results) {
  const suites = [];
  const byName = new Map();

  for (const result of results) {
    let suite = byName.get(result.suite);
    if (!suite) {
      suite = { name: result.suite, ran: 0, failed: 0, skipped: 0, failures: [] };
      byName.set(result.suite, suite);
      suites.push(suite);
    }
    if (result.skipped) {
      suite.skipped += 1;
      continue;
    }
    suite.ran += 1;
    if (isFailure(result)) {
      suite.failed += 1;
      const label = shortenCommand(result.command);
      suite.failures.push(result.error ? `${label} (${result.error})` : label);
    }
  }

  const totals = suites.reduce(
    (acc, suite) => ({
      ran: acc.ran + suite.ran,
      failed: acc.failed + suite.failed,
      skipped: acc.skipped + suite.skipped,
    }),
    { ran: 0, failed: 0, skipped: 0 },
  );

  return {
    suites,
    totals,
    failedSuites: suites.filter((suite) => suite.failed > 0).map((suite) => suite.name),
    ok: totals.failed === 0,
  };
}

export function formatSummary(results, { bail = false } = {}) {
  const report = summarize(results);
  if (report.suites.length === 0) return '\n## summary\n  no suites ran';

  const width = Math.max(...report.suites.map((suite) => suite.name.length));
  const lines = ['', '## summary'];

  for (const suite of report.suites) {
    const state = suite.failed > 0 ? 'FAIL' : suite.ran === 0 ? 'SKIP' : 'ok';
    const counts = [`${suite.ran} ran`];
    if (suite.failed > 0) counts.push(`${suite.failed} failed`);
    if (suite.skipped > 0) counts.push(`${suite.skipped} not run`);
    lines.push(`  ${suite.name.padEnd(width)}  ${state.padEnd(4)}  ${counts.join(', ')}`);
    for (const failure of suite.failures) {
      lines.push(`  ${' '.repeat(width)}        ${failure}`);
    }
  }

  const { ran, failed, skipped } = report.totals;
  const tally = [`${report.suites.length} suites`, `${ran} processes ran`];
  if (failed > 0) tally.push(`${failed} failed`);
  if (skipped > 0) tally.push(`${skipped} not run`);
  lines.push('', `${tally.join(', ')}.`);

  if (failed > 0) lines.push(`Failing suites: ${report.failedSuites.join(', ')}`);
  if (skipped > 0 && bail) {
    lines.push('Stopped early by --bail, so the counts above are not full coverage.');
  }
  if (report.ok) lines.push('All requested suites passed.');

  return lines.join('\n');
}
