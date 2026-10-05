// Modified from Impeccable: typed Melzi launcher and distribution contracts.
/**
 * Category map for user-invocable skills, consumed by the provider
 * transformers. The site-side page data model (sub-pages-data.js) lives in
 * the private impeccable-site repo and keeps its own copy.
 */

export const SKILL_CATEGORIES: Record<string, string> = {
  // CREATE - build something new
  'melzi': 'create',
  shape: 'create',
  handdrawn: 'create',
  // EVALUATE - review and assess
  critique: 'evaluate',
  audit: 'evaluate',
  explore: 'evaluate',
  // REFINE - improve existing design
  typeset: 'refine',
  layout: 'refine',
  colorize: 'refine',
  animate: 'refine',
  bolder: 'refine',
  quieter: 'refine',
  // SIMPLIFY - reduce and clarify
  clarify: 'simplify',
  // HARDEN - production-ready
  polish: 'harden',
  harden: 'harden',
  // SYSTEM - setup and tooling
  init: 'system',
  teach: 'system',
  document: 'system',
  study: 'system',
  identity: 'system',
  live: 'system',
  generate: 'system',
};

export const CATEGORY_ORDER = ['create', 'evaluate', 'refine', 'simplify', 'harden', 'system'];
