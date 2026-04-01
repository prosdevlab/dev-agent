/**
 * Latest version information
 * Update this file when adding a new version to updates/index.mdx
 */

export const latestVersion = {
  version: '0.11.1',
  title: 'Cached Dependency Graph',
  date: 'April 1, 2026',
  summary:
    'dev_map and dev_refs load a pre-built graph instead of fetching all docs — removes the 10k doc ceiling for larger repos.',
  link: '/updates#v0111--cached-dependency-graph',
} as const;
