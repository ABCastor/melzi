# jelly-ui

A fixture pack for the declared-waivers tests. Only the Detector notes section
matters here; a real pack carries the full component contract above it.

## Components

Forty imaginary elements. Not the point of this fixture.

## Detector notes

This library's aesthetic intentionally collides with several melzi rules.
Ignore-list them deliberately in the project rather than fighting the library.

- `bounce-easing` is the strongest collision. The spring curves overshoot on purpose: `cubic-bezier(.28,1.35,.5,1)` and `(.34,1.5,.5,1)`. Overshoot is the product here.
- `design-system-radius`: the library is pills, `999px` everywhere.
- `design-system-font-size`: display type runs fluid at `clamp(2.5rem, 6vw, 5rem)`.
- `design-system-color`: the variant hues `#e8467c` and `oklch(60% 0.25 350)` are the library's own palette.
- `low-contrast`: the platinum caption `#9aa0a6` on mist measures 4.2:1 and the library considers that intentional.
- `pulsing-dot`: the toaster renders a tone dot per toast. Honest liveness, not decoration.
