# Hand-drawn vectors: making a mark look drawn without a filter

Load this when the brief asks for something that must look **drawn by a person** and still be a clean scalable vector: a mascot, a spot illustration, marginalia, an annotation mark, a sketchy diagram.

## Start from the intended use

Resolve `[target]` to the requested asset or its placement in the project. Read the existing visual system and any approved character reference. Establish the subject, identifying features, smallest display size, colour variants, and whether motion is needed. Ask only for missing choices that change the drawing. A standalone illustration can proceed here; a new production identity mark also follows the Mark phase in [identity.md](identity.md) for identity, proof, adoption, and propagation.

## The fact that decides the technique

**An SVG stroke has constant width along a path.** It cannot taper through `stroke-width` alone, and tapered ends are a strong signal of a hand.

Emit the outline as a **filled path**. Compute a ribbon around a centreline, then vary its width along its length. This is the pressure-outline approach used by tools such as perfect-freehand and freehand drawing systems in Excalidraw, tldraw, Canva and draw.io.

`{{scripts_path}}/melzi/pen.py` implements it using Python 3 and only the standard-library `math` module. Import that installed file to call `pen(points, w0, w1, wmid, bias)`. It returns an SVG path `d` string: a smooth centreline through `points`, offset either side by a pressure curve that is light at the entry, full through the belly of the stroke, and light again at the exit. `w0`, `w1`, and `wmid` are full widths in the drawing's coordinate units. `bias` moves where the belly sits, because a hand does not put its weight in the middle. Supply at least two distinct finite coordinate pairs in drawing order, non-negative widths, a positive integer `smooth` and a non-negative integer `prec`. The helper expects valid input; it does not validate it. `smooth` controls samples per segment and `prec` controls decimal precision. Tight turns can make the offset ribbon cross itself or form spikes: spread the control points, reduce the width, or split the turn into separate strokes, then inspect the rendered join. `pen.dot()` supplies a closed round detail when needed.

For example, after resolving the installed path, this prints a tapered ribbon ready for `<path fill="currentColor" d="..."/>`:

```python
import importlib.util

spec = importlib.util.spec_from_file_location("pen", "{{scripts_path}}/melzi/pen.py")
pen = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pen)
d = pen.pen([(0, 0), (10, 4), (20, 0)], w0=0.6, w1=0.6, wmid=2.2, bias=0.45)
print(d)
```

If Python 3 is unavailable, author the same filled-path geometry directly or use an available pressure-outline tool such as perfect-freehand. The geometry and the checks below still apply.

## What reads as drawn

Use tapered ends; line-weight hierarchy, heavy on the silhouette and light on interior detail; overshoot where two lines cross past each other; open contours that do not quite meet; a belly in the stroke that sits off-centre; deliberate variation applied as a rule.

Random jitter does not supply that intent. Inconsistent stroke weights and randomly tapered lines can also make generated artwork look defective. Deviation that repeats in the same condition reads as a decision; unrelated deviations across matching parts read as mistakes.

**rough.js suits diagrams.** Its characteristic sketch output uses constant-width stroked paths, random offsets and double strikes. That treatment cannot taper and is recognisable as Excalidraw-style diagramming. Random offsets can change when paths are regenerated at runtime; bake the path `d` for a static diagram; for an identifying mark, construct the pressure outline instead.

## The size wall

Taper, wobble, overshoot and double-strike are most useful roughly between 32px and 96px. **At 24px, plan around silhouette and gross weight contrast.** Make two drawings: the full one and a small cousin with interior detail deleted and the identifying shape enlarged. Scaling one file down will not make those decisions for you.

## Making it draw itself

A filled ribbon cannot be revealed with `stroke-dasharray` on the ribbon itself. Emit the **centreline** alongside it, stroke that inside a `<mask>` at a width greater than the ribbon's widest point, and animate its `stroke-dashoffset`. The ribbon appears along the path the hand travelled. Sequence the masks in the order a person would draw. `pen.centreline()` returns the mask path and `pen.polylen()` returns its length. Use matching points and smoothing for the ribbon and centreline.

## Micro-motion on a small character

The pause stops a loop becoming annoying. Useful measured starting timings are 0.4s for a lean, 0.85s for a jump, frame holds of 85ms rising to 270ms at the effort peak, and **1500ms of rest before the loop repeats**. At 24-48px, favour motions that change the silhouette: a tail flick, an ear twitch, a rise from behind an edge. A head turn that leaves the silhouette unchanged may be invisible. Stop decorative motion under `prefers-reduced-motion` and show the complete drawing in its resting pose.

## Checking it

Render at the true device pixel size, then magnify nearest-neighbour. Do not judge a small drawing solely from a large vector preview. To establish whether a change is visible, diff the two renders pixel by pixel. A geometrically different drawing can still produce identical pixels at its target size.

Deliver the authored SVG, its small-size cousin where needed, and true-size previews on the intended backgrounds. Check one-colour and reversed variants for identifying marks. Keep raster references outside the shipped SVG; inspect it for embedded images and external raster dependencies. State which sizes and motion settings were actually checked.

## Generate a reference when the drawing is stuck

Repeated revisions can preserve the same construction fault. Consider a rabbit mascot whose two front teeth are drawn as one block scored with a hairline. Two separate narrow shapes with a real gap, hanging from the front of the muzzle into open space, read differently from a block with a line down it. One construction study can reveal that relationship before another round repeats the mistake.

**The generation is a reference, never the artefact.** The delivered mark is fully authored SVG, scalable and made only of vectors. Generate, inspect, name the structural difference, then construct it in vector geometry. Never trace or embed the generation, or ship a raster as the mark. Take the relationship between parts from the image, rather than copying its contours.

Ask for the construction explicitly: "two separate white front teeth hanging below the muzzle, separated by a visible gap" gives a relationship to inspect. A style label such as "cute cartoon rabbit" leaves the attachment unspecified. Passing your own render back and asking what is structurally wrong can be more useful than generating another alternative.

Model choice, prompt structure, character consistency, generated-art tells, and diagnosis prompts are in [imagegen.md](imagegen.md). Load it before using an image tool.
