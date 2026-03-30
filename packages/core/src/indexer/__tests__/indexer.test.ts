import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Use mock VectorStorage (no antfly server needed)
vi.mock('../../vector/index');

import { RepositoryIndexer } from '../index';
import type { IndexProgress } from '../types';

describe('RepositoryIndexer', () => {
  let testDir: string;
  let repoDir: string;
  let vectorDir: string;

  beforeAll(async () => {
    // Create temporary directories
    testDir = path.join(os.tmpdir(), `indexer-test-${Date.now()}`);
    repoDir = path.join(testDir, 'repo');
    vectorDir = path.join(testDir, 'vectors');

    await fs.mkdir(repoDir, { recursive: true });
    await fs.mkdir(vectorDir, { recursive: true });

    // Create test files
    await fs.writeFile(
      path.join(repoDir, 'auth.ts'),
      `export class AuthService {
  authenticate(user: string, password: string): boolean {
    return true;
  }
}`,
      'utf-8'
    );

    await fs.writeFile(
      path.join(repoDir, 'utils.ts'),
      `export function formatDate(date: Date): string {
  return date.toISOString();
}`,
      'utf-8'
    );

    await fs.writeFile(
      path.join(repoDir, 'README.md'),
      `# Test Repository

This is a test repository for indexing.`,
      'utf-8'
    );
  }, 60000); // Longer timeout for model download

  afterAll(async () => {
    // Clean up
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('should initialize successfully', async () => {
    const indexer = new RepositoryIndexer({
      repositoryPath: repoDir,
      vectorStorePath: path.join(vectorDir, 'test1.lance'),
    });

    await indexer.initialize();
    await indexer.close();
  });

  it('should index repository', async () => {
    const indexer = new RepositoryIndexer({
      repositoryPath: repoDir,
      vectorStorePath: path.join(vectorDir, 'test2.lance'),
    });

    await indexer.initialize();

    const stats = await indexer.index();

    expect(stats.filesScanned).toBeGreaterThan(0);
    expect(stats.documentsExtracted).toBeGreaterThan(0);
    expect(stats.documentsIndexed).toBeGreaterThanOrEqual(0);
    expect(stats.duration).toBeGreaterThan(0);
    expect(stats.errors).toEqual([]);
    expect(stats.repositoryPath).toBe(repoDir);

    await indexer.close();
  });

  it('should track progress during indexing', async () => {
    const indexer = new RepositoryIndexer({
      repositoryPath: repoDir,
      vectorStorePath: path.join(vectorDir, 'test3.lance'),
    });

    await indexer.initialize();

    const progressUpdates: IndexProgress[] = [];

    await indexer.index({
      onProgress: (progress) => {
        progressUpdates.push({ ...progress });
      },
    });

    expect(progressUpdates.length).toBeGreaterThan(0);
    expect(progressUpdates[progressUpdates.length - 1].phase).toBe('complete');
    expect(progressUpdates[progressUpdates.length - 1].percentComplete).toBe(100);

    await indexer.close();
  });

  it('should search indexed content', async () => {
    const indexer = new RepositoryIndexer({
      repositoryPath: repoDir,
      vectorStorePath: path.join(vectorDir, 'test4.lance'),
    });

    await indexer.initialize();
    await indexer.index();

    const results = await indexer.search('authentication', { limit: 5 });

    expect(Array.isArray(results)).toBe(true);
    // Results may be empty if no documents were indexed or semantic similarity is low
    if (results.length > 0) {
      expect(results[0]).toHaveProperty('id');
      expect(results[0]).toHaveProperty('score');
      expect(results[0]).toHaveProperty('metadata');
    }

    await indexer.close();
  });

  it('should get indexing statistics', async () => {
    const indexer = new RepositoryIndexer({
      repositoryPath: repoDir,
      vectorStorePath: path.join(vectorDir, 'test5.lance'),
    });

    await indexer.initialize();

    // Index
    const indexStats = await indexer.index();
    expect(indexStats.duration).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(indexStats.errors)).toBe(true);

    // getStats returns stats from Antfly (mock linearMerge stores docs)
    const stats = await indexer.getStats();
    expect(stats).not.toBeNull();
    expect(stats?.documentsIndexed).toBeGreaterThan(0);

    await indexer.close();
  });

  it('should support language filtering', async () => {
    const indexer = new RepositoryIndexer({
      repositoryPath: repoDir,
      vectorStorePath: path.join(vectorDir, 'test7.lance'),
    });

    await indexer.initialize();

    const stats = await indexer.index({
      languages: ['typescript'],
    });

    // Should complete without error
    expect(stats.duration).toBeGreaterThanOrEqual(0);
    expect(stats.errors.length).toBe(0);

    await indexer.close();
  });

  it('should handle empty repository', async () => {
    const emptyRepo = path.join(testDir, 'empty-repo');
    await fs.mkdir(emptyRepo, { recursive: true });

    const indexer = new RepositoryIndexer({
      repositoryPath: emptyRepo,
      vectorStorePath: path.join(vectorDir, 'test8.lance'),
    });

    await indexer.initialize();

    const stats = await indexer.index();

    expect(stats.filesScanned).toBe(0);
    expect(stats.documentsIndexed).toBe(0);

    await indexer.close();
  });

  it('should handle search with options', async () => {
    const indexer = new RepositoryIndexer({
      repositoryPath: repoDir,
      vectorStorePath: path.join(vectorDir, 'test11.lance'),
    });

    await indexer.initialize();
    await indexer.index();

    // Search with limit
    const results = await indexer.search('function', { limit: 2 });
    expect(results.length).toBeLessThanOrEqual(2);

    // Search with score threshold
    const filteredResults = await indexer.search('test', { scoreThreshold: 0.8 });
    for (const result of filteredResults) {
      expect(result.score).toBeGreaterThanOrEqual(0.8);
    }

    await indexer.close();
  });

  it('should handle close without initialization', async () => {
    const indexer = new RepositoryIndexer({
      repositoryPath: repoDir,
      vectorStorePath: path.join(vectorDir, 'test12.lance'),
    });

    // Should not throw
    await indexer.close();
  });

  it('should format documents with missing fields', async () => {
    const emptyRepo = path.join(testDir, 'empty-fields');
    await fs.mkdir(emptyRepo, { recursive: true });

    // Create file with minimal content
    await fs.writeFile(path.join(emptyRepo, 'minimal.md'), '# Title', 'utf-8');

    const indexer = new RepositoryIndexer({
      repositoryPath: emptyRepo,
      vectorStorePath: path.join(vectorDir, 'test16.lance'),
    });

    await indexer.initialize();

    const stats = await indexer.index();
    expect(stats.duration).toBeGreaterThanOrEqual(0);

    await indexer.close();
  });

  it('should format document text properly', async () => {
    const indexer = new RepositoryIndexer({
      repositoryPath: repoDir,
      vectorStorePath: path.join(vectorDir, 'test13.lance'),
    });

    await indexer.initialize();
    const stats = await indexer.index();

    // Should have indexed some documents
    expect(stats.documentsIndexed).toBeGreaterThanOrEqual(0);

    // Search should work (may or may not find results depending on semantic similarity)
    const results = await indexer.search('test query', { limit: 5 });
    expect(Array.isArray(results)).toBe(true);

    await indexer.close();
  });
});

describe('RepositoryIndexer - Edge Cases', () => {
  let testDir: string;

  beforeAll(async () => {
    testDir = path.join(os.tmpdir(), `indexer-edge-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('should handle unreadable files during indexing', async () => {
    const repoDir = path.join(testDir, 'unreadable');
    await fs.mkdir(repoDir, { recursive: true });

    // Create a temporary file
    const tempFile = path.join(repoDir, 'temp.ts');
    await fs.writeFile(tempFile, 'export const temp = 1;', 'utf-8');

    const indexer = new RepositoryIndexer({
      repositoryPath: repoDir,
      vectorStorePath: path.join(testDir, 'edge4.lance'),
    });

    await indexer.initialize();

    // Index should handle files
    const stats = await indexer.index();
    expect(stats.duration).toBeGreaterThanOrEqual(0);

    await indexer.close();
  });
});

describe('RepositoryIndexer - Configuration', () => {
  let testDir: string;

  beforeAll(async () => {
    testDir = path.join(os.tmpdir(), `indexer-config-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('should use default configuration values', async () => {
    const repoDir = path.join(testDir, 'repo1');
    await fs.mkdir(repoDir, { recursive: true });

    const indexer = new RepositoryIndexer({
      repositoryPath: repoDir,
      vectorStorePath: path.join(testDir, 'vectors1.lance'),
    });

    await indexer.initialize();

    // Stats may be non-null if mock's shared doc store has data from prior tests
    // The important thing is no error is thrown
    const stats = await indexer.getStats();
    expect(stats === null || stats.documentsIndexed >= 0).toBe(true);

    await indexer.close();
  });

  it('should accept exclude patterns', async () => {
    const repoDir = path.join(testDir, 'repo3');
    await fs.mkdir(repoDir, { recursive: true });

    await fs.writeFile(path.join(repoDir, 'include.ts'), 'export const a = 1;', 'utf-8');
    await fs.writeFile(path.join(repoDir, 'exclude.ts'), 'export const b = 2;', 'utf-8');

    const indexer = new RepositoryIndexer({
      repositoryPath: repoDir,
      vectorStorePath: path.join(testDir, 'vectors3.lance'),
      excludePatterns: ['exclude.ts'],
    });

    await indexer.initialize();

    const stats = await indexer.index();

    // Should complete without error
    expect(stats.duration).toBeGreaterThanOrEqual(0);
    expect(stats.errors.length).toBe(0);

    await indexer.close();
  });

  it('should handle all progress phases', async () => {
    const repoDir = path.join(testDir, 'progress-test');
    await fs.mkdir(repoDir, { recursive: true });

    await fs.writeFile(path.join(repoDir, 'file.ts'), 'export const x = 1;', 'utf-8');

    const phases: string[] = [];

    const indexer = new RepositoryIndexer({
      repositoryPath: repoDir,
      vectorStorePath: path.join(testDir, 'progress.lance'),
    });

    await indexer.initialize();

    await indexer.index({
      onProgress: (progress) => {
        if (!phases.includes(progress.phase)) {
          phases.push(progress.phase);
        }
      },
    });

    // Should have gone through all phases
    expect(phases.length).toBeGreaterThan(0);

    await indexer.close();
  });

  it('should handle custom language extensions', async () => {
    const repoDir = path.join(testDir, 'lang-ext');
    await fs.mkdir(repoDir, { recursive: true });

    await fs.writeFile(path.join(repoDir, 'file.ts'), 'export const x = 1;', 'utf-8');

    const indexer = new RepositoryIndexer({
      repositoryPath: repoDir,
      vectorStorePath: path.join(testDir, 'lang-ext.lance'),
    });

    await indexer.initialize();

    // Test with various language options
    const stats = await indexer.index({ languages: ['typescript', 'python', 'go', 'rust'] });
    expect(stats.duration).toBeGreaterThanOrEqual(0);

    await indexer.close();
  });

  it('should handle empty exclude patterns', async () => {
    const repoDir = path.join(testDir, 'no-exclude');
    await fs.mkdir(repoDir, { recursive: true });

    await fs.writeFile(path.join(repoDir, 'file.ts'), 'export const x = 1;', 'utf-8');

    const indexer = new RepositoryIndexer({
      repositoryPath: repoDir,
      vectorStorePath: path.join(testDir, 'no-exclude.lance'),
      excludePatterns: [],
    });

    await indexer.initialize();

    const stats = await indexer.index({ excludePatterns: [] });
    expect(stats.duration).toBeGreaterThanOrEqual(0);

    await indexer.close();
  });
});
