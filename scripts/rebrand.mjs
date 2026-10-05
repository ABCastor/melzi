#!/usr/bin/env node
/**
 * rebrand.mjs — the idempotent Impeccable -> Melzi brand transform.
 *
 * WHY THIS EXISTS
 * ---------------
 * This repo is a fork of pbakaus/impeccable and we intend to keep pulling their
 * functional updates forever. Our rebrand touches the same lines upstream edits,
 * so every merge would otherwise mean hand-resolving brand conflicts.
 *
 * Instead: merge upstream taking THEIR content on any brand-line conflict, then
 * re-run this script. It re-applies our brand deterministically. Merging becomes
 * "merge, re-run, verify green" instead of archaeology.
 *
 * It is IDEMPOTENT: running it twice is a no-op. Run it as often as you like.
 *
 * THE HARD-WON RULES
 * ------------------
 * `impeccable` is NOT one string with one meaning. It is at least six, and a
 * naive find-replace breaks the build (it did, on 2026-07-16). The distinctions:
 *
 *   RENAME  the command            `/impeccable audit`      -> `/melzi audit`
 *   RENAME  the skill/pkg identity `name: impeccable`       -> `name: melzi`
 *   RENAME  the CLI invocation     `npx impeccable`         -> `npx melzi`
 *   KEEP    upstream attribution   `pbakaus/impeccable`     (their repo, not ours)
 *   KEEP    upstream's git remote  `upstream/impeccable`    (names THEIR repo: the
 *                                  sync runner's output must keep saying it)
 *   KEEP    internal protocol      `impeccable-variants-start`, `impeccable-live-bar`,
 *                                  `impeccable-design-hook`, `impeccable-config.mjs`,
 *                                  `impeccable-logo-*` ... (writers+readers must agree;
 *                                  users never see these; renaming only desyncs them)
 *   KEEP    the live Freeform enum `action: 'impeccable'`   (internal action id)
 *   KEEP    the config dir         `.impeccable/`           (runtime contract)
 *   KEEP    the domain / handle    `impeccable.style`, `@impeccable_ai` (not ours)
 *   KEEP    the English adjective  "impeccable frontend design"
 *
 * WHAT THIS SCRIPT CANNOT SEE (do these by hand, then guard them with a test)
 * --------------------------------------------------------------------------
 * Every rule here is a literal-text match, so a brand string that is BUILT at
 * runtime is invisible to it. Two classes bit us on 2026-07-16:
 *
 *   1. Interpolated commands. `${PREFIX}impeccable` never contains the literal
 *      `/impeccable`, so the command rule could not match it, and every hook
 *      message kept telling users to run a command that no longer exists. There
 *      is now a dedicated rule for that exact declaration (see RULES).
 *   2. Prose that names the tool. "Install impeccable skills", "A newer
 *      Impeccable is available" -- indistinguishable by regex from the English
 *      adjective we deliberately KEEP. No rule can be safe here; a human reads
 *      the diff. `--check` will not catch these, so tests must.
 *
 * Usage:
 *   node scripts/rebrand.mjs           # apply
 *   node scripts/rebrand.mjs --check   # report drift, change nothing (exit 1 if drift)
 */

import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROVIDERS } from './lib/transformers/providers.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const CHECK_ONLY = process.argv.includes('--check');

// Every tree that carries the brand.
//
// site/ IS included, and that is a correction. It was excluded on the theory that
// site/ is purely upstream's marketing and would merge clean, but the rebrand
// commit had already hand-edited 54 files under it: those docs tell users what to
// TYPE (`npx impeccable detect`, `/impeccable hooks`), and leaving them would
// document a tool that does not exist. Hand edits the transform cannot reproduce
// are exactly what this script exists to prevent, because the next
// `merge upstream -> re-run rebrand` would silently revert them.
//
// The rules below are safe on site/ by construction: they match only command,
// CLI, and identity forms. They cannot touch the testimonials (bare prose), the
// star count, `impeccable.style`, `@impeccable_ai`, or Bakaus's attribution, so
// site/ keeps its real endorsements intact and only its instructions rebrand.
//
// extension/ is included for the same reason.
//
// tests/ is deliberately NOT included, and that was tried and reverted on
// 2026-07-16. A JS regex literal opens with `/`, so `/impeccable live script
// part: .../` is indistinguishable from the command `/impeccable audit` and the
// command rule rewrites it. The source it asserts against says
// `// --- impeccable live script part:` -- no slash, so no rule touches it. The
// transform therefore rewrote the ASSERTION but not the thing asserted, and left
// two tests disagreeing about the same marker (one via regex, one via indexOf).
// A rule that silently edits what a test claims is worse than no rule: it breaks
// the writer/reader agreement the KEEP list exists to protect, and it can leave
// a test green while checking the wrong string. Tests get rebranded by hand.
//
// `.gitignore` is in the list because it carries brand-COUPLED PATHS, not prose: it
// must ignore exactly what live mode writes. It was outside the set until 2026-07-16
// and had silently gone stale -- `live-inject.mjs` writes
// `src/lib/melzi/ImpeccableLiveRoot.svelte` (renamed by the command rule, whose
// lookahead allows a following `/`), while .gitignore still said `src/lib/impeccable/`,
// so the tool's own output stopped being ignored. `--check` reported no drift the whole
// time because a file outside this set is never read. Same silent shape as the rest.
// `site` stays in the list, but for a different reason than the block above describes.
// Upstream deleted their marketing site in v4 (2026-07-27) and moved it to the private
// impeccable-site repo, so the 54 hand-edited doc files that justified adding it are gone.
// What survives under `site/public/` is tracked BUILD OUTPUT (counts.js, the _data/api
// JSON, Cloudflare _redirects), which still carries command forms. Dropping `site` would
// push those outside the include set, where the blind-spot guard in tests/rebrand.test.mjs
// would correctly start failing on them.
// `crates` and `browser-bundle` joined on 2026-09-14 with upstream's Rust engine: the binary
// now prints every directive, command hint, and console tag the JS scripts used to, so
// its sources carry the brand. The launcher and binary NAMES stay upstream's; see the
// KEEP rows on COMMAND_RE. In-crate tests rename together with the code they assert on.
export const INCLUDE_DIRS = ['skill', 'scripts', 'cli', 'docs', 'site', 'extension', 'crates', 'browser-bundle', 'vscode'];
// CLAUDE.md sits here for the reason site/ does: it carries the command token ~23
// times and tells users and agents what to type, so its brand was living only as
// hand edits while its sibling AGENTS.md was already covered. The next upstream
// merge touching it would have taken their /impeccable content, the transform
// could not re-apply ours, and --check would have said no drift while the loss
// went through in silence. Adding it reports zero drift: the rules already
// reproduce the hand edits, and scope was the only thing missing.
export const INCLUDE_FILES = ['README.md', 'README.npm.md', 'AGENTS.md', 'CLAUDE.md', 'package.json',
  '.claude-plugin/plugin.json', '.claude-plugin/marketplace.json', '.gitignore',
  // Upstream's #688 rewrite (2026-09-14 sync) put `/impeccable init` in this repo's own
  // PRODUCT.md, so the product record now carries a command the fork must own.
  'PRODUCT.md'];

// Generated / vendored output regenerates from source via `bun run build:release`.
//
// The harness half is DERIVED from PROVIDERS rather than spelled out, because a
// hand-written list silently rots: upstream's v4 added `.grok` and `.vibe`, and a
// literal regex that predates them treats two generated trees as source. The only
// thing that noticed was tests/rebrand.test.mjs, and only because it happens to
// scan every tracked file. Adding a provider must not require editing this line.
const HARNESS_DIRS = [...new Set(Object.values(PROVIDERS).map((p) => p.configDir))];
const EXCLUDE_RE = new RegExp(
  `(^|/)(node_modules|dist|build|plugin|\\.git|${HARNESS_DIRS.map(escapeRegex).join('|')})(/|$)`,
);

// Written as escapes, not as literal NUL bytes. The runtime value is unchanged and
// still cannot occur in any source file, which is the whole point of it; but a raw
// NUL in this file makes `file(1)` call the brand transform binary and plain grep
// go silent on it. Keep the escapes.
const SENTINEL = '\0UPSTREAM\0';

/**
 * The command rename. `/impeccable` is renamed ONLY when the next character proves
 * it is the command and not a filename, marker, domain, or handle.
 *
 *   `/impeccable audit`   -> rename   (space)
 *   `/impeccable'`        -> rename   (skill-dir string literal)
 *   `skills/impeccable/`  -> rename   (generated skill dir)
 *   `/impeccable-config`  -> KEEP     (hyphen = internal filename/marker)
 *   `/impeccable.style`   -> KEEP     (dot = domain)
 *   `/impeccable_ai`      -> KEEP     (underscore = social handle)
 *   `pbakaus/impeccable`  -> KEEP     (protected by sentinel before this runs)
 *   `scripts/impeccable`  -> KEEP     (the engine LAUNCHER file, 2026-09-14)
 *   `bin/impeccable`      -> KEEP     (the engine BINARY: bin/, debug/, release/, ...)
 *   `scripts\/impeccable` -> KEEP     (the same, escaped inside a JS regex literal)
 *
 * The two KEEP rows at the bottom arrived with upstream's Rust engine. Every skill
 * verb is now `{{scripts_path}}/impeccable <verb>`, run through a launcher file
 * literally named `impeccable` that execs a binary of the same name. Those names are
 * a protocol between the build, the launcher, the hook manifests, and the binary's
 * own install detection, exactly like `.github/hooks/impeccable.json`: renaming one
 * side desyncs it from the others and nothing throws. Upstream's own brand pass
 * spares the same `}}`-preceded segment for the same reason (scripts/lib/utils.js).
 * So the rename is refused when the segment before `/impeccable` names where a
 * launcher or binary lives. `skills/impeccable`, `lib/impeccable`, `src/impeccable`
 * and the prose command `/impeccable audit` still rename, as before.
 */
const COMMAND_RE = /(?<!(?:scripts|bin|debug|release|custom|tools|arm64|x64|[\d}>*]|\$version|\$arch)\\?)\/impeccable(?![-A-Za-z0-9._])/g;

/**
 * The browser/terminal console tag: `console.warn('[impeccable] scan failed', err)`.
 *
 * These print into the END USER'S console, so they are branding, not internal protocol.
 * The KEEP list protects `impeccable-*` markers because writers and readers must agree
 * and users never see them; these fail both halves -- users do see them, and nothing
 * reads them (no runtime parser; the only reader is a source-text assertion in
 * tests/live-browser-source.test.mjs, which is updated by hand alongside this rule).
 *
 * The leading `'` / `"` / backtick / `%c` guard is what makes the rule safe. Without it,
 * `[impeccable]` also matches markdown link labels (`[impeccable](https://...)` in
 * site/public/llms.txt) and a CSS comment in site/styles/home-rebuild.css, neither of
 * which is a console tag. The tag is always the head of a string literal; those never are.
 *
 * The optional `.suffix` catches the dotted namespaces `[impeccable.steer]` /
 * `[impeccable.voice]`, which a bare `[impeccable]` match silently leaves behind.
 */
const CONSOLE_TAG_RE = /(['"`]|%c)\[impeccable(\.[a-z]+)?\]/g;

const RULES = [
  [/\{\{command_prefix\}\}impeccable/g, '{{command_prefix}}melzi'],
  // The command token is interpolated in skill/scripts/lib/provider.mjs, so its
  // slash arrives from a constant and COMMAND_RE cannot see it. Match the exact
  // declaration instead. Keep this in step with that file.
  [/\$\{IMPECCABLE_COMMAND_PREFIX\}impeccable/g, '${IMPECCABLE_COMMAND_PREFIX}melzi'],
  [/npx impeccable/g, 'npx melzi'],
  [/IMPECCABLE_SUB_COMMANDS/g, 'MELZI_SUB_COMMANDS'],
  [COMMAND_RE, '/melzi'],
  [CONSOLE_TAG_RE, '$1[melzi$2]'],

  // Added 2026-08-13, all five for the same reason: upstream restored or newly
  // introduced these user-visible strings, they were hand-maintained here
  // before (or would have had to be), and a hand edit is what the next sync
  // reverts in silence. Each was checked repo-wide and matches only its site.
  //
  // The hook envelope carries a protocol version, so CONSOLE_TAG_RE's
  // `[impeccable]` / `[impeccable.foo]` shapes miss `[impeccable@1]`. It is the
  // first thing the model and the user read from a hook.
  // No leading-quote guard (2026-09-14): the version number already makes the shape
  // unique to the envelope, and the guard missed every envelope after the first in
  // JSON-escaped hook output, where the tag follows a literal `\n`.
  [/\[impeccable@(\d+)\]/g, '[melzi@$1]'],
  // The clean-ack steer line names the skill to the user in prose.
  [/impeccable skill guidance/g, 'melzi skill guidance'],
  // pin.mjs interpolates the command through a local `commandPrefix`, so the
  // slash never appears next to the name and COMMAND_RE cannot see it.
  [/\$\{commandPrefix\}impeccable/g, '${commandPrefix}melzi'],
  // pin.mjs's "no harness directories with <product> installed" console line.
  [/impeccable installed/g, 'melzi installed'],
  // The pick-card kicker, rendered in caps on the decision page and named as a
  // convention in reference prose. Curly apostrophe: it is what upstream ships.
  [/IMPECCABLE’S PICK/g, 'MELZI’S PICK'],
  // Cursor's pre-write deny message announces the product to the user.
  [/Impeccable design hook/g, 'Melzi design hook'],
  // pin.mjs decides a harness is installed by looking for the skill DIRECTORY,
  // which is ours. This is the documented path.join blind spot: the name is a
  // quoted argument, so no command or console rule reaches it, --check sees no
  // drift, and the only symptom is pin silently finding no harness at all. It
  // was a hand edit until now, which is exactly why this merge reverted it.
  // The other join(..., 'impeccable') sites in cli/ and scripts/ are upstream's
  // bundle and dist layout and stay theirs, so this rule names its exact site.
  [/const impeccableDir = join\(skillsDir, 'impeccable'\)/g,
   "const impeccableDir = join(skillsDir, 'melzi')"],
  // build.js checks the rewritten plugin SKILL.md at the skill DIRECTORY path.
  // Upstream added the check in the 2026-09-14 sync's range. Same path.join blind
  // spot as the pin.mjs rule above, but loud this time: build:release dies with
  // ENOENT on plugin/skills/impeccable/SKILL.md. Exact site only, as above.
  [/verifyPluginSkillRewrite\(path\.join\(pluginSkillsDir, 'impeccable', 'SKILL\.md'\)\)/g,
   "verifyPluginSkillRewrite(path.join(pluginSkillsDir, 'melzi', 'SKILL.md'))"],
  // pin.mjs's OpenCode slash-command bridge (upstream #483, 2026-09-14 sync). The
  // body tells OpenCode's agent which skill to load BY NAME, so upstream's name
  // there is a functional break, not a cosmetic one: the bridge loads a skill
  // that does not exist in this fork. The command file name becomes the user's
  // slash command, so it carries our name too. The marker
  // `<!-- impeccable-pinned-command -->` is a sentinel like PIN_MARKER: KEEP.
  [/Load the \\`impeccable\\` skill via the skill tool \(name: "impeccable"\)/g,
   'Load the \\`melzi\\` skill via the skill tool (name: "melzi")'],
  [/workflow via \/impeccable\./g, 'workflow via /melzi.'],
  // --- Rust engine (2026-09-14). The same blind spots the JS had, in Rust spelling. ---
  // Runtime-assembled command name: `<prefix>impeccable` never contains `/impeccable`.
  [/format!\("\{\}impeccable", command_prefix\)/g, 'format!("{}melzi", command_prefix)'],
  [/Shortcut for \{\}impeccable \{\}\./g, 'Shortcut for {}melzi {}.'],
  [/\{prefix\}impeccable \{command\}/g, '{prefix}melzi {command}'],
  // The OpenCode bridge body names the skill to load, with Rust's escaped quotes.
  [/Load the `impeccable` skill via the skill tool \(name: \\"impeccable\\"\)/g,
   'Load the `melzi` skill via the skill tool (name: \\"melzi\\")'],
  [/format!\("impeccable-\{command\}\.md"\)/g, 'format!("melzi-{command}.md")'],
  // The same bridge as it appears at runtime and in recorded output: plain backticks and
  // quotes in the body, and the command file under any commands/ directory.
  [/Load the `impeccable` skill via the skill tool \(name: "impeccable"\)/g, 'Load the `melzi` skill via the skill tool (name: "melzi")'],
  [/commands\/impeccable-([a-z][a-z0-9-]*)\.md/g, 'commands/melzi-$1.md'],
  // The skill DIRECTORY as its own quoted path argument (the path.join blind spot,
  // Rust's jsp::join). Exact shapes only: the binary and launcher names stay.
  [/"skills", "impeccable"/g, '"skills", "melzi"'],
  [/(&?skills(?:_dir)?, )"impeccable"(?=[\],])/g, '$1"melzi"'],
  // Installed-skill identity checks in the installer's migration and link logic.
  [/\bname == "impeccable"/g, 'name == "melzi"'],
  [/\be == "impeccable" \|\| e\.ends_with\("-impeccable"\)/g, 'e == "melzi" || e.ends_with("-melzi")'],
  // The installer's own banner.
  [/prompt\.bold\("impeccable"\)/g, 'prompt.bold("melzi")'],
  // Windows spellings of the skill directory, where COMMAND_RE's slash never appears.
  [/skills(\\+)impeccable(?=\\)/g, 'skills$1melzi'],
  // doctor's DESIGN.md seed-marker check glues the command prefix onto this tail at
  // runtime, so the marker our own document/init text writes (`/melzi document`)
  // never matched and every seeded DESIGN.md read as real. Exact site.
  [/"impeccable document once there's code to capture/g, '"melzi document once there\'s code to capture'],
  // The decision page's default title (serve_question.rs and the PAGE_EXPRS provenance in
  // question_page.rs). Lowercase, so neither the command nor the prose rule reaches it.
  [/impeccable · decision/g, 'Melzi · decision'],
  // Codex's command prefix is a dollar sign, so its command never carries a slash.
  // Mostly assembled at runtime in the engine (see the format! rules above); this covers
  // it wherever it is written out, and lets the oracle normalize recorded Codex prose.
  [/(?<![\w{$])\$impeccable(?![-\w.])/g, '$melzi'],
  [/join\(commandsDir, `impeccable-\$\{command\}\.md`\)/g, 'join(commandsDir, `melzi-${command}.md`)'],
  [/`commands\/impeccable-<cmd>\.md`/g, '`commands/melzi-<cmd>.md`'],
  [/\/impeccable-<cmd> runs the same workflow/g, '/melzi-<cmd> runs the same workflow'],
];

/** Skill-identity literals: the string that IS the skill/package/dir name. */
const IDENTITY_RULES = [
  [/^name: impeccable$/m, 'name: melzi'],                 // SKILL.src.md frontmatter
  [/"name": "impeccable"/g, '"name": "melzi"'],           // package.json + manifests
  [/"impeccable": "cli\/bin\/cli\.js"/g, '"melzi": "cli/bin/cli.js"'], // bin key
  [/s\.name === 'impeccable'/g, "s.name === 'melzi'"],
  [/\(s\) => s\.name === 'impeccable'/g, "(s) => s.name === 'melzi'"],

  // The Chrome extension's identity: the name Chrome renders in the extensions
  // list, the DevTools tab, the Elements sidebar pane, and the two window titles.
  //
  // These are rules rather than hand edits for the reason the console tags were
  // (hand edits are unreproducible and the next upstream merge reverts them), plus
  // one specific to markup: tests/brand-user-visible.test.mjs scans quoted string
  // LITERALS, and `<h1>Impeccable</h1>` has no quotes, so the guard structurally
  // cannot see it. A rule can, and `--check` then guards it. Rule what a rule can
  // safely reach; the guard is only for prose no safe rule can match.
  //
  // Each pattern was checked repo-wide and matches only its intended site. Note the
  // capital I: the pre-existing `"name": "impeccable"` rule above is lowercase and
  // does NOT match the extension manifest.
  //
  // `panels.create` has a READER: tests/extension-build.test.mjs asserts on this
  // exact call in source text. tests/ is outside INCLUDE_DIRS by design, so that
  // assertion is hand-maintained and must move in the same pass as this rule.
  // The skill DIRECTORY name, as a path segment built by path.join(). Five sites
  // across build.js, openai-plugin.js, and the CLI's hook resolution. COMMAND_RE
  // cannot see them: there is no slash, the name is its own quoted argument.
  //
  // These were hand edits until the 2026-07-27 upstream sync reverted all five in
  // silence and --check reported no drift, which is the exact loss the fork's sync ritual
  // says this script exists to prevent. The breakage is quiet, not loud: our dist
  // emits `skills/melzi/`, so a stale `impeccable` source path copies nothing
  // and resolves hooks to a directory that does not exist. Nothing throws.
  [/'skills', 'impeccable'/g, "'skills', 'melzi'"],

  // The root skill's own category key. Upstream moved this out of the deleted
  // sub-pages-data.js into skill-categories.js during v4; the key IS the skill name,
  // so a stale one drops the root skill from every provider transformer's category map.
  [/^(\s*)impeccable: 'create',$/m, "$1'melzi': 'create',"],

  // Live-mode's two user-visible product names: the overlay's accessible name
  // (title + aria-label, read aloud by screen readers) and the server's startup
  // line in the user's terminal. Upstream rewrote both in v4 and the fork's hand
  // edits went with them; tests/brand-user-visible.test.mjs is what noticed.
  //
  // Both phrases name the PRODUCT, never the English adjective ("impeccable live
  // mode" is not a thing anyone writes), so a rule reaches them safely and --check
  // then guards them. That is the preferred half of the doctrine: the guard is for
  // prose no safe rule can match, and neither of these is that.
  [/Impeccable live mode/g, 'Melzi live mode'],
  [/Impeccable live server running/g, 'Melzi live server running'],

  [/"name": "Impeccable"/g, '"name": "Melzi"'],           // extension/manifest.json
  [/<h1>Impeccable<\/h1>/g, '<h1>Melzi</h1>'],            // panel.html + popup.html
  [/(panels\.create\(\s*)'Impeccable'/g, "$1'Melzi'"],    // the DevTools panel tab
  [/createSidebarPane\('Impeccable'/g, "createSidebarPane('Melzi'"], // Elements pane
  [/to see Impeccable findings/g, 'to see Melzi findings'], // sidebar.html empty state

  // The product names itself in prose. Title-case `Impeccable` is a PROSE form: it never
  // appears in a path, a key, an enum value or a detection string, because those are all
  // lowercase here, and it cannot reach inside an identifier like
  // `fileHasImpeccableHookMarker` because there is no word boundary before a capital in
  // the middle of a camelCase name. That is what makes one rule safe.
  //
  // DELIBERATELY NOT PAIRED with a lowercase equivalent. An earlier attempt renamed
  // lowercase `impeccable` too and needed ten follow-up rules to undo the damage in code
  // contexts, and still shipped a regression: `e === 'impeccable'` is how the installer
  // RECOGNISES a prior install, so half-renaming it made every existing project reinstall
  // instead of reporting "already installed". Rename what presents; leave what resolves.
  //
  // The three exclusions are upstream's own facts, not our naming:
  //   - "Impeccable started from there" states where UPSTREAM's project began. Renaming it
  //     would claim their lineage as ours, which is an attribution problem under
  //     Apache-2.0 as well as simply untrue.
  //   - "Impeccable asks for an issue and maintainer approval first" is the AI_PR_NOTICE
  //     text upstream's own instructions prescribe verbatim. It is about their policy.
  //   - "Impeccable's updates" in the fork's sync ritual refers to their releases.
  //   - "a fork of Impeccable" NAMES what we forked. The rule ate this sentence three
  //     times before it was excluded, each time turning it into "a fork of Melzi",
  //     which says nothing. A prose rename cannot be made safe over prose whose whole job
  //     is to name the old thing: every such sentence needs an explicit exclusion, and the
  //     idempotency check below is what catches a missing one.
  [/\bImpeccable\b/g, 'Melzi'],

  // Added 2026-07-29 after a survey of every user-visible brand string. Each pattern was
  // checked repo-wide with the include-set walker before being added and matches only its
  // intended sites. All of them name the PRODUCT, so a rule reaches them safely and
  // `--check` guards them from here; none is the English adjective the KEEP list keeps.
  //
  // The first two are not branding at all, they are a BROKEN INSTRUCTION. `doctor` prints
  // them as the fix for a stale hook manifest and tells the user to run `impeccable hooks
  // on`, which is not a command under any name: every other reference in the repo, down to
  // cli/bin/commands/skills.mjs, spells it `/melzi hooks on`. The bare form escaped
  // COMMAND_RE because that pattern needs a leading slash, which is the same blind spot
  // recorded above for `'skills', 'impeccable'`. Restore the slash along with the name.
  // Both backtick spellings, and the second one is the lesson. The first version of this
  // rule matched only bare backticks, so it fixed line 328 and silently missed line 310,
  // where the same text sits inside a template literal with ESCAPED backticks (\\`). The
  // rule then reported success and `--check` said no drift while the broken instruction
  // still shipped. A partial rename is worse than none: it looks handled.
  [/\\?`impeccable hooks on\\?`/g, (m) => (m.startsWith('\\') ? '\\`/melzi hooks on\\`' : '`/melzi hooks on`')],
  [/\\?`impeccable hooks off\\?`/g, (m) => (m.startsWith('\\') ? '\\`/melzi hooks off\\`' : '`/melzi hooks off`')],

  // Same shape, arrived with the 2026-08-01 upstream sync: live-server.mjs names
  // "an `impeccable document` run" in a comment. Bare, so COMMAND_RE's required
  // slash misses it, and it tells a reader to run a command that does not exist
  // under our name. The backticks are what make this safe to rule: `impeccable
  // document` unquoted is ordinary English ("an impeccable document"), while the
  // backticked form is only ever the command.
  [/\\?`impeccable document\\?`/g, (m) => (m.startsWith('\\') ? '\\`/melzi document\\`' : '`/melzi document`')],

  [/Impeccable doctor:/g, 'Melzi doctor:'],                   // doctor report header
  [/impeccable doctor failed:/g, 'melzi doctor failed:'],     // doctor stderr
  [/project's Impeccable artifacts/g, "project's Melzi artifacts"], // doctor help + refs
  [/Impeccable design detector:/g, 'Melzi design detector:'], // the hook's own description
  [/Impeccable design hook/g, 'Melzi design hook'],           // named in 6 user-facing strings
  [/Impeccable's own project files/g, "Melzi's own project files"], // staleness notice
  [/Impeccable's interview and decision steps/g, "Melzi's interview and decision steps"],
  [/Impeccable Live\b/g, 'Melzi Live'],                       // live-mode hints and headers

  // DELIBERATELY NOT RULED: `ImpeccableLiveRoot`. It is a component NAME this tool writes
  // into the user's own repository, and their layout files import it by that identifier.
  // Renaming it here would break every project that already ran live mode, so it needs a
  // migration that rewrites both sides, not a text substitution. Left alone on purpose.
];

/**
 * This file must never transform itself, and the exclusion has to be STATED.
 *
 * Its source is where every rule literally lives: `[/npx impeccable/g, ...]`,
 * `COMMAND_RE = /\/impeccable(?!...)/`, `hasBrand = /impeccable/i`. Run the transform
 * over that and each rule is rewritten into its own output, so `npx impeccable` maps
 * to `npx melzi` becomes `npx melzi` maps to `npx melzi`, a no-op.
 * `hasBrand` stops matching the brand at all, and the script quietly becomes an
 * expensive way to change nothing while `--check` keeps saying no drift.
 *
 * It never happened, and NOT because anyone arranged it. `isBinary()` skips any file
 * containing a NUL, and SENTINEL used to be written as literal NUL bytes, so this file
 * excluded itself by accident. That accident was doing real work: `--check` reported
 * "no drift" while never once reading the transform it was checking, which is the same
 * shape as the casing bug described above `hasBrand` and the harness-dir rot described
 * above EXCLUDE_RE. The bytes were escaped on 2026-07-29 so the file stops reading as
 * binary to grep and `file(1)`, which removed the accident and left the danger.
 *
 * tests/rebrand.test.mjs holds this in place from both sides: the exclusion is
 * asserted, AND the transform is shown to still want to rewrite this file, so nobody
 * can retire the line as dead weight.
 */
export const SELF = 'scripts/rebrand.mjs';

export function inIncludeSet(f) {
  if (f === SELF) return false;
  if (EXCLUDE_RE.test(f)) return false;
  if (INCLUDE_FILES.includes(f)) return true;
  return INCLUDE_DIRS.some((d) => f === d || f.startsWith(d + '/'));
}

function listFiles() {
  const out = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
  return out.filter(inIncludeSet);
}

function isBinary(file) {
  try {
    const buf = readFileSync(path.join(ROOT, file));
    return buf.includes(0);
  } catch { return true; }
}

// Ways of naming things UPSTREAM OWNS. Each is protected before any rule runs:
// they point at pbakaus's work, not at ours. Add a form here rather than teaching
// COMMAND_RE to recognise it.
//
// This list is load-bearing and it has been wrong twice, both times the same way:
// COMMAND_RE's lookahead `(?![-A-Za-z0-9._])` deliberately allows a following `/`
// (so `skills/impeccable/` renames), which means ANY path segment `/impeccable/`
// that belongs to upstream gets rewritten as if it were our command.
//
//   `upstream/impeccable`  -- our own tooling announced "upstream/melzi
//                             shipped 40 commit(s)", crediting their work to us.
//   the Chrome Web Store   -- `chromewebstore.google.com/detail/impeccable/<id>`
//                             became `/detail/melzi/<id>` in fe1e0357. The
//                             slug is cosmetic and the ID resolves, so the link
//                             kept working and 301'd to pbakaus's PUBLISHED
//                             "Impeccable" extension while our site captioned it
//                             "Install Melzi". A working link is worse than
//                             a broken one here: it presents their product as ours.
//                             We have never published an extension; that ID is theirs.
//                             Verified 2026-07-16 by following the redirect.
export const UPSTREAM_REFS = [
  'pbakaus/impeccable',
  'upstream/impeccable',
  // Upstream's domain in mixed case (crates/context/src/url.rs test input). The prose
  // rule renames a capitalised `Impeccable` whatever follows it, dot included. 2026-09-14.
  'Impeccable.Style',
  'chromewebstore.google.com/detail/impeccable',
  // Attribution, added 2026-07-29. The prose rule below renamed all three of these
  // before they were masked, and the third time it did it the repo's own guard caught
  // the consequence in its own words: we were presenting Paul Bakaus's work as ours.
  // A prose rename cannot be made safe over prose whose job is to NAME the thing we
  // forked, so the naming phrases get masked rather than pattern-matched around.
  'Base work: **Impeccable** by Paul Bakaus',
  'a fork of Impeccable, Apache-2.0',
  'a fork of Impeccable, licensed under Apache-2.0',
  'Impeccable started from there.',
  "Impeccable asks for an issue and maintainer approval first.",
  "Impeccable's updates",
  // Added 2026-08-06. The sync ledger's 2026-08-03 entry describes how git mapped
  // `skills/impeccable/` onto our own skills tree. That is upstream's directory path,
  // named in a sentence whose whole job is to record what moved where, so it is the
  // same category as the attribution phrases above rather than a brand string to
  // rewrite. Its absence is what made tests/rebrand.test.mjs red from that sync
  // onward: the STALE probe matches `/impeccable` when the next character is a slash,
  // so the entry read as a live un-rebranded command. CI failed daily on it, and the
  // sync's own hand-off entry recorded the suite as green.
  //
  // Masked as the SENTENCE, not the bare path. The first attempt used
  // `skills/impeccable/` alone and broke the `things we own still rename` case:
  // the identical string is OURS in .gitignore, where it must rename to
  // `skills/melzi/`. Upstream's tree and our tree are indistinguishable by
  // substring, so the discriminator has to be the surrounding prose — which is
  // why every other entry here is a phrase rather than a token.
  "upstream's `skills/impeccable/` paths",
];

/**
 * The fast-path skip. Case-INsensitive on purpose, and exported so a test can hold it to
 * that: it used to be `!includes('impeccable') && !includes('IMPECCABLE')`, which skipped
 * any file whose only brand mention is title-case `Impeccable`. Those files were never
 * transformed AND never drift-reported, so `--check` printed "no drift" about 23 files it
 * had not read, including every extension window title. A skip must never depend on the
 * casing of the thing being searched for.
 */
export const hasBrand = (text) => /impeccable/i.test(text);

export function transform(text) {
  // Protect every way of naming upstream before any /impeccable rule can see it.
  // SENTINEL is NUL-delimited, so these placeholders cannot collide with source.
  let out = text;
  UPSTREAM_REFS.forEach((ref, i) => {
    out = out.split(ref).join(`${SENTINEL}${i}${SENTINEL}`);
  });
  for (const [re, to] of [...RULES, ...IDENTITY_RULES]) out = out.replace(re, to);
  UPSTREAM_REFS.forEach((ref, i) => {
    out = out.split(`${SENTINEL}${i}${SENTINEL}`).join(ref);
  });
  return out;
}

/**
 * Everything above is pure and importable; everything below is the CLI.
 *
 * The split exists because this file had NO tests and structurally could not have any:
 * the loop and `process.exit` ran at module top level, so `import` meant "rebrand the
 * whole repo, then maybe kill the test process". That is why three bugs of the identical
 * shape (exit 0, no error, wrong) all shipped here and were each found by accident, weeks
 * apart, by a different task: the upstream-merge strategy's linchpin was unrehearsed.
 * tests/rebrand.test.mjs now exercises the exported surface. Keep the CLI in `main()` so
 * it stays that way.
 */
function main() {
let changed = 0;
const drifted = [];
for (const file of listFiles()) {
  const abs = path.join(ROOT, file);
  try { if (!statSync(abs).isFile()) continue; } catch { continue; }
  if (isBinary(file)) continue;
  const before = readFileSync(abs, 'utf8');
  if (!hasBrand(before)) continue;
  const after = transform(before);
  if (after === before) continue;
  drifted.push(file);
  changed++;
  if (!CHECK_ONLY) writeFileSync(abs, after);
}

if (CHECK_ONLY) {
  if (changed === 0) { console.log('✓ rebrand: no drift, brand is applied'); process.exit(0); }
  console.error(`✗ rebrand: ${changed} file(s) carry un-rebranded upstream strings:`);
  for (const f of drifted) console.error(`  - ${f}`);
  console.error('\nRun `node scripts/rebrand.mjs` to re-apply the brand.');
  process.exit(1);
}

console.log(changed === 0
  ? '✓ rebrand: already applied (no-op)'
  : `✓ rebrand: re-applied brand to ${changed} file(s)`);
for (const f of drifted) console.log(`  - ${f}`);
}

// Run only as a CLI. Importing this module must never rewrite the repo.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
