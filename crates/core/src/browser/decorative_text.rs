//! The browser engines' reading of [`DecorativeTextFacts`] off the `Dom`
//! probe. The decision is [`classify_decorative_text`]; this only measures.

use crate::checks::decorative_text::{
    avatar_sized, centred_in, classify_decorative_text, is_mockup_marker, is_signature_marker,
    DecorativeShape, DecorativeTextFacts, MOCKUP_MARKER_SKIP_TAGS,
};
use super::dom::{class_attr, closest_or_none, pf0, tag_lower, Dom, ElId};
use crate::color::{parse_any_color, parse_rgb, Rgba};
use crate::js;

fn parse_rgb_or_any(value: &str) -> Option<Rgba> {
    parse_rgb(Some(value)).or_else(|| parse_any_color(Some(value)))
}

/// Controls whose whole text is their label.
const CONTROL_SELECTOR: &str = "a, button, label, summary, select, option, [role=\"button\"], [role=\"link\"], [role=\"tab\"], [role=\"menuitem\"], [role=\"option\"], [role=\"checkbox\"], [role=\"radio\"], [role=\"switch\"]";
const HEADING_SELECTOR: &str = "h1, h2, h3, h4, h5, h6, [role=\"heading\"]";

fn collapsed_text(dom: &dyn Dom, el: ElId) -> String {
    js::trim(&dom.text_content(el))
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Whether a box paints something a letter could sit on: a fill, an image,
/// a visible border, or (for an `svg`) its own shapes.
fn box_paints(dom: &dyn Dom, el: ElId) -> bool {
    if tag_lower(dom, el) == "svg" {
        return true;
    }
    let fill = parse_rgb_or_any(&dom.style(el, "backgroundColor"));
    if fill.is_some_and(|c| c.alpha_or_one() > 0.1) {
        return true;
    }
    let image = dom.style(el, "backgroundImage");
    if !image.is_empty() && image != "none" {
        return true;
    }
    ["Top", "Right", "Bottom", "Left"].iter().all(|side| {
        pf0(&dom.style(el, &format!("border{side}Width"))) > 0.0
            && parse_rgb_or_any(&dom.style(el, &format!("border{side}Color")))
                .is_some_and(|c| c.alpha_or_one() > 0.1)
    })
}

/// The element, or its parent or grandparent, as a small painted box that
/// holds only this text, with the text centred in it.
fn in_avatar_box(dom: &dyn Dom, el: ElId, text: &str) -> bool {
    let own = dom.direct_text_rect(el).unwrap_or_else(|| dom.rect(el));
    let text_box = (own.left, own.top, own.width, own.height);
    let mut cur = Some(el);
    for _ in 0..3 {
        let Some(b) = cur else { break };
        if collapsed_text(dom, b) != text {
            break;
        }
        let r = dom.rect(b);
        if avatar_sized(r.width, r.height)
            && box_paints(dom, b)
            && centred_in(text_box, (r.left, r.top, r.width, r.height))
        {
            return true;
        }
        cur = dom.parent(b);
    }
    false
}

/// `(picture, marked)`: an HTML ancestor is `role="img"`, or an ancestor's
/// class or id names a mockup. A `figcaption` on the way up ends both.
fn marked_mockup(dom: &dyn Dom, el: ElId) -> (bool, bool) {
    // `role="img"` names an HTML subtree drawn as a picture. On an `svg` (or
    // inside one) it is how a chart, a logo or an icon is labelled, and a
    // chart's axis labels are read, so it says nothing there.
    let mut in_svg = closest_or_none(dom, el, "svg").is_some();
    let mut cur = Some(el);
    while let Some(c) = cur {
        let tag = tag_lower(dom, c);
        if tag == "figcaption" {
            return (false, false);
        }
        if !in_svg && dom.attr(c, "role").is_some_and(|r| js::trim(&r).eq_ignore_ascii_case("img")) {
            return (true, false);
        }
        if tag == "svg" {
            in_svg = false;
        }
        if !MOCKUP_MARKER_SKIP_TAGS.contains(&tag.as_str())
            && (is_mockup_marker(&class_attr(dom, c))
                || is_mockup_marker(&dom.attr(c, "id").unwrap_or_default()))
        {
            return (false, true);
        }
        cur = dom.parent(c);
    }
    (false, false)
}

/// Whether a box sits in a drawn product mockup: under an HTML `role="img"`
/// outside any `svg`, or in or itself a framed demo by its structure (r5-p26's
/// three title-bar dots, preview caption, or scaled or tilted device frame,
/// and r8-t1's frame box with a sample caption on it or beside it).
/// `nested-cards` reports an inner box here as advisory (decision
/// r6-t3-nested-cards-mockups); `text-occlusion` asks
/// [`covered_text_in_mockup_dom`]. A mockup class or id is not read: an
/// `illustration` names a feature tile's picture as often as a mockup, and
/// r4-p17 keeps such a tile failing.
pub fn box_in_mockup_dom(dom: &dyn Dom, el: ElId) -> bool {
    under_html_picture(dom, el)
        || super::text_context::in_framed_demo_dom(dom, el)
        || super::text_context::is_demo_frame_dom(dom, el)
}

/// Whether covered text sits in a drawn product mockup and is not a
/// control's: `text-occlusion` reports it as advisory (decision
/// r8-t2-occlusion-stacked-mockup). The framed-demo walk ends at a control
/// on its own; the `role="img"` path does not, so the control is asked here.
pub fn covered_text_in_mockup_dom(dom: &dyn Dom, el: ElId) -> bool {
    closest_or_none(dom, el, CONTROL_SELECTOR).is_none() && box_in_mockup_dom(dom, el)
}

/// `el` or an ancestor is an HTML element marked `role="img"`, outside any
/// `svg`; a `figcaption` on the way up ends the walk, as in [`marked_mockup`].
fn under_html_picture(dom: &dyn Dom, el: ElId) -> bool {
    let mut in_svg = closest_or_none(dom, el, "svg").is_some();
    let mut cur = Some(el);
    while let Some(c) = cur {
        let tag = tag_lower(dom, c);
        if tag == "figcaption" {
            return false;
        }
        if !in_svg && dom.attr(c, "role").is_some_and(|r| js::trim(&r).eq_ignore_ascii_case("img")) {
            return true;
        }
        if tag == "svg" {
            in_svg = false;
        }
        cur = dom.parent(c);
    }
    false
}

fn marked_signature(dom: &dyn Dom, el: ElId) -> bool {
    [Some(el), dom.parent(el)].into_iter().flatten().any(|c| {
        is_signature_marker(&class_attr(dom, c))
            || is_signature_marker(&dom.attr(c, "id").unwrap_or_default())
    })
}

/// What the `Dom` says about one element's text.
pub fn decorative_text_facts_dom(dom: &dyn Dom, el: ElId) -> DecorativeTextFacts {
    let text = collapsed_text(dom, el);
    let control_label = closest_or_none(dom, el, CONTROL_SELECTOR)
        .is_some_and(|c| collapsed_text(dom, c) == text);
    let (picture_ancestor, mockup_ancestor) = marked_mockup(dom, el);
    DecorativeTextFacts {
        avatar_box: !text.is_empty() && text.chars().count() <= 3 && in_avatar_box(dom, el, &text),
        in_kbd: closest_or_none(dom, el, "kbd").is_some(),
        font_family: dom.style(el, "fontFamily"),
        in_heading: closest_or_none(dom, el, HEADING_SELECTOR).is_some(),
        control_label,
        signature_marked: marked_signature(dom, el),
        mockup_ancestor,
        picture_ancestor,
        framed_demo: super::text_context::in_framed_demo_dom(dom, el),
        text,
    }
}

/// The decorative shape one element's text has, if any.
pub fn decorative_text_shape_dom(dom: &dyn Dom, el: ElId) -> Option<DecorativeShape> {
    classify_decorative_text(&decorative_text_facts_dom(dom, el))
}

/// Whether one element's text has no reading job.
pub fn is_decorative_text_dom(dom: &dyn Dom, el: ElId) -> bool {
    decorative_text_shape_dom(dom, el).is_some()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::browser::fake_dom::FakeDom;

    #[test]
    fn avatar_initial_in_a_round_tile() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let tile = d.add(Some(body), "span");
        d.add_text(tile, "JD");
        d.set_styles(tile, &[("backgroundColor", "rgb(19, 130, 232)"), ("fontFamily", "Inter")]);
        d.set_rect(tile, 0.0, 0.0, 40.0, 40.0);
        assert_eq!(decorative_text_shape_dom(&d, tile), Some(DecorativeShape::AvatarInitials));
        // The same letters as a link's whole label are the control's name.
        let mut d2 = FakeDom::new();
        let (_h, body) = d2.with_page();
        let a = d2.add(Some(body), "a");
        let tile = d2.add(Some(a), "span");
        d2.add_text(tile, "JD");
        d2.set_styles(tile, &[("backgroundColor", "rgb(19, 130, 232)")]);
        d2.set_rect(tile, 0.0, 0.0, 40.0, 40.0);
        assert_eq!(decorative_text_shape_dom(&d2, tile), None);
    }

    #[test]
    fn a_key_or_an_info_badge_is_not_initials() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let p = d.add(Some(body), "p");
        let key = d.add(Some(p), "kbd");
        d.add_text(key, "K");
        d.set_styles(key, &[("backgroundColor", "rgb(246, 246, 246)")]);
        d.set_rect(key, 0.0, 0.0, 20.0, 20.0);
        assert_eq!(decorative_text_shape_dom(&d, key), None);
        let info = d.add(Some(body), "span");
        d.add_text(info, "i");
        d.set_styles(info, &[("backgroundColor", "rgb(242, 242, 242)")]);
        d.set_rect(info, 0.0, 40.0, 16.0, 16.0);
        assert_eq!(decorative_text_shape_dom(&d, info), None);
        // A brand's lower-case letter in a chat avatar is an avatar.
        let brand = d.add(Some(body), "span");
        d.add_text(brand, "r");
        d.set_styles(brand, &[("backgroundColor", "rgb(19, 130, 232)")]);
        d.set_rect(brand, 0.0, 80.0, 28.0, 28.0);
        assert_eq!(decorative_text_shape_dom(&d, brand), Some(DecorativeShape::AvatarInitials));
    }

    #[test]
    fn a_letter_in_an_unpainted_or_wide_box_is_text() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let bare = d.add(Some(body), "span");
        d.add_text(bare, "A");
        d.set_rect(bare, 0.0, 0.0, 40.0, 40.0);
        assert_eq!(decorative_text_shape_dom(&d, bare), None);
        let wide = d.add(Some(body), "span");
        d.add_text(wide, "A");
        d.set_styles(wide, &[("backgroundColor", "rgb(0, 0, 0)")]);
        d.set_rect(wide, 0.0, 0.0, 120.0, 40.0);
        assert_eq!(decorative_text_shape_dom(&d, wide), None);
    }

    #[test]
    fn mockup_marker_reaches_through_ancestors_but_not_sections() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let frame = d.add(Some(body), "div");
        d.set_attr(frame, "class", "hero-mockup");
        let row = d.add(Some(frame), "div");
        let label = d.add(Some(row), "span");
        d.add_text(label, "Ready");
        assert_eq!(decorative_text_shape_dom(&d, label), Some(DecorativeShape::Mockup));
        let sec = d.add(Some(body), "section");
        d.set_attr(sec, "class", "mockups");
        let p = d.add(Some(sec), "p");
        d.add_text(p, "Every mockup ships with source files");
        assert_eq!(decorative_text_shape_dom(&d, p), None);
        // A practice exam and an image credit are not pictures of a UI.
        for class in ["mock-exam", "illustration-credit"] {
            let wrap = d.add(Some(body), "div");
            d.set_attr(wrap, "class", class);
            let q = d.add(Some(wrap), "p");
            d.add_text(q, "Short label");
            assert_eq!(decorative_text_shape_dom(&d, q), None, "{class}");
        }
    }

    #[test]
    fn role_img_marks_html_pictures_not_svg_charts() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let pic = d.add(Some(body), "div");
        d.set_attr(pic, "role", "img");
        let code = d.add(Some(pic), "code");
        d.add_text(code, "$ npm run build");
        assert_eq!(decorative_text_shape_dom(&d, code), Some(DecorativeShape::Mockup));
        let chart = d.add(Some(body), "svg");
        d.set_attr(chart, "role", "img");
        let label = d.add(Some(chart), "text");
        d.add_text(label, "Nov 2022");
        assert_eq!(decorative_text_shape_dom(&d, label), None);
    }
}
