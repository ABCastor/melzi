/**
 * The component-library pack: put the house kit's own rules in front of the
 * agent, before it writes a single component.
 *
 * FORK-ONLY. Upstream has no equivalent, so this file carries zero merge
 * burden. The only patch it needs in an upstream file is two lines in
 * context.mjs (one import, one call), recorded as a fork delta.
 *
 * WHY THIS EXISTS. Everything the skill knows about a project's visual world
 * comes from PRODUCT.md, DESIGN.md, and the surface brief, all of which
 * describe intent. None of them describe the components that already exist and
 * must be used. So on a project with a house kit the agent does the one thing
 * the kit was built to stop: it hand-rolls a button, picks its own spacing, and
 * produces something that looks close and integrates badly. The fix is not more
 * rules in the skill, it is the kit's own document, verbatim, at boot.
 *
 * THE DECLARATION. A project opts in by giving PRODUCT.md a `## Component
 * Library` section whose first line is a bare slug, mirroring the existing
 * `## Platform` pattern. Absent section = no library and no output: a project
 * without a kit must pay nothing for this.
 *
 * WHERE PACKS LIVE, AND WHY NOT IN THE REPO. `$IMPECCABLE_LIBRARY_DIR/<slug>/
 * LIBRARY.md` when that variable is set, else `~/.impeccable/libraries/<slug>/
 * LIBRARY.md`. Packs are user-side data, never repo files: a kit is a property
 * of the person or the company, it is reused across projects, and several of
 * them are private. Shipping any pack here would also make this tool the
 * curator of other people's design systems, which it is not.
 *
 * VERBATIM, AND ONE LIBRARY. The pack is inlined as written rather than
 * summarised, because a paraphrase of a component contract is the failure being
 * prevented. One library per project in v1: a second one raises a precedence
 * question ("which kit owns the button?") that no boot-time inline can answer.
 *
 * FAILURE POLICY. Never break the boot. This runs before the agent has any
 * context at all, so a throw here costs the whole session. A declared library
 * with no readable pack degrades to a WARNING naming the exact path that was
 * checked, never to silence: silence would leave the user believing their kit
 * was loaded while the agent invents components.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const LIBRARY_HEADING = 'Component Library';
const LIBRARY_PACK_FILE = 'LIBRARY.md';

/** A slug names one directory. Not a path, not a sentence. */
const SLUG_RE = /^[a-z0-9][a-z0-9._-]*$/i;

/**
 * Read the first non-empty line under a bare `## <heading>`. Deliberately a
 * local copy of context.mjs's `extractSectionValue` (which IS exported) rather
 * than an import: importing it would create the first module cycle in this
 * graph (context.mjs -> library-pack.mjs -> context.mjs), and it would couple
 * this fork-only module to an upstream helper that upstream rewrites freely. A
 * renamed or moved helper after a sync would fail at import time and kill the
 * whole boot, which the never-throw wrapper below cannot guard. The ~15 copied
 * lines parse OUR declaration contract, so divergence is not a real risk.
 */
function sectionValue(product, heading) {
  if (typeof product !== 'string' || !product) return null;
  const headingRe = new RegExp(`^##\\s+${heading}\\s*$`, 'i');
  const lines = product.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (headingRe.test(lines[i].trim())) {
      for (let j = i + 1; j < lines.length; j++) {
        const next = lines[j].trim();
        // A new heading before any value means the section is empty.
        if (/^#{1,6}\s/.test(next)) return null;
        if (next) return next;
      }
    }
  }
  return null;
}

/**
 * The declared library slug, or null. Takes the first token of the value line
 * so an annotated declaration (`jelly-ui (v2, vendored)`) still resolves; a
 * value that is not slug-shaped is refused rather than resolved, which is what
 * keeps a PRODUCT.md from pointing the reader at an arbitrary file.
 */
export function extractLibrarySlug(product) {
  const value = sectionValue(product, LIBRARY_HEADING);
  if (!value) return null;
  const token = value.split(/[\s,(]+/)[0].replace(/[.,;:)]+$/, '');
  return SLUG_RE.test(token) ? token : null;
}

/** Absolute path of the pack for a slug. Packs are user-side, never repo files. */
export function resolveLibraryPackPath(slug, { env = process.env, home = os.homedir() } = {}) {
  const root = (env.IMPECCABLE_LIBRARY_DIR || '').trim() || path.join(home, '.impeccable', 'libraries');
  return path.join(root, slug, LIBRARY_PACK_FILE);
}

/**
 * The block to append to the boot output, or null when nothing is declared.
 * Exported separately from `appendLibraryPack` so the tests can assert on the
 * text itself, which is the entire contract with the agent.
 */
export function buildLibraryPackBlock(product, options = {}) {
  const slug = extractLibrarySlug(product);
  if (!slug) return null;

  const packPath = resolveLibraryPackPath(slug, options);
  let content = null;
  try {
    content = fs.readFileSync(packPath, 'utf8');
  } catch {
    content = null;
  }

  if (content === null || !content.trim()) {
    return `WARNING: PRODUCT.md declares \`## ${LIBRARY_HEADING}\` \`${slug}\`, but no readable pack was found at \`${packPath}\`. `
      + `Build the interface without inventing components for it, and tell the user their library pack is missing: `
      + `either write ${LIBRARY_PACK_FILE} at that path, or drop the \`## ${LIBRARY_HEADING}\` section from PRODUCT.md.`;
  }

  return [
    `# COMPONENT LIBRARY: ${slug} (${packPath})`,
    '',
    `COMPONENT_LIBRARY_AUTHORITY: This project builds with \`${slug}\`. Its document below is authority over your own component `
      + `instincts: use the components and tokens it names instead of hand-rolling equivalents, and when a needed component is `
      + `genuinely absent from it, say so rather than quietly inventing one.`,
    '',
    content.trim(),
  ].join('\n');
}

/**
 * The one entry point context.mjs calls. Swallows everything: a boot that
 * cannot print context is worse than a boot without a library pack.
 */
export function appendLibraryPack(parts, product, options = {}) {
  try {
    const block = buildLibraryPackBlock(product, options);
    if (block) parts.push(block);
  } catch {
    // Deliberately silent. See the failure policy at the top of this file.
  }
}
