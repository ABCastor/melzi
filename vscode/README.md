# Melzi for GitHub Copilot

Design guidance and tools for building, critiquing, auditing, and refining interfaces with GitHub Copilot in VS Code.

## Use

Requires VS Code 1.109.3 or later, GitHub Copilot Chat access, and a trusted local checkout. Open Copilot Chat in Agent mode and try:

- `/melzi polish` to refine the current interface.
- `/melzi audit` to inspect accessibility and implementation quality.
- `/melzi shape` to plan a new interface.

Copilot can also discover the skill automatically for relevant design requests. Supporting references load only when needed.

If `/melzi` is missing immediately after trusting a folder, run **Developer: Reload Window**, then try again.

## What gets installed

This extension bundles the skill, references, and engine launchers. It has no extension runtime, activation events, telemetry code, update command, or automatic detector hooks. Installing it does not copy files into your project or edit `copilot-instructions.md`. Replacing the extension replaces its bundled skill.

When Copilot invokes an engine command, set `IMPECCABLE_BIN` in its environment to an absolute path to Melzi's source-built engine. Build it with `cargo build --release -p impeccable`. This fork has no prebuilt engine publication or verified Marketplace release. The package is a local skill bundle; its publisher name must be registered before it can be published to a Marketplace. On Windows without a POSIX shell, use the `.cmd` launcher. In PowerShell, invoke a quoted path with `&`.

Commands you request may edit your project or launch local previews. This is not an editor diagnostics extension, and it does not block saves. Native custom-agent sidecars and automatic hooks from other installation methods are not registered by this skill-only package; the skill includes its inline role fallbacks.

Avoid installing another Melzi skill copy in the same workspace or user profile: duplicate skill names can make selection ambiguous. Browser-only VS Code without a terminal is unsupported. Remote SSH, WSL, and container setups need the extension and engine on the workspace host and are not yet smoke-tested.

[Source and installation](https://github.com/ABCastor/melzi)
