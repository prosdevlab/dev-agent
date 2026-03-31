/**
 * E2E: Force re-index (dev index . --force).
 *
 * Requires a running Antfly server. Guarded by ANTFLY_INTEGRATION=true.
 * Run: ANTFLY_INTEGRATION=true pnpm test -- --testPathPattern e2e-force-reindex
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RepositoryIndexer } from '../indexer';

const RUN_E2E = process.env.ANTFLY_INTEGRATION === 'true';
const describeE2E = RUN_E2E ? describe : describe.skip;

const tmpDir = `/tmp/dev-agent-e2e-force-${Date.now()}`;
const vectorStorePath = path.join(tmpDir, 'vectors');

describeE2E('E2E: Force re-index', () => {
  let indexer: RepositoryIndexer;

  beforeAll(async () => {
    await fs.mkdir(path.join(tmpDir, 'src'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, 'src', 'hello.ts'),
      'export function hello(): string { return "world"; }\n'
    );
    await fs.writeFile(
      path.join(tmpDir, 'src', 'utils.ts'),
      'export function add(a: number, b: number): number { return a + b; }\n'
    );

    indexer = new RepositoryIndexer({
      repositoryPath: tmpDir,
      vectorStorePath,
    });

    await indexer.initialize();
    await indexer.index();

    // Allow Antfly to finish embedding before running queries
    await new Promise((r) => setTimeout(r, 2000));
  }, 60_000);

  afterAll(async () => {
    await indexer.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('initial index has documents', async () => {
    const stats = await indexer.getStats();
    expect(stats).not.toBeNull();
    expect(stats?.documentsIndexed).toBeGreaterThan(0);
  });

  it('force re-index clears and rebuilds', async () => {
    const reindexStats = await indexer.index({ force: true });
    expect(reindexStats.documentsIndexed).toBeGreaterThan(0);
    expect(reindexStats.errors).toHaveLength(0);

    // Wait for Antfly to settle
    await new Promise((r) => setTimeout(r, 1000));

    // Content should still be searchable
    const results = await indexer.search('hello', { limit: 5 });
    expect(results.length).toBeGreaterThan(0);
  }, 60_000);

  it('search works after force re-index', async () => {
    const results = await indexer.search('add', { limit: 5 });
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => String(r.metadata?.path ?? '').includes('utils'))).toBe(true);
  });
});
