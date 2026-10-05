# Harness installation

Run `bun run build:release` from the Melzi source checkout. It creates the provider directories under `dist/` and combines them in `dist/universal.zip`.

| Tool | Generated skill directory | Project installation directory |
|---|---|---|
| Codex | `dist/agents/.agents/skills/melzi` | `.agents/skills/melzi` |
| Claude Code | `dist/claude-code/.claude/skills/melzi` | `.claude/skills/melzi` |
| Cursor | `dist/cursor/.cursor/skills/melzi` | `.cursor/skills/melzi` |
| Gemini CLI | `dist/gemini/.gemini/skills/melzi` | `.gemini/skills/melzi` |
| OpenCode | `dist/opencode/.opencode/skills/melzi` | `.opencode/skills/melzi` |
| GitHub Copilot | `dist/github/.github/skills/melzi` | `.github/skills/melzi` |

Copy the skill directory into the matching project directory, or into the user skill directory your tool supports. Provider builds may also include agent definitions and hook manifests beside the skill. Installing only the skill directory installs its commands; hooks require the provider's separate manifest and any approval the tool requires. Codex project hooks require approval through `/hooks`.

Build the native engine with `cargo build --release -p impeccable`. Point `IMPECCABLE_BIN` to the absolute path of `target/release/impeccable` (`impeccable.exe` on Windows) in the coding tool's environment. This fork does not publish prebuilt engine packages. Start with `/melzi init` after installing the skill.

The `.agents` payload is checked in for direct Codex skill installs. Provider-local `.claude`, `.cursor`, and `.codex` output is kept in release bundles and regenerated locally; those directories are excluded from the public source tree. The standalone `plugin/` directory is a generated plugin package with its own manifests.
