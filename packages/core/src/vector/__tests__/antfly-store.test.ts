import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AntflyVectorStore } from '../antfly-store.js';
import type { EmbeddingDocument } from '../types.js';

const ANTFLY_URL = process.env.ANTFLY_URL ?? 'http://localhost:8080/api/v1';
const TABLE = `test-antfly-${Date.now()}`;

// Skip entire suite if antfly is not available
const isAntflyAvailable = async (): Promise<boolean> => {
  try {
    const resp = await fetch(`${ANTFLY_URL}/tables`);
    return resp.ok;
  } catch {
    return false;
  }
};

function makeDocs(count: number, prefix = 'doc'): EmbeddingDocument[] {
  const snippets = [
    'export function authenticate(token: string): boolean { return jwt.verify(token, SECRET); }',
    'export function validateUser(userId: string): Promise<User> { return db.users.findOne({ id: userId }); }',
    'export function handleError(err: Error): Response { logger.error(err); return new Response(err.message, { status: 500 }); }',
    'export async function retryWithBackoff<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> { /* backoff */ }',
    'export function searchDocuments(query: string, limit = 10): Promise<SearchResult[]> { return vectorStore.search(query); }',
    'export class RateLimiter { private tokens: number; consume(): boolean { return this.tokens-- > 0; } }',
    'export class EventBus { private listeners = new Map(); emit(event: string, data: unknown) { /* emit */ } }',
    'export async function healthCheck(): Promise<HealthStatus> { return Promise.all([checkDB(), checkVector()]); }',
    'export function indexRepository(path: string): Promise<void> { return vectorStore.add(scanner.scan(path)); }',
    'export function parseConfig(path: string): Config { return JSON.parse(fs.readFileSync(path, "utf-8")); }',
  ];

  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-${i}`,
    text: snippets[i % snippets.length],
    metadata: { type: 'function', file: `src/${prefix}-${i}.ts`, line: i * 10 },
  }));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe.runIf(await isAntflyAvailable())('AntflyVectorStore', () => {
  let store: AntflyVectorStore;

  beforeAll(async () => {
    store = new AntflyVectorStore({ baseUrl: ANTFLY_URL, table: TABLE });
    await store.initialize();
  }, 30_000);

  afterAll(async () => {
    try {
      await store.clear();
      await store.close();
    } catch {
      // Best-effort cleanup
    }
  });

  it('creates table on initialize (idempotent)', async () => {
    // Second initialize should not throw
    const store2 = new AntflyVectorStore({ baseUrl: ANTFLY_URL, table: TABLE });
    await expect(store2.initialize()).resolves.not.toThrow();
    await store2.close();
  });

  it('inserts and retrieves documents by key', async () => {
    const docs = makeDocs(3);
    await store.add(docs);

    // Wait for antfly to process
    await sleep(3000);

    const result = await store.get('doc-0');
    expect(result).not.toBeNull();
    expect(result!.id).toBe('doc-0');
    expect(result!.text).toContain('authenticate');
    expect(result!.metadata).toHaveProperty('type', 'function');
  }, 15_000);

  it('upserts on duplicate key', async () => {
    const original = await store.get('doc-0');
    expect(original).not.toBeNull();

    // Re-insert same key with different text
    await store.add([
      {
        id: 'doc-0',
        text: 'UPDATED: export function authenticate(token: string, opts?: AuthOptions): boolean { /* v2 */ }',
        metadata: { type: 'function', file: 'src/auth-v2.ts', line: 1 },
      },
    ]);

    await sleep(2000);

    const updated = await store.get('doc-0');
    expect(updated).not.toBeNull();
    expect(updated!.text).toContain('UPDATED');
    expect(updated!.metadata).toHaveProperty('file', 'src/auth-v2.ts');
  }, 15_000);

  it('searches by semantic query', async () => {
    // Insert more docs for better search results
    await store.add(makeDocs(10, 'search'));
    await sleep(5000);

    const results = await store.searchText('authentication and user validation');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toHaveProperty('id');
    expect(results[0]).toHaveProperty('score');
    expect(results[0]).toHaveProperty('metadata');
  }, 20_000);

  it('respects search limit', async () => {
    const results = await store.searchText('authentication function', { limit: 3 });
    expect(results.length).toBeLessThanOrEqual(3);
  }, 10_000);

  it('respects scoreThreshold', async () => {
    const allResults = await store.searchText('authentication');
    const filtered = await store.searchText('authentication', { scoreThreshold: 999 });
    expect(filtered.length).toBe(0);
    expect(allResults.length).toBeGreaterThan(0);
  }, 10_000);

  it('deletes documents', async () => {
    await store.add([
      { id: 'to-delete-1', text: 'temporary document one', metadata: {} },
      { id: 'to-delete-2', text: 'temporary document two', metadata: {} },
    ]);
    await sleep(2000);

    await store.delete(['to-delete-1', 'to-delete-2']);

    const result = await store.get('to-delete-1');
    expect(result).toBeNull();
  }, 15_000);

  it('counts documents', async () => {
    // Ensure data exists
    await store.add(makeDocs(2, 'cnt'));
    await sleep(3000);

    const count = await store.count();
    expect(count).toBeGreaterThan(0);
  }, 15_000);

  it('gets all documents', async () => {
    // Ensure we have data
    const count = await store.count();
    if (count === 0) {
      await store.add(makeDocs(3, 'getall'));
      await sleep(3000);
    }

    const all = await store.getAll();
    expect(all.length).toBeGreaterThan(0);
    expect(all[0]).toHaveProperty('id');
    expect(all[0]).toHaveProperty('score', 1); // Full scan = score 1
    expect(all[0]).toHaveProperty('metadata');
  }, 15_000);

  it('searches by document ID', async () => {
    // Ensure we have data
    const count = await store.count();
    if (count === 0) {
      await store.add(makeDocs(5, 'sbd'));
      await sleep(5000);
    }

    // Find a doc that exists
    const all = await store.getAll({ limit: 1 });
    if (all.length === 0) return; // Skip if still empty

    const results = await store.searchByDocumentId(all[0].id);
    expect(results.length).toBeGreaterThan(0);
  }, 20_000);

  it('returns empty for searchByDocumentId with missing ID', async () => {
    const results = await store.searchByDocumentId('nonexistent-id');
    expect(results).toEqual([]);
  }, 10_000);

  it('returns model info', () => {
    const info = store.getModelInfo();
    expect(info.dimension).toBe(384);
    expect(info.modelName).toBe('BAAI/bge-small-en-v1.5');
  });

  it('returns storage size', async () => {
    const size = await store.getStorageSize();
    expect(size).toBeGreaterThanOrEqual(0);
  }, 10_000);

  it('handles empty table search', async () => {
    // Create a fresh empty table
    const emptyTable = `test-empty-${Date.now()}`;
    const emptyStore = new AntflyVectorStore({ baseUrl: ANTFLY_URL, table: emptyTable });
    await emptyStore.initialize();

    const results = await emptyStore.searchText('anything');
    expect(results).toEqual([]);

    // Cleanup
    await emptyStore.clear();
    await emptyStore.close();
  }, 15_000);

  it('search() with embedding vector throws', async () => {
    await expect(store.search([0.1, 0.2, 0.3])).rejects.toThrow(
      'does not accept pre-computed embeddings'
    );
  });

  it('throws when not initialized', async () => {
    const uninitialized = new AntflyVectorStore({ baseUrl: ANTFLY_URL, table: 'nope' });
    await expect(uninitialized.searchText('test')).rejects.toThrow('not initialized');
    // Empty add is a no-op (early return before assertReady)
    await expect(uninitialized.add([])).resolves.not.toThrow();
    // Non-empty add should throw
    await expect(uninitialized.add(makeDocs(1))).rejects.toThrow('not initialized');
  });

  it('detects model mismatch', async () => {
    const mismatchStore = new AntflyVectorStore({
      baseUrl: ANTFLY_URL,
      table: TABLE,
      model: 'nomic-ai/nomic-embed-text-v1.5', // Different model than the table was created with
    });

    await expect(mismatchStore.initialize()).rejects.toThrow('Model mismatch');
  }, 10_000);

  it('clears all data', async () => {
    await store.clear();

    const count = await store.count();
    expect(count).toBe(0);

    const all = await store.getAll();
    expect(all).toEqual([]);
  }, 15_000);

  it('handles delete with empty array', async () => {
    // Should not throw
    await expect(store.delete([])).resolves.not.toThrow();
  });

  it('handles add with empty array', async () => {
    // Should not throw
    await expect(store.add([])).resolves.not.toThrow();
  });
});
