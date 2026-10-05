# /melzi explore: drive the real product, find what actually breaks

*Pollux-UXUI: the twin-loop UI-testing command. An Explorer drives the live interface hunting
defects; a structurally-independent Verifier re-drives from a clean reset and confirms or rejects
each one with its own evidence. Design: `pollux-uxui/DESIGN.md`. Contracts: `pollux-uxui/contracts.md`.
Deterministic helpers: `.qoder/skills/melzi/scripts/pollux-uxui/`.*

This command does not judge a page statically (that is `audit`/`critique`). It OPERATES the product
like a relentless tester and reports replayable failures with OBSERVED evidence.

## Requires (hard-fail, never silently degrade)
- A browser driver in the harness exposing the Contract-2 surface. **Playwright MCP** is the shipped
  target. Call the driver's `capabilities()` first; all six are required: `pageErrors`, `network`,
  `a11yTree`, `consoleMessages`, `bbox`, `screenshot`. Only `pageErrors` can be supplied by an injected
  init-script (the `window` error listener); the other five come from the backend or not at all. If any
  required capability is missing, STOP and tell the user which one. Do not run a partial pass while
  claiming coverage.
- A **run-state capsule** (Contract 4). If none is provided, build the minimal one (baseUrl, viewport,
  locale, timezone, storage=reset-to-empty, listenersAttachedBeforeNav=true) and record it. Never put
  secrets in it; reference a credential source instead.

## Setup
1. Attach console/network/pageerror listeners **before** the first navigation (captures are empty
   otherwise). `pageErrors` needs an injected `window` error listener regardless of backend.
2. `reset(runState)` to the capsule, then `observe()`.
3. Start a run via the controller (`.qoder/skills/melzi/scripts/pollux-uxui/controller.mjs`): it owns the runId,
   phase, budget, checkpoints, and the flaws log. If the chat is interrupted, resume from its checkpoint.

## Phase A: Explore (defect-hunting bias, NOT task completion)
Your goal is to find defects, not to complete a user task. Chasing a task makes you skip anomalies
(Goal-Oriented Masking). Each step:
1. `observe()`, then record it and read the stop decision. ONE command, every step:
   `node .qoder/skills/melzi/scripts/pollux-uxui/explore-step.mjs observe --run-dir D --url U --a11y-file F --step N`
   Pass `--steps-max N` on the first step only, using the budget you were given; it is stored and
   every later step reuses it. **Do NOT pass `--plateau-k` unless you were given a specific K.** It
   defaults to 5, and a K you invent silently redefines what "exhausted" means for the whole run.
   It prints `{nodeId, newNode, coverage, stop}`. This is the only place the graph lives: it persists
   to the run dir, because each of your helper calls is a fresh process and an in-memory graph would
   forget the plateau counter between steps. Do not hand-maintain any of this in your head.
2. Choose the highest-**novelty** action: prefer actions leading to unseen states, then untried actions
   on this node (`explore-step.mjs novelty --run-dir D --node ID --op click --ref e1` → `{novelty}`;
   0 = already tried). Bias toward inputs that stress the app: invalid data, empty required fields,
   rapid re-clicks, boundary values, destructive-looking controls, back/forward. After acting, record
   the transition: `explore-step.mjs edge --run-dir D --from ID --to ID --op click --ref e1 --step N`.
3. `act()`. Append the step to the action log: `op`, `ref`, `value`, AND a durable `selector` (a unique
   CSS or text locator). The snapshot `ref` (e.g. `e17`) is NOT stable across sessions; the independent
   Verifier replays from the durable `selector`, so a step that carries only a snapshot ref is unusable
   downstream. This IS the repro script.
4. After acting, look for a candidate defect across ALL evidence channels, not just the screenshot:
   - screen: dead control (no change), layout overflow/clipping, broken resource, misleading affordance
     (looks disabled but fires, or vice-versa);
   - console/pageErrors: uncaught errors, thrown exceptions (invisible on screen);
   - network: failed requests behind a success UI (silent failure), wrong status;
   - state: an action that should change/persist state but does not, or a "reset" that does not reset.
5. For each candidate, write a flaw record (Contract 1) via `controller.recordFlaw`: defectType,
   a provisional severity, the **assertion** (what SHOULD happen, grounded in the spec or the app's own
   source if available), the action log, and the observed evidence (screenshot path, bbox,
   consoleErrors, pageErrors, network, domProbes). Mark `createdBy: "explorer"`, no verifier verdict yet.
6. Do NOT self-attribute app bugs to your own mistake, and do NOT self-congratulate a bug you caused.
   When unsure "real bug vs my mistake", record it as a candidate and let the Verifier arbitrate.
7. **Stop when, and only when, step 1 says `stop.stop === true`.** Running out of *new* states is not
   the stop signal. When novelty is exhausted, keep exercising the states you already know: re-try
   untried actions, push boundary and invalid inputs, revisit controls. You no longer have to carry the counter yourself; step 1 persists it for you. `stop.reason` tells you which condition ended the run:
   - `budget`: you ran out of room.
   - `stalled`: the last K recorded events discovered nothing new.

   **Neither reason proves coverage, and neither means the app was exhausted.** `stalled` is a stagnation heuristic over your own recent activity, not a statement about the app. The graph records which actions you TOOK, never which actions were AVAILABLE, so it cannot tell "nothing left to try" from "you stopped trying": observing one unchanged page K+1 times reports `stalled` with every control on it still unclicked. Budget is checked first, so a run that merely ran out of room is never dressed up as the stagnation reason. An honest exhaustion signal needs an action-case frontier model, which does not exist yet. Until it does, report the reason, the nodes and the edges as what they are, DISCOVERY statistics, and state coverage as unproven. Never write that the app was fully explored.

## Phase B: Verify (structural independence is the whole point)
For EACH candidate flaw, launch a **cold, independent Verifier**: a fresh subprocess with zero
conversation history and its OWN Playwright MCP browser session. Launch it via the launcher
(`.qoder/skills/melzi/scripts/pollux-uxui/verifier-launch.mjs`), which encodes the flags below. The two lanes are
NOT drop-in equivalent for driving a browser MCP non-interactively (proven in E3); use the exact flags
and do not "simplify" them away, each one was required to make a launch actually work:

- **`claude -p` (the clean default):**
  `claude -p "<prompt>" --mcp-config <pw.json> --strict-mcp-config --allowed-tools "<specific mcp__playwright__* tools>" --setting-sources "" --no-session-persistence --model <explicit> --output-format stream-json --verbose --json-schema <verdict-schema>`.
  `--strict-mcp-config` pins the MCP set to `<pw.json>` alone. **`--allowed-tools` must list the SPECIFIC
  safe browser tools (`mcp__playwright__browser_navigate`, `browser_snapshot`, `browser_click`, ...),
  NEVER the bare `mcp__playwright` whole-server form**: the server also exposes `browser_run_code_unsafe`,
  which runs arbitrary JS in the Node MCP process (RCE-equivalent, `vm` is not a sandbox), so a
  whole-server allowlist would let the Verifier read an answer key regardless of cwd. With the specific
  list, non-listed tools (including `run_code_unsafe`, and `Read`/`Bash` file-reads) are denied in the
  default permission mode (verified: a `-p` run cannot read `/etc/hostname`). `--setting-sources ""` stops
  the Verifier inheriting the user's own permission allow-rules (a user rule allowing `cat`/`curl` would
  otherwise leak in). **Do NOT add `--permission-mode bypassPermissions`**: it OVERRIDES the allowlist and
  re-enables `Read`/`Bash` (verified empirically). `--no-session-persistence` keeps the context cold,
  `--output-format stream-json --verbose` gives the runner the tool-call stream, `--json-schema` (an
  INLINE JSON string) forces the single final verdict into the Contract-1 verifier shape.
- **`codex exec` (needs the sandbox+approval bypass, so it MUST also disable its own tools; local target only):**
  `codex exec "<prompt>" --json --ephemeral --model <explicit> --output-schema <verdict-schema-file> --cd <temp-workspace> --skip-git-repo-check --ignore-user-config --ignore-rules --dangerously-bypass-approvals-and-sandbox -c features.shell_tool=false -c web_search="disabled"` plus the Playwright MCP via `-c mcp_servers.playwright.*` overrides only, and stdin set to ignore (Node `stdio: ['ignore', ...]`, the non-shell `< /dev/null`).
  Found the hard way (E3): `-s read-only` cancels navigation (the browser cannot write its temp profile),
  `-s workspace-write` alone auto-denies every MCP tool call, and a non-ignored stdin blocks codex forever,
  so the bypass is required for the browser MCP to act. But the bypass ALSO re-enables codex's shell, so
  the shell tool MUST be disabled by config (`-c features.shell_tool=false`, verified to block shell under
  bypass) and user customization stripped (`--ignore-user-config --ignore-rules`). Acceptable ONLY in a
  throwaway temp workspace on a local target. Note the provider difference: claude `--json-schema` takes an
  INLINE JSON string, codex `--output-schema` takes a FILE path.

Each lane gets its OWN isolated Playwright MCP instance:
`--isolated --headless --init-script <pageerror-listener.js> --storage-state <immutable-capsule-state> --output-dir <runtime> --viewport-size <capsule> --allowed-origins <capsule-origin>`.
The init-script installs the `window` error/unhandledrejection listener BEFORE page scripts (Contract 2:
Playwright MCP has no first-class pageerror tool); `--isolated` plus the immutable storage-state give
browser-context isolation and a storage reset, NOT a full Contract-4 reset (seeded backend data and any
custom reset procedure are the capsule's job, run before the browser starts); `--allowed-origins` keeps
the Verifier on the intended local target. If neither an isolated subprocess nor a separate browser
session can be guaranteed, hard-fail. A prompt-only "ignore the Explorer" is theater.

**Filesystem isolation is part of independence, not an afterthought (Sol risk 3), but it takes BOTH a
clean cwd AND tool restriction.** A cold process/browser does not enforce the withhold-list: a Verifier
that can see the repo will read `ANSWER-KEY.md`, `flaws.jsonl`, or Explorer artifacts, and source
comments can leak ground truth. So (1) launch the Verifier in a **fresh temporary workspace** whose cwd
contains ONLY the allowlisted bundle below (no repo root, no run directory, no answer key, no Explorer
output), AND (2) **restrict its tools to the Playwright MCP only** (above): with built-in file/shell
tools still enabled, a clean cwd is porous, the agent can read any absolute path. Prefer passing the
text bundle inline in the prompt over writing it to the cwd, so the only on-disk files are the MCP's own
config/listener/storage-state, which the agent never reads directly.

GIVE the Verifier only (the allowlisted bundle):
- the opaque `flawId`;
- the run-state capsule (Contract 4);
- the sanitized `actionLog` (steps + **durable `selector`s** for cross-session replay, no Explorer notes/diagnosis);
- the `assertion` and access to a **SANITIZED** spec / app source (strip any comments or markers that name bugs/decoys/ground truth);
- its budget and the output schema.

WITHHOLD from the Verifier: the Explorer's reasoning, diagnosis, confidence, severity, ranking,
annotated evidence, the state-graph/strategy, any prior verdicts, and any answer key. Browser
isolation is not backend isolation; serialize resets or give each lane its own seeded backend
namespace so one Verifier's replay cannot corrupt another's.

The Verifier MUST: `reset()` to the capsule, replay the action log, collect its OWN evidence
(screenshot, DOM, network, console, pageErrors, bbox), reason from the SPEC/SOURCE (what should
happen) versus what it OBSERVES, and return `{verdict: confirmed|rejected|inconclusive, rationale,
decisiveEvidence, independence:{coldContext, ownSession, replayedFromReset}}`. The controller writes
the verdict back onto the flaw record.

## Phase C: Report
Run the Reporter. Do NOT hand-write the findings:
`node .qoder/skills/melzi/scripts/pollux-uxui/reporter.mjs --run-dir D` (add `--format json` to post-process).

It reads the run dir and enforces what you must not relax: only a CONFIRMED flaw is a finding;
rejected ones are dropped; inconclusive, unverified, and schema-invalid records are disclosed in
their own sections as explicitly NOT findings; each finding carries the replayable action log from
the durable `selector`, plus screenshot, severity, defect type, and the Verifier's decisive evidence;
and the coverage line reports nodes and edges as DISCOVERY statistics and states coverage as unproven, because no stop reason in this engine proves coverage.

You add only what the run dir cannot know:
- what was NOT covered (states behind auth/data you could not reach, capabilities missing). Name the action classes that sit outside the accessibility snapshot entirely, because the graph cannot even represent them: scrolling, browser back/forward, direct route entry, keyboard-only affordances (Escape, Tab, arrows), drag, hover, context menus, lazy-load, and canvas or other non-semantic clickables;
- precision caveat: this is confirmed-by-an-independent-active-verifier, not proof of zero false
  positives. State the measured numbers if a ground-truth set was used; never a claimed one.

Never promote a candidate the Verifier did not confirm, and never present "we found nothing" as
"there is nothing to find".

## Boundaries (honest)
- Web only in P1. iOS/Android/desktop are later phases behind the same driver contract.
- The oracle problem is not solved; the independent active Verifier is the mitigation, not a guarantee.
- Never perform destructive real-world actions on a production target (real deletes, payments, sends).
  Explore against a safe/seeded environment, or stop at the confirmation step and report the risk.
