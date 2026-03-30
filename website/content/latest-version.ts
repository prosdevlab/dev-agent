/**
 * Latest version information
 * Update this file when adding a new version to updates/index.mdx
 */

export const latestVersion = {
  version: '0.9.0',
  title: 'Antfly Hybrid Search',
  date: 'March 29, 2026',
  summary:
    'Replaced LanceDB with Antfly — dev_search now uses hybrid search (BM25 + vector + RRF). New `dev setup` command handles backend installation.',
  link: '/updates#v090--antfly-hybrid-search',
} as const;
