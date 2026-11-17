# Third-Party Notices

This project includes content derived from third-party work, used under the terms of its original license.

## Platform Design Skills

The `skill/reference/ios.md` and `skill/reference/android.md` platform reference files are distilled from ehmo's `platform-design-skills` (Apple Human Interface Guidelines and Material Design 3 rules), rewritten in Impeccable's voice.

**Original work:** https://github.com/ehmo/platform-design-skills
**Original license:** MIT
**Author:** ehmo

## Hallmark

The `study` command's idea (point at a design you admire, extract its design DNA, optionally lock that DNA into a portable design system) comes from nutlope's `hallmark`. No text or code was copied; the command, its prose, and its routing into this fork's signature and world pool were written here.

Five checks in `skill/reference/taste-bar.md` also come from Hallmark's gates and build order (read at commit 04977e15f3dfd6ee4b74c887dac3eb52665d6c92): the 320 to 1920 width sweep for mechanical breaks, judging the first viewport before the sections under it, the before-and-after inventory of links, fields, handlers, script hooks and headings when changing an existing screen, the refusal of a success state with no request behind it, and pictures that are real and licensed rather than borrowed. Only the ideas were taken; the text was written here, and Hallmark's scripts, theme catalogue and photo data were not used.

**Original work:** https://github.com/nutlope/hallmark
**Original license:** MIT
**Author:** nutlope

## unslop

Two ideas in section 5 of `skill/reference/taste-bar.md` come from Damir Sokolovsky's `unslop` (read at commit 620163eedb3529d9cd23a3994ed8d287d06f760d): deciding how much an existing screen needs before changing it, including saying so when it is already good, and working in layers across the whole screen in a set order. No text was copied; the section was written here.

**Original work:** https://github.com/heydamir/unslop
**Original license:** Creative Commons Attribution 4.0 International (CC BY 4.0), https://creativecommons.org/licenses/by/4.0/
**Author:** Damir Sokolovsky (@heydamir)
**Changes:** ideas only, restated in new prose and adapted to this skill's taste bar.

## I Like to Move It

The film and talk-deck production method in `skill/reference/motion-film.md` (formats first, a static storyboard gate, a seekable timeline captured frame by frame, low-resolution drafts, per-format recomposition, and a click-stepped offline deck), plus the motion character line, the easing-character table and three runtime traps in `skill/reference/animate.md`, come from Elisabetta Cavataio's `i-like-to-move-it-skills`, shown at the Claude Community Event in Torino on 26 October 2026. The repository carries no license file; its README invites readers to use and adapt the skills. Only the ideas were taken: no text or code was copied, and the prose and examples were written here.

**Original work:** https://github.com/elisabettacavataio-design/i-like-to-move-it-skills (read at commit 6e0129a8eae13349ca787ee47527bc3b19565356)
**Original license:** none stated
**Author:** Elisabetta Cavataio

## Declarative Dragging

The model-driven dragging entry in `skill/reference/animate.md` (declare which model states a drag may reach, render them speculatively, interpolate mid-drag, settle on the nearest legal state) comes from Joshua Horowitz, Andrew Blinn and Jeffrey Heer, *Declarative Dragging* (UIST 2026), and its library Dragology. No text or code was copied; the entry was written here.

**Original work:** https://declarative-dragging.github.io/ and https://github.com/declarative-dragging/dragology (read at commit d89d1337f7c0b1aa9dc379f5267d1c8658b291c4)
**Original license:** MIT
**Authors:** Joshua Horowitz, Andrew Blinn, Jeffrey Heer

## Self-critique gates in other design skills

Two ideas in `skill/reference/taste-bar.md` were prompted by reading other public design skills on 10 November 2026. No text or code was copied; the tests, the axes, and the prose were written here.

- A pre-delivery critique that scores named axes from 1 to 5 and forces a revision below a threshold, naming the weakest axis: nutlope's `hallmark` (https://github.com/nutlope/hallmark, MIT per the entry above).
- A finish gate with a bounded number of rounds that checks renders at 390 and 1440: Leonxlnx's `taste-skill` (https://github.com/Leonxlnx/taste-skill, licence not checked).

## This project is a derivative (fork) of Impeccable

Base work: **Impeccable** by Paul Bakaus, https://github.com/pbakaus/impeccable
Original license: Apache License 2.0 (retained; see LICENSE).
Forked at upstream commit: 8259c28209b92792005cec14dad573df39f68eaf
Synced with upstream at `cli-v4.9.2` (commit d41d9860b); engine and launcher version 0.1.25.

This distribution modifies and extends the original with provider adapters, design-review workflows, reference and taste handling, live feedback, and a typed launcher and provider-build boundary. Impeccable's original copyright and Apache-2.0 terms are retained. Melzi's additions and modifications are distributed under Apache-2.0. Source files identify modifications where practical; distribution JavaScript is generated from the corresponding TypeScript source.


## Literata title lettering

The outlined Melzi README title derives from Literata, Copyright 2017 The Literata Project Authors (https://github.com/googlefonts/literata). The font is licensed under the SIL Open Font License 1.1. See `docs/OFL-literata.txt`.
