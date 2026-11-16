The review island is how a design comes back with the user's judgement attached to the thing it is about. Load this whenever an HTML prototype, comp, or built page goes to the user to look at, which is every design round that ends in a browser, and load it again when reading a round back.

It is an instrument, never product chrome. It renders in Melzi's own material inside its own shadow root, and nothing about it belongs to the design under review. Do not restyle it to match the world, do not fold it into a sidebar, and do not let it inherit the surface's tokens. The one thing the product owns is light and dark: the page is judged as it will really look, and the island stays the same in both.

## Give it to the user

Copy the script next to the page and add one tag before `</body>`:

```html
<script src="review-layer.js" data-sizes="1280,834,390"></script>
```

The file ships with the skill at `.claude/skills/melzi/scripts/review-layer.js`. `data-sizes` is optional; it draws a width switch with those pixel widths plus Full, and omitting the attribute drops the switch. There is no DOM until the page is opened with `#review` or `?review`, or the user presses Command Shift R. A page shipped with the tag and opened normally is the clean page.

The same built file is what the Chrome extension injects, so a page you did not build can be reviewed too. Everything below is identical either way.

## Offer the project's own candidates

Without this the island falls back to a small neutral starter set, which is rarely what the project wants. Declare the real candidates before the script tag, or ship a `review-library.json` beside the page:

```js
window.REVIEW_LIBRARY = {
  project: 'stable-project-id',
  palettes: [{ id, name, roles: { ground, surface, ink, muted, accent }, note }],
  faces:    [{ id, family, role, stack, source, licence: 'web' | 'paid' | 'personal', note }],
  retired:  [{ id, reason }]
}
```

`retired` is a hard filter, not a label: a retired palette or face is never generated, never suggested, and never enters a comparison. It appears only in a "previously ruled out" drawer with its reason. Put everything the project has already rejected in there: that list is what stops a round re-proposing what was settled months ago.

Mark a face `personal` when its licence forbids web embedding. The island will preview it and refuse to let it reach a hand-off.

## Collect the round on disk

Local storage alone means the round only exists in that browser. To get it onto disk, serve the folder:

```
python3 .claude/skills/melzi/scripts/review-serve.py <folder> --port 8795
```

and set the endpoint in the page, before the script tag:

```html
<script>window.REVIEW_ENDPOINT = '/api/review';</script>
```

Each note is then appended to `<folder>/reviews/<page>.json` and each attached picture is written under `<folder>/reviews/assets/`. Candidate verdicts and complete Go rounds also append to `~/.impeccable/taste/review-verdicts.jsonl` and `review-rounds.jsonl`, beside the existing taste ledger. They are separate streams because the taste ledger's comparison rows are pairwise `a`/`b`/`tie` evidence, while an island verdict is unary `love`/`like`/`no` and a Go is a whole page proposal. Encoding either as a comparison would falsify the data.

Give every project a stable `REVIEW_LIBRARY.project`, or set `window.REVIEW_PROJECT` explicitly. The explicit value wins, then the library project, then the serving origin; the pathname is never the project identity. On mount, the island merges the server's project memory with its local browser cache and keeps the latest verdict per candidate ID.

Without an endpoint the island still works and the user exports instead. Candidate memory is then only a cache in that browser, and the island says so in its status line rather than pretending it is durable. Add `--tailnet` to also serve the machine's Tailscale address, and give the user that URL to review on a phone or an iPad, or to hand to a second reviewer.

## What the user does

The island opens on **Comment** showing two things: a box for the page as a whole, and a button to point at an element. Everything else is behind a mode word.

- **Comment**: a note about the whole page needs no element. Pointing at an element pins the note to it, and the readout names the face, size, weight and colours that element actually resolves, and the custom property behind each. Notes carry a kind and an open or done state, and take a picture by button, paste or drop. In the extension, Screenshot captures the visible page directly.
- **Colour**: the roles the page really declares, edited in OKLCH with the page repainting live. Locks, re-roll, a three-step ramp, a palette pulled out of a dropped picture, one line of contrast verdict with the pair table and colour-vision simulation behind it.
- **Type**: a face per role from the project's library or the catalogue, applied live, with the licence on every face and the specimen set in the user's own words.
- **Compare**: Keep turns the live overrides into a named candidate. Candidates go side by side on the real page and take a verdict of love, like or no. The island remembers every candidate ever judged for this project, and reports how an opinion moved.
- **Pins**: everything in the round, filterable by state and by reviewer, exportable.

## Read the round back

Go writes one record. With a server it is `<folder>/reviews/<page>.json`; without one it is the file the user exported or pasted.

| Field | What it tells you |
|---|---|
| `notes[]` | each note, with `scope` page or element, its `kind`, its `state`, the user's words, an attached `image`, and for a pinned note the `path` and the first words of the element |
| `tokens{}` | every colour they changed, as `was` beside `now`, with the role and the colour space |
| `faces{}` | every typeface, size, line height, measure and axis they changed, again as `was` beside `now` |
| `candidates[]` | the complete directions they compared, each with its verdict, whether it was one of the conventional options, and their `previous` verdict if they had judged it before |
| `chosen` | the candidate they landed on, or null |
| `unresolved[]` | anything the island could not apply, and why |

Work the notes one by one, in order, and treat each as its own change with its own verification. Do not batch them into one restyle, and do not silently drop the ones you disagree with: fix, or say why not. Open every attached picture and look at it before acting. It is the example the user could not put in words, and it usually carries the answer the note only gestures at.

Read `unresolved` before you read anything else. A font that failed to load or a property that could not be written is absent from the diff, so without that list you will read a change as unwanted when it merely failed.

A note whose element no longer exists is marked as having lost its place. That means the element was renamed, replaced or removed since the round, so use the note and the element's first words to find what it was about rather than guessing from the path.

**`tokens` and `faces` are a proposal, not a decision.** Apply them to the pages under review. Do not rewrite `DESIGN.md`, a signature file, or a project's token source from a round; promoting a proposal is the user's own step, and on a project whose colours are jointly owned it is not yours to take.

**Never re-propose what they already rejected without saying so.** The candidate memory and the library's `retired` list both record it. If you have a real reason to bring one back, say out loud that they said no to it before, and why you are raising it again. Silently re-offering a rejected candidate makes a tool with a memory feel like one without.

When the round is done, tell the user which notes are addressed and leave the file in place. They clear the set themselves from the Pins drawer.
