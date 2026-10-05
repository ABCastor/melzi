# Macrostructures: the shape of the page

A dealt world names a palette, a material, a mood. It says nothing about the shape of the page, so three worlds can arrive as three paint jobs on one layout, and two screens that share a shape read as one option shown twice however far apart their moods are.

Every dealt world therefore carries a `structure`. It is the second axis, orthogonal to the world: the world says what the screen is made of, the structure says how it is arranged.

| id | Shape | What it does to heading placement, reading order, and density |
|---|---|---|
| `bento` | Bento grid | Headings live inside their own tiles, the eye browses cells in any order it likes, density high and evenly spread. |
| `long-document` | Long document | One heading opens each section of a single column, reading runs strictly top to bottom, density low and unvarying. |
| `marquee` | Marquee hero | One enormous heading owns the first screen alone, the page reads as a statement followed by a thin tail, density near zero up top and ordinary below. |
| `stat-led` | Stat-led | Figures outrank headings and set the type scale, the eye lands on a number and reads its label second, density concentrated into a band and sparse around it. |
| `workbench` | Workbench | Headings shrink to panel labels around a central work surface, reading radiates outward from the middle rather than downward, density high at the edges and calm in the centre. |
| `manifesto` | Manifesto | The headings are the content, few and very large, read as a sequence of declarations with nothing between them, density as close to nothing as the page can bear. |
| `letter` | Letter | An address or salutation stands where a heading would, one measured column is read once from start to finish, density low with wide unused margin. |
| `index-first` | Index first | The opening heading is a list of everything the page contains, reading is choose-then-descend rather than scroll, density high in text and near zero in image. |
| `split-studio` | Split studio | A heading stays pinned in one half while the other half moves, two tracks are read in parallel instead of one in series, density deliberately unequal between the halves. |
| `specimen` | Type specimen | Headings demonstrate the typeface rather than label a section, reading follows the scale downward from largest to smallest, density swings hard between a giant setting and fine print. |
| `atlas` | Atlas | Headings float as captions pinned to a drawn field or map, reading order is spatial and the visitor sets it, density clustered around the drawing and empty elsewhere. |
| `catalogue` | Catalogue | A small repeated heading tops each specimen with the live thing under it, reading is scanning down a repeating unit, density uniform and modular the whole way. |

## Building the one you were dealt

- **Take the shape as dealt.** Do not trade it for one that suits the world better. The spread across shapes is what makes a hand three options instead of three moods, and a shape that fights its world is usually the more interesting screen.
- **The shape is the arrangement, the world is everything painted onto it.** Heading placement, reading order and density come from this table. Texture, palette weighting, imagery, motion, ornament and material come from the world's `form`, `spark` and `system`.
- **A shape is a starting geometry, not a template.** Two bento grids built for two different worlds should share no tile count, no rhythm, and no scale. If they do, the world stopped doing any work.
- **The signature outranks the shape.** Where a shape wants a type scale or a colour weighting the signature invariants forbid, the signature wins and the shape bends around it.

`node .trae/skills/melzi/scripts/melzi/world-pool.mjs --structures` prints this list as JSON. A world may pin its own `structure`, in which case that value is used verbatim and may name a shape not listed here.
