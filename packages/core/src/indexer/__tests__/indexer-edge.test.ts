import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Use mock VectorStorage (no antfly server needed)
vi.mock('../../vector/index');

import { RepositoryIndexer } from '../index';

/**
 * Edge case tests focused on increasing branch coverage
 */
describe('RepositoryIndexer - Edge Case Coverage', () => {
  let testDir: string;

  beforeAll(async () => {
    testDir = path.join(os.tmpdir(), `indexer-edge-coverage-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
  }, 60000);

  afterAll(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('should handle document with no language info', async () => {
    const repoDir = path.join(testDir, 'no-lang');
    await fs.mkdir(repoDir, { recursive: true });

    // Create file with unknown extension
    await fs.writeFile(path.join(repoDir, 'file.unknown'), 'content', 'utf-8');

    const indexer = new RepositoryIndexer({
      repositoryPath: repoDir,
      vectorStorePath: path.join(testDir, 'no-lang.lance'),
    });

    await indexer.initialize();

    const stats = await indexer.index();

    // Should handle files with no/unknown language
    expect(stats.duration).toBeGreaterThanOrEqual(0);

    await indexer.close();
  });

  it('should handle progress callback at different stages', async () => {
    const repoDir = path.join(testDir, 'progress-stages');
    await fs.mkdir(repoDir, { recursive: true });

    for (let i = 0; i < 10; i++) {
      await fs.writeFile(path.join(repoDir, `file${i}.ts`), `export const v${i} = ${i};`, 'utf-8');
    }

    const progressUpdates: Array<{ phase: string; percent: number }> = [];

    const indexer = new RepositoryIndexer({
      repositoryPath: repoDir,
      vectorStorePath: path.join(testDir, 'progress-stages.lance'),
    });

    await indexer.initialize();

    await indexer.index({
      onProgress: (progress) => {
        progressUpdates.push({
          phase: progress.phase,
          percent: progress.percentComplete,
        });
      },
    });

    // Should have multiple progress updates
    expect(progressUpdates.length).toBeGreaterThan(0);

    // Should reach 100%
    const hasComplete = progressUpdates.some((p) => p.percent === 100);
    expect(hasComplete).toBe(true);

    await indexer.close();
  });

  it('should handle empty repository for index', async () => {
    const repoDir = path.join(testDir, 'empty-repo');
    await fs.mkdir(repoDir, { recursive: true });

    const indexer = new RepositoryIndexer({
      repositoryPath: repoDir,
      vectorStorePath: path.join(testDir, 'empty-repo.lance'),
    });

    await indexer.initialize();

    const stats = await indexer.index();
    expect(stats.filesScanned).toBe(0);
    expect(stats.documentsIndexed).toBe(0);

    await indexer.close();
  });

  it('should handle search after indexing', async () => {
    const repoDir = path.join(testDir, 'search-test');
    await fs.mkdir(repoDir, { recursive: true });

    await fs.writeFile(
      path.join(repoDir, 'file.ts'),
      'export function hello() { return "world"; }',
      'utf-8'
    );

    const indexer = new RepositoryIndexer({
      repositoryPath: repoDir,
      vectorStorePath: path.join(testDir, 'search-test.lance'),
    });

    await indexer.initialize();
    await indexer.index();

    const results = await indexer.search('hello', { limit: 5 });
    expect(Array.isArray(results)).toBe(true);

    await indexer.close();
  });
});
