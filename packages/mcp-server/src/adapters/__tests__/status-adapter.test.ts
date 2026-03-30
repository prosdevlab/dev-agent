/**
 * Tests for StatusAdapter
 */

import type { StatsService } from '@prosdevlab/dev-agent-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StatusAdapter } from '../built-in/status-adapter';
import type { AdapterContext, ToolExecutionContext } from '../types';

// Mock StatsService
const createMockStatsService = () => {
  return {
    getStats: vi.fn(),
    isIndexed: vi.fn(),
  } as unknown as StatsService;
};

describe('StatusAdapter', () => {
  let adapter: StatusAdapter;
  let mockStatsService: StatsService;
  let mockContext: AdapterContext;
  let mockExecutionContext: ToolExecutionContext;

  beforeEach(() => {
    mockStatsService = createMockStatsService();

    adapter = new StatusAdapter({
      statsService: mockStatsService,
      repositoryPath: '/test/repo',
      vectorStorePath: '/test/.dev-agent/vectors.lance',
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

    // Setup default mock responses
    vi.mocked(mockStatsService.getStats).mockResolvedValue({
      filesScanned: 2341,
      documentsExtracted: 1234,
      documentsIndexed: 1234,
      vectorsStored: 1234,
      duration: 18300,
      errors: [],
      startTime: new Date('2025-11-24T08:00:00Z'),
      endTime: new Date('2025-11-24T08:00:18Z'),
      repositoryPath: '/test/repo',
    });
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

    it('should have correct section enum values', () => {
      const definition = adapter.getToolDefinition();
      const sectionProperty = definition.inputSchema.properties?.section;

      expect(sectionProperty).toBeDefined();
      expect(sectionProperty?.enum).toEqual(['summary', 'repo', 'indexes', 'github', 'health']);
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
      it('should return compact summary by default', async () => {
        const result = await adapter.execute({}, mockExecutionContext);

        expect(result.success).toBe(true);
        expect(result.data).toContain('Dev-Agent Status');
        expect(result.data).toContain('Repository:');
        expect(result.data).toContain('2341 files indexed');
      });

      it('should return verbose summary when requested', async () => {
        const result = await adapter.execute(
          { section: 'summary', format: 'verbose' },
          mockExecutionContext
        );

        expect(result.success).toBe(true);
        expect(result.data).toContain('Detailed');
        expect(result.data).toContain('Repository');
        expect(result.data).toContain('Vector Indexes');
        expect(result.data).toContain('Health Checks');
      });

      it('should handle repository not indexed', async () => {
        vi.mocked(mockStatsService.getStats).mockResolvedValue(null);

        const result = await adapter.execute({}, mockExecutionContext);

        expect(result.success).toBe(true);
        expect(result.data).toContain('not indexed');
      });
    });

    describe('repo section', () => {
      it('should return repository status in compact format', async () => {
        const result = await adapter.execute({ section: 'repo' }, mockExecutionContext);

        expect(result.success).toBe(true);
        expect(result.data).toContain('Repository Index');
        expect(result.data).toContain('2341');
        expect(result.data).toContain('1234');
      });

      it('should return repository status in verbose format', async () => {
        const result = await adapter.execute(
          { section: 'repo', format: 'verbose' },
          mockExecutionContext
        );

        expect(result.success).toBe(true);
        expect(result.data).toContain('Documents Indexed:');
        expect(result.data).toContain('Vectors Stored:');
      });

      it('should handle repository not indexed', async () => {
        vi.mocked(mockStatsService.getStats).mockResolvedValue(null);

        const result = await adapter.execute({ section: 'repo' }, mockExecutionContext);

        expect(result.success).toBe(true);
        expect(result.data).toContain('Not indexed');
        expect(result.data).toContain('dev index');
      });
    });

    describe('indexes section', () => {
      it('should return indexes status in compact format', async () => {
        await adapter.initialize(mockContext);

        const result = await adapter.execute({ section: 'indexes' }, mockExecutionContext);

        expect(result.success).toBe(true);
        expect(result.data).toContain('Vector Indexes');
        expect(result.data).toContain('Code Index');
        expect(result.data).toContain('1234 embeddings');
      });

      it('should return indexes status in verbose format', async () => {
        await adapter.initialize(mockContext);

        const result = await adapter.execute(
          { section: 'indexes', format: 'verbose' },
          mockExecutionContext
        );

        expect(result.success).toBe(true);
        expect(result.data).toContain('Code Index');
        expect(result.data).toContain('Documents:');
      });
    });

    describe('github section', () => {
      it('should return GitHub status message', async () => {
        await adapter.initialize(mockContext);

        const result = await adapter.execute({ section: 'github' }, mockExecutionContext);

        expect(result.success).toBe(true);
        expect(result.data).toContain('GitHub Integration');
      });
    });

    describe('health section', () => {
      it('should return health status in compact format', async () => {
        const result = await adapter.execute({ section: 'health' }, mockExecutionContext);

        expect(result.success).toBe(true);
        expect(result.data).toContain('Health Checks');
      });

      it('should return health status in verbose format', async () => {
        const result = await adapter.execute(
          { section: 'health', format: 'verbose' },
          mockExecutionContext
        );

        expect(result.success).toBe(true);
        expect(result.data).toContain('Health Checks');
        expect(result.data.length).toBeGreaterThan(100);
      });
    });

    describe('error handling', () => {
      it('should handle errors during status generation', async () => {
        vi.mocked(mockStatsService.getStats).mockRejectedValue(new Error('Database error'));

        const result = await adapter.execute({ section: 'summary' }, mockExecutionContext);

        expect(result.success).toBe(false);
        expect(result.error?.code).toBe('STATUS_FAILED');
        expect(result.error?.message).toBe('Database error');
      });

      it('should log errors', async () => {
        vi.mocked(mockStatsService.getStats).mockRejectedValue(new Error('Test error'));

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

  describe('time formatting', () => {
    it('should format recent times correctly', async () => {
      const now = new Date();
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

      vi.mocked(mockStatsService.getStats).mockResolvedValue({
        filesScanned: 100,
        documentsExtracted: 50,
        documentsIndexed: 50,
        vectorsStored: 50,
        duration: 1000,
        errors: [],
        startTime: twoHoursAgo,
        endTime: twoHoursAgo,
        repositoryPath: '/test/repo',
      });

      const result = await adapter.execute({ section: 'summary' }, mockExecutionContext);

      expect(result.success).toBe(true);
      expect(result.data).toContain('ago');
    });
  });

  describe('storage size formatting', () => {
    it('should format bytes correctly', async () => {
      const result = await adapter.execute({ section: 'indexes' }, mockExecutionContext);

      expect(result.success).toBe(true);
      expect(result.data).toMatch(/\d+(\.\d+)?\s*(B|KB|MB|GB)/);
    });
  });
});
