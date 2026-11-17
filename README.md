<h1><img src="docs/readme-header.svg" width="112" height="72" align="absmiddle" alt=""> <img src="docs/readme-title.svg" width="101" height="40" align="absmiddle" alt="Melzi*"></h1>

[![Checks](https://github.com/ABCastor/melzi/actions/workflows/checks.yml/badge.svg)](https://github.com/ABCastor/melzi/actions/workflows/checks.yml)

<!-- rebrand:off -->
Melzi is a design skill for coding tools, built on Paul Bakaus's [Impeccable](https://github.com/pbakaus/impeccable) and kept in sync with it. It installs only from a local build: there is no npm package, and the launcher never downloads an engine or a skill bundle.

Your coding tool gets Impeccable's vocabulary for reviewing a frontend (typography, layout, colour, motion, accessibility, and the repeated patterns that make generated interfaces look alike) and its native detector, which checks source files and rendered pages against 62 rules. Melzi then makes the tool check its own rendered screens against a written bar before you see them. The skill has 21 commands, including `/melzi critique`, `/melzi audit`, `/melzi polish`, and `/melzi live`.

## Compared with Impeccable

Melzi shares Impeccable's git history and merges its releases, and this version tracks Impeccable cli-v4.9.2. The detector, live mode, and most of the commands come from there. Release notes are in [CHANGELOG.md](CHANGELOG.md).

| | Impeccable | Melzi |
|---|---|---|
| Detector | 62 rules over source files and rendered pages | The same 62 rules |
| Checking its own work | A craft floor of bans, and a look at the render at the shipped sizes | The same floor, plus a taste bar of 14 tests on the render and a scored director's pass, two rounds at most |
| Changing an existing screen | The command's playbook | Decides first how much the screen needs, then proves no link, field, handler, or heading went missing |
| Testing a running app | `critique` and `audit` reports | `/melzi explore` drives the app, and a separate verifier replays each defect from a clean reset |
| Starting from a design you admire | Not included | `/melzi study` names its design language from a URL or a screenshot |
| Visual identity | `document` writes down the system you have | `/melzi identity` builds one, with a mark, from choices between rendered versions |
| Illustration | Not included | `/melzi handdrawn` draws mascots and marks as clean SVG |
| Feedback on a prototype | Live mode swaps variants of one element | Live mode, plus a review island for notes, pins, and colours and faces tried on the page |
| Motion | `animate` | `animate` with model-driven dragging, recorded motion review, and films and talk decks |
| Findings | Ranked P0 to P3 | Ranked, and labelled by the evidence behind each one |
| Install | `npx impeccable install`, editor plugins, a Chrome extension | A local build only; remote `install`, `update`, and `check` refuse to run |
| Commands | 24 | 21 canonical commands, with eight of Impeccable's folded into others |

**If you want a one-command install, editor plugins, or the browser extension, use Impeccable.** Melzi is for working from a checkout you build and can read.

### The taste bar

Every UI edit ends with a director's pass from `skill/reference/taste-bar.md`. The skill captures the page at 390 and 1440 pixels wide, sweeps the width from 320 to 1920 looking for mechanical breaks, judges the first viewport before anything below it, and writes down the three most visible faults before it scores anything. Then it runs fourteen tests on the pixels: a squint at quarter size, a swap of every face to Georgia and Arial that the layout has to survive, a count of distinct left edges (three or fewer on desktop), a spacing scale of six values or fewer, and a check that every "Sent" or "Saved" follows a request that really happened, among others. Seven axes get a score from 1 to 5, each with a reason you can see in the render. Anything under 4 gets a named fix, the weakest axis gets one even when everything passes, and a second render closes the pass.

**You are never asked to rate, rank, or score a screen.** The skill holds the bar itself, hands over the screenshots with what it found and changed, and says plainly when an axis is still short.

A change to a screen that already exists starts by deciding how much the screen needs, and says so when the answer is nothing. Before the first edit the skill records every link target, field name, handler, script hook, and heading; after the last it compares, and anything missing is restored or named in the hand-off. The work goes in layers across the whole screen, spacing first and motion last.

Five of these checks adapt ideas from nutlope's [Hallmark](https://github.com/nutlope/hallmark), and two from Damir Sokolovsky's [unslop](https://github.com/heydamir/unslop). [NOTICE.md](NOTICE.md) says which, along with every other borrowed idea.

### Commands and tools Impeccable does not have

- **`/melzi explore`** drives the running app looking for defects, then an independent verifier replays each one from a clean reset and confirms or rejects it with its own evidence. It needs a browser driver such as [Playwright MCP](https://github.com/microsoft/playwright-mcp).
- **`/melzi study`** takes a URL or a screenshot of a design you admire and names its design language before anything is written.
- **`/melzi identity`** builds a visual system and an identity mark by asking you to choose between rendered versions, never for a hex value or a font name. The colours and faces it settles become a signature that later design tasks carry, and the detector reports anything outside it.
- **`/melzi handdrawn`** draws mascots, spot illustrations, and annotation marks that look drawn by a person and stay clean SVG.
- **A review island** (`skill/scripts/review-layer.js`): one script tag on a prototype, and your notes, element pins, and the colours and typefaces you try on the page come back to the coding tool attached to the page.
- **Motion review** (`skill/scripts/motion-eyes.mjs`) records scripted interactions as a video and a timestamped contact sheet, so animation is judged from a recording rather than from stills.
- **Model-driven dragging** in `animate`: a drag may only land on states the product allows, rendered ahead and blended mid-drag, after Horowitz, Blinn, and Heer's [Declarative Dragging](https://declarative-dragging.github.io/) and its library Dragology.
- **Films and talk decks** (`skill/reference/motion-film.md`): formats first, a storyboard gate, a seekable timeline captured frame by frame, and a click-stepped deck that runs offline, after Elisabetta Cavataio's [i-like-to-move-it-skills](https://github.com/elisabettacavataio-design/i-like-to-move-it-skills).
- **Taste calibration** (`skill/scripts/melzi/`), only when you ask for it by name: your picks between rendered screens are stored in `~/.impeccable/taste/` and fitted into a model that scores screens you have not seen.
- **Evidence labels** on critique and audit findings (observed, reproduced, standard, research, inference, taste), defined in `skill/reference/rigor.md`.

Eight of Impeccable's commands (`adapt`, `craft`, `delight`, `distill`, `extract`, `onboard`, `optimize`, `overdrive`) are folded into other playbooks, and each name still works. Melzi generates skills for the same coding tools as Impeccable.

<!-- rebrand:on -->
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

<!-- rebrand:off -->
Codex uses `.agents/skills/melzi`, Claude Code uses `.claude/skills/melzi`, and Cursor uses `.cursor/skills/melzi`. Start with `/melzi init` inside the tool. Remote `install`, `update`, and `check` are unavailable. Those verbs fail before prompts or writes unless `IMPECCABLE_BUNDLE_PATH` names an existing locally built bundle. The local copy method above is the simplest installation path.
<!-- rebrand:on -->

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

Live mode is for a local checkout only: do not inject it into a deployed site or loosen a production CSP for it. Applying copy edits runs the optional `impeccable:manual-edit-validate` script from your `package.json` with your permissions, so read it first in a repo you do not know. Apply hands staged copy edits to your chat agent when a live session has polled in the last minute; otherwise it starts the `codex` CLI from your PATH (or `claude` when codex is missing) with approvals, permission checks and sandboxing off (`--dangerously-bypass-approvals-and-sandbox` or `--permission-mode bypassPermissions`), inheriting your environment, and with a prompt that carries the staged edits, the edited elements' HTML and nearby text, the page URL and candidate source paths. Set `IMPECCABLE_LIVE_COPY_AGENT=chat` where live mode starts to keep Apply in your chat session, or `off` to turn Apply off; the server reads it once at startup.

<!-- rebrand:off -->
Melzi keeps Impeccable's direction catalog. When a new design rolls visual directions from it, the request goes to impeccable.style, and while telemetry is on it also sends an anonymous record of which directions were shown and which one you chose. Turn telemetry off with `DO_NOT_TRACK=1`, `IMPECCABLE_NO_TELEMETRY=1`, `telemetry off` through the launcher, or `"telemetry": false` in `.impeccable/config.json`.
<!-- rebrand:on -->

[Harness installation details](docs/HARNESSES.md) cover the supported layouts. Run `help` or `detect --help` through the launcher for the current command options.

## What it checks

The detector handles HTML, CSS, JSX, TSX, Vue, and Svelte. It reports rule findings, rather than a verdict on whether a design is good. Reviewing a running page can expose problems that a source scan cannot see. Live review needs a Chromium-based browser and a running app; framework support varies.

The skill adds design guidance and review workflows around those checks. The taste bar and the playbooks are instructions: they work as well as your coding tool follows them, and a person still has the final say on a design. The default test suite includes browser and framework integration checks. It needs a Chromium browser and supporting tools. Optional integration suites may also require an installed coding CLI or provider credentials.

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

Apache-2.0. Melzi is built on [Impeccable](https://github.com/pbakaus/impeccable) by Paul Bakaus. It is a modified fork that retains the original copyright and terms. See [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md) for retained attribution and third-party notices.

<p><a href="https://abcastor.com"><img src="docs/castor-footer.svg" width="350" alt="Chip, the Castor beaver, Castor, we give a dam"></a></p>
