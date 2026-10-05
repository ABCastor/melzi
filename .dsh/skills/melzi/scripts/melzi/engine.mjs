/** Local Rust engine access for fork helpers. Never downloads an engine. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scripts = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function loadEngine(env = process.env) {
  const exe = process.platform === 'win32' ? 'impeccable.exe' : 'impeccable';
  const platform = { darwin: 'darwin', linux: 'linux', win32: 'windows' }[process.platform] || 'unknown';
  const home = (process.platform === 'win32' ? env.USERPROFILE : env.HOME) || os.homedir();
  const cache = env.IMPECCABLE_HOME || path.join(home, '.impeccable');
  let version = '';
  try { version = fs.readFileSync(path.join(scripts, 'VERSION'), 'utf8').trim(); } catch { /* no pinned cache */ }
  // Match the launcher's local candidates, plus this checkout's release build.
  // An explicit override is authoritative: an invalid one must fail the proof.
  const candidates = env.IMPECCABLE_BIN ? [path.resolve(env.IMPECCABLE_BIN)] : [
    path.join(scripts, 'bin', `${platform}-${process.arch}`, exe),
    path.join(home, '.impeccable', 'bin', exe),
    ...(version ? [path.join(cache, 'bin', version, exe)] : []),
    path.resolve(scripts, '..', '..', 'target', 'release', exe),
    ...(env.PATH || '').split(path.delimiter).filter(Boolean).map(dir => path.join(dir, exe)),
  ];
  const childEnv = { ...env, IMPECCABLE_LAUNCHER_PROBE: '1', IMPECCABLE_DOWNLOAD_BASE: '', IMPECCABLE_SKILL_DIR: env.IMPECCABLE_SKILL_DIR || path.dirname(scripts) };
  const binary = candidates.find(candidate => {
    if (!fs.existsSync(candidate)) return false;
    const probe = spawnSync(candidate, ['engine-probe'], { env: childEnv, encoding: 'utf8', timeout: 10000 });
    return probe.status === 0 && /^impeccable-engine\s/.test(probe.stdout || '');
  });
  if (!binary) throw new Error('no local Rust detector engine found; set IMPECCABLE_BIN to a built engine; cannot prove binding');

  const runJson = (args, cwd, statuses) => {
    const result = spawnSync(binary, args, { cwd, env: childEnv, encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
    if (result.error || !statuses.includes(result.status)) {
      throw new Error(`detector engine failed: ${result.error?.message || result.stderr?.trim() || `exit ${result.status}`}`);
    }
    try { return JSON.parse(result.stdout); } catch { throw new Error('detector engine returned invalid JSON; cannot prove binding'); }
  };
  return {
    describeDesign(target, cwd = process.cwd()) {
      const result = runJson(['detect', '--design-system-json', path.resolve(cwd, target)], cwd, [0]);
      if (!result || typeof result.hasDesign !== 'boolean' || !Object.hasOwn(result, 'designSystem')) {
        throw new Error('detector engine does not support design-system inspection; cannot prove binding');
      }
      return result;
    },
    detect(target, cwd = process.cwd()) {
      const result = runJson(['detect', '--json', path.resolve(cwd, target)], cwd, [0, 2]);
      if (!Array.isArray(result)) throw new Error('detector engine returned invalid findings; cannot prove binding');
      return result;
    },
  };
}
