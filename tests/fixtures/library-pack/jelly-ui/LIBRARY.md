# Jelly UI

A fixture component library pack. It exists so the tests can prove that a
declared library's own rules reach the agent verbatim, rather than being
summarised or paraphrased on the way in.

## Components

- `<JellyButton variant="primary" | "ghost">` is the only button. Never hand-roll one.
- `<JellyCard>` owns its own padding. Do not wrap it in a spacing div.

## Tokens

Spacing comes from `--jelly-space-1` through `--jelly-space-6`. No raw pixel values.
