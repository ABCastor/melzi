use impeccable_html::{detect_html_source, DetectHtmlOptions};
use std::path::Path;

fn count(body: &str) -> usize {
    detect_html_source(body, Path::new("/tmp/broken-image.html"), &DetectHtmlOptions::default())
        .iter().filter(|f| f.antipattern == "broken-image").count()
}

#[test]
fn srcset_is_an_image_source() {
    assert_eq!(count("<img srcset=\"photo.png 1x, photo@2x.png 2x\" alt=\"Example\">"), 0);
    assert_eq!(count("<img srcset=\"photo.png 400w, photo@2x.png 800w\" sizes=\"100vw\" alt=\"Example\">"), 0);
    assert_eq!(count("<img src=\"\" srcset=\"/a.png 1x\" alt=\"\">"), 0);
}

#[test]
fn an_image_without_a_source_is_still_reported() {
    assert_eq!(count("<img srcset=\"\" alt=\"\">"), 1);
    assert_eq!(count("<img alt=\"\">"), 1);
    assert_eq!(count("<img src=\"#\" alt=\"\">"), 1);
}
