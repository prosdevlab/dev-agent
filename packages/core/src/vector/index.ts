/**
 * Vector storage system
 *
 * Backed by Antfly — handles embedding generation, vector storage,
 * and hybrid search (BM25 + vector + RRF) internally.
 */

export * from './antfly-store.js';
export * from './types.js';

import {
  type AntflyStoreConfig,
  AntflyVectorStore,
  type LinearMergeResult,
} from './antfly-store.js';
import type {
  EmbeddingDocument,
  SearchOptions,
  SearchResult,
  VectorStats,
  VectorStorageConfig,
} from './types.js';

/**
 * Derives an antfly table name from a storePath.
 *
 * storePath examples:
 *   ~/.dev-agent/indexes/my-project/vectors       → dev-agent-my-project-code
 *   ~/.dev-agent/indexes/my-project/vectors-git    → dev-agent-my-project-git
 *   ~/.dev-agent/indexes/my-project/vectors-github → dev-agent-my-project-github
 */
function deriveTableName(storePath: string): string {
  const parts = storePath.replace(/\/$/, '').split('/');
  const last = parts.at(-1) ?? 'code';
  const projectDir = parts.at(-2) ?? 'default';

  // Sanitize for antfly table names (alphanumeric + hyphens)
  const project = projectDir.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();

  if (last === 'vectors') return `dev-agent-${project}-code`;
  if (last === 'vectors-git') return `dev-agent-${project}-git`;
  if (last === 'vectors-github') return `dev-agent-${project}-github`;
  return `dev-agent-${project}-${last.replace(/[^a-zA-Z0-9-]/g, '-')}`;
}

/**
 * High-level vector storage API.
 *
 * Wraps AntflyVectorStore and preserves the same public interface that
 * all consumers (indexers, services, CLI, MCP) depend on.
 *
 * With Antfly, there is no separate embedding step — documents are
 * embedded automatically on insert and queries use hybrid search.
 */
export class VectorStorage {
  private readonly store: AntflyVectorStore;
  private initialized = false;

  constructor(config: VectorStorageConfig) {
    const antflyConfig: AntflyStoreConfig = {
      table: deriveTableName(config.storePath),
      model: config.embeddingModel,
    };

    this.store = new AntflyVectorStore(antflyConfig);
  }

  /**
   * Initialize the storage.
   *
   * The skipEmbedder option is accepted for backward compatibility but
   * has no effect — Antfly handles embeddings internally.
   */
  async initialize(_options?: { skipEmbedder?: boolean }): Promise<void> {
    if (this.initialized) return;
    await this.store.initialize();
    this.initialized = true;
  }

  /**
   * Add documents (Antfly generates embeddings automatically via Termite)
   */
  async addDocuments(documents: EmbeddingDocument[]): Promise<void> {
    this.assertReady();
    if (documents.length === 0) return;
    await this.store.add(documents);
  }

  /**
   * Search using hybrid search (BM25 + vector + RRF)
   */
  async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    this.assertReady();
    return this.store.searchText(query, options);
  }

  /**
   * Find documents similar to a given document by ID
   */
  async searchByDocumentId(documentId: string, options?: SearchOptions): Promise<SearchResult[]> {
    this.assertReady();
    return this.store.searchByDocumentId(documentId, options);
  }

  /**
   * Get all documents without semantic search (full scan)
   */
  async getAll(options?: { limit?: number }): Promise<SearchResult[]> {
    this.assertReady();
    return this.store.getAll(options);
  }

  /**
   * Get a document by ID
   */
  async getDocument(id: string): Promise<EmbeddingDocument | null> {
    this.assertReady();
    return this.store.get(id);
  }

  /**
   * Delete documents by ID
   */
  async deleteDocuments(ids: string[]): Promise<void> {
    this.assertReady();
    await this.store.delete(ids);
  }

  /**
   * Linear Merge: full-index dedup via Antfly server-side content hashing.
   * Use ONLY for full-index. Incremental paths must use batchUpsertAndDelete().
   */
  async linearMerge(
    documents: EmbeddingDocument[],
    lastMergedId?: string
  ): Promise<LinearMergeResult> {
    this.assertReady();
    return this.store.linearMerge(documents, lastMergedId);
  }

  /**
   * Combined upsert + delete for incremental updates (watcher, restart catchup).
   * Safe for concurrent calls.
   */
  async batchUpsertAndDelete(upserts: EmbeddingDocument[], deleteIds: string[]): Promise<void> {
    this.assertReady();
    await this.store.batchUpsertAndDelete(upserts, deleteIds);
  }

  /**
   * Clear all documents (destructive — used for force re-indexing)
   */
  async clear(): Promise<void> {
    this.assertReady();
    await this.store.clear();
  }

  /**
   * Get statistics about the vector store
   */
  async getStats(): Promise<VectorStats> {
    this.assertReady();
    const modelInfo = this.store.getModelInfo();
    const totalDocuments = await this.store.count();
    const storageSize = await this.store.getStorageSize();

    return {
      totalDocuments,
      storageSize,
      dimension: modelInfo.dimension,
      modelName: modelInfo.modelName,
    };
  }

  /**
   * Optimize the store (no-op for Antfly — manages compaction internally)
   */
  async optimize(): Promise<void> {
    this.assertReady();
    await this.store.optimize();
  }

  /**
   * Close the storage
   */
  async close(): Promise<void> {
    await this.store.close();
    this.initialized = false;
  }

  private assertReady(): void {
    if (!this.initialized) {
      throw new Error('VectorStorage not initialized. Call initialize() first.');
    }
  }
}
