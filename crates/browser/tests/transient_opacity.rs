//! Which opacity the URL engine blends into the ink for low-contrast,
//! against an installed browser. Skips cleanly when there is none.
//!
//! A box faded at rest fades the glyphs and the faded colour is scored. A
//! box caught mid-reveal (blurred, sliding in from under 0.1 opacity, or
//! faded by an animation or transition running at capture) is scored at
//! the text's declared colour. The running animations reach the core
//! through the snapshot's `anim` / `an` facts, which only a browser records.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};

use impeccable_browser::BrowserEngine;
use impeccable_detect::engines::{ScanOptions, UrlEngine};

fn fixtures_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/antipatterns")
}

fn serve() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let port = listener.local_addr().unwrap().port();
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            std::thread::spawn(move || handle(stream));
        }
    });
    port
}

fn handle(mut stream: TcpStream) {
    let mut buf = [0u8; 8192];
    let n = stream.read(&mut buf).unwrap_or(0);
    let request = String::from_utf8_lossy(&buf[..n]);
    let path = request
        .lines()
        .next()
        .and_then(|l| l.split_whitespace().nth(1))
        .unwrap_or("/")
        .split('?')
        .next()
        .unwrap_or("/")
        .to_string();
    let (status, body) = match std::fs::read(fixtures_dir().join(path.trim_start_matches('/'))) {
        Ok(body) => ("200 OK", body),
        Err(_) => ("404 Not Found", b"missing".to_vec()),
    };
    let head = format!(
        "HTTP/1.0 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(&body);
    let _ = stream.flush();
}

fn engine() -> Option<BrowserEngine> {
    let env: HashMap<String, String> = std::env::vars().collect();
    if impeccable_browser::discovery::find_browser(&env).is_err() {
        eprintln!("skip: no installed browser found");
        return None;
    }
    Some(BrowserEngine::new(env))
}

#[test]
fn the_url_engine_blends_only_the_opacity_at_rest() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let url = format!("http://127.0.0.1:{port}/transient-opacity-contrast.html");
    let findings = engine.detect_url(&url, &ScanOptions::default()).expect("scan");
    let snippets: Vec<String> = findings
        .iter()
        .filter(|f| f.antipattern == "low-contrast")
        .map(|f| f.snippet.clone())
        .collect();

    for (case, expected) in [
        ("header in an accordion item faded at rest", "text #85888a on #ffffff"),
        ("card held faded with will-change", "text #94989c on #ffffff"),
        ("label faded with an opacity transition at rest", "text #a4a4aa on #ffffff"),
        ("faint word caught mid-reveal, at its declared colour", "text #b0b1b2 on #ffffff"),
    ] {
        assert!(
            snippets.iter().any(|s| s.contains(expected)),
            "{case} should flag as `{expected}`, got {snippets:?}"
        );
    }
    // The pass column: each case's declared colour passes, and none of them
    // is reported at a blended colour either. A blended snippet prints a
    // colour of its own, so the pass cases are counted by what is left.
    assert_eq!(
        snippets.len(),
        4,
        "only the four faded-at-rest cases should report, got {snippets:?}"
    );
}
