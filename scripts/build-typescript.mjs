import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targets = [
  'cli/bin/cli',
  'scripts/lib/transformers/factory',
  'scripts/lib/transformers/providers',
  'scripts/lib/transformers/index',
  'scripts/lib/skill-categories',
];
const check = process.argv.includes('--check');
const config = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile);
if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
const program = ts.createProgram(parsed.fileNames, parsed.options);
const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
if (diagnostics.length) {
  process.stderr.write(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCurrentDirectory: () => root,
    getCanonicalFileName: name => name,
    getNewLine: () => '\n',
  }));
  process.exit(1);
}
for (const target of targets) {
  const source = path.join(root, `${target}.ts`);
  const destination = path.join(root, `${target}.js`);
  const result = ts.transpileModule(fs.readFileSync(source, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    fileName: source,
  });
  const banner = `// Generated from ${path.basename(source)}. Edit the TypeScript source and run bun run build:typescript.\n`;
  const output = result.outputText.startsWith('#!')
    ? result.outputText.replace(/^(#![^\n]*\n)/, `$1${banner}`)
    : banner + result.outputText;
  if (check) {
    if (!fs.existsSync(destination) || fs.readFileSync(destination, 'utf8') !== output) {
      process.stderr.write(`${target}.js differs from its TypeScript source; run bun run build:typescript.\n`);
      process.exitCode = 1;
    }
  } else {
    fs.writeFileSync(destination, output);
  }
}
if (!process.exitCode) console.log(`TypeScript: ${check ? 'checked' : 'built'} ${targets.length} runtime modules.`);
