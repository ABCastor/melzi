//! Corpus decision r6-t5-unread-pixel-verdicts in the URL engine, over
//! `tests/fixtures/antipatterns/low-contrast-unread-pixels.html`, rendered by
//! an installed browser. Skips cleanly when there is none.
//!
//! White copy over a dark photo the contrast walk cannot read is scored
//! against the grey fill under the photo and handed to the pixel pass. Where
//! the pixels read it, their verdict replaces the element pass's (the copy
//! passes); where they refuse to (a backdrop filter over the photo), the
//! element pass's verdict stands as advisory, its text unchanged.

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
    let rel = request
        .lines()
        .next()
        .and_then(|l| l.split_whitespace().nth(1))
        .unwrap_or("/")
        .trim_start_matches('/')
        .to_string();
    let (status, body) = match std::fs::read(fixtures_dir().join(&rel)) {
        Ok(body) if !rel.contains("..") => ("200 OK", body),
        _ => ("404 Not Found", b"missing".to_vec()),
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
fn verdicts_the_pixels_could_not_read_are_advisory() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let url = format!("http://127.0.0.1:{port}/low-contrast-unread-pixels.html");
    let findings = engine.detect_url(&url, &ScanOptions::default()).expect("scan");
    let low: Vec<(&str, &str, Option<bool>)> = findings
        .iter()
        .filter(|f| f.antipattern == "low-contrast")
        .map(|f| {
            (
                f.extras.get("selector").and_then(|v| v.as_str()).unwrap_or(""),
                f.severity.as_str(),
                f.advisory,
            )
        })
        .collect();
    assert_eq!(low, vec![("#flag-copy-under-backdrop-filter", "advisory", Some(true))], "{findings:#?}");
    let snippet = &findings
        .iter()
        .find(|f| f.antipattern == "low-contrast")
        .expect("finding")
        .snippet;
    assert!(snippet.contains("text #ffffff on #979797"), "{snippet}");
}

