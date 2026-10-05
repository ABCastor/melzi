# VS Code skill package

`bun run package:vscode` builds the provider skill bundle and creates a local VSIX under `dist/vscode/`. The declared publisher is `abcastor`; this release does not claim that publisher registration or Marketplace publication is complete. Install a built VSIX with `code --install-extension <path-to-vsix>`.

The package requires VS Code 1.109.3 or newer, GitHub Copilot Chat access, and a trusted local workspace. It registers the Melzi skill and its references, without an extension runtime or project hook installer. Use Copilot Chat in Agent mode and invoke `/melzi init` or `/melzi audit`.

Build the native engine from this checkout and expose its absolute path through `IMPECCABLE_BIN` in the workspace host's environment. Prebuilt Melzi engine packages are not published. The engine executable name remains `impeccable` for compatibility.

Only one copy of the Melzi skill should be active in a workspace. Browser-only VS Code has no supported terminal runtime. SSH, WSL, and containers need both the package and engine on the workspace host; those modes have no release smoke proof here.
