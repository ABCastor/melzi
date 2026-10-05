# Melzi for Cursor

The repository includes a local Cursor plugin payload. No Melzi Cursor Marketplace listing is published.

Build the source engine and skill bundles as described in the root README. Set `IMPECCABLE_BIN` to the absolute engine path in Cursor's environment. Copy `dist/cursor-plugin` to the local plugin location supported by your Cursor version, then reload Cursor. Keep the plugin and a separate `.cursor/skills/melzi` installation mutually exclusive to avoid duplicate commands.

The payload contains one skill, four agents, and a `preToolUse` hook. Its native manifest, references, scripts, and license are generated from canonical source. Run `node --test tests/cursor-plugin.test.mjs` to check packaging, hook relocation, script permissions, links, and version consistency. A packaged payload passing those checks does not establish that a particular Cursor version loads it correctly; verify discovery and hook execution in your installation.

Marketplace submission, Windows shell behavior, and remote editor runtime support need separate verification. The generated-output workflow checks for drift and does not commit or push changes.
