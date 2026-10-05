# Melzi

A launcher for Melzi's native design detector and skill commands.

The design skill has 21 canonical commands. This fork needs an engine built from the Melzi source checkout. It does not install upstream Impeccable engine packages. Build with `cargo build --release -p impeccable`, then set `IMPECCABLE_BIN` to the absolute path of `target/release/impeccable` (`impeccable.exe` on Windows).

```sh
IMPECCABLE_BIN=/path/to/melzi/target/release/impeccable melzi help
IMPECCABLE_BIN=/path/to/melzi/target/release/impeccable melzi detect src/
```

The package's `--version` reports the launcher version. The source README documents skill installation and runtime requirements. Apache-2.0; a modified fork of Impeccable by Paul Bakaus. See LICENSE and NOTICE.md.
