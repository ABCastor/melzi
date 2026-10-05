import { createTransformer } from '../scripts/lib/transformers/factory.js';
import type { ProviderConfig, Skill } from '../scripts/lib/transformers/types.js';

const config: ProviderConfig = {
  provider: 'cursor', configDir: '.cursor', displayName: 'Cursor',
  frontmatterFields: ['license'], agentFormat: 'cursor-md',
};
const skill: Skill = { name: 'melzi', description: 'Design review', body: 'Review this interface.' };
const transform = createTransformer(config);
// These are compile-time contracts, never execute a distribution build here.
void (() => transform([skill], 'dist', { skillsVersion: '1.0.0' }));
// @ts-expect-error A misspelled hook kind cannot ship a silently missing manifest.
const badHook: ProviderConfig = { ...config, emitHooks: 'cluade' };
// @ts-expect-error Unknown frontmatter fields cannot silently disappear from a build.
const badField: ProviderConfig = { ...config, frontmatterFields: ['allow-tools'] };
// @ts-expect-error An agent must carry the instructions that will be emitted.
const badAgent: Skill = { ...skill, agents: [{ name: 'reviewer', description: 'Review' }] };
// @ts-expect-error Script file modes must be numbers for chmod.
const badMode: Skill = { ...skill, scripts: [{ name: 'launcher', content: '', mode: '755' }] };
void [badHook, badField, badAgent, badMode];
