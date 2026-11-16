Load this when the motion leaves the live page: a reel, ad, product film or explainer exported to video, or a talk deck in which every slide moves. [animate.md](animate.md) still owns the motion thesis, the material and the timing; this file owns production, review and delivery. A presentation film for a Castor product goes through the Castor film system instead: [castor-film.md](castor-film.md).

---

## Shared ground: time is a parameter

A film frame and a deck step are both a state of the page at a known instant. Build so that instant can be set, not waited for.

- **One entry point sets the whole page to time `t`.** It pauses every animation, sets its `currentTime`, then updates whatever script draws (counters, typed text, image sequences). Capture, review and the person's scrubbing all go through it.

```js
window.renderAt = (seconds) => {
  for (const anim of document.getAnimations()) {
    anim.pause();
    anim.currentTime = seconds * 1000;
  }
  window.onFrame?.(seconds); // script-drawn state: counters, text, frame sequences
};
```

- **No wall clock, no unseeded chance.** `setTimeout` chains, free-running `requestAnimationFrame`, `Date.now()` and unseeded `Math.random()` make a frame that cannot be reproduced, and a frame that cannot be reproduced cannot be reviewed or fixed.
- **Ready before the first frame.** Wait for `document.fonts.ready` and for every image to decode. Footage inside a scene becomes an extracted frame sequence driven by the timeline; a playing `<video>` drifts from the capture clock.
- **Use the house renderer when there is one.** Remotion, HyperFrames or a project pipeline already implement this contract; check them against it rather than building a second one.

## Films

Every stage ends in one small output the person approves. A mistake found at the script costs a sentence; the same mistake found after the full render costs the render.

### 1. Brief, formats first

Ask once, only what is not already known: the kind of film, every format it needs and which one is primary, the length and any cut-downs, sound (and whether it must work muted), the assets and the claims that are true and usable, and delivery (platform, size cap, loop, cover frame). Ask for formats before anything else: they decide the composition, and a format added later means recomposing every scene. Confirm the answers back in five lines.

| Kind | What decides it |
|---|---|
| Social | a hook in the first one or two seconds, legible with the sound off, vertical primary, tight rhythm |
| Ad or promo | only claims the client supplied, logo and call to action on an end card held at least two seconds, cut-downs such as 6, 15 and 30 s |
| Product demo | the real interface, recorded or faithfully rebuilt; one feature per scene; zoom to the detail that matters |
| Explainer | one idea per scene, simple diagrams, little text, time to read it |
| Portfolio | the work full-frame, credits, nothing confidential |

### 2. Script and direction

One sentence of aim: what the viewer should understand or do afterwards. Then a table, one row per scene: seconds, on-screen text, what is seen, direction. The seconds add up to the length. Direction is character, not technique, in the form the thesis in [animate.md](animate.md) asks for. Text only, approved before anything is drawn.

### 3. Tokens

The film speaks the product's language: its colors, type, radii, shadows, and reference durations and easings, in one tokens file every scene reads, so a change of color or rhythm is one line. When the product has a site or codebase, take them from there as `document` does. A missing asset is a placeholder labelled with the file name it expects, never stand-in imagery of the person's work or results.

### 4. Storyboard gate

Draw each scene's key frame, its settled end state, as a static composition in the primary format only. Put every frame in one page as a numbered grid (S1, S2, …) with duration and direction under each, and review one screenshot of the whole grid at thumbnail width, not a picture per frame. Layout, hierarchy, copy, color and crop are settled here, where a change is cheapest. No motion until the storyboard is approved.

### 5. Motion draft

Animate out of the approved frames, all scenes on one timeline in one page at the full canvas size. Render the draft at half resolution and 15 fps. Review it the way [animate.md](animate.md) reviews captured motion: a contact sheet of eight to twelve frames chosen at the start, middle and end of scenes, then the draft itself, at quarter speed when judging easing. Show the person the draft and the numbered sheet.

### 6. Iterate

- Ask for feedback as scene, timecode and intended feel ("S3 at 0:07 drags, it should snap"). When feedback is vague, offer two alternatives for that one scene.
- Change only that scene's parameters, re-render only its span, and batch corrections given together into one round.
- After two rounds on one scene without converging, return to its storyboard frame: the composition is wrong, not the motion.

### 7. Export and the other formats

- **Primary format first, at full resolution:** 1080 px on the short side, 30 fps; 60 only for very fast motion on a platform that plays it.
- **The other formats recompose, never crop.** Same timeline, same tokens, positions changed per format through layout variables on the canvas. Durations stay identical so cuts remain in sync. Each format is approved on its own contact sheet before it renders.
- **Encoding baseline:** H.264, CRF about 18 to 20, `yuv420p`, `+faststart`, one keyframe per second. Audio (AAC, 128 to 192 kbps) is muxed last; a silent film carries no audio track.

```bash
ffmpeg -framerate 30 -i frames/%05d.png -c:v libx264 -crf 19 -pix_fmt yuv420p -g 30 -movflags +faststart film.mp4
```

- **QA before delivery:**
  - In vertical video, keep essential text clear of the platform's interface. Start from roughly the top 250 px and bottom 350 px of a 1920 px frame, then check the target platform's current safe-zone guide.
  - Text no smaller than about 40 px on a 1080 px canvas.
  - The first frame works as a cover.
  - A loop has no visible seam.
  - Duration and file size are within the platform's limits.
  - Claims and call to action match the approved script word for word.

## Talk decks

A deck that moves is a small web app delivered as one offline HTML file and a media folder. It opens with a double click, runs from a presentation clicker and needs no network.

### Engine contract

- **A fixed 1920×1080 canvas** scaled to the window; every measurement is in canvas pixels.
- **State is slide plus step**, mirrored in the URL hash so a reload lands where the speaker was. Arrow keys, Space and Page Up/Down (what clickers send) advance and go back; also offer jump-to-number, an overview, fullscreen, a black screen, hide chrome, media play, replay and mute, and a help overlay.
- **The speaker owns the pace.** Every reveal that matters is a step on a click; timers are only for an entrance's micro-motion. No slide shows text that gives away its next step.
- **Mount only the live slide**, plus the outgoing one during a transition, and prefetch the media of the slides either side.
- **Media come from a registry.** A missing file renders a labelled placeholder showing its expected path, so dropping the file in finishes the slide without a rebuild. Every video gets a poster from its first frame so it never opens on black. When the browser blocks sound on autoplay, start muted and show the unmute key.
- **The build shows its stamp** (date and time) in the help overlay, so on stage you know which build is open. Fonts are self-hosted and inlined; tool versions are pinned.
- **Encode for projection:** H.264, CRF about 22, 30 fps, one keyframe per second, `+faststart`; verticals around 720×1280, horizontals 1280 to 1600 px wide; strip audio that is not used, and keep the original when a re-encode comes out larger.

### Verify and deliver

- After every change, build, open the slide at its `#slide.step`, capture several instants of its animation into one sheet, and look at it.
- Before the event, run the whole deck cold on a fresh browser profile: no console errors, every video ready, and the start delay of delayed videos measured.
- Deliver speaker notes per slide (clicks, timing, what to say) and a short README on swapping a media file.
- On the day: copy the whole folder, open it in a Chromium browser, go fullscreen, step through every slide once to warm the cache, then test sound and the clicker.
- A slide that rewinds through saved screenshots of earlier iterations tells the story of how the work was made better than any text about it.

---

Adapted from Elisabetta Cavataio's "I Like to Move It" skills (<https://github.com/elisabettacavataio-design/i-like-to-move-it-skills>), shown at the Claude Community Event in Torino on 26 October 2026. The method is hers; the wording here is new and no text or code was copied.
