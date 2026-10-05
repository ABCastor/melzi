//! After a skill directory is written, make it self-contained: when its
//! `scripts/VERSION` names an engine release and no
//! `scripts/bin/<os>-<arch>/impeccable[.exe]` is present, copy IMPECCABLE_BIN
//! or download from an explicit IMPECCABLE_DOWNLOAD_BASE. This unpublished
//! fork has no default endpoint. Remote binaries keep the launcher's asset
//! naming and required `.sha256` verification. Not part of the JS.

use std::collections::HashMap;

use impeccable_common::Io;
use sha2::{Digest, Sha256};

use crate::bundle::{download, hex};
use crate::providers::Sys;
use crate::util::{self, jsp};

pub const DEFAULT_DOWNLOAD_BASE: &str = "";

/// The `<os>-<arch>` tag the launcher computes (`darwin|linux|windows` x
/// `arm64|x64`); `None` on a platform without a release asset.
pub fn platform_tag() -> Option<(&'static str, &'static str)> {
    let os = if cfg!(target_os = "macos") {
        "darwin"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        return None;
    };
    let arch = if cfg!(target_arch = "aarch64") {
        "arm64"
    } else if cfg!(target_arch = "x86_64") {
        "x64"
    } else {
        return None;
    };
    Some((os, arch))
}

/// Where the binary for `(os, arch)` lives inside a skill directory.
pub fn binary_path(skill_dir: &str, os: &str, arch: &str) -> String {
    let name = if os == "windows" { "impeccable.exe" } else { "impeccable" };
    jsp::join(&[skill_dir, "scripts", "bin", &format!("{os}-{arch}"), name])
}

/// The release asset URL for a version and platform. Engine releases are
/// tagged `engine-v<version>` because the repo also carries skill, CLI,
/// extension and detector tags.
pub fn asset_url(base: &str, version: &str, os: &str, arch: &str) -> String {
    let ext = if os == "windows" { ".exe" } else { "" };
    format!("{}/engine-v{version}/impeccable-{os}-{arch}{ext}", base.trim_end_matches('/'))
}

/// Fetch one release binary, verified against its `.sha256` sidecar. Fails
/// closed, mirroring the launchers (triage C1): a sidecar that cannot be
/// fetched or is empty refuses the download - only a binary whose hash
/// matches its published sidecar is ever installed.
fn fetch_binary(url: &str) -> Result<Vec<u8>, String> {
    let bytes = download(url)?;
    let sidecar = download(&format!("{url}.sha256")).map_err(|e| {
        format!("cannot verify against {url}.sha256 ({e}); refusing the unverified download")
    })?;
    let text = String::from_utf8_lossy(&sidecar);
    let expected = text.split_whitespace().next().unwrap_or("").to_lowercase();
    if expected.is_empty() {
        return Err(format!(
            "cannot verify against {url}.sha256 (empty sidecar); refusing the unverified download"
        ));
    }
    let actual = hex(&Sha256::digest(&bytes));
    if actual != expected {
        return Err(format!("checksum mismatch downloading {url}"));
    }
    Ok(bytes)
}

/// Belt and suspenders for the executable bit: chmod +x the launcher
/// (`scripts/impeccable`) and every staged engine binary
/// (`scripts/bin/**/impeccable*`) inside a skill dir. Zip extraction and the
/// dir copy preserve modes themselves, but any channel that loses them (a
/// zip with no unix modes, a mode-dropping copier) would otherwise turn every
/// hook and Setup call into "Permission denied". No-op off unix and for
/// missing paths.
pub fn ensure_executable_scripts(skill_dir: &str) {
    let launcher = jsp::join(&[skill_dir, "scripts", "impeccable"]);
    if util::exists(&launcher) {
        let _ = util::set_executable(&launcher);
    }
    let bin_root = jsp::join(&[skill_dir, "scripts", "bin"]);
    for tag in util::read_dir_names(&bin_root).unwrap_or_default() {
        let dir = jsp::join(&[&bin_root, &tag]);
        if !util::is_dir(&dir) {
            continue;
        }
        for name in util::read_dir_names(&dir).unwrap_or_default() {
            if name.starts_with("impeccable") {
                let _ = util::set_executable(&jsp::join(&[&dir, &name]));
            }
        }
    }
}

/// Install the engine binary into every skill dir in `skill_dirs` that needs
/// one. Prints one line per binary installed; download failures are reported
/// on stderr and do not fail the skill install. Without a configured source,
/// the launcher also refuses until a local engine is supplied. Repairs the
/// executable bit on the launcher and any binaries already present.
pub fn install_engine_binaries(sys: &Sys, io: &mut Io, skill_dirs: &[String]) {
    install_engine_binaries_with(sys, io, skill_dirs, &mut fetch_binary);
}

fn install_engine_binaries_with(
    sys: &Sys,
    io: &mut Io,
    skill_dirs: &[String],
    fetch: &mut dyn FnMut(&str) -> Result<Vec<u8>, String>,
) {
    for skill_dir in skill_dirs {
        ensure_executable_scripts(skill_dir);
    }
    let Some((os, arch)) = platform_tag() else { return };
    let base = sys
        .env
        .get("IMPECCABLE_DOWNLOAD_BASE")
        .filter(|v| !v.is_empty())
        .cloned()
        .unwrap_or_else(|| DEFAULT_DOWNLOAD_BASE.to_string());
    let mut cache: HashMap<String, Result<Vec<u8>, String>> = HashMap::new();
    for skill_dir in skill_dirs {
        let version_file = jsp::join(&[skill_dir, "scripts", "VERSION"]);
        let Ok(raw) = util::read_text(&version_file) else { continue };
        let version = raw.trim();
        if version.is_empty() {
            continue;
        }
        let dest = binary_path(skill_dir, os, arch);
        if util::exists(&dest) {
            continue;
        }
        let url = asset_url(&base, version, os, arch);
        let fetched = cache
            .entry(version.to_string())
            .or_insert_with(|| {
                if let Some(local) = sys.env.get("IMPECCABLE_BIN").filter(|v| !v.is_empty()) {
                    return util::read_bytes(&jsp::resolve(&sys.cwd, &[local]));
                }
                if base.is_empty() {
                    return Err(
                        "no download endpoint is configured; this fork does not publish engine binaries. Refusing to download upstream's engine. Build this checkout: cargo build --release -p impeccable. Set IMPECCABLE_BIN to target/release/impeccable (target/release/impeccable.exe on Windows), or copy it to ~/.impeccable/bin/impeccable for the launcher. Set IMPECCABLE_DOWNLOAD_BASE to use an explicit release channel.".into()
                    );
                }
                fetch(&url)
            })
            .clone();
        match fetched {
            Ok(bytes) => {
                let written = util::mkdir_p(&jsp::dirname(&dest))
                    .and_then(|_| util::write_bytes(&dest, &bytes))
                    .and_then(|_| util::set_executable(&dest));
                match written {
                    Ok(()) => io.out(&format!(
                        "Installed impeccable engine v{version} ({os}-{arch}) into: {}\n",
                        sys.format_path_for_display(&dest)
                    )),
                    Err(e) => io.err(&format!(
                        "Could not write the impeccable engine v{version} ({os}-{arch}) into {}: {e}\n",
                        sys.format_path_for_display(&dest)
                    )),
                }
            }
            Err(e) => {
                if !e.is_empty() {
                    io.err(&format!(
                        "Could not install the impeccable engine v{version} for {os}-{arch}: {e}. Supply a local binary or an explicit download endpoint before retrying.\n"
                    ));
                    // Report once per version, then stay quiet for its siblings.
                    cache.insert(version.to_string(), Err(String::new()));
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fork_engine_install_refuses_no_endpoint_and_accepts_local_or_explicit_sources() {
        let Some((os, arch)) = platform_tag() else { return };
        let root = std::env::temp_dir().join(format!("impeccable-engine-fork-{}", std::process::id()));
        let skill = root.join("skill");
        std::fs::create_dir_all(skill.join("scripts")).unwrap();
        std::fs::write(skill.join("scripts/VERSION"), "1.2.3").unwrap();
        let skill = skill.to_string_lossy().into_owned();
        let dest = binary_path(&skill, os, arch);
        let mut sys = Sys::new(Default::default(), root.to_string_lossy().into_owned());
        let (mut io, captured) = Io::captured("", root.clone(), Default::default());
        let mut forbidden = |_: &str| -> Result<Vec<u8>, String> { panic!("unexpected download") };
        install_engine_binaries_with(&sys, &mut io, &[skill.clone()], &mut forbidden);
        let stderr = String::from_utf8_lossy(&captured.stderr.borrow()).into_owned();
        assert!(stderr.contains("no download endpoint"), "{stderr}");
        assert!(stderr.contains("cargo build --release -p impeccable"));
        assert!(!util::exists(&dest));

        std::fs::write(root.join("local-engine"), b"local engine").unwrap();
        sys.env.insert("IMPECCABLE_BIN".into(), "local-engine".into());
        install_engine_binaries_with(&sys, &mut io, &[skill.clone()], &mut forbidden);
        assert_eq!(util::read_bytes(&dest).unwrap(), b"local engine");
        // Existing sibling engines stay ahead of all source lookups.
        sys.env.insert("IMPECCABLE_BIN".into(), "missing-engine".into());
        install_engine_binaries_with(&sys, &mut io, &[skill.clone()], &mut forbidden);
        assert_eq!(util::read_bytes(&dest).unwrap(), b"local engine");
        std::fs::remove_file(&dest).unwrap();
        install_engine_binaries_with(&sys, &mut io, &[skill.clone()], &mut forbidden);
        assert!(!util::exists(&dest), "an invalid local override must not fall through");

        sys.env.remove("IMPECCABLE_BIN");
        sys.env.insert("IMPECCABLE_DOWNLOAD_BASE".into(), "https://fork.invalid/releases".into());
        let mut calls = Vec::new();
        let mut fetch = |url: &str| { calls.push(url.to_string()); Ok(b"verified remote engine".to_vec()) };
        install_engine_binaries_with(&sys, &mut io, &[skill], &mut fetch);
        assert_eq!(calls, vec![asset_url("https://fork.invalid/releases", "1.2.3", os, arch)]);
        assert_eq!(util::read_bytes(&dest).unwrap(), b"verified remote engine");
        util::rm_rf(&root.to_string_lossy());
    }

    #[test]
    fn asset_naming_matches_launcher() {
        assert_eq!(
            asset_url("https://fork.invalid/releases", "1.2.3", "darwin", "arm64"),
            "https://fork.invalid/releases/engine-v1.2.3/impeccable-darwin-arm64"
        );
        assert_eq!(asset_url("http://x/", "1", "windows", "x64"), "http://x/engine-v1/impeccable-windows-x64.exe");
        // The sibling binary path is joined with the host's path semantics
        // (backslashes on Windows); only the asset name is platform-keyed.
        assert_eq!(
            binary_path("/s", "linux", "x64"),
            jsp::join(&["/s", "scripts", "bin", "linux-x64", "impeccable"])
        );
        assert_eq!(
            binary_path("/s", "windows", "arm64"),
            jsp::join(&["/s", "scripts", "bin", "windows-arm64", "impeccable.exe"])
        );
    }
}
