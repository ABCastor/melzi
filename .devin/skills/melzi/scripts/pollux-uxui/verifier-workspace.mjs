import { createHash } from 'node:crypto';
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import {
  dirname,
  isAbsolute,
  join,
  posix,
  relative,
  sep,
} from 'node:path';

function assertRelativePosixPath(value, label) {
  const displayPath = String(value);
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label} "${displayPath}" must be a non-empty string`);
  }
  if (posix.isAbsolute(value)) {
    throw new TypeError(`${label} "${value}" must be relative`);
  }
  if (value.includes('\\')) {
    throw new TypeError(`${label} "${value}" must not contain backslashes`);
  }
  if (value.split('/').includes('..')) {
    throw new TypeError(`${label} "${value}" must not contain a .. segment`);
  }
  if (value === '.' || posix.normalize(value) !== value) {
    throw new TypeError(`${label} "${value}" must be POSIX-normalized`);
  }
}

function validateFiles(files, runtimeDir) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new TypeError('files must be a non-empty array');
  }

  assertRelativePosixPath(runtimeDir, 'runtimeDir');
  const runtimePath = runtimeDir.toLowerCase();
  const seenPaths = new Set();

  return files.map((file, index) => {
    const label = `files[${index}].path`;
    if (!file || typeof file !== 'object' || Array.isArray(file)) {
      throw new TypeError(`files[${index}] path "<unknown>" must belong to an object`);
    }

    assertRelativePosixPath(file.path, label);
    const normalizedCase = file.path.toLowerCase();
    if (seenPaths.has(normalizedCase)) {
      throw new TypeError(`${label} "${file.path}" duplicates another path case-insensitively`);
    }
    if (
      normalizedCase === runtimePath
      || normalizedCase.startsWith(`${runtimePath}/`)
      || runtimePath.startsWith(`${normalizedCase}/`)
    ) {
      throw new TypeError(`${label} "${file.path}" overlaps runtimeDir "${runtimeDir}"`);
    }
    if (typeof file.content !== 'string') {
      throw new TypeError(`${label} "${file.path}" content must be a string`);
    }
    if (!Number.isInteger(file.mode) || file.mode < 0 || file.mode > 0o777) {
      throw new TypeError(`${label} "${file.path}" mode must be an integer from 0o000 to 0o777`);
    }

    seenPaths.add(normalizedCase);
    return file;
  });
}

function isInside(parent, child) {
  const childPath = relative(parent, child);
  return childPath === '' || (
    childPath !== '..'
    && !childPath.startsWith(`..${sep}`)
    && !isAbsolute(childPath)
  );
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function assertOrdinaryEntry(stats, relPath) {
  if (stats.isSymbolicLink()) throw new Error(`symlink entry: ${relPath}`);
  if (stats.isSocket()) throw new Error(`socket entry: ${relPath}`);
  if (stats.isFIFO()) throw new Error(`fifo entry: ${relPath}`);
  if (stats.isBlockDevice()) throw new Error(`block device entry: ${relPath}`);
  if (stats.isCharacterDevice()) throw new Error(`character device entry: ${relPath}`);
}

export function materializeWorkspace({ files, runtimeDir = 'runtime' }) {
  const validatedFiles = validateFiles(files, runtimeDir);
  const manifest = new Map(validatedFiles.map((file) => [
    file.path,
    { sha256: sha256(file.content), mode: file.mode },
  ]));
  const realTmp = realpathSync(tmpdir());
  const dir = mkdtempSync(join(realTmp, 'pollux-verifier-'));

  try {
    const dirStats = lstatSync(dir);
    if (!dirStats.isDirectory() || dirStats.isSymbolicLink()) {
      throw new Error(`workspace path is not a real directory: ${dir}`);
    }

    const realDir = realpathSync(dir);
    if (!realDir.startsWith(`${realTmp}${sep}`)) {
      throw new Error(`workspace path escaped temporary directory: ${dir}`);
    }

    chmodSync(dir, 0o700);
    const runtimePath = join(dir, runtimeDir);
    mkdirSync(runtimePath, { recursive: true, mode: 0o755 });

    for (const file of validatedFiles) {
      const target = join(dir, file.path);
      if (!isInside(dir, target) || target === dir) {
        throw new Error(`workspace target escaped directory: ${file.path}`);
      }

      const parent = dirname(target);
      mkdirSync(parent, { recursive: true });
      const realParent = realpathSync(parent);
      if (!isInside(realDir, realParent)) {
        throw new Error(`workspace parent escaped directory: ${file.path}`);
      }

      writeFileSync(target, file.content);
      chmodSync(target, file.mode);
    }

    const allowedPaths = [...manifest.keys()].sort();

    function verify() {
      const seenFiles = new Set();
      let sawRuntimeDir = false;

      function walk(absolutePath, relPath) {
        const displayPath = relPath || '.';
        const stats = lstatSync(absolutePath);
        assertOrdinaryEntry(stats, displayPath);

        if (stats.isDirectory()) {
          if (relPath === runtimeDir) sawRuntimeDir = true;
          for (const name of readdirSync(absolutePath)) {
            const childRelPath = relPath ? `${relPath}/${name}` : name;
            walk(join(absolutePath, name), childRelPath);
          }
          return;
        }

        if (!stats.isFile()) throw new Error(`unsupported entry: ${displayPath}`);
        if (relPath.startsWith(`${runtimeDir}/`)) return;

        const expected = manifest.get(relPath);
        if (!expected) throw new Error(`unexpected file: ${relPath}`);

        const actualHash = sha256(readFileSync(absolutePath));
        if (actualHash !== expected.sha256) {
          throw new Error(`hash mismatch: ${relPath}`);
        }
        if ((stats.mode & 0o022) !== 0) {
          throw new Error(`group/other writable file: ${relPath}`);
        }
        seenFiles.add(relPath);
      }

      walk(dir, '');
      if (!sawRuntimeDir) throw new Error(`missing runtime directory: ${runtimeDir}`);
      for (const relPath of manifest.keys()) {
        if (!seenFiles.has(relPath)) throw new Error(`missing file: ${relPath}`);
      }
      return true;
    }

    return {
      dir,
      runtimeDir,
      allowedPaths,
      digest(relPath) {
        return manifest.get(relPath)?.sha256;
      },
      verify,
      dispose() {
        rmSync(dir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}
