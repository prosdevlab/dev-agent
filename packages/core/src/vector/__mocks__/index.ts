/**
 * Mock VectorStorage for tests that don't need a real antfly server.
 *
 * Used by indexer, subagent, and CLI tests that test their own logic,
 * not vector storage behavior. The real antfly tests are in antfly-store.test.ts.
 */

import { vi } from 'vitest';

export { type AntflyStoreConfig, AntflyVectorStore } from '../antfly-store.js';
// Re-export real types
export * from '../types.js';

// In-memory document store for mock
const docs = new Map<string, { text: string; metadata: Record<string, unknown> }>();

export class VectorStorage {
  private initialized = false;

  constructor(_config: { storePath: string; embeddingModel?: string; dimension?: number }) {
    // No-op — mock doesn't connect to anything
  }

  async initialize(_options?: { skipEmbedder?: boolean }): Promise<void> {
    this.initialized = true;
  }

  async addDocuments(
    documents: Array<{ id: string; text: string; metadata: Record<string, unknown> }>
  ): Promise<void> {
    for (const doc of documents) {
      docs.set(doc.id, { text: doc.text, metadata: doc.metadata });
    }
  }

  async search(
    _query: string,
    options?: { limit?: number; scoreThreshold?: number }
  ): Promise<Array<{ id: string; score: number; metadata: Record<string, unknown> }>> {
    const limit = options?.limit ?? 10;
    const results = Array.from(docs.entries())
      .slice(0, limit)
      .map(([id, doc]) => ({
        id,
        score: 0.85,
        metadata: doc.metadata,
      }));
    return results;
  }

  async searchByDocumentId(
    documentId: string,
    options?: { limit?: number }
  ): Promise<Array<{ id: string; score: number; metadata: Record<string, unknown> }>> {
    return this.search(documentId, options);
  }

  async getAll(options?: {
    limit?: number;
  }): Promise<Array<{ id: string; score: number; metadata: Record<string, unknown> }>> {
    const limit = options?.limit ?? 10000;
    return Array.from(docs.entries())
      .slice(0, limit)
      .map(([id, doc]) => ({
        id,
        score: 1,
        metadata: doc.metadata,
      }));
  }

  async getDocument(
    id: string
  ): Promise<{ id: string; text: string; metadata: Record<string, unknown> } | null> {
    const doc = docs.get(id);
    if (!doc) return null;
    return { id, ...doc };
  }

  async deleteDocuments(ids: string[]): Promise<void> {
    for (const id of ids) {
      docs.delete(id);
    }
  }

  async clear(): Promise<void> {
    docs.clear();
  }

  async getStats(): Promise<{
    totalDocuments: number;
    storageSize: number;
    dimension: number;
    modelName: string;
  }> {
    return {
      totalDocuments: docs.size,
      storageSize: 0,
      dimension: 384,
      modelName: 'BAAI/bge-small-en-v1.5',
    };
  }

  async optimize(): Promise<void> {
    // no-op
  }

  async close(): Promise<void> {
    this.initialized = false;
  }
}
