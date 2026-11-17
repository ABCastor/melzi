# Changelog

Melzi's own changes. For the changes that arrive from Impeccable in each sync, see [Impeccable's changelog](https://impeccable.style/changelog).

## 2026-11-17

Synced with Impeccable cli-v4.9.2 (engine 0.1.25, skill 4.9.1, upstream commit `d41d9860b`). Every Melzi addition is kept: the skill has 21 commands and the detector 62 rules.

### The taste bar

- `skill/reference/taste-bar.md` is a new bar the skill holds on its own work. It is loaded with the craft floor before every UI edit, and every edit ends with its director's pass: renders at the shipped widths, the first viewport judged first, three faults written down before any score, fourteen tests on the pixels, seven axes scored from 1 to 5 with visible evidence, one round of fixes, and one confirming render.
- The skill no longer asks you to rate, rank, or score screens. The taste calibration session runs only when you ask for it by name.
- Changes to an existing screen now start by deciding how much the screen needs, keep a before-and-after inventory of its links, fields, handlers, script hooks, and headings, and work in layers across the whole screen.

### Ideas from Hallmark and unslop

After a comparison with nutlope's [Hallmark](https://github.com/nutlope/hallmark) (MIT) and Damir Sokolovsky's [unslop](https://github.com/heydamir/unslop) (CC BY 4.0), seven of their ideas are in the taste bar, written in Melzi's own words. Credits are in [NOTICE.md](NOTICE.md).

- From Hallmark: a width sweep from 320 to 1920 for mechanical breaks; the first viewport judged before the sections under it; the before-and-after inventory when changing an existing screen; no success state without a real request behind it; and pictures that are real and licensed, with their credit.
- From unslop: deciding how much a screen needs before changing it, including saying so when it is already good; and a set order of layers across the whole screen.

### Motion

- `animate` adds model-driven dragging: each draggable element declares the model states a drag may reach, the engine renders them ahead, blends them mid-drag, and settles on the nearest legal one. After [Declarative Dragging](https://declarative-dragging.github.io/) by Joshua Horowitz, Andrew Blinn, and Jeffrey Heer, and its library Dragology.
- New `skill/reference/motion-film.md` for films and talk decks: formats first, a static storyboard gate, a seekable timeline captured frame by frame, low-resolution drafts, per-format recomposition, and a click-stepped deck that runs offline. `animate` gains a motion character line, an easing-character table, and three runtime traps. After Elisabetta Cavataio's [i-like-to-move-it-skills](https://github.com/elisabettacavataio-design/i-like-to-move-it-skills).

### Installs stay local

- Impeccable's installer is now written in Rust, and Melzi's refusal carries over to it: `install`, `update`, and `check` fail before any prompt, download, or write unless `IMPECCABLE_BUNDLE_PATH` names a locally built bundle or the engine finds `dist/universal.zip` in its own checkout.
