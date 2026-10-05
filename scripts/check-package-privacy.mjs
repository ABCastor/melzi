import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = ['README.md', 'README.npm.md', 'package.json', 'LICENSE', 'NOTICE.md'];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(file);
    else files.push(path.relative(root, file));
  }
}
walk(path.join(root, 'cli/bin'));
const patterns = [
  /(?:\/Users\/|\/home\/|[A-Z]:\\Users\\)(?!<|\$|\{|(?:user|username|yourname)(?:[\/\\]|\b))[^\s"'`<>\/\\]+[\/\\]/g,
  /\b[A-Z0-9._%+-]+@(?!example\.(?:com|org|net)\b)[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
];
let failed = false;
for (const file of files) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  if (patterns.some(pattern => new RegExp(pattern.source, pattern.flags).test(text))) {
    console.error(`Private identifier in package surface: ${file}`);
    failed = true;
  }
}
if (failed) process.exit(1);
console.log(`Package privacy: checked ${files.length} files.`);
