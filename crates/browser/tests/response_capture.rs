//! Native transport evidence: read the response that was rendered, never refetch.
use impeccable_browser::{cdp::Browser, discovery};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::mpsc::{Receiver, channel};
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};
use std::time::{Duration, Instant};

fn browser_required() -> bool {
    std::env::var_os("CI").is_some() || std::env::var_os("IMPECCABLE_BROWSER").is_some()
}

fn browser_executable() -> Option<std::path::PathBuf> {
    let env: HashMap<String, String> = std::env::vars().collect();
    match discovery::find_browser(&env) {
        Ok(exe) => Some(exe),
        Err(error) => {
            assert!(
                !browser_required(),
                "required test browser unavailable: {error}"
            );
            eprintln!("skip: no browser: {error}");
            None
        }
    }
}

fn launch(exe: &std::path::Path) -> Option<Browser> {
    match Browser::launch(exe, &[], false) {
        Ok(browser) => Some(browser),
        Err(error) => {
            assert!(
                !browser_required(),
                "required test browser launch failed: {}",
                error.message
            );
            eprintln!("skip: could not launch browser: {}", error.message);
            None
        }
    }
}

fn serve_capture_fixture(listener: TcpListener, count: Arc<AtomicUsize>) -> Receiver<()> {
    let (accepted, observed) = channel();
    std::thread::spawn(move || {
        for mut stream in listener.incoming().flatten() {
            let _ = accepted.send(());
            let count = count.clone();
            // Chrome can preconnect without sending bytes. Keep that socket
            // out of the accept loop and bound its handler's lifetime.
            std::thread::spawn(move || {
                if stream
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .is_err()
                    || stream
                        .set_write_timeout(Some(Duration::from_secs(2)))
                        .is_err()
                {
                    return;
                }
                let mut request = [0u8; 4096];
                let n = stream.read(&mut request).unwrap_or(0);
                if n == 0 {
                    return;
                }
                let request = String::from_utf8_lossy(&request[..n]);
                let (kind, body) = if request.starts_with("GET /asset.bin ") {
                    let number = count.fetch_add(1, Ordering::SeqCst);
                    (
                        "application/octet-stream",
                        if number == 0 {
                            vec![0, 255, 13, 128, 42]
                        } else {
                            vec![99, 4, 0, 128]
                        },
                    )
                } else {
                    (
                        "text/html",
                        b"<!doctype html><title>capture</title><body>fixture</body>".to_vec(),
                    )
                };
                let header = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: {kind}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
                    body.len()
                );
                let _ = stream.write_all(header.as_bytes());
                let _ = stream.write_all(&body);
            });
        }
    });
    observed
}

#[test]
fn capture_fixture_serves_http_while_an_earlier_connection_is_silent() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let hits = Arc::new(AtomicUsize::new(0));
    let accepted = serve_capture_fixture(listener, hits.clone());
    let mut idle = TcpStream::connect(address).unwrap();
    accepted.recv_timeout(Duration::from_secs(1)).unwrap();
    let mut request = TcpStream::connect(address).unwrap();
    request
        .set_read_timeout(Some(Duration::from_millis(300)))
        .unwrap();
    request
        .write_all(b"GET /asset.bin HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
        .unwrap();
    let mut response = Vec::new();
    let result = request.read_to_end(&mut response);
    // Keep the earlier connection silent until the HTTP exchange ends.
    result.expect("a silent preconnection must not block the fixture accept loop");
    assert!(response.starts_with(b"HTTP/1.1 200 OK\r\n"));
    assert!(response.ends_with(&[0, 255, 13, 128, 42]));
    assert_eq!(hits.load(Ordering::SeqCst), 1);
    idle.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
    assert_eq!(
        idle.read(&mut [0]).unwrap(),
        0,
        "silent handler must expire without serving a response"
    );
}

#[test]
fn response_capture_reads_original_bytes_and_preserves_repeated_url_ambiguity() {
    let Some(exe) = browser_executable() else { return; };
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let origin = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
    let hits = Arc::new(AtomicUsize::new(0));
    let _accepted = serve_capture_fixture(listener, hits.clone());
    let Some(mut browser) = launch(&exe) else { return; };
    let mut page = browser.new_page().unwrap();
    assert!(
        page.response_evidence(&[]).is_err(),
        "capture must be explicitly enabled"
    );
    page.begin_response_capture().unwrap();
    page.goto(&origin, "load", Duration::from_secs(15)).unwrap();
    page.evaluate_value("fetch('/asset.bin').then(r=>r.arrayBuffer()).then(()=>true)")
        .unwrap();
    // Pump a browser round-trip after the fetch's completion event.
    page.evaluate_value("true").unwrap();
    let urls = vec![format!("{origin}/asset.bin")];
    let first = page.response_evidence(&urls).unwrap();
    assert_eq!(first.responses.len(), 1);
    assert_eq!(
        first.responses[0].body.as_deref(),
        Some(&[0, 255, 13, 128, 42][..])
    );
    assert!(!first.responses[0].ambiguous_url);
    assert_eq!(
        hits.load(Ordering::SeqCst),
        1,
        "body evidence must not make another request"
    );
    page.evaluate_value("fetch('/asset.bin').then(r=>r.arrayBuffer()).then(()=>true)")
        .unwrap();
    page.evaluate_value("true").unwrap();
    let repeated = page.response_evidence(&urls).unwrap();
    assert_eq!(repeated.responses.len(), 2);
    assert!(repeated.responses.iter().all(|r| r.ambiguous_url));
    assert_eq!(
        repeated.responses[0].body.as_deref(),
        Some(&[0, 255, 13, 128, 42][..])
    );
    assert_eq!(
        repeated.responses[1].body.as_deref(),
        Some(&[99, 4, 0, 128][..])
    );
    assert_eq!(hits.load(Ordering::SeqCst), 2);
    assert!(!repeated.changed_during_collection);
    assert!(!repeated.truncated);
    assert_eq!(repeated.responses[0].status, Some(200.0));
    assert_eq!(repeated.responses[0].mime_type, "application/octet-stream");
    // A new document must not borrow response evidence from its predecessor.
    page.goto(&format!("{origin}/next"), "load", Duration::from_secs(15))
        .unwrap();
    let next = page.response_evidence(&urls).unwrap();
    assert!(next.responses.is_empty());
    assert_eq!(next.missing_urls, urls);
    assert_eq!(hits.load(Ordering::SeqCst), 2);
    page.close();
    browser.close();
}

fn read_fixture_request_head(stream: &mut TcpStream) -> Option<Vec<u8>> {
    let deadline = Instant::now() + Duration::from_secs(2);
    let mut request = Vec::new();
    while request.len() < 4096 {
        let remaining = deadline.checked_duration_since(Instant::now())?;
        stream.set_read_timeout(Some(remaining)).ok()?;
        let mut chunk = [0; 512];
        let capacity = chunk.len().min(4096 - request.len());
        let n = match stream.read(&mut chunk[..capacity]) {
            Ok(0) => return None,
            Ok(n) => n,
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => return None,
        };
        request.extend_from_slice(&chunk[..n]);
        if request.windows(4).any(|bytes| bytes == b"\r\n\r\n") {
            return Some(request);
        }
    }
    None
}

fn serve_large_fixture(
    listener: TcpListener,
    served: Vec<u8>,
    count: Arc<AtomicUsize>,
) -> (std::thread::JoinHandle<()>, Receiver<()>) {
    let (accepted, observed) = channel();
    let server = std::thread::spawn(move || {
        for mut stream in listener.incoming().flatten() {
            let _ = accepted.send(());
            // A canceled preconnection is not a document request. Keep the
            // listener alive after EOF/read/write errors. Consume the full
            // header so closing cannot reset a response over unread bytes.
            // All fragments share one absolute read budget and a 4096-byte cap.
            if stream
                .set_write_timeout(Some(Duration::from_secs(15)))
                .is_err()
            {
                continue;
            }
            let Some(request) = read_fixture_request_head(&mut stream) else {
                continue;
            };
            if !request.starts_with(b"GET /index.html ") {
                continue;
            }
            count.fetch_add(1, Ordering::SeqCst);
            if write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", served.len()).is_err() {
                continue;
            }
            if stream.write_all(&served).is_ok() {
                break;
            }
        }
    });
    (server, observed)
}

#[test]
fn large_document_fixture_ignores_a_disconnected_preconnection() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let body = vec![b'x'; 9 * 1024 * 1024];
    let hits = Arc::new(AtomicUsize::new(0));
    let (server, accepted) = serve_large_fixture(listener, body.clone(), hits.clone());
    let idle = TcpStream::connect(address).unwrap();
    accepted.recv_timeout(Duration::from_secs(1)).unwrap();
    // Close an accepted socket without sending any HTTP request. A listener
    // must survive this ordinary browser pool cancellation.
    idle.shutdown(std::net::Shutdown::Both).unwrap();
    drop(idle);
    let mut request = TcpStream::connect(address).unwrap();
    request
        .set_read_timeout(Some(Duration::from_millis(300)))
        .unwrap();
    request
        .write_all(b"GET /index.html HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
        .unwrap();
    let mut response = Vec::new();
    request
        .read_to_end(&mut response)
        .expect("listener must survive a disconnected preconnection");
    assert!(response.starts_with(b"HTTP/1.1 200 OK\r\n"));
    assert!(response.ends_with(&body));
    assert_eq!(
        hits.load(Ordering::SeqCst),
        1,
        "an empty connection is not a document request"
    );
    server.join().unwrap();
}

#[test]
fn large_document_fixture_accepts_a_fragmented_request_line() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let body = b"document".to_vec();
    let hits = Arc::new(AtomicUsize::new(0));
    let (server, accepted) = serve_large_fixture(listener, body.clone(), hits.clone());
    let mut request = TcpStream::connect(address).unwrap();
    accepted.recv_timeout(Duration::from_secs(1)).unwrap();
    request
        .set_read_timeout(Some(Duration::from_millis(300)))
        .unwrap();
    request.write_all(b"GET /in").unwrap();
    std::thread::sleep(Duration::from_millis(20));
    request
        .write_all(b"dex.html HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
        .unwrap();
    let mut response = Vec::new();
    request.read_to_end(&mut response).unwrap();
    assert!(
        response.starts_with(b"HTTP/1.1 200 OK\r\n"),
        "a fragmented document request must be served: {response:?}"
    );
    assert!(response.ends_with(&body));
    assert_eq!(hits.load(Ordering::SeqCst), 1);
    server.join().unwrap();
}

#[test]
fn large_document_fixture_consumes_the_entire_request_head() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let body = vec![b'x'; 9 * 1024 * 1024];
    let hits = Arc::new(AtomicUsize::new(0));
    let (server, accepted) = serve_large_fixture(listener, body.clone(), hits.clone());
    let mut request = TcpStream::connect(address).unwrap();
    accepted.recv_timeout(Duration::from_secs(1)).unwrap();
    request
        .set_read_timeout(Some(Duration::from_millis(300)))
        .unwrap();
    write!(request, "GET /index.html HTTP/1.1\r\nHost: localhost\r\nX-Fixture-Pad: {}\r\nConnection: close\r\n\r\n", "x".repeat(2048)).unwrap();
    let mut response = Vec::new();
    request
        .read_to_end(&mut response)
        .expect("unread request headers must not reset the document response");
    assert!(response.starts_with(b"HTTP/1.1 200 OK\r\n"));
    assert!(response.ends_with(&body));
    assert_eq!(hits.load(Ordering::SeqCst), 1);
    server.join().unwrap();
}

#[test]
fn large_utf8_document_retains_exact_bytes_without_refetch() {
    let Some(exe) = browser_executable() else { return; };
    // One non-Latin-1 character makes Blink retain a two-byte string. The
    // inspector buffer must accommodate it even though the UTF-8 body is <16MiB.
    let body = format!("<!doctype html><meta charset=utf-8><title>€</title><!--{}-->", "a".repeat(9 * 1024 * 1024)).into_bytes();
    let served = body.clone();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://127.0.0.1:{}/index.html", listener.local_addr().unwrap().port());
    let hits = Arc::new(AtomicUsize::new(0));
    let count = hits.clone();
    let (server, _accepted) = serve_large_fixture(listener, served, count);
    let Some(mut browser) = launch(&exe) else { return; };
    let mut page = browser.new_page().unwrap();
    page.begin_response_capture().unwrap();
    page.goto(&url, "load", Duration::from_secs(15)).unwrap();
    let evidence = page.response_evidence(&[url]).unwrap();
    let response = &evidence.responses[0];
    assert!(response.unavailable_reason.is_none(), "{:?}", response.unavailable_reason);
    assert_eq!(response.body.as_deref(), Some(body.as_slice()));
    assert_eq!(hits.load(Ordering::SeqCst), 1);
    page.close();
    browser.close();
    server.join().unwrap();
}

#[test]
fn decoded_text_bodies_match_only_their_served_bytes() {
    let Some(exe) = browser_executable() else { return; };
    // Blink reports these as text: the BOM dropped, the Latin-1 byte as U+FFFD.
    let html = b"\xEF\xBB\xBF<!doctype html><link rel=stylesheet href=a.css><p>x</p>".to_vec();
    let css = b"/* caf\xE9 */\r\np{color:red}".to_vec();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let origin = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
    let (served_html, served_css) = (html.clone(), css.clone());
    std::thread::spawn(move || {
        for mut stream in listener.incoming().flatten() {
            let mut request = [0u8; 4096];
            let n = stream.read(&mut request).unwrap_or(0);
            let (kind, body) = if request[..n].starts_with(b"GET /a.css ") { ("text/css", &served_css) } else { ("text/html", &served_html) };
            let _ = write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: {kind}; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
            let _ = stream.write_all(body);
        }
    });
    let Some(mut browser) = launch(&exe) else { return; };
    let mut page = browser.new_page().unwrap();
    page.begin_response_capture().unwrap();
    page.goto(&format!("{origin}/"), "load", Duration::from_secs(15)).unwrap();
    let urls = vec![format!("{origin}/"), format!("{origin}/a.css")];
    let evidence = page.response_evidence(&urls).unwrap();
    let find = |u: &str| evidence.responses.iter().find(|r| r.url == u).unwrap();
    let (doc, sheet) = (find(&urls[0]), find(&urls[1]));
    assert!(doc.text && sheet.text, "fixture must exercise decoded text bodies");
    assert_ne!(sheet.body.as_deref(), Some(css.as_slice()));
    assert!(doc.body_matches(&html) && sheet.body_matches(&css));
    let mut tampered = css.clone();
    tampered[9] = b'e';
    assert!(!sheet.body_matches(&tampered) && !sheet.body_matches(&html));
    assert!(!doc.body_matches(&html[3..].iter().chain(b" ").copied().collect::<Vec<_>>()));
    page.close();
    browser.close();
}
