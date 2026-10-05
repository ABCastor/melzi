import fs from 'node:fs';
import path from 'node:path';

// Keep the complete attribution with every independently installable payload.
export function copyDistributionNotices(rootDir, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const name of ['LICENSE', 'NOTICE.md']) {
    fs.copyFileSync(path.join(rootDir, name), path.join(destination, name));
  }
  const ofl = path.join(rootDir, 'docs/OFL-literata.txt');
  if (fs.existsSync(ofl)) {
    fs.mkdirSync(path.join(destination, 'docs'), { recursive: true });
    fs.copyFileSync(ofl, path.join(destination, 'docs/OFL-literata.txt'));
  }
}
