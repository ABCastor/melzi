# Windows engine artifacts

Melzi has no configured Windows signing identity or published signed engine release. The manual engine workflow builds all five native targets and uploads artifacts labeled `melzi-engine-unsigned-*`. It does not sign binaries or publish a GitHub Release.

For local Windows use, build with `cargo build --release -p impeccable` and set `IMPECCABLE_BIN` to `target/release/impeccable.exe`. The source executable retains its compatibility name.

Before distributing a signed Windows release, provision a signing identity owned by the Melzi maintainer, restrict its access to a reviewed release workflow, and verify Authenticode publisher and timestamp before creating checksums. Do not reuse upstream Impeccable's signing identity or certificate claims. Existing release assets must remain immutable.

`bun test tests/release-engine-workflow.test.js` checks the present manual, read-only artifact boundary. It does not prove signing or release publication.
