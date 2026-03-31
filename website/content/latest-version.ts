/**
 * Latest version information
 * Update this file when adding a new version to updates/index.mdx
 */

export const latestVersion = {
  version: '0.10.3',
  title: 'Fix Setup/Index Model Directory Mismatch',
  date: 'March 30, 2026',
  summary:
    'Fixed dev setup reporting model ready while dev index fails with "model not found" due to mismatched model directories.',
  link: '/updates#v0103--fix-setupindex-model-directory-mismatch',
} as const;
