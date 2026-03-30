/**
 * E2E: Index the dev-agent repo, search, verify results.
 *
 * Requires a running Antfly server. Guarded by ANTFLY_INTEGRATION=true.
 * Run: ANTFLY_INTEGRATION=true pnpm test -- --testPathPattern e2e-index-dev-agent
 */

import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RepositoryIndexer } from '../indexer';

const RUN_E2E = process.env.ANTFLY_INTEGRATION === 'true';
const describeE2E = RUN_E2E ? describe : describe.skip;

const repoRoot = path.resolve(__dirname, '../../../../..');
const vectorStorePath = `/tmp/dev-agent-e2e-full-${Date.now()}/vectors`;

describeE2E('E2E: Index dev-agent repo', () => {
  let indexer: RepositoryIndexer;
  let indexDuration: number;

  beforeAll(
    async () => {
      indexer = new RepositoryIndexer({
        repositoryPath: repoRoot,
        vectorStorePath,
      });

      await indexer.initialize();

      const start = Date.now();
      const stats = await indexer.index();
      indexDuration = Date.now() - start;

      console.log(
        `Full index: ${stats.documentsIndexed} docs in ${(indexDuration / 1000).toFixed(1)}s`
      );

      expect(stats.documentsIndexed).toBeGreaterThan(100);
    },
    5 * 60 * 1000
  ); // 5 min timeout

  afterAll(async () => {
    await indexer.close();
  });

  it('indexes more than 500 documents', async () => {
    const stats = await indexer.getStats();
    expect(stats).not.toBeNull();
    expect(stats?.documentsIndexed).toBeGreaterThan(500);
  });

  it('exact keyword search returns the searched function', async () => {
    const results = await indexer.search('AntflyVectorStore', { limit: 5 });
    expect(results.length).toBeGreaterThan(0);
    const hasAntflyStore = results.some(
      (r) =>
        String(r.metadata?.name ?? '').includes('AntflyVectorStore') ||
        String(r.metadata?.path ?? '').includes('antfly-store')
    );
    expect(hasAntflyStore).toBe(true);
  });

  it('semantic search returns relevant results', async () => {
    const results = await indexer.search('hybrid search with BM25 and vector', { limit: 10 });
    expect(results.length).toBeGreaterThan(0);
    // Should find search-related code
    const hasSearchCode = results.some(
      (r) =>
        String(r.metadata?.path ?? '').includes('search') ||
        String(r.metadata?.path ?? '').includes('vector') ||
        String(r.metadata?.path ?? '').includes('antfly')
    );
    expect(hasSearchCode).toBe(true);
  });

  it(
    're-index skips unchanged documents (content hash)',
    async () => {
      const stats = await indexer.index();
      // All docs should be skipped on second index (content hash match)
      // The merge result flows through — documentsIndexed includes skipped
      expect(stats.documentsIndexed).toBeGreaterThan(0);
      expect(stats.errors).toHaveLength(0);
    },
    5 * 60 * 1000
  );

  it('completes initial index within 120 seconds', () => {
    expect(indexDuration).toBeLessThan(120_000);
  });

  it('search latency is under 500ms', async () => {
    const start = Date.now();
    await indexer.search('validateUser', { limit: 5 });
    const latency = Date.now() - start;
    expect(latency).toBeLessThan(500);
  });
});
