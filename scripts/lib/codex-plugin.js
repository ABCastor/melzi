// `homepage` is optional: this fork has no published site, so the root manifest
// carries no homepage and every URL derived from it is omitted rather than
// emitted as the string "undefined/privacy". Restore the field in
// .claude-plugin/plugin.json once a real site exists and these come back.
const withHomepage = (homepage, fields) => (homepage ? fields : {});

export function buildCodexPluginManifest(rootManifest) {
  const { homepage } = rootManifest;
  return {
    name: rootManifest.name,
    version: rootManifest.version,
    description: 'Design and refine frontend interfaces with coding agents.',
    author: {
      name: 'Renaissance Geek Inc',
      ...withHomepage(homepage, { url: homepage }),
    },
    ...withHomepage(homepage, { homepage }),
    repository: rootManifest.repository,
    license: 'Apache-2.0',
    keywords: [
      'design',
      'frontend',
      'ui',
      'ux',
      'accessibility',
      'anti-patterns',
    ],
    skills: './skills/',
    interface: {
      displayName: 'Melzi',
      shortDescription: 'Design and refine interfaces',
      longDescription: 'Create, critique, and refine frontend interfaces with your coding agent. Melzi provides 24 focused design commands, live browser iteration for exploring visual directions, and automatic checks that flag common design anti-patterns as you work.',
      developerName: 'Renaissance Geek Inc',
      category: 'Creativity',
      capabilities: ['Interactive', 'Read', 'Write'],
      ...withHomepage(homepage, {
        websiteURL: homepage,
        privacyPolicyURL: `${homepage}/privacy`,
      }),
      termsOfServiceURL: `${rootManifest.repository}/blob/main/LICENSE`,
      defaultPrompt: [
        'critique this interface and prioritize what to fix.',
        'craft a distinctive landing page, then polish the result.',
        'start melzi live so I can explore bolder or more delightful variants.',
      ],
      brandColor: '#E2AE38',
      composerIcon: './assets/icon.png',
      logo: './assets/icon.png',
      screenshots: [],
    },
  };
}
