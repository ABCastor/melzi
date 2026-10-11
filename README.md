<h1><img src="docs/readme-header.svg" width="112" height="72" align="absmiddle" alt=""> <img src="docs/readme-title.svg" width="101" height="40" align="absmiddle" alt="Melzi*"></h1>

[![Checks](https://github.com/ABCastor/melzi/actions/workflows/checks.yml/badge.svg)](https://github.com/ABCastor/melzi/actions/workflows/checks.yml)

Design review skills and interface checks for AI coding tools.

Melzi gives your coding tool a vocabulary for reviewing a frontend: typography, layout, colour, motion, accessibility, and the repeated patterns that make generated interfaces look alike. Its skill has 21 canonical commands, including `/melzi critique`, `/melzi audit`, `/melzi polish`, and `/melzi live`. A native detector checks source files and rendered pages against 59 rules.

## Build and use

This fork requires a local engine build. Prebuilt Melzi engine packages are not published, and the launcher does not automatically install or download Impeccable's engine.

Use Rust stable through rustup, Bun matching `.bun-version`, and Node.js 22.18 or newer. `rust-toolchain.toml` also declares the WebAssembly target needed by browser builds. From this checkout on macOS or Linux:

```sh
bun install --frozen-lockfile
cargo build --release -p impeccable
bun run build:release

IMPECCABLE_BIN="$PWD/target/release/impeccable" node cli/bin/cli.js help
IMPECCABLE_BIN="$PWD/target/release/impeccable" node cli/bin/cli.js detect src/
IMPECCABLE_BIN="$PWD/target/release/impeccable" node cli/bin/cli.js detect --json src/
```

On Windows, build the same engine and bundles, then use PowerShell:

```powershell
$env:IMPECCABLE_BIN = "$PWD/target/release/impeccable.exe"
node cli/bin/cli.js help
node cli/bin/cli.js detect src/
```

The Windows engine is `target/release/impeccable.exe`. The executable name, `IMPECCABLE_*` settings, `.impeccable/` state directory, and `impeccable-ignore-*` markers are retained for compatibility. To use the skill's commands, make `IMPECCABLE_BIN` point to the same absolute binary path in your coding tool's environment.

The release build writes `dist/universal.zip` and generates skill directories for supported tools. Copy the directory for your tool into a project, or install its `skills/melzi` directory in your tool's user skill directory. For Codex, the generated payload is `dist/agents/.agents/skills/melzi`; for Claude Code, it is `dist/claude-code/.claude/skills/melzi`. To install the Codex payload in another project:

```sh
mkdir -p /path/to/project/.agents/skills
cp -R dist/agents/.agents/skills/melzi /path/to/project/.agents/skills/
```

Codex uses `.agents/skills/melzi`, Claude Code uses `.claude/skills/melzi`, and Cursor uses `.cursor/skills/melzi`. Start with `/melzi init` inside the tool. Remote `install`, `update`, and `check` are unavailable. Those verbs fail before prompts or writes unless `IMPECCABLE_BUNDLE_PATH` names an existing locally built bundle. The local copy method above is the simplest installation path.

A few starting points:

| Command | Use it to |
|---|---|
| `/melzi critique` | Review the interface and identify the changes that matter. |
| `/melzi audit` | Check accessibility, layout, and design consistency. |
| `/melzi handdrawn` | Add controlled hand-drawn detail to an interface. |
| `/melzi live` | Try variants in a running local app. |

Keep local review captures and question logs out of Git while retaining shared project settings:

```gitignore
# impeccable-ignore-start
**/.impeccable/review/
**/.impeccable/questions/
# impeccable-ignore-end
```

[Harness installation details](docs/HARNESSES.md) cover the supported layouts. Run `help` or `detect --help` through the launcher for the current command options.

## What it checks

The detector handles HTML, CSS, JSX, TSX, Vue, and Svelte. It reports rule findings, rather than a verdict on whether a design is good. Reviewing a running page can expose problems that a source scan cannot see. Live review needs a Chromium-based browser and a running app; framework support varies.

The skill adds design guidance and review workflows around those checks. It depends on the coding tool following its instructions, and visual judgment still needs a person. The default test suite includes browser and framework integration checks. It needs a Chromium browser and supporting tools. Optional integration suites may also require an installed coding CLI or provider credentials.

The launcher package version and native engine version are separate: `node cli/bin/cli.js --version` reports the package version; `ENGINE_VERSION` pins the native engine.

## Development

The npm launcher and provider distribution transformers have strict TypeScript source. Their checked-in JavaScript output keeps Node installations and existing build consumers working without a TypeScript loader. The detector and command engine remain Rust; browser scripts and other adapters still include JavaScript.

Useful development checks:

```sh
bun run typecheck
bun run check:typescript
bun run check:notices # after build:release
bun run test
cargo test --workspace
```

After changing a typed runtime module, run `bun run build:typescript`. After changing the skill or provider output, run `bun run build:release`. [The engine guide](docs/ENGINE.md) explains the Rust workspace and browser bundles.

## License

Apache-2.0. Melzi is a modified fork of [Impeccable](https://github.com/pbakaus/impeccable) by Paul Bakaus. See [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md) for retained attribution and third-party notices.

<p><a href="https://abcastor.com"><img src="docs/castor-footer.svg" width="350" alt="Chip, the Castor beaver, Castor, we give a dam"></a></p>
