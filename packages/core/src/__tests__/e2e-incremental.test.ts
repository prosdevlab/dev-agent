/**
 * E2E: Incremental indexing via applyIncremental.
 *
 * Requires a running Antfly server. Guarded by ANTFLY_INTEGRATION=true.
 * Run: ANTFLY_INTEGRATION=true pnpm test -- --testPathPattern e2e-incremental
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RepositoryIndexer } from '../indexer';
import { prepareDocumentsForEmbedding } from '../indexer/utils';
import { scanRepository } from '../scanner';

const RUN_E2E = process.env.ANTFLY_INTEGRATION === 'true';
const describeE2E = RUN_E2E ? describe : describe.skip;

const tmpDir = `/tmp/dev-agent-e2e-incremental-${Date.now()}`;
const vectorStorePath = path.join(tmpDir, 'vectors');

describeE2E('E2E: Incremental indexing', () => {
  let indexer: RepositoryIndexer;
  const testFile = path.join(tmpDir, 'src', 'test-function-xyz.ts');

  beforeAll(async () => {
    await fs.mkdir(path.join(tmpDir, 'src'), { recursive: true });
    await fs.writeFile(testFile, 'export function testFunctionXyz(): string { return "hello"; }\n');

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

  it('newly indexed function is searchable', async () => {
    const results = await indexer.search('testFunctionXyz', { limit: 5 });
    expect(results.length).toBeGreaterThan(0);
  });

  it('updated function content is re-indexed after applyIncremental', async () => {
    await fs.writeFile(
      testFile,
      'export function testFunctionXyz(): string { return "updated content unique abc123"; }\n'
    );

    const scanResult = await scanRepository({
      repoRoot: tmpDir,
      include: ['src/test-function-xyz.ts'],
    });
    const upserts = prepareDocumentsForEmbedding(scanResult.documents);
    await indexer.applyIncremental(upserts, []);

    // Wait for Antfly to index
    await new Promise((r) => setTimeout(r, 1000));

    const results = await indexer.search('unique abc123', { limit: 5 });
    expect(results.some((r) => String(r.metadata?.path ?? '').includes('test-function-xyz'))).toBe(
      true
    );
  });

  it('deleted file docs are removed after applyIncremental', async () => {
    // Find doc IDs for the test file
    const all = await indexer.getAll({ limit: 1000 });
    const fileDocIds = all
      .filter((r) => String(r.metadata?.path ?? '').includes('test-function-xyz'))
      .map((r) => r.id);

    expect(fileDocIds.length).toBeGreaterThan(0);

    // Delete via applyIncremental
    await indexer.applyIncremental([], fileDocIds);

    // Wait for Antfly
    await new Promise((r) => setTimeout(r, 1000));

    const results = await indexer.search('testFunctionXyz', { limit: 5 });
    const stillPresent = results.some((r) =>
      String(r.metadata?.path ?? '').includes('test-function-xyz')
    );
    expect(stillPresent).toBe(false);
  });

  it('incremental update completes in under 3 seconds', async () => {
    // Re-create the file for this timing test
    await fs.writeFile(testFile, 'export function timingTest(): number { return 42; }\n');

    const scanResult = await scanRepository({
      repoRoot: tmpDir,
      include: ['src/test-function-xyz.ts'],
    });
    const upserts = prepareDocumentsForEmbedding(scanResult.documents);

    const start = Date.now();
    await indexer.applyIncremental(upserts, []);
    const duration = Date.now() - start;

    expect(duration).toBeLessThan(3000);
  });
});
