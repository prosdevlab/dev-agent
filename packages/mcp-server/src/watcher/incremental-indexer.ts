/**
 * Incremental Indexer — Connects file watcher events to RepositoryIndexer.
 *
 * Filters changed files to indexable extensions, scans only those files,
 * and applies incremental updates via batchUpsertAndDelete. Maintains a
 * path-to-docID cache for resolving delete targets.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  buildReverseCalleeIndex,
  deserializeGraph,
  type EmbeddingDocument,
  prepareDocumentsForEmbedding,
  type RepositoryIndexer,
  scanRepository,
  serializeGraph,
  updateGraphIncremental,
  updateReverseIndexIncremental,
} from '@prosdevlab/dev-agent-core';

// ── Types ────────────────────────────────────────────────────────────────

export interface IncrementalIndexerConfig {
  repositoryIndexer: RepositoryIndexer;
  repositoryPath: string;
  /** Path to cached dependency-graph.json */
  graphPath?: string;
  logger?: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
}

// ── Indexable file filter ────────────────────────────────────────────────

const INDEXABLE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.go',
  '.md',
  '.markdown',
  '.py',
  '.rs',
]);

function isIndexableFile(filePath: string): boolean {
  return INDEXABLE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

// ── createIncrementalIndexer ─────────────────────────────────────────────

export function createIncrementalIndexer(config: IncrementalIndexerConfig): {
  onChanges: (changed: string[], deleted: string[]) => Promise<void>;
  invalidateCache: () => void;
} {
  const { repositoryIndexer, repositoryPath, graphPath, logger } = config;

  // Path-to-docID cache for resolving deletes
  const pathToDocIds = new Map<string, string[]>();
  let cacheStale = true;

  async function rebuildCache(): Promise<void> {
    const all = await repositoryIndexer.getAll({ limit: 50000 });
    pathToDocIds.clear();
    for (const doc of all) {
      const p = doc.metadata?.path as string | undefined;
      if (!p) continue;
      const ids = pathToDocIds.get(p) ?? [];
      ids.push(doc.id);
      pathToDocIds.set(p, ids);
    }
    cacheStale = false;
  }

  function updateCache(upserts: EmbeddingDocument[]): void {
    for (const doc of upserts) {
      const p = doc.metadata?.path as string | undefined;
      if (!p) continue;
      const ids = pathToDocIds.get(p) ?? [];
      if (!ids.includes(doc.id)) ids.push(doc.id);
      pathToDocIds.set(p, ids);
    }
  }

  async function resolveDeleteIds(deletedPaths: string[]): Promise<string[]> {
    if (deletedPaths.length === 0) return [];
    if (cacheStale) await rebuildCache();

    const ids: string[] = [];
    for (const absPath of deletedPaths) {
      const rel = path.relative(repositoryPath, absPath);
      const docIds = pathToDocIds.get(rel);
      if (docIds) {
        ids.push(...docIds);
        pathToDocIds.delete(rel);
      }
    }
    return ids;
  }

  async function onChanges(changed: string[], deleted: string[]): Promise<void> {
    // 1. Filter changed files to only indexable extensions
    const filteredChanged = changed.filter(isIndexableFile);

    // 2. Scan only changed files
    let upserts: EmbeddingDocument[] = [];
    if (filteredChanged.length > 0) {
      const relativePaths = filteredChanged.map((f) => path.relative(repositoryPath, f));
      const scanResult = await scanRepository({
        repoRoot: repositoryPath,
        include: relativePaths,
        exclude: [],
      });
      upserts = prepareDocumentsForEmbedding(scanResult.documents);
    }

    // 3. Resolve document IDs for deleted files
    const deleteIds = await resolveDeleteIds(deleted);

    // 4. Apply incremental update
    if (upserts.length > 0 || deleteIds.length > 0) {
      await repositoryIndexer.applyIncremental(upserts, deleteIds);
      updateCache(upserts);
      logger?.info(
        `[MCP] Incremental update: ${upserts.length} upserted, ${deleteIds.length} deleted`
      );

      // 5. Update cached dependency graph + reverse index (atomic write)
      if (graphPath) {
        try {
          const json = await fs.readFile(graphPath, 'utf-8');
          const result = deserializeGraph(json);
          if (result) {
            const deletedFiles = deleted.map((f) => path.relative(repositoryPath, f));
            const changedDocs = upserts.map((d) => ({
              id: d.id,
              score: 0,
              metadata: d.metadata,
            }));
            const updatedGraph = updateGraphIncremental(result.graph, changedDocs, deletedFiles);
            const updatedReverse = result.reverseIndex
              ? updateReverseIndexIncremental(result.reverseIndex, changedDocs, deletedFiles)
              : buildReverseCalleeIndex(changedDocs);
            await fs.writeFile(graphPath, serializeGraph(updatedGraph, updatedReverse), 'utf-8');
          }
        } catch {
          // Graph update failed — next full index will fix it
        }
      }
    }
  }

  function invalidateCache(): void {
    cacheStale = true;
  }

  return { onChanges, invalidateCache };
}
