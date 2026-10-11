//! The full-page screenshot an evidence scan records, against an installed
//! browser and locally served fixtures. Skips cleanly when there is none.
//!
//! - A tall document paints to its foot, and a wide one to its right edge.
//! - A page whose body scrolls (the document is one viewport tall) is
//!   captured by scrolling the body, and the pixel contrast pass reads the
//!   text below its fold. A footer under a 100vh shell that scrolls its own
//!   frame follows the frame's content.
//! - Rows a feed renders only once they are scrolled to appear in the
//!   screenshot.
//! - An element past the screenshot cut gets a viewport shot of its own.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};

use base64::Engine as _;
use impeccable_browser::{
    detect_url_evidence, origin, BrowserEngine, Evidence, EvidenceRequest,
};
use impeccable_core::findings::Finding;
use impeccable_detect::engines::ScanOptions;

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
        .to_string();
    let file = fixtures_dir().join(path.trim_start_matches('/'));
    let (status, body) = if path == "/offset-scroller.html" {
        ("200 OK", OFFSET_SCROLLER_PAGE.as_bytes().to_vec())
    } else if path == "/margin-shell.html" {
        ("200 OK", MARGIN_SHELL_PAGE.as_bytes().to_vec())
    } else {
        match std::fs::read(&file) {
            Ok(body) => ("200 OK", body),
            Err(_) => ("404 Not Found", b"missing".to_vec()),
        }
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

fn scan(
    engine: &BrowserEngine,
    port: u16,
    fixture: &str,
    viewport: (u32, u32),
    request: &EvidenceRequest,
) -> Option<(Vec<Finding>, Evidence)> {
    if !fixtures_dir().join(fixture).exists() {
        eprintln!("skip: {fixture} not present");
        return None;
    }
    let options = ScanOptions {
        viewport: Some(viewport),
        ..Default::default()
    };
    let mut browser = engine.launch().expect("launch");
    let url = format!("http://127.0.0.1:{port}/{fixture}");
    let out = detect_url_evidence(&mut browser, &url, &options, "load", 100, request)
        .expect("evidence scan");
    browser.close();
    Some(out)
}

fn decode(jpeg_base64: &str) -> image::RgbImage {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(jpeg_base64)
        .expect("base64");
    image::load_from_memory_with_format(&bytes, image::ImageFormat::Jpeg)
        .expect("jpeg")
        .to_rgb8()
}

/// The luma spread inside `[x, y, w, h]`: text or a marker spreads wide,
/// a blank region reads about 0.
fn luma_spread(img: &image::RgbImage, rect: [f64; 4]) -> u8 {
    let x0 = rect[0].max(0.0) as u32;
    let y0 = rect[1].max(0.0) as u32;
    let x1 = ((rect[0] + rect[2]) as u32).min(img.width());
    let y1 = ((rect[1] + rect[3]) as u32).min(img.height());
    let (mut lo, mut hi) = (255u8, 0u8);
    for y in y0..y1 {
        for x in x0..x1 {
            let p = img.get_pixel(x, y).0;
            let l = ((p[0] as u32 * 299 + p[1] as u32 * 587 + p[2] as u32 * 114) / 1000) as u8;
            lo = lo.min(l);
            hi = hi.max(l);
        }
    }
    hi.saturating_sub(lo)
}

fn rect_of(evidence: &Evidence, selector: &str) -> [f64; 4] {
    let r = evidence
        .element_rects
        .get(selector)
        .and_then(|v| v.as_array())
        .unwrap_or_else(|| panic!("no rect for {selector}: {:?}", evidence.element_rects.keys()));
    let v: Vec<f64> = r.iter().filter_map(|n| n.as_f64()).collect();
    [v[0], v[1], v[2], v[3]]
}

fn flagged<'a>(findings: &'a [Finding], evidence: &'a Evidence) -> Vec<(&'a str, &'a str, &'a str)> {
    findings
        .iter()
        .zip(&evidence.origins)
        .map(|(f, o)| {
            (
                f.antipattern.as_str(),
                f.extras.get("selector").and_then(|v| v.as_str()).unwrap_or(""),
                *o,
            )
        })
        .collect()
}

#[test]
fn a_tall_page_paints_to_its_foot() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let Some((findings, evidence)) =
        scan(&engine, port, "fullpage-screenshot.html", (1280, 800), &EvidenceRequest::default())
    else {
        return;
    };
    let all = flagged(&findings, &evidence);
    assert!(all.contains(&("low-contrast", "#flag-foot-copy", origin::SCAN)), "{all:?}");
    assert!(!all.iter().any(|(_, s, _)| *s == "#pass-foot-copy"), "{all:?}");

    let shot = evidence.screenshot.as_ref().expect("screenshot");
    assert!(shot.document_height > 4000.0, "{}", shot.document_height);
    assert_eq!(shot.height, shot.document_height);
    let img = decode(&shot.jpeg_base64);
    assert_eq!(img.height() as f64, shot.height);
    let rect = rect_of(&evidence, "#flag-foot-copy");
    assert!(rect[1] > 4000.0, "{rect:?}");
    // The faint copy is light grey on white; its glyphs still spread.
    assert!(luma_spread(&img, rect) > 20, "the flagged copy is blank in the screenshot");
    // The green marker under it, in the should-pass column too.
    let marker = [rect[0], rect[1] + rect[3] + 16.0, 420.0, 40.0];
    assert!(luma_spread(&img, [20.0, marker[1], 900.0, 40.0]) > 60, "marker row is blank");
    assert!(evidence.element_shots.is_empty(), "{:?}", evidence.element_shots.len());
}

#[test]
fn a_wide_page_is_captured_to_its_right_edge() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let Some((_, evidence)) =
        scan(&engine, port, "fullpage-screenshot.html", (390, 844), &EvidenceRequest::default())
    else {
        return;
    };
    let shot = evidence.screenshot.as_ref().expect("screenshot");
    assert!(shot.width >= 900.0, "{}", shot.width);
    let img = decode(&shot.jpeg_base64);
    let rect = rect_of(&evidence, "#flag-foot-copy");
    // The should-pass column's ink copy, level with the flagged copy, past
    // the 390px viewport edge.
    assert!(
        luma_spread(&img, [480.0, rect[1], 420.0, rect[3]]) > 60,
        "the column past the viewport edge is blank"
    );
}

#[test]
fn a_body_scroller_page_is_captured_by_scrolling_the_body() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let Some((findings, evidence)) = scan(
        &engine,
        port,
        "fullpage-screenshot-scroller.html",
        (1280, 800),
        &EvidenceRequest::default(),
    ) else {
        return;
    };
    let all = flagged(&findings, &evidence);
    assert!(all.contains(&("low-contrast", "#flag-scroller-foot-copy", origin::SCAN)), "{all:?}");
    // Only the visual pass can measure white text on a photo, and the photo
    // sits below the body scroller's fold.
    assert!(
        all.contains(&("low-contrast", "#flag-scroller-photo-copy", origin::VISUAL_CONTRAST)),
        "{all:?}"
    );
    // The walk cannot read vector paint, so the verdict is the pixel pass's,
    // read with the body scrolled to the text.
    let pixel = findings
        .iter()
        .zip(&evidence.origins)
        .find(|(f, o)| {
            **o == origin::VISUAL_CONTRAST
                && f.extras.get("selector").and_then(|v| v.as_str()) == Some("#flag-scroller-vector-copy")
        })
        .unwrap_or_else(|| panic!("no pixel finding for the vector copy: {all:?}"));
    assert!(pixel.0.snippet.starts_with("pixel contrast "), "{}", pixel.0.snippet);
    for unwanted in [
        "#pass-scroller-photo-copy",
        "#pass-scroller-vector-copy",
        "#pass-scroller-foot-copy",
    ] {
        assert!(!all.iter().any(|(_, s, _)| *s == unwanted), "{unwanted} flagged: {all:?}");
    }

    let shot = evidence.screenshot.as_ref().expect("screenshot");
    assert!(shot.height > 4000.0, "{}", shot.height);
    let img = decode(&shot.jpeg_base64);
    // Every pass put the body back where it measured, so the rects are
    // document positions and match the screenshot.
    for selector in [
        "#flag-scroller-foot-copy",
        "#flag-scroller-photo-copy",
        "#flag-scroller-vector-copy",
    ] {
        let rect = rect_of(&evidence, selector);
        assert!(rect[1] > 2000.0, "{selector}: {rect:?}");
        assert!(luma_spread(&img, rect) > 10, "{selector} is blank in the screenshot");
    }
    let foot = rect_of(&evidence, "#flag-scroller-foot-copy");
    assert!(
        luma_spread(&img, [20.0, foot[1] + foot[3] + 16.0, 900.0, 40.0]) > 60,
        "marker row is blank"
    );
    // Viewport chrome paints once, in the first viewport, not on every tile:
    // the fixed badge, and the tooltip the page re-anchored on every scroll.
    // Counted in solid 4x4 blocks, not pixels: with subpixel text
    // antialiasing (ClearType on Windows, LCD filtering on Linux) a glyph's
    // coloured fringe can fall inside either colour range one pixel at a
    // time, and only a painted box fills a block.
    let blocks = |y0: u32, y1: u32, pick: &dyn Fn([u8; 3]) -> bool| {
        let y1 = y1.min(img.height());
        (y0..y1.saturating_sub(3))
            .step_by(4)
            .flat_map(|y| (0..img.width().saturating_sub(3)).step_by(4).map(move |x| (x, y)))
            .filter(|&(x, y)| (0..4).all(|dy| (0..4).all(|dx| pick(img.get_pixel(x + dx, y + dy).0))))
            .count()
    };
    let badge = |p: [u8; 3]| p[0] > 170 && p[1] < 70 && p[2] > 50 && p[2] < 140;
    let tip = |p: [u8; 3]| p[0] < 70 && p[1] > 110 && p[1] < 170 && p[2] > 170;
    assert!(blocks(0, 800, &badge) > 200, "the fixed badge is missing from the first viewport");
    assert_eq!(blocks(800, img.height(), &badge), 0, "the fixed badge repeats below the first viewport");
    assert!(blocks(0, 800, &tip) > 200, "the anchored tooltip is missing from the first viewport");
    assert_eq!(blocks(800, img.height(), &tip), 0, "the anchored tooltip repeats below the first viewport");
}

#[test]
fn a_fixed_scroll_frame_page_is_captured_by_scrolling_the_frame() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let Some((findings, evidence)) = scan(
        &engine,
        port,
        "fullpage-screenshot-frame.html",
        (1280, 800),
        &EvidenceRequest::default(),
    ) else {
        return;
    };
    let all = flagged(&findings, &evidence);
    assert!(all.contains(&("low-contrast", "#flag-frame-foot-copy", origin::SCAN)), "{all:?}");
    assert!(!all.iter().any(|(_, s, _)| *s == "#pass-frame-foot-copy"), "{all:?}");

    let shot = evidence.screenshot.as_ref().expect("screenshot");
    assert_eq!(shot.method, impeccable_browser::fullpage::method::STITCHED);
    assert!(shot.height > 3400.0, "{}", shot.height);
    let img = decode(&shot.jpeg_base64);
    let rect = rect_of(&evidence, "#flag-frame-foot-copy");
    assert!(rect[1] > 3000.0, "{rect:?}");
    assert!(luma_spread(&img, rect) > 20, "the flagged copy is blank in the screenshot");
    assert!(
        luma_spread(&img, [20.0, rect[1] + rect[3] + 16.0, 900.0, 40.0]) > 60,
        "marker row is blank"
    );
}

#[test]
fn rows_rendered_on_scroll_appear_in_the_screenshot() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let Some((_, evidence)) = scan(
        &engine,
        port,
        "fullpage-screenshot-virtual.html",
        (1280, 800),
        &EvidenceRequest::default(),
    ) else {
        return;
    };
    let shot = evidence.screenshot.as_ref().expect("screenshot");
    assert!(shot.height > 5000.0, "{}", shot.height);
    let img = decode(&shot.jpeg_base64);
    // A band of rows near the foot of both lists.
    for y in [2500.0, 4000.0, 5600.0] {
        assert!(
            luma_spread(&img, [20.0, y, 900.0, 180.0]) > 40,
            "rows near y {y} are blank in the screenshot"
        );
    }
}

#[test]
fn an_element_past_the_cut_gets_its_own_shot() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let request = EvidenceRequest {
        max_screenshot_height: 1500.0,
        ..EvidenceRequest::default()
    };
    let Some((_, evidence)) =
        scan(&engine, port, "fullpage-screenshot.html", (1280, 800), &request)
    else {
        return;
    };
    let shot = evidence.screenshot.as_ref().expect("screenshot");
    assert_eq!(shot.height, 1500.0);
    assert!(shot.document_height > 4000.0);
    let rect = rect_of(&evidence, "#flag-foot-copy");
    assert!(rect[1] > shot.height, "{rect:?}");

    let element = evidence
        .element_shots
        .iter()
        .find(|s| s.selector == "#flag-foot-copy")
        .expect("a viewport shot for the element past the cut");
    let img = decode(&element.jpeg_base64);
    assert_eq!(img.width() as f64, element.width);
    assert_eq!(img.height() as f64, element.height);
    let r = element.rect;
    assert!(r[1] >= 0.0 && r[1] + r[3] <= element.height, "{r:?}");
    assert!((r[2] - rect[2]).abs() < 1.0 && (r[3] - rect[3]).abs() < 1.0, "{r:?} vs {rect:?}");
    assert!(luma_spread(&img, r) > 20, "the element shot is blank at the element");
    // Nothing inside the cut gets a shot of its own.
    assert!(
        evidence.element_shots.iter().all(|s| {
            let r = rect_of(&evidence, &s.selector);
            r[1] >= shot.height || r[0] >= shot.width
        }),
        "a shot was taken for an element inside the screenshot"
    );
}

#[test]
fn a_right_to_left_page_records_where_its_screenshot_starts() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let Some((findings, evidence)) =
        scan(&engine, port, "fullpage-screenshot-rtl.html", (390, 844), &EvidenceRequest::default())
    else {
        return;
    };
    let all = flagged(&findings, &evidence);
    assert!(all.contains(&("low-contrast", "#flag-rtl-copy", origin::SCAN)), "{all:?}");
    assert!(!all.iter().any(|(_, s, _)| *s == "#pass-rtl-copy"), "{all:?}");

    // The body scrolls from the right, and the 900px grid overflows 510px
    // left of the viewport, at negative document x. The image starts there.
    let shot = evidence.screenshot.as_ref().expect("screenshot");
    assert!((shot.width - 900.0).abs() <= 16.0, "{}", shot.width);
    assert!((shot.origin_x - (390.0 - shot.width)).abs() <= 16.0, "{} {}", shot.origin_x, shot.width);
    let img = decode(&shot.jpeg_base64);
    assert_eq!(img.width() as f64, shot.width);
    let rect = rect_of(&evidence, "#flag-rtl-copy");
    assert!(rect[0] < 0.0 && rect[0] > -80.0, "{rect:?}");
    let image_x = rect[0] - shot.origin_x;
    assert!(
        luma_spread(&img, [image_x, rect[1], rect[2], rect[3]]) > 20,
        "the flagged copy is blank at its image position"
    );
    // The marker under the copy is green where the origin puts it; the rect's
    // x taken as image x lands on the other column's blue marker.
    let marker_y = (rect[1] + rect[3] + 42.0) as u32;
    let green = |p: [u8; 3]| p[1] > 90 && p[0] < 70 && p[2] < 110;
    let blue = |p: [u8; 3]| p[2] > 150 && p[0] < 90 && p[1] < 120;
    let at = |x: f64| img.get_pixel(x as u32, marker_y).0;
    assert!(green(at(image_x + 200.0)), "no green marker at the image position: {:?}", at(image_x + 200.0));
    assert!(blue(at(rect[0].max(0.0) + 200.0)), "the uncorrected position is not the other column: {:?}", at(rect[0].max(0.0) + 200.0));

    // Nothing overflows at desktop width, and a page that scrolls from the
    // left keeps its origin at 0 however wide it is.
    let Some((_, desktop)) =
        scan(&engine, port, "fullpage-screenshot-rtl.html", (1280, 800), &EvidenceRequest::default())
    else {
        return;
    };
    assert_eq!(desktop.screenshot.as_ref().expect("screenshot").origin_x, 0.0);
    let Some((_, wide)) =
        scan(&engine, port, "fullpage-screenshot.html", (390, 844), &EvidenceRequest::default())
    else {
        return;
    };
    let wide_shot = wide.screenshot.as_ref().expect("screenshot");
    assert!(wide_shot.width >= 900.0, "{}", wide_shot.width);
    assert_eq!(wide_shot.origin_x, 0.0);
}

/// A page whose inner scroller is already scrolled when it is measured (a
/// restored position), under a band that sits above the scroller. Served
/// inline: it holds no findings, so it stays out of the fixture sweeps.
const OFFSET_SCROLLER_PAGE: &str = r#"<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Offset scroller</title>
<style>
  html, body { height: 100%; margin: 0; overflow: hidden; background: #ffffff; }
  .band { height: 100px; background: #0a7d3b; }
  .frame { position: absolute; top: 100px; left: 0; right: 0; bottom: 0; overflow: auto; }
  .content { height: 3000px; background: #ffffff; }
</style></head>
<body>
  <div class="band"></div>
  <div class="frame" id="frame"><div class="content"></div></div>
  <script>document.getElementById('frame').scrollTop = 600;</script>
</body></html>"#;

#[test]
fn a_scroller_measured_mid_scroll_keeps_the_band_above_it() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let options = ScanOptions {
        viewport: Some((1280, 800)),
        ..Default::default()
    };
    let mut browser = engine.launch().expect("launch");
    let url = format!("http://127.0.0.1:{port}/offset-scroller.html");
    let (_, evidence) = detect_url_evidence(&mut browser, &url, &options, "load", 100, &EvidenceRequest::default())
        .expect("evidence scan");
    browser.close();
    let shot = evidence.screenshot.as_ref().expect("screenshot");
    assert_eq!(shot.method, impeccable_browser::fullpage::method::STITCHED);
    let img = decode(&shot.jpeg_base64);
    // The band is the image's first hundred rows, as the rects measured it.
    let p = img.get_pixel(40, 50).0;
    assert!(p[1] > 90 && p[0] < 60, "band rows are not where they were measured: {p:?}");
}

/// A 100vh app shell that scrolls its own frame inside the body's default
/// 8px margin, so the document is 16px taller than the viewport. Served
/// inline, like the offset scroller.
const MARGIN_SHELL_PAGE: &str = r#"<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Margin shell</title>
<style>
  body { background: #ffffff; }
  .shell { height: 100vh; overflow: auto; }
  .content { height: 3000px; background: #ffffff; }
  .marker { height: 60px; background: #0a7d3b; }
</style></head>
<body>
  <div class="shell"><div class="content"></div><div class="marker"></div><div style="height: 200px"></div></div>
</body></html>"#;

#[test]
fn a_shell_inside_a_body_margin_is_captured_by_scrolling_the_shell() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let options = ScanOptions {
        viewport: Some((1280, 800)),
        ..Default::default()
    };
    let mut browser = engine.launch().expect("launch");
    let url = format!("http://127.0.0.1:{port}/margin-shell.html");
    let (_, evidence) = detect_url_evidence(&mut browser, &url, &options, "load", 100, &EvidenceRequest::default())
        .expect("evidence scan");
    browser.close();
    let shot = evidence.screenshot.as_ref().expect("screenshot");
    assert_eq!(shot.method, impeccable_browser::fullpage::method::STITCHED);
    assert!(shot.height > 3000.0, "{}", shot.height);
    let img = decode(&shot.jpeg_base64);
    // The marker under the shell's 3000px of content, 8px down for the margin.
    let p = img.get_pixel(40, 8 + 3000 + 30).0;
    assert!(p[1] > 90 && p[0] < 60 && p[2] < 110, "the marker below the fold is missing: {p:?}");
}

/// A 100vh app shell that scrolls its own frame, with a footer below it, so
/// the document scrolls the footer's height: under a quarter viewport, so
/// the frame is captured, and the footer has to follow the frame's content.
/// Served inline, like the margin shell.
const SHELL_FOOTER_PAGE: &str = r#"<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Shell footer</title>
<style>
  body { margin: 0; background: #ffffff; }
  .shell { height: 100vh; overflow: auto; }
  .content { height: 3000px; background: #ffffff; }
  .footer { height: 150px; background: #0a7d3b; }
</style></head>
<body>
  <div class="shell"><div class="content"></div></div>
  <div class="footer"></div>
</body></html>"#;

#[test]
fn a_footer_under_a_scrolled_shell_reaches_the_screenshot() {
    let Some(engine) = engine() else { return };
    let port = serve_page(SHELL_FOOTER_PAGE);
    let options = ScanOptions {
        viewport: Some((1280, 800)),
        ..Default::default()
    };
    let mut browser = engine.launch().expect("launch");
    let url = format!("http://127.0.0.1:{port}/");
    let (_, evidence) = detect_url_evidence(&mut browser, &url, &options, "load", 100, &EvidenceRequest::default())
        .expect("evidence scan");
    browser.close();
    let shot = evidence.screenshot.as_ref().expect("screenshot");
    assert_eq!(shot.method, impeccable_browser::fullpage::method::STITCHED);
    assert!(shot.height >= 3140.0, "{}", shot.height);
    let img = decode(&shot.jpeg_base64);
    // The shell's content is white to its foot; the footer follows it.
    let p = img.get_pixel(40, 2900).0;
    assert!(p[0] > 200 && p[1] > 200, "the shell's content is not white: {p:?}");
    let p = img.get_pixel(40, 3075).0;
    assert!(p[1] > 90 && p[0] < 60 && p[2] < 110, "the footer below the shell is missing: {p:?}");
}

fn serve_page(body: &'static str) -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let port = listener.local_addr().unwrap().port();
    std::thread::spawn(move || {
        // One thread per connection, so an idle connection the browser opens
        // ahead of its request never holds up the one that asks.
        for mut stream in listener.incoming().flatten() {
            std::thread::spawn(move || {
                let mut buf = [0u8; 8192];
                let _ = stream.read(&mut buf);
                let head = format!(
                    "HTTP/1.0 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                );
                let _ = stream.write_all(head.as_bytes());
                let _ = stream.write_all(body.as_bytes());
            });
        }
    });
    port
}
