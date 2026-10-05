// Modified from Impeccable: typed contracts for provider distribution builds.
export type FrontmatterField = 'user-invocable' | 'argument-hint' | 'license' | 'compatibility' | 'metadata' | 'allowed-tools';
export type HookProvider = 'claude' | 'codex' | 'cursor' | 'github' | 'grok' | 'gemini';
export type AgentFormat = 'codex-toml' | 'claude-md' | 'copilot-agent-md' | 'cursor-md';

export interface SkillFile {
  name: string;
  content: string;
  mode?: number;
}

export interface SkillAgent {
  name: string;
  description: string;
  body: string;
  codexName?: string;
  claudeName?: string;
  effort?: string;
  nicknameCandidates?: string[];
  tools?: string;
  model?: string;
  maxTurns?: number;
  providers?: string[];
}

export interface Skill {
  name: string;
  description: string;
  body: string;
  userInvocable?: boolean;
  argumentHint?: string;
  license?: string;
  compatibility?: string;
  metadata?: string | Record<string, unknown>;
  allowedTools?: string;
  scripts?: SkillFile[];
  references?: SkillFile[];
  agents?: SkillAgent[];
}

export interface ProviderConfig {
  provider: string;
  configDir: string;
  displayName: string;
  providerTags?: string[];
  frontmatterFields?: FrontmatterField[];
  agentFormat?: AgentFormat;
  emitHooks?: HookProvider;
  hooksManifestRel?: string;
  placeholderProvider?: string;
  writeOpenAIMetadata?: boolean;
  includeVersion?: boolean;
  versionInMetadata?: boolean;
  bodyTransform?: (body: string, skill: Skill) => string;
}

export interface TransformOptions {
  skillsVersion?: string;
}
export type Transformer = (skills: Skill[], distDir: string, options?: TransformOptions) => void;
