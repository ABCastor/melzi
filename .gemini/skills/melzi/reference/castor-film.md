Load this when the request is a presentation video, launch film or product film for one of Castor's products ("make a presentation video for X"). It routes the work to the Castor film system and adds what the system cannot know. [motion-film.md](motion-film.md) still owns the general stages; [animate.md](animate.md) still owns the motion thesis.

---

## Where the system lives

The launch-film repository (private; find the checkout named `launch-film` in the workspace), folder `reel/`. Its `README.md` opens with the system's table: songs, beat maps, direction, material, film, checks. Read it first, then the first film made this way, `reel/films/borgo/` (its `DIRECTORS.md` records how its direction was chosen and what changed while building). The owner's design decisions are in the design note of the castor-presentation-video project (`Castor Film System`, design).

## The order of work

1. **Dossier.** From the product's README, its live site and its context, write `reel/films/<film>/dossier/brief.md`: what the product does for whom, the states worth showing (recorded stills from the live site), the facts the film may claim (only what the live product shows that day), the owner's rules, and the song library with each song's measured tempo and character (`node reel/tools/songs.mjs list`).
2. **Direction.** Send the same brief to two or three director models, each blind to the others. Choose one treatment, keep all of them in `directors/`, and record the comparison and every change made while building in `DIRECTORS.md`.
3. **Song.** Only from the library, and only a song no other Castor film uses. Add a song with `node reel/tools/songs.mjs add <page>`: it reads the licence from the song's own page and refuses NonCommercial, NoDerivatives and ShareAlike. Map its beats with `uv run reel/rhythm/beats.py <audio>`.
4. **Material.** Record the live product with Playwright in a local headless browser (`films/<film>/record.mjs`), one state per action, with the boxes of what the film frames. Never the person's own browser.
5. **Film.** `films/<film>/make.mjs` places every cut, click, key and caption on the measured beats, renders with HyperFrames, mixes the song, puts the credit on screen, and ends with the Castor signature from `reel/kit/castor-ending` (its `land` and `dam` options put the tagline on the music).
6. **Checks, before anyone watches:** `check-beat-sync` on the finished MP4, `check-variety` against every earlier film, then `check-still`, `check-readable`, `check-ending`, `check-uncut`. `tools/film-stills.mjs --cuts` gives one sheet of every shot to look at.
7. **Deliver** with `make.mjs --deliver <dir>`: the film, a silent README loop, a poster and the music notice. The product's own repository takes them only when the owner says so.

## What makes it this product's film

- **The real interface, as recorded, is the picture.** No stand-in screens, no generated imagery, no stock background.
- **Each film differs.** Song, palette treatment and structure are each the product's own; `check-variety` enforces it. When two products share a ground (paper behind both), use a scheme the product really offers (its dark mode), not a tint invented for the film.
- **Captions are plain English.** No em dashes, no owner name, no flying text; one short line, on the beat.
- **A proper song carries it.** Choose the song from the product's character, never a generated track.
