//! Melzi must reject unsupported remote distribution before side effects.
use std::collections::HashMap;
use std::path::PathBuf;
use impeccable_common::Io;

fn run(args: &[&str], env: HashMap<String, String>) -> (i32, String, String) {
    let args = args.iter().map(|arg| arg.to_string()).collect::<Vec<_>>();
    let (mut io, captured) = Io::captured("", PathBuf::from("/fixture/melzi/nonexistent"), env);
    let code = impeccable_skills::run(&args, &mut io);
    drop(io);
    let stdout = String::from_utf8_lossy(&captured.stdout.borrow()).into_owned();
    let stderr = String::from_utf8_lossy(&captured.stderr.borrow()).into_owned();
    (code, stdout, stderr)
}

#[test]
fn unavailable_remote_verbs_fail_before_prompts_or_writes() {
    for verb in ["install", "update", "check"] {
        for bundle in [None, Some(""), Some("/fixture/melzi/missing.zip")] {
            let mut env = HashMap::from([("IMPECCABLE_API_URL".into(), "https://impeccable.style".into())]);
            if let Some(bundle) = bundle { env.insert("IMPECCABLE_BUNDLE_PATH".into(), bundle.into()); }
            let (code, stdout, stderr) = run(&[verb, "--yes", "--force", "--global"], env);
            assert_eq!(code, 1, "{verb}: {stderr}");
            assert!(stdout.is_empty(), "no prompts or success output: {stdout}");
            assert!(stderr.contains(&format!("remote `{verb}` is unavailable")));
            assert!(stderr.contains("cargo build --release -p impeccable && bun run build:release"));
            assert!(stderr.contains("https://github.com/ABCastor/melzi#build-and-use"));
            assert!(!stderr.contains("Downloading"));
        }
    }
}

#[test]
fn subcommand_help_is_read_only_and_describes_local_bundle_requirement() {
    for verb in ["install", "update", "check"] {
        for flag in ["--help", "-h"] {
            let (code, stdout, stderr) = run(&[verb, flag], HashMap::new());
            assert_eq!(code, 0);
            assert!(stderr.is_empty());
            assert!(stdout.contains("IMPECCABLE_BUNDLE_PATH=/absolute/path/to/dist/universal.zip"));
            assert!(stdout.contains("Remote"));
            assert!(!stdout.contains("latest version"));
        }
    }
}

#[test]
fn skill_help_points_to_local_build_instead_of_upstream_installation() {
    let (code, stdout, stderr) = run(&["help"], HashMap::new());
    assert_eq!(code, 0);
    assert!(stderr.is_empty());
    assert!(stdout.contains("Remote installation and updates are unavailable."));
    assert!(stdout.contains("https://github.com/ABCastor/melzi#build-and-use"));
    assert!(!stdout.contains("npx melzi install"));
    assert!(!stdout.contains("npx melzi update"));
    assert!(!stdout.contains("https://impeccable.style"));
    assert!(stdout.contains("21 commands available"));
}

#[test]
fn root_help_describes_the_same_local_only_boundary() {
    let usage = impeccable_detect::ROOT_USAGE;
    assert!(usage.contains("Remote skill installation and updates are unavailable."));
    assert!(usage.contains("explicit local IMPECCABLE_BUNDLE_PATH"));
    assert!(!usage.contains("latest version"));
}
