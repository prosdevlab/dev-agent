/**
 * Vector store implementation using Antfly
 *
 * Replaces LanceDBVectorStore + TransformersEmbedder with a single class.
 * Antfly handles embedding generation (via Termite), storage, and hybrid search
 * (BM25 + vector + RRF) internally.
 */

import { AntflyClient } from '@antfly/sdk';
import type {
  EmbeddingDocument,
  SearchOptions,
  SearchResult,
  SearchResultMetadata,
  VectorStore,
} from './types.js';

// ── Antfly response types ──
// Local types for the SDK boundary. The SDK is auto-generated from OpenAPI;
// these provide type safety without coupling to internal SDK types.

interface AntflyHit {
  _id: string;
  _score: number;
  _index_scores?: Record<string, number>;
  _source?: Record<string, unknown>;
}

/** SDK query() returns this shape (already unwrapped from the REST responses[] wrapper) */
interface AntflyQueryResponse {
  hits: { hits: AntflyHit[] | null; total: number };
  status: number;
  took?: number;
}

interface AntflyTableInfo {
  name: string;
  indexes: Record<
    string,
    {
      type: string;
      dimension?: number;
      embedder?: { provider: string; model: string };
    }
  >;
  storage_status?: { disk_usage: number };
}

/** Known embedding model dimensions */
const MODEL_DIMENSIONS: Record<string, number> = {
  'BAAI/bge-small-en-v1.5': 384,
  'mxbai-embed-large-v1': 1024,
  'nomic-ai/nomic-embed-text-v1.5': 768,
  'openai/clip-vit-base-patch32': 512,
};

/** Result of a Linear Merge operation */
export interface LinearMergeResult {
  upserted: number;
  skipped: number;
  deleted: number;
  took?: number; // nanoseconds
}

const DEFAULT_MODEL = 'BAAI/bge-small-en-v1.5';
const DEFAULT_BASE_URL = process.env.ANTFLY_URL ?? 'http://localhost:18080/api/v1';
const BATCH_SIZE = 500;

/**
 * Configuration for AntflyVectorStore
 */
export interface AntflyStoreConfig {
  baseUrl?: string;
  table: string;
  indexName?: string;
  template?: string;
  model?: string;
}

/**
 * Vector store backed by Antfly.
 *
 * Antfly handles embedding generation (Termite), vector storage,
 * BM25 full-text indexing, and hybrid search with RRF fusion.
 */
export class AntflyVectorStore implements VectorStore {
  readonly path: string;
  private readonly cfg: Required<AntflyStoreConfig>;
  private readonly client: AntflyClient;
  private initialized = false;

  constructor(config: AntflyStoreConfig) {
    this.cfg = {
      baseUrl: config.baseUrl ?? DEFAULT_BASE_URL,
      table: config.table,
      indexName: config.indexName ?? 'content',
      template: config.template ?? '{{text}}',
      model: config.model ?? DEFAULT_MODEL,
    };
    this.path = `${this.cfg.baseUrl}/${this.cfg.table}`;
    this.client = new AntflyClient({ baseUrl: this.cfg.baseUrl });
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const tableNames = await this.listTableNames();

      if (tableNames.includes(this.cfg.table)) {
        await this.checkModelMismatch();
      } else {
        await this.createTableWithIndex();
      }

      this.initialized = true;
    } catch (error) {
      if (error instanceof Error && error.message.includes('Model mismatch')) throw error;
      throw new Error(
        `Failed to initialize Antfly store (${this.cfg.table}): ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Add documents. Embeddings param is ignored — Antfly auto-embeds via Termite.
   */
  async add(documents: EmbeddingDocument[], _embeddings?: number[][]): Promise<void> {
    if (documents.length === 0) return;
    this.assertReady();

    for (let i = 0; i < documents.length; i += BATCH_SIZE) {
      const batch = documents.slice(i, i + BATCH_SIZE);
      const inserts: Record<string, Record<string, unknown>> = {};
      for (const doc of batch) {
        inserts[doc.id] = { text: doc.text, metadata: JSON.stringify(doc.metadata) };
      }

      try {
        await this.batchOp({ inserts });
      } catch (error) {
        throw new Error(
          `Failed to add documents (batch ${Math.floor(i / BATCH_SIZE) + 1}): ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }

  /**
   * VectorStore interface method — throws. Use searchText() instead.
   */
  async search(_queryEmbedding: number[], _options?: SearchOptions): Promise<SearchResult[]> {
    throw new Error(
      'AntflyVectorStore.search() does not accept pre-computed embeddings. ' +
        'Use searchText(query, options) instead — Antfly handles embedding internally.'
    );
  }

  /**
   * Search by text using Antfly's hybrid search (BM25 + vector + RRF).
   */
  async searchText(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    this.assertReady();
    const { limit = 10, scoreThreshold = 0 } = options;

    try {
      const resp = await this.queryTable({
        semantic_search: query,
        indexes: [this.cfg.indexName],
        limit,
      });

      return this.extractHits(resp)
        .map((hit) => ({
          id: hit._id,
          score: hit._score,
          metadata: this.parseMetadata(hit._source),
        }))
        .filter((r) => r.score >= scoreThreshold);
    } catch (error) {
      throw new Error(
        `Failed to search: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async get(id: string): Promise<EmbeddingDocument | null> {
    this.assertReady();

    try {
      const result = (await this.client.tables.lookup(this.cfg.table, id)) as
        | Record<string, unknown>
        | undefined;
      if (!result) return null;

      return {
        id,
        text: (result.text as string) ?? '',
        metadata: this.parseRawMetadata(result.metadata),
      };
    } catch (error) {
      if (String(error).includes('404') || String(error).includes('not found')) return null;
      throw new Error(
        `Failed to get document: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async delete(ids: string[]): Promise<void> {
    this.assertReady();
    if (ids.length === 0) return;

    try {
      await this.batchOp({ deletes: ids });
    } catch (error) {
      throw new Error(
        `Failed to delete documents: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async count(): Promise<number> {
    this.assertReady();

    try {
      const resp = await this.queryTable({ limit: 1 });
      return resp?.hits?.total ?? 0;
    } catch {
      // Empty or newly-created table may return unexpected shapes
      return 0;
    }
  }

  async getAll(options: { limit?: number } = {}): Promise<SearchResult[]> {
    this.assertReady();
    const { limit = 10000 } = options;

    try {
      const resp = await this.queryTable({ limit });
      return this.extractHits(resp).map((hit) => ({
        id: hit._id,
        score: 1,
        metadata: this.parseMetadata(hit._source),
      }));
    } catch (error) {
      throw new Error(
        `Failed to get all documents: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async searchByDocumentId(
    documentId: string,
    options: SearchOptions = {}
  ): Promise<SearchResult[]> {
    this.assertReady();
    const doc = await this.get(documentId);
    if (!doc) return [];
    return this.searchText(doc.text, options);
  }

  async clear(): Promise<void> {
    this.assertReady();

    try {
      await this.client.tables.drop(this.cfg.table);
      await this.createTableWithIndex();
    } catch (error) {
      throw new Error(
        `Failed to clear store: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async optimize(): Promise<void> {
    // Antfly manages compaction internally
  }

  async close(): Promise<void> {
    this.initialized = false;
  }

  getModelInfo(): { dimension: number; modelName: string } {
    return {
      dimension: MODEL_DIMENSIONS[this.cfg.model] ?? 384,
      modelName: this.cfg.model,
    };
  }

  async getStorageSize(): Promise<number> {
    try {
      const info = await this.getTableInfo();
      return info?.storage_status?.disk_usage ?? 0;
    } catch {
      return 0;
    }
  }

  /**
   * Linear Merge: send all documents, Antfly deduplicates via content hash.
   * Absent keys within the batch's key range are deleted automatically.
   *
   * Use ONLY for full-index operations. For incremental updates, use batchUpsertAndDelete().
   * Records must be sorted lexicographically by key (handled internally).
   */
  async linearMerge(
    documents: EmbeddingDocument[],
    lastMergedId = '',
    onProgress?: (processed: number, total: number) => void
  ): Promise<LinearMergeResult> {
    if (documents.length === 0) {
      return { upserted: 0, skipped: 0, deleted: 0 };
    }
    this.assertReady();

    const sorted = [...documents].sort((a, b) => a.id.localeCompare(b.id));
    const records: Record<string, unknown> = {};
    for (const doc of sorted) {
      records[doc.id] = { text: doc.text, metadata: JSON.stringify(doc.metadata) };
    }

    const total = documents.length;
    const totals: LinearMergeResult = { upserted: 0, skipped: 0, deleted: 0 };
    let cursor = lastMergedId;

    try {
      const raw = this.client.getRawClient();
      do {
        const result = await raw.POST('/tables/{tableName}/merge', {
          params: { path: { tableName: this.cfg.table } },
          body: { records, last_merged_id: cursor },
        });

        if (result.error) {
          throw new Error(
            typeof result.error === 'object' && 'error' in result.error
              ? String((result.error as Record<string, unknown>).error)
              : String(result.error)
          );
        }

        const data = result.data;
        if (!data) {
          throw new Error('Linear Merge returned no data');
        }

        totals.upserted += data.upserted ?? 0;
        totals.skipped += data.skipped ?? 0;
        totals.deleted += data.deleted ?? 0;
        if (data.took) totals.took = (totals.took ?? 0) + data.took;

        onProgress?.(totals.upserted + totals.skipped, total);

        if (data.status === 'partial' && data.next_cursor) {
          cursor = data.next_cursor;
        } else {
          break;
        }
        // biome-ignore lint/correctness/noConstantCondition: pagination loop exits via break
      } while (true);

      return totals;
    } catch (error) {
      throw new Error(
        `Linear Merge failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Combined upsert + delete in a single batchOp call.
   * Safe for incremental updates and concurrent calls.
   */
  async batchUpsertAndDelete(upserts: EmbeddingDocument[], deleteIds: string[]): Promise<void> {
    if (upserts.length === 0 && deleteIds.length === 0) return;
    this.assertReady();

    const body: Record<string, unknown> = {};

    if (upserts.length > 0) {
      const inserts: Record<string, Record<string, unknown>> = {};
      for (const doc of upserts) {
        inserts[doc.id] = { text: doc.text, metadata: JSON.stringify(doc.metadata) };
      }
      body.inserts = inserts;
    }

    if (deleteIds.length > 0) {
      body.deletes = deleteIds;
    }

    try {
      await this.batchOp(body);
    } catch (error) {
      throw new Error(
        `batchUpsertAndDelete failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // ── SDK boundary layer ──
  // These methods isolate the SDK's loosely-typed API behind our own types.

  private async listTableNames(): Promise<string[]> {
    const raw = await this.client.tables.list();
    const tables = raw as unknown as AntflyTableInfo[] | string[];
    if (!Array.isArray(tables)) return [];
    return tables.map((t) => (typeof t === 'string' ? t : t.name));
  }

  private async createTableWithIndex(): Promise<void> {
    const body = {
      indexes: {
        [this.cfg.indexName]: {
          type: 'embeddings',
          template: this.cfg.template,
          embedder: { provider: 'termite', model: this.cfg.model },
        },
      },
    };
    await (this.client.tables.create as Function)(this.cfg.table, body);
  }

  private async getTableInfo(): Promise<AntflyTableInfo | null> {
    const raw = await this.client.tables.get(this.cfg.table);
    return (raw ?? null) as AntflyTableInfo | null;
  }

  private async queryTable(params: Record<string, unknown>): Promise<AntflyQueryResponse> {
    const raw = await (this.client.query as Function)({
      table: this.cfg.table,
      ...params,
    });
    return raw as AntflyQueryResponse;
  }

  private async batchOp(body: Record<string, unknown>): Promise<void> {
    await (this.client.tables.batch as Function)(this.cfg.table, body);
  }

  // ── Helpers ──

  private assertReady(): void {
    if (!this.initialized) {
      throw new Error('Store not initialized. Call initialize() first.');
    }
  }

  private async checkModelMismatch(): Promise<void> {
    try {
      const info = await this.getTableInfo();
      const embeddingIndex = info?.indexes?.[this.cfg.indexName];

      if (embeddingIndex?.embedder?.model && embeddingIndex.embedder.model !== this.cfg.model) {
        throw new Error(
          `Model mismatch: table "${this.cfg.table}" uses "${embeddingIndex.embedder.model}" ` +
            `but config specifies "${this.cfg.model}". ` +
            'Run `dev index --force` to re-index with the new model.'
        );
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('Model mismatch')) throw error;
    }
  }

  private extractHits(resp: AntflyQueryResponse): AntflyHit[] {
    return resp?.hits?.hits ?? [];
  }

  private parseMetadata(source: Record<string, unknown> | undefined): SearchResultMetadata {
    if (!source) return {};

    const metadataField = source.metadata;
    if (typeof metadataField === 'string') {
      try {
        return JSON.parse(metadataField) as SearchResultMetadata;
      } catch {
        return {};
      }
    }
    if (metadataField && typeof metadataField === 'object') {
      return metadataField as SearchResultMetadata;
    }

    const { text: _, metadata: __, _timestamp: ___, ...rest } = source;
    return rest as SearchResultMetadata;
  }

  private parseRawMetadata(metadata: unknown): Record<string, unknown> {
    if (typeof metadata === 'string') {
      try {
        return JSON.parse(metadata);
      } catch {
        return {};
      }
    }
    if (metadata && typeof metadata === 'object') {
      return metadata as Record<string, unknown>;
    }
    return {};
  }
}
