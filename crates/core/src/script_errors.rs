//! What an uncaught page error is, read from its message.
//!
//! A URL scan reports each uncaught error as `script-error`. Most are the
//! rule's error. Two kinds report as advisory: ad-tech errors
//! ([`crate::third_party::ad_tech_vendor`]) and the hydration errors React
//! recovers from, named here.

/// The invariants React throws when hydration fails and it recovers by
/// rendering again on the client: #418 (the server HTML did not match), #419
/// (the server could not finish a Suspense boundary), #422 and #423 (an error
/// while hydrating a boundary or the root, switched to client rendering) and
/// #425 (text content did not match). One failure throws #418 or #425 and
/// then #422 or #423, and the visitor sees a complete page.
pub const REACT_RECOVERABLE_HYDRATION_ERRORS: &[u32] = &[418, 419, 422, 423, 425];

/// The invariant number when `message` is one of React's recoverable
/// hydration errors: `Minified React error #<n>` with `<n>` in
/// [`REACT_RECOVERABLE_HYDRATION_ERRORS`], in the form a production build
/// throws (`#418; visit https://react.dev/errors/418 ...`) or decoded
/// (`#418: Hydration failed ...`). Such a `script-error` reports as advisory
/// (corpus decision r5-p13-script-error-hydration). Every other error,
/// another React invariant included, is `None` and keeps failing the scan.
pub fn react_recoverable_hydration_error(message: &str) -> Option<u32> {
    const MARK: &str = "Minified React error #";
    let rest = &message[message.find(MARK)? + MARK.len()..];
    let digits = rest.bytes().take_while(u8::is_ascii_digit).count();
    let code = rest[..digits].parse::<u32>().ok()?;
    REACT_RECOVERABLE_HYDRATION_ERRORS.contains(&code).then_some(code)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recoverable_hydration_errors_are_named() {
        for (message, code) in [
            ("Uncaught Error: Minified React error #418: Hydration failed because the initial UI does not match what was rendered on the server.", 418),
            ("Uncaught Error: Minified React error #419: The server could not finish this Suspense boundary, likely due to an error during server rendering. Switched to client rendering.", 419),
            ("Uncaught Error: Minified React error #422: There was an error while hydrating this Suspense boundary. Switched to client rendering.", 422),
            ("Uncaught Error: Minified React error #423; visit https://reactjs.org/docs/error-decoder.html?invariant=423 for the full message", 423),
            ("Uncaught Error: Minified React error #425; visit https://react.dev/errors/425 for the full message", 425),
        ] {
            assert_eq!(react_recoverable_hydration_error(message), Some(code), "{message}");
        }
    }

    #[test]
    fn every_other_error_keeps_failing() {
        for message in [
            // Other React invariants: a crash, and hydration ones outside the set.
            "Uncaught Error: Minified React error #185: Maximum update depth exceeded.",
            "Uncaught Error: Minified React error #421: This Suspense boundary received an update before it finished hydrating.",
            "Uncaught Error: Minified React error #4180; visit https://react.dev/errors/4180",
            "Uncaught Error: Minified React error #; visit",
            // The number or the word alone is not the invariant.
            "Uncaught Error: Order #418 failed to sync",
            "Uncaught Error: hydration of the cart failed",
            // mrtarget.de (findings 143138, 143187, 143325).
            "Uncaught TypeError: $.evo.article is not a function",
            "Uncaught TypeError: $.evo.io is not a function",
        ] {
            assert_eq!(react_recoverable_hydration_error(message), None, "{message}");
        }
    }
}
