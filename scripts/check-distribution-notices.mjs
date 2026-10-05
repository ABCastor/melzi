import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { PROVIDERS } from './lib/transformers/index.js';

const noticeFiles = ['LICENSE', 'NOTICE.md'];
function matches(actual, expected, label) {
  if (!actual || !Buffer.from(actual).equals(expected)) {
    throw new Error(`Distribution attribution missing or changed: ${label}`);
  }
}
export function checkDistributionArchive(archive, rootDir) {
  const entries = unzipSync(fs.readFileSync(archive));
  const prefix = archive.endsWith('.vsix') ? 'extension/' : '';
  for (const name of noticeFiles) {
    matches(entries[prefix + name], fs.readFileSync(path.join(rootDir, name)), `${archive}: ${prefix}${name}`);
  }
  const roots = new Set(Object.keys(entries).filter(name => name.endsWith('/SKILL.md')).map(name => name.slice(0, -'SKILL.md'.length)));
  for (const directory of roots) {
    for (const name of noticeFiles) {
      matches(entries[directory + name], fs.readFileSync(path.join(rootDir, name)), `${archive}: ${directory}${name}`);
    }
  }
  return roots.size;
}
function checkDirectory(directory, rootDir) {
  for (const name of noticeFiles) {
    matches(fs.existsSync(path.join(directory, name)) ? fs.readFileSync(path.join(directory, name)) : null,
      fs.readFileSync(path.join(rootDir, name)), path.join(directory, name));
  }
  for (const entry of fs.readdirSync(directory, { recursive: true })) {
    if (!entry.endsWith('SKILL.md')) continue;
    const skillRoot = path.dirname(path.join(directory, entry));
    for (const name of noticeFiles) {
      matches(fs.existsSync(path.join(skillRoot, name)) ? fs.readFileSync(path.join(skillRoot, name)) : null,
        fs.readFileSync(path.join(rootDir, name)), path.join(skillRoot, name));
    }
  }
}
export function checkDistributions(rootDir, distDir) {
  const directories = [...Object.values(PROVIDERS).map(config => config.provider),
    'universal', 'cursor-plugin', 'vscode', 'openai/impeccable'];
  for (const directory of directories) checkDirectory(path.join(distDir, directory), rootDir);
  if (fs.existsSync(path.join(rootDir, 'plugin'))) checkDirectory(path.join(rootDir, 'plugin'), rootDir);
  const archives = fs.readdirSync(distDir).filter(name => /\.(zip|vsix)$/.test(name));
  for (const required of ['universal.zip', 'openai-plugin.zip']) {
    if (!archives.includes(required)) throw new Error(`Missing distribution archive: ${required}`);
  }
  for (const archive of archives) checkDistributionArchive(path.join(distDir, archive), rootDir);
  console.log(`Distribution attribution: ${directories.length} staged payloads and ${archives.length} archives match LICENSE/NOTICE bytes.`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rootDir = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
  try {
    if (process.argv[2] === '--archive') {
      checkDistributionArchive(path.resolve(process.argv[3]), rootDir);
      console.log('Archive attribution matches LICENSE/NOTICE bytes.');
    } else checkDistributions(rootDir, path.join(rootDir, 'dist'));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
