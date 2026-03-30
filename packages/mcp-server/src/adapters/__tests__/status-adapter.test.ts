/**
 * Tests for StatusAdapter
 */

import * as fs from 'node:fs';
import type { VectorStorage } from '@prosdevlab/dev-agent-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StatusArgsSchema } from '../../schemas/index.js';
import { StatusAdapter } from '../built-in/status-adapter';
import type { AdapterContext, ToolExecutionContext } from '../types';

// Mock fs.promises.stat and fs.promises.access
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    promises: {
      ...actual.promises,
      stat: vi.fn(),
      access: vi.fn(),
    },
    constants: actual.constants,
  };
});

const createMockVectorStorage = (overrides?: Partial<VectorStorage>) => {
  return {
    getStats: vi.fn().mockResolvedValue({
      totalDocuments: 42,
      storageSize: 1024 * 1024 * 5, // 5 MB
      dimension: 384,
      modelName: 'BAAI/bge-small-en-v1.5',
    }),
    initialize: vi.fn(),
    close: vi.fn(),
    addDocuments: vi.fn(),
    search: vi.fn(),
    deleteDocuments: vi.fn(),
    optimize: vi.fn(),
    ...overrides,
  } as unknown as VectorStorage;
};

describe('StatusAdapter', () => {
  let adapter: StatusAdapter;
  let mockVectorStorage: VectorStorage;
  let mockContext: AdapterContext;
  let mockExecutionContext: ToolExecutionContext;

  beforeEach(() => {
    vi.clearAllMocks();

    mockVectorStorage = createMockVectorStorage();

    adapter = new StatusAdapter({
      vectorStorage: mockVectorStorage,
      repositoryPath: '/test/repo',
      watcherSnapshotPath: '/test/.dev-agent/watcher-snapshot',
      defaultSection: 'summary',
    });

    mockContext = {
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      config: {},
    };

    mockExecutionContext = {
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    };

    // Default: repository accessible, snapshot exists
    vi.mocked(fs.promises.access).mockResolvedValue(undefined);
    vi.mocked(fs.promises.stat).mockResolvedValue({
      mtime: new Date(Date.now() - 5 * 60 * 1000), // 5 minutes ago
    } as fs.Stats);
  });

  describe('metadata', () => {
    it('should have correct metadata', () => {
      expect(adapter.metadata.name).toBe('status-adapter');
      expect(adapter.metadata.version).toBe('1.0.0');
      expect(adapter.metadata.description).toContain('status');
    });
  });

  describe('initialize', () => {
    it('should initialize successfully', async () => {
      await adapter.initialize(mockContext);
      expect(mockContext.logger.info).toHaveBeenCalledWith('StatusAdapter initialized', {
        repositoryPath: '/test/repo',
        defaultSection: 'summary',
      });
    });
  });

  describe('getToolDefinition', () => {
    it('should return correct tool definition', () => {
      const definition = adapter.getToolDefinition();

      expect(definition.name).toBe('dev_status');
      expect(definition.description).toContain('status');
      expect(definition.inputSchema.type).toBe('object');
      expect(definition.inputSchema.properties).toHaveProperty('section');
      expect(definition.inputSchema.properties).toHaveProperty('format');
    });

    it('should have correct section enum values without github', () => {
      const definition = adapter.getToolDefinition();
      const sectionProperty = definition.inputSchema.properties?.section;

      expect(sectionProperty).toBeDefined();
      expect(sectionProperty?.enum).toEqual(['summary', 'repo', 'indexes', 'health']);
    });

    it('should have correct format enum values', () => {
      const definition = adapter.getToolDefinition();
      const formatProperty = definition.inputSchema.properties?.format;

      expect(formatProperty).toBeDefined();
      expect(formatProperty?.enum).toEqual(['compact', 'verbose']);
    });
  });

  describe('execute', () => {
    describe('validation', () => {
      it('should reject invalid section', async () => {
        const result = await adapter.execute({ section: 'invalid' }, mockExecutionContext);

        expect(result.success).toBe(false);
        expect(result.error?.code).toBe('INVALID_PARAMS');
        expect(result.error?.message).toContain('section');
      });

      it('should reject invalid format', async () => {
        const result = await adapter.execute(
          { section: 'summary', format: 'invalid' },
          mockExecutionContext
        );

        expect(result.success).toBe(false);
        expect(result.error?.code).toBe('INVALID_PARAMS');
        expect(result.error?.message).toContain('format');
      });
    });

    describe('summary section', () => {
      it('should show document count in summary', async () => {
        const result = await adapter.execute({}, mockExecutionContext);

        expect(result.success).toBe(true);
        expect(result.data).toContain('Dev-Agent Status');
        expect(result.data).toContain('42');
      });

      it('should show Not indexed when zero docs', async () => {
        vi.mocked(mockVectorStorage.getStats).mockResolvedValue({
          totalDocuments: 0,
          storageSize: 0,
          dimension: 384,
          modelName: 'BAAI/bge-small-en-v1.5',
        });

        const result = await adapter.execute({}, mockExecutionContext);

        expect(result.success).toBe(true);
        expect(result.data).toContain('Not indexed');
      });

      it('should show auto-index active when snapshot exists', async () => {
        const result = await adapter.execute({}, mockExecutionContext);

        expect(result.success).toBe(true);
        expect(result.data).toContain('Auto-index:** Active');
        expect(result.data).toContain('Last Updated:');
      });

      it('should show auto-index not active when no snapshot', async () => {
        vi.mocked(fs.promises.stat).mockRejectedValue(new Error('ENOENT'));

        const result = await adapter.execute({}, mockExecutionContext);

        expect(result.success).toBe(true);
        expect(result.data).toContain('Not active');
        expect(result.data).toContain('dev index');
      });
    });

    describe('repo section', () => {
      it('should show repository details', async () => {
        const result = await adapter.execute({ section: 'repo' }, mockExecutionContext);

        expect(result.success).toBe(true);
        expect(result.data).toContain('Repository Index');
        expect(result.data).toContain('42');
        expect(result.data).toContain('Antfly');
      });

      it('should handle repository not indexed', async () => {
        vi.mocked(mockVectorStorage.getStats).mockResolvedValue({
          totalDocuments: 0,
          storageSize: 0,
          dimension: 384,
          modelName: 'BAAI/bge-small-en-v1.5',
        });

        const result = await adapter.execute({ section: 'repo' }, mockExecutionContext);

        expect(result.success).toBe(true);
        expect(result.data).toContain('Not indexed');
        expect(result.data).toContain('dev index');
      });
    });

    describe('indexes section', () => {
      it('should show Antfly not LanceDB', async () => {
        const result = await adapter.execute({ section: 'indexes' }, mockExecutionContext);

        expect(result.success).toBe(true);
        expect(result.data).toContain('Antfly');
        expect(result.data).not.toContain('LanceDB');
      });

      it('should show document count and model info', async () => {
        const result = await adapter.execute({ section: 'indexes' }, mockExecutionContext);

        expect(result.success).toBe(true);
        expect(result.data).toContain('42');
        expect(result.data).toContain('BAAI/bge-small-en-v1.5');
        expect(result.data).toContain('384-dim');
      });

      it('should show watcher snapshot age', async () => {
        const result = await adapter.execute({ section: 'indexes' }, mockExecutionContext);

        expect(result.success).toBe(true);
        expect(result.data).toContain('Last Snapshot');
        expect(result.data).toContain('Auto-index:** Active');
      });

      it('should show run dev index when no snapshot', async () => {
        vi.mocked(fs.promises.stat).mockRejectedValue(new Error('ENOENT'));

        const result = await adapter.execute({ section: 'indexes' }, mockExecutionContext);

        expect(result.success).toBe(true);
        expect(result.data).toContain('Not found');
        expect(result.data).toContain('dev index');
      });

      it('should show not indexed when zero docs', async () => {
        vi.mocked(mockVectorStorage.getStats).mockResolvedValue({
          totalDocuments: 0,
          storageSize: 0,
          dimension: 384,
          modelName: 'BAAI/bge-small-en-v1.5',
        });

        const result = await adapter.execute({ section: 'indexes' }, mockExecutionContext);

        expect(result.success).toBe(true);
        expect(result.data).toContain('Not indexed');
      });
    });

    describe('health section', () => {
      it('should show Antfly health check when ok', async () => {
        const result = await adapter.execute({ section: 'health' }, mockExecutionContext);

        expect(result.success).toBe(true);
        expect(result.data).toContain('Health Checks');
        expect(result.data).toContain('Antfly');
        expect(result.data).toContain('Connected and responding');
      });

      it('should show Antfly error when getStats fails', async () => {
        vi.mocked(mockVectorStorage.getStats).mockRejectedValue(new Error('Connection refused'));

        const result = await adapter.execute({ section: 'health' }, mockExecutionContext);

        expect(result.success).toBe(true);
        expect(result.data).toContain('Antfly');
        expect(result.data).toContain('Not reachable');
        expect(result.data).toContain('dev setup');
      });

      it('should show verbose details when requested', async () => {
        const result = await adapter.execute(
          { section: 'health', format: 'verbose' },
          mockExecutionContext
        );

        expect(result.success).toBe(true);
        expect(result.data).toContain('Health Checks');
        expect(result.data.length).toBeGreaterThan(50);
      });

      it('should not contain GitHub CLI check', async () => {
        const result = await adapter.execute({ section: 'health' }, mockExecutionContext);

        expect(result.data).not.toContain('GitHub CLI');
      });
    });

    describe('github section removed', () => {
      it('should reject github as section via schema', () => {
        const parsed = StatusArgsSchema.safeParse({ section: 'github' });
        expect(parsed.success).toBe(false);
      });

      it('should reject github section via adapter validation', async () => {
        const result = await adapter.execute({ section: 'github' }, mockExecutionContext);
        expect(result.success).toBe(false);
        expect(result.error?.code).toBe('INVALID_PARAMS');
      });
    });

    describe('error handling', () => {
      it('should handle errors during status generation', async () => {
        vi.mocked(mockVectorStorage.getStats).mockRejectedValue(new Error('Database error'));

        const result = await adapter.execute({ section: 'summary' }, mockExecutionContext);

        expect(result.success).toBe(false);
        expect(result.error?.code).toBe('STATUS_FAILED');
        expect(result.error?.message).toBe('Database error');
      });

      it('should log errors', async () => {
        vi.mocked(mockVectorStorage.getStats).mockRejectedValue(new Error('Test error'));

        await adapter.execute({ section: 'summary' }, mockExecutionContext);

        expect(mockExecutionContext.logger.error).toHaveBeenCalledWith(
          'Status check failed',
          expect.any(Object)
        );
      });
    });

    describe('logging', () => {
      it('should log debug information', async () => {
        await adapter.execute({ section: 'summary' }, mockExecutionContext);

        expect(mockExecutionContext.logger.debug).toHaveBeenCalledWith('Executing status check', {
          section: 'summary',
          format: 'compact',
        });
      });

      it('should log completion', async () => {
        await adapter.execute({ section: 'summary' }, mockExecutionContext);

        expect(mockExecutionContext.logger.info).toHaveBeenCalledWith(
          'Status check completed',
          expect.objectContaining({
            section: 'summary',
            format: 'compact',
          })
        );
      });
    });
  });

  describe('estimateTokens', () => {
    it('should estimate tokens for compact summary', () => {
      const estimate = adapter.estimateTokens({ section: 'summary', format: 'compact' });
      expect(estimate).toBe(200);
    });

    it('should estimate tokens for verbose summary', () => {
      const estimate = adapter.estimateTokens({ section: 'summary', format: 'verbose' });
      expect(estimate).toBe(800);
    });

    it('should estimate tokens for compact section', () => {
      const estimate = adapter.estimateTokens({ section: 'repo', format: 'compact' });
      expect(estimate).toBe(150);
    });

    it('should estimate tokens for verbose section', () => {
      const estimate = adapter.estimateTokens({ section: 'repo', format: 'verbose' });
      expect(estimate).toBe(500);
    });

    it('should use defaults when no args provided', () => {
      const estimate = adapter.estimateTokens({});
      expect(estimate).toBe(200); // Default is summary + compact
    });
  });
});
