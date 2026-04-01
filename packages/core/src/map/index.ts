/**
 * Codebase Map Generator
 * Generates a hierarchical view of the codebase structure
 */

import * as path from 'node:path';
import type { Logger } from '@prosdevlab/kero';
import type { RepositoryIndexer } from '../indexer';
import { stripFocusPrefix } from '../indexer/utils/change-frequency.js';
import { getFileIcon } from '../utils/icons';
import type { SearchResult } from '../vector/types';
import type { LocalGitExtractor } from './git-extractor';
import { connectedComponents, loadOrBuildGraph, pageRank } from './graph';
import type {
  ChangeFrequency,
  CodebaseMap,
  ExportInfo,
  HotPath,
  MapNode,
  MapOptions,
} from './types';

export { GitExtractor, LocalGitExtractor } from './git-extractor';
export * from './git-types';
export * from './graph';
export * from './types';

/** Default options for map generation */
const DEFAULT_OPTIONS: Required<MapOptions> = {
  depth: 2,
  focus: '',
  includeExports: true,
  maxExportsPerDir: 5,
  includeHotPaths: true,
  maxHotPaths: 5,
  smartDepth: false,
  smartDepthThreshold: 10,
  tokenBudget: 2000,
  includeChangeFrequency: false,
  repositoryPath: '',
};

/** Context for map generation including optional git extractor and logger */
export interface MapGenerationContext {
  indexer: RepositoryIndexer;
  gitExtractor?: LocalGitExtractor;
  logger?: Logger;
  /** Path to cached dependency-graph.json — avoids rebuilding from getAll */
  graphPath?: string;
}

/**
 * Generate a codebase map from indexed documents
 *
 * @param indexer - Repository indexer with indexed documents
 * @param options - Map generation options
 * @returns Codebase map structure
 */
export async function generateCodebaseMap(
  indexer: RepositoryIndexer,
  options?: MapOptions
): Promise<CodebaseMap>;

/**
 * Generate a codebase map with git history context
 *
 * @param context - Map generation context with indexer and optional git extractor
 * @param options - Map generation options
 * @returns Codebase map structure
 */
export async function generateCodebaseMap(
  context: MapGenerationContext,
  options?: MapOptions
): Promise<CodebaseMap>;

export async function generateCodebaseMap(
  indexerOrContext: RepositoryIndexer | MapGenerationContext,
  options?: MapOptions
): Promise<CodebaseMap> {
  const opts = { ...DEFAULT_OPTIONS, ...(options || {}) };

  // Normalize input
  const context: MapGenerationContext =
    'indexer' in indexerOrContext
      ? indexerOrContext
      : { indexer: indexerOrContext as RepositoryIndexer };

  const logger = context.logger;
  const startTime = Date.now();

  logger?.debug({ depth: opts.depth, focus: opts.focus }, 'Starting codebase map generation');

  // Get all indexed documents (fast scan without semantic search)
  // This is 10-20x faster than search() as it skips embedding generation
  const t1 = Date.now();
  const allDocs = await context.indexer.getAll({
    limit: 10000,
  });
  const t2 = Date.now();
  logger?.debug({ duration_ms: t2 - t1, docCount: allDocs.length }, 'Retrieved all documents');
  if (allDocs.length >= 10000) {
    logger?.warn('Document limit (10000) reached — map and graph results may be incomplete');
  }

  // Build directory tree from documents
  const t3 = Date.now();
  const root = buildDirectoryTree(allDocs, opts);
  const t4 = Date.now();
  logger?.debug({ duration_ms: t4 - t3 }, 'Built directory tree');

  // Count totals
  const t5 = Date.now();
  const totalComponents = countComponents(root);
  const totalDirectories = countDirectories(root);
  const t6 = Date.now();
  logger?.debug(
    {
      duration_ms: t6 - t5,
      totalComponents,
      totalDirectories,
    },
    'Counted components'
  );

  // Load cached dependency graph or build from docs as fallback
  const t7 = Date.now();
  const graph = await loadOrBuildGraph(context.graphPath, async () => allDocs);
  const hotPaths = opts.includeHotPaths ? computeHotPaths(allDocs, graph, opts.maxHotPaths) : [];
  const rawComponents = connectedComponents(graph);
  const components = rawComponents
    .filter((c) => c.length > 1) // Only show multi-file subsystems
    .map((files) => ({ files, size: files.length }));
  const t8 = Date.now();
  logger?.debug(
    { duration_ms: t8 - t7, hotPathCount: hotPaths.length, componentCount: components.length },
    'Computed hot paths and components'
  );

  // Compute change frequency if requested and git extractor is available
  if (opts.includeChangeFrequency && context.gitExtractor) {
    const t9 = Date.now();
    await computeChangeFrequency(root, context.gitExtractor);
    const t10 = Date.now();
    logger?.debug({ duration_ms: t10 - t9 }, 'Computed change frequency');
  }

  const totalDuration = Date.now() - startTime;
  logger?.info(
    {
      duration_ms: totalDuration,
      totalComponents,
      totalDirectories,
      hotPathCount: hotPaths.length,
    },
    'Codebase map generated'
  );

  return {
    root,
    totalComponents,
    totalDirectories,
    hotPaths,
    components: components.length > 0 ? components : undefined,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Build a directory tree from search results
 */
function buildDirectoryTree(docs: SearchResult[], opts: Required<MapOptions>): MapNode {
  // Group documents by directory
  const byDir = new Map<string, SearchResult[]>();

  for (const doc of docs) {
    const filePath = (doc.metadata.path as string) || (doc.metadata.file as string) || '';
    if (!filePath) continue;

    // Apply focus filter
    if (opts.focus && !filePath.startsWith(opts.focus)) {
      continue;
    }

    const relativePath = stripFocusPrefix(filePath, opts.focus);
    const dir = path.dirname(relativePath);
    const existing = byDir.get(dir);
    if (existing) {
      existing.push(doc);
    } else {
      byDir.set(dir, [doc]);
    }
  }

  // Build tree structure
  const rootName = opts.focus || '.';
  const root: MapNode = {
    name: rootName === '.' ? 'root' : path.basename(rootName),
    path: rootName,
    componentCount: 0,
    children: [],
    exports: [],
  };

  // Process each directory
  for (const [dir, dirDocs] of byDir) {
    insertIntoTree(root, dir, dirDocs, opts);
  }

  // Propagate counts up the tree (do this ONCE after all directories are processed)
  propagateCounts(root);

  // Prune tree to depth (smart or fixed)
  if (opts.smartDepth) {
    smartPruneTree(root, opts.depth, opts.smartDepthThreshold);
  } else {
    pruneToDepth(root, opts.depth);
  }

  // Sort children alphabetically
  sortTree(root);

  return root;
}

/**
 * Insert documents into the tree at the appropriate location
 */
function insertIntoTree(
  root: MapNode,
  dirPath: string,
  docs: SearchResult[],
  opts: Required<MapOptions>
): void {
  const parts = dirPath.split(path.sep).filter((p) => p && p !== '.');

  let current = root;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const currentPath = parts.slice(0, i + 1).join(path.sep);

    let child = current.children.find((c) => c.name === part);
    if (!child) {
      child = {
        name: part,
        path: currentPath,
        componentCount: 0,
        children: [],
        exports: [],
      };
      current.children.push(child);
    }
    current = child;
  }

  // Add component count and exports to the leaf directory
  current.componentCount += docs.length;

  if (opts.includeExports) {
    const exports = extractExports(docs, opts.maxExportsPerDir);
    current.exports = current.exports || [];
    current.exports.push(...exports);
    // Limit total exports
    if (current.exports.length > opts.maxExportsPerDir) {
      current.exports = current.exports.slice(0, opts.maxExportsPerDir);
    }
  }

  // Note: Don't propagate counts here - it will be done once after all directories are processed
}

/**
 * Extract export information from documents
 */
function extractExports(docs: SearchResult[], maxExports: number): ExportInfo[] {
  const exports: ExportInfo[] = [];

  for (const doc of docs) {
    if (doc.metadata.exported && doc.metadata.name) {
      exports.push({
        name: doc.metadata.name as string,
        type: (doc.metadata.type as string) || 'unknown',
        file: (doc.metadata.path as string) || (doc.metadata.file as string) || '',
        signature: doc.metadata.signature as string | undefined,
      });

      if (exports.length >= maxExports) break;
    }
  }

  return exports;
}

/**
 * Propagate component counts up the tree
 */
function propagateCounts(node: MapNode): number {
  let total = node.componentCount;

  for (const child of node.children) {
    total += propagateCounts(child);
  }

  node.componentCount = total;
  return total;
}

/**
 * Prune tree to specified depth
 */
function pruneToDepth(node: MapNode, depth: number, currentDepth = 0): void {
  if (currentDepth >= depth) {
    // At max depth, collapse children
    node.children = [];
    return;
  }

  for (const child of node.children) {
    pruneToDepth(child, depth, currentDepth + 1);
  }
}

/**
 * Smart prune tree - expand dense directories, collapse sparse ones
 * Uses information density heuristic: expand if componentCount >= threshold
 */
function smartPruneTree(
  node: MapNode,
  maxDepth: number,
  threshold: number,
  currentDepth = 0
): void {
  // Always stop at max depth
  if (currentDepth >= maxDepth) {
    node.children = [];
    return;
  }

  // For each child, decide whether to expand or collapse
  for (const child of node.children) {
    // Expand if:
    // 1. We're within first 2 levels (always show some structure)
    // 2. OR the child has enough components to be "interesting"
    const shouldExpand = currentDepth < 2 || child.componentCount >= threshold;

    if (shouldExpand) {
      smartPruneTree(child, maxDepth, threshold, currentDepth + 1);
    } else {
      // Collapse this branch - it's too sparse to be interesting
      child.children = [];
    }
  }
}

/**
 * Sort tree children alphabetically
 */
function sortTree(node: MapNode): void {
  node.children.sort((a, b) => a.name.localeCompare(b.name));
  for (const child of node.children) {
    sortTree(child);
  }
}

/**
 * Count total components in tree
 */
function countComponents(node: MapNode): number {
  return node.componentCount;
}

/**
 * Count total directories in tree
 */
function countDirectories(node: MapNode): number {
  let count = 1; // Count this node
  for (const child of node.children) {
    count += countDirectories(child);
  }
  return count;
}

/**
 * Compute change frequency for all nodes in the tree
 */
async function computeChangeFrequency(root: MapNode, extractor: LocalGitExtractor): Promise<void> {
  // Collect all unique directory paths
  const dirPaths = collectDirectoryPaths(root);

  // Get date thresholds
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

  // Compute frequency for each directory
  const frequencyMap = new Map<string, ChangeFrequency>();

  for (const dirPath of dirPaths) {
    try {
      // Get commits for this directory in the last 90 days
      const commits = await extractor.getCommits({
        path: dirPath === 'root' ? '.' : dirPath,
        limit: 100,
        since: ninetyDaysAgo.toISOString(),
        noMerges: true,
      });

      // Count commits in each time window
      let last30Days = 0;
      const last90Days = commits.length;
      let lastCommit: string | undefined;

      for (const commit of commits) {
        const commitDate = new Date(commit.author.date);
        if (commitDate >= thirtyDaysAgo) {
          last30Days++;
        }
        if (!lastCommit || commitDate > new Date(lastCommit)) {
          lastCommit = commit.author.date;
        }
      }

      frequencyMap.set(dirPath, {
        last30Days,
        last90Days,
        lastCommit,
      });
    } catch {
      // Directory might not exist in git or other error
      // Just skip it
    }
  }

  // Apply frequency data to tree nodes
  applyChangeFrequency(root, frequencyMap);
}

/**
 * Collect all directory paths from the tree
 */
function collectDirectoryPaths(node: MapNode, paths: string[] = []): string[] {
  paths.push(node.path);
  for (const child of node.children) {
    collectDirectoryPaths(child, paths);
  }
  return paths;
}

/**
 * Apply change frequency data to tree nodes
 */
function applyChangeFrequency(node: MapNode, frequencyMap: Map<string, ChangeFrequency>): void {
  const freq = frequencyMap.get(node.path);
  if (freq) {
    node.changeFrequency = freq;
  }

  for (const child of node.children) {
    applyChangeFrequency(child, frequencyMap);
  }
}

/**
 * Compute hot paths using PageRank over the dependency graph.
 *
 * Replaces simple reference counting with graph-aware ranking.
 * Files that are depended on by other important files rank higher.
 * Sort by PageRank score, display real incoming edge count.
 */
function computeHotPaths(
  docs: SearchResult[],
  graph: Map<string, import('./graph').WeightedEdge[]>,
  maxPaths: number
): HotPath[] {
  const ranks = pageRank(graph);

  // Count real incoming edges per file (distinct source files)
  const incomingCounts = new Map<string, Set<string>>();
  for (const [src, edges] of graph) {
    for (const e of edges) {
      if (!incomingCounts.has(e.target)) incomingCounts.set(e.target, new Set());
      incomingCounts.get(e.target)?.add(src);
    }
  }

  // Build a lookup for primary component name per file
  const componentByFile = new Map<string, string>();
  for (const doc of docs) {
    const filePath = (doc.metadata.path as string) || (doc.metadata.file as string) || '';
    if (filePath && doc.metadata.name && !componentByFile.has(filePath)) {
      componentByFile.set(filePath, doc.metadata.name as string);
    }
  }

  // Sort by PageRank score, display real incoming ref count
  return Array.from(ranks.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxPaths)
    .map(([file, score]) => ({
      file,
      incomingRefs: incomingCounts.get(file)?.size ?? 0,
      score,
      primaryComponent: componentByFile.get(file),
    }));
}

/**
 * Format codebase map as readable text
 */
export function formatCodebaseMap(map: CodebaseMap, options: MapOptions = {}): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const lines: string[] = [];

  // Format hot paths if present
  if (opts.includeHotPaths && map.hotPaths.length > 0) {
    // Strip repo root for relative paths
    const rootPrefix = opts.repositoryPath
      ? `${opts.repositoryPath}/`
      : map.root.path
        ? `${map.root.path}/`
        : '';

    lines.push('Hot paths:');
    for (const hp of map.hotPaths) {
      const fileName = hp.file.split('/').pop() || hp.file;
      const dirPath = hp.file.substring(0, hp.file.lastIndexOf('/'));
      const relativeDirPath =
        rootPrefix && dirPath.startsWith(rootPrefix) ? dirPath.slice(rootPrefix.length) : dirPath;
      const refs = `${hp.incomingRefs} refs`.padStart(8);
      lines.push(`  ${fileName.padEnd(35)}${refs}   ${relativeDirPath}`);
    }
    lines.push('');
  }

  // Format connected components if present
  if (map.components && map.components.length > 1) {
    lines.push(`Subsystems (${map.components.length} connected):`);
    for (let i = 0; i < Math.min(5, map.components.length); i++) {
      const comp = map.components[i];
      // Show the common directory prefix for the component
      const prefix = findCommonPrefix(comp.files);
      const label = prefix || 'mixed';
      lines.push(`  ${i + 1}. ${label} (${comp.size} files)`);
    }
    if (map.components.length > 5) {
      lines.push(`  ...${map.components.length - 5} more`);
    }
    lines.push('');
  }

  // Format tree
  lines.push('Structure:');
  formatNode(map.root, lines, '  ', true, opts, true);

  return lines.join('\n');
}

/**
 * Format a single node in the tree
 */
function formatNode(
  node: MapNode,
  lines: string[],
  prefix: string,
  isLast: boolean,
  opts: Required<MapOptions>,
  isRoot = false
): void {
  const count = node.componentCount > 0 ? node.componentCount.toLocaleString() : '';

  if (isRoot) {
    lines.push(`${prefix}${node.name}/  ${count} components`.trimEnd());
  } else {
    const connector = isLast ? '└─ ' : '├─ ';
    lines.push(`${prefix}${connector}${node.name}/  ${count}`.trimEnd());
  }

  // Format children (skip exports for clean output)
  const childPrefix = isRoot ? `${prefix}  ` : prefix + (isLast ? '   ' : '│  ');
  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];
    const isChildLast = i === node.children.length - 1;
    formatNode(child, lines, childPrefix, isChildLast, opts);
  }
}

/**
 * Find common directory prefix for a set of file paths
 */
function findCommonPrefix(files: string[]): string {
  if (files.length === 0) return '';
  const dirs = files.map((f) => f.substring(0, f.lastIndexOf('/')));
  if (dirs.length === 0) return '';

  let prefix = dirs[0];
  for (const dir of dirs) {
    while (prefix && !dir.startsWith(prefix)) {
      prefix = prefix.substring(0, prefix.lastIndexOf('/'));
    }
  }
  // Require at least 2 path segments for a meaningful label
  // "packages" alone is too generic; "packages/core" is useful
  const segments = prefix.split('/').filter(Boolean);
  return segments.length >= 2 ? prefix : '';
}
