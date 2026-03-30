/**
 * Repository Indexer - Orchestrates scanning and storage via Antfly
 *
 * Phase 2: Uses Antfly Linear Merge for full-index (server-side content
 * hashing, dedup, stale doc removal) and batchUpsertAndDelete for
 * incremental updates. No local state file — Antfly is the source of truth.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Logger } from '@prosdevlab/kero';
import type { EventBus } from '../events/types.js';
import { scanRepository } from '../scanner';
import type { EmbeddingDocument, LinearMergeResult, SearchOptions, SearchResult } from '../vector';
import { VectorStorage } from '../vector';
import { StatsAggregator } from './stats-aggregator';
import type {
  DetailedIndexStats,
  IndexError,
  IndexerConfig,
  IndexOptions,
  IndexStats,
  LanguageStats,
  PackageStats,
  SupportedLanguage,
} from './types';
import { getExtensionForLanguage, prepareDocumentsForEmbedding } from './utils';
import { aggregateChangeFrequency, calculateChangeFrequency } from './utils/change-frequency.js';

/**
 * Repository Indexer
 *
 * Full index uses Antfly Linear Merge (content-hashed dedup + range-scoped deletion).
 * Incremental updates use batchUpsertAndDelete (explicit inserts + deletes).
 */
export class RepositoryIndexer {
  private readonly config: Required<
    Pick<IndexerConfig, 'repositoryPath' | 'vectorStorePath' | 'excludePatterns' | 'languages'>
  > &
    Pick<IndexerConfig, 'logger' | 'legacyStatePath'>;
  private vectorStorage: VectorStorage;
  private eventBus?: EventBus;
  private logger?: Logger;

  constructor(config: IndexerConfig, eventBus?: EventBus) {
    this.config = {
      excludePatterns: [],
      languages: [],
      ...config,
    };

    this.vectorStorage = new VectorStorage({
      storePath: this.config.vectorStorePath,
    });

    this.eventBus = eventBus;
    this.logger = config.logger;
  }

  /**
   * Initialize the indexer (initialize vector storage)
   */
  async initialize(options?: { skipEmbedder?: boolean }): Promise<void> {
    await this.vectorStorage.initialize(options);
    await this.cleanupLegacyState();
  }

  /**
   * Index the entire repository using Antfly Linear Merge.
   * Content-hashed: unchanged docs are skipped server-side.
   * Range-scoped deletion: docs for deleted files are auto-removed.
   */
  async index(options: IndexOptions = {}): Promise<IndexStats> {
    const startTime = new Date();
    const errors: IndexError[] = [];

    try {
      if (options.force) {
        options.logger?.info('Force re-index requested, clearing existing vectors');
        await this.vectorStorage.clear();
      }

      // Phase 1: Scan repository
      const onProgress = options.onProgress;
      onProgress?.({
        phase: 'scanning',
        filesProcessed: 0,
        totalFiles: 0,
        documentsIndexed: 0,
        percentComplete: 0,
      });

      const scanResult = await scanRepository({
        repoRoot: this.config.repositoryPath,
        include: options.languages?.map((lang) => `**/*.${getExtensionForLanguage(lang)}`),
        exclude: [...this.config.excludePatterns, ...(options.excludePatterns || [])],
        languages: options.languages,
        logger: options.logger,
        onProgress: (scanProgress) => {
          onProgress?.({
            phase: 'scanning',
            filesProcessed: scanProgress.filesScanned,
            totalFiles: scanProgress.filesTotal,
            documentsIndexed: scanProgress.documentsExtracted,
            percentComplete:
              scanProgress.filesTotal > 0
                ? Math.round((scanProgress.filesScanned / scanProgress.filesTotal) * 100)
                : 0,
          });
        },
      });

      const filesScanned = scanResult.stats.filesScanned;
      const documentsExtracted = scanResult.documents.length;

      // Aggregate detailed statistics
      const statsAggregator = new StatsAggregator();
      for (const doc of scanResult.documents) {
        statsAggregator.addDocument(doc);
      }

      // Phase 2: Prepare documents for embedding
      const logger = options.logger?.child({ component: 'indexer' });
      logger?.info({ documents: documentsExtracted }, 'Preparing documents for embedding');

      onProgress?.({
        phase: 'embedding',
        filesProcessed: filesScanned,
        totalFiles: filesScanned,
        documentsIndexed: 0,
        percentComplete: 33,
      });

      const embeddingDocuments = prepareDocumentsForEmbedding(scanResult.documents);

      // Phase 3: Linear Merge — Antfly deduplicates via content hash
      logger?.info({ documents: embeddingDocuments.length }, 'Starting Linear Merge');

      onProgress?.({
        phase: 'storing',
        filesProcessed: filesScanned,
        totalFiles: filesScanned,
        documentsIndexed: 0,
        totalDocuments: embeddingDocuments.length,
        percentComplete: 66,
      });

      let mergeResult: LinearMergeResult;
      try {
        mergeResult = await this.vectorStorage.linearMerge(
          embeddingDocuments,
          undefined,
          (processed, total) => {
            onProgress?.({
              phase: 'storing',
              filesProcessed: filesScanned,
              totalFiles: filesScanned,
              documentsIndexed: processed,
              totalDocuments: total,
              percentComplete: Math.round((processed / total) * 100),
            });
          }
        );
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        errors.push({
          type: 'storage',
          message: `Linear Merge failed: ${errorMessage}`,
          error: error instanceof Error ? error : undefined,
          timestamp: new Date(),
        });
        throw error;
      }

      const documentsIndexed = mergeResult.upserted + mergeResult.skipped;

      logger?.info(
        {
          upserted: mergeResult.upserted,
          skipped: mergeResult.skipped,
          deleted: mergeResult.deleted,
        },
        `Linear Merge complete: ${mergeResult.upserted} upserted, ${mergeResult.skipped} unchanged, ${mergeResult.deleted} removed`
      );

      // Phase 4: Complete
      const endTime = new Date();
      onProgress?.({
        phase: 'complete',
        filesProcessed: filesScanned,
        totalFiles: filesScanned,
        documentsIndexed,
        percentComplete: 100,
      });

      const detailedStats = statsAggregator.getDetailedStats();

      const stats: DetailedIndexStats = {
        filesScanned,
        documentsExtracted,
        documentsIndexed,
        vectorsStored: documentsIndexed,
        duration: endTime.getTime() - startTime.getTime(),
        errors,
        startTime,
        endTime,
        repositoryPath: this.config.repositoryPath,
        ...detailedStats,
        statsMetadata: {
          isIncremental: false,
          lastFullIndex: endTime,
          lastUpdate: endTime,
          incrementalUpdatesSince: 0,
        },
      };

      // Emit index.updated event
      if (this.eventBus) {
        void this.eventBus.emit(
          'index.updated',
          {
            type: 'code',
            documentsCount: documentsIndexed,
            duration: stats.duration,
            path: this.config.repositoryPath,
            stats,
            isIncremental: false,
          },
          { waitForHandlers: false }
        );
      }

      return stats;
    } catch (error) {
      if (!errors.some((e) => e.type === 'storage')) {
        errors.push({
          type: 'scanner',
          message: `Indexing failed: ${error instanceof Error ? error.message : String(error)}`,
          error: error instanceof Error ? error : undefined,
          timestamp: new Date(),
        });
      }
      throw error;
    }
  }

  /**
   * Apply incremental updates (used by file watcher and restart catchup).
   * Uses batchUpsertAndDelete — NOT Linear Merge (safe for partial updates).
   */
  async applyIncremental(upserts: EmbeddingDocument[], deleteIds: string[]): Promise<void> {
    await this.vectorStorage.batchUpsertAndDelete(upserts, deleteIds);
  }

  /**
   * Search the indexed repository
   */
  async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    return this.vectorStorage.search(query, options);
  }

  /**
   * Find similar documents to a given document by ID
   */
  async searchByDocumentId(documentId: string, options?: SearchOptions): Promise<SearchResult[]> {
    return this.vectorStorage.searchByDocumentId(documentId, options);
  }

  /**
   * Get all indexed documents (full scan, no ranking)
   */
  async getAll(options?: { limit?: number }): Promise<SearchResult[]> {
    return this.vectorStorage.getAll(options);
  }

  /**
   * Get indexing statistics from Antfly
   */
  async getStats(): Promise<DetailedIndexStats | null> {
    const vectorStats = await this.vectorStorage.getStats();
    if (vectorStats.totalDocuments === 0) {
      return null;
    }

    return {
      filesScanned: 0, // Not tracked without state file
      documentsExtracted: vectorStats.totalDocuments,
      documentsIndexed: vectorStats.totalDocuments,
      vectorsStored: vectorStats.totalDocuments,
      duration: 0,
      errors: [],
      startTime: new Date(),
      endTime: new Date(),
      repositoryPath: this.config.repositoryPath,
      statsMetadata: {
        isIncremental: false,
        lastFullIndex: new Date(),
        lastUpdate: new Date(),
        incrementalUpdatesSince: 0,
      },
    };
  }

  /**
   * Get the underlying VectorStorage instance.
   * Used by StatusAdapter for direct Antfly stats access.
   */
  getVectorStorage(): VectorStorage {
    return this.vectorStorage;
  }

  /**
   * Close the indexer and cleanup resources
   */
  async close(): Promise<void> {
    await this.vectorStorage.close();
  }

  /**
   * Enrich language stats with change frequency data
   * Non-blocking: returns original stats if git analysis fails
   */
  async enrichLanguageStatsWithChangeFrequency(
    byLanguage?: Partial<Record<SupportedLanguage, LanguageStats>>
  ): Promise<Partial<Record<SupportedLanguage, LanguageStats>> | undefined> {
    if (!byLanguage) return byLanguage;

    try {
      const changeFreq = await calculateChangeFrequency({
        repositoryPath: this.config.repositoryPath,
        maxCommits: 1000,
      });

      const enriched: Partial<Record<SupportedLanguage, LanguageStats>> = {};

      for (const [lang, langStats] of Object.entries(byLanguage) as Array<
        [SupportedLanguage, LanguageStats]
      >) {
        const langExtensions = this.getExtensionsForLanguage(lang);
        const langFiles = new Map(
          [...changeFreq.entries()].filter(([filePath]) =>
            langExtensions.some((ext) => filePath.endsWith(ext))
          )
        );

        const aggregate = aggregateChangeFrequency(langFiles);

        enriched[lang] = {
          ...langStats,
          avgCommitsPerFile: aggregate.avgCommitsPerFile,
          lastModified: aggregate.lastModified ?? undefined,
        };
      }

      return enriched;
    } catch {
      return byLanguage;
    }
  }

  /**
   * Enrich package stats with change frequency data
   */
  async enrichPackageStatsWithChangeFrequency(
    byPackage?: Record<string, PackageStats>
  ): Promise<Record<string, PackageStats> | undefined> {
    if (!byPackage) return byPackage;

    try {
      const changeFreq = await calculateChangeFrequency({
        repositoryPath: this.config.repositoryPath,
        maxCommits: 1000,
      });

      const enriched: Record<string, PackageStats> = {};

      for (const [pkgPath, pkgStats] of Object.entries(byPackage)) {
        const pkgFiles = new Map(
          [...changeFreq.entries()].filter(([filePath]) => filePath.startsWith(pkgPath))
        );

        const aggregate = aggregateChangeFrequency(pkgFiles);

        enriched[pkgPath] = {
          ...pkgStats,
          totalCommits: aggregate.totalCommits,
          lastModified: aggregate.lastModified ?? undefined,
        };
      }

      return enriched;
    } catch {
      return byPackage;
    }
  }

  private getExtensionsForLanguage(language: SupportedLanguage): string[] {
    const extensionMap: Record<SupportedLanguage, string[]> = {
      typescript: ['.ts', '.tsx'],
      javascript: ['.js', '.jsx', '.mjs', '.cjs'],
      go: ['.go'],
      markdown: ['.md', '.markdown'],
    };
    return extensionMap[language] || [];
  }

  /**
   * Detect and remove legacy indexer-state.json files from Phase 1.
   * Checks both centralized and repo-relative paths.
   */
  private async cleanupLegacyState(): Promise<void> {
    const paths = [
      this.config.legacyStatePath,
      path.join(this.config.repositoryPath, '.dev-agent/indexer-state.json'),
    ].filter(Boolean) as string[];

    for (const statePath of paths) {
      try {
        await fs.access(statePath);
        this.logger?.info(
          `Migrating to new indexing system — removing legacy ${path.basename(statePath)}`
        );
        await fs.rm(statePath);
      } catch {
        // Not found — normal
      }
    }
  }
}

export * from './types';
