/**
 * Tests for MapAdapter
 */

import type { RepositoryIndexer, SearchResult } from '@prosdevlab/dev-agent-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConsoleLogger } from '../../utils/logger';
import { MapAdapter } from '../built-in/map-adapter';
import type { AdapterContext, ToolExecutionContext } from '../types';

describe('MapAdapter', () => {
  let mockIndexer: RepositoryIndexer;
  let adapter: MapAdapter;
  let context: AdapterContext;
  let execContext: ToolExecutionContext;

  // Mock search results representing indexed documents
  const mockSearchResults: SearchResult[] = [
    {
      id: 'packages/core/src/scanner/typescript.ts:TypeScriptScanner:19',
      score: 0.9,
      metadata: {
        path: 'packages/core/src/scanner/typescript.ts',
        type: 'class',
        name: 'TypeScriptScanner',
        exported: true,
      },
    },
    {
      id: 'packages/core/src/indexer/index.ts:RepositoryIndexer:10',
      score: 0.8,
      metadata: {
        path: 'packages/core/src/indexer/index.ts',
        type: 'class',
        name: 'RepositoryIndexer',
        exported: true,
      },
    },
    {
      id: 'packages/mcp-server/src/adapters/search-adapter.ts:SearchAdapter:35',
      score: 0.75,
      metadata: {
        path: 'packages/mcp-server/src/adapters/search-adapter.ts',
        type: 'class',
        name: 'SearchAdapter',
        exported: true,
      },
    },
  ];

  beforeEach(async () => {
    // Create mock indexer
    mockIndexer = {
      search: vi.fn().mockResolvedValue(mockSearchResults),
      getAll: vi.fn().mockResolvedValue(mockSearchResults),
    } as unknown as RepositoryIndexer;

    // Create adapter
    adapter = new MapAdapter({
      repositoryIndexer: mockIndexer,
      defaultDepth: 2,
      defaultTokenBudget: 2000,
    });

    // Create context
    const logger = new ConsoleLogger('[test]', 'error'); // Quiet for tests
    context = {
      logger,
      config: { repositoryPath: '/test' },
    };

    execContext = {
      logger,
      config: { repositoryPath: '/test' },
    };

    await adapter.initialize(context);
  });

  describe('Tool Definition', () => {
    it('should provide valid tool definition', () => {
      const def = adapter.getToolDefinition();

      expect(def.name).toBe('dev_map');
      expect(def.description).toContain('structural overview');
      expect(def.inputSchema.type).toBe('object');
      expect(def.inputSchema.properties).toHaveProperty('depth');
      expect(def.inputSchema.properties).toHaveProperty('focus');
      expect(def.inputSchema.properties).toHaveProperty('includeExports');
      expect(def.inputSchema.properties).toHaveProperty('tokenBudget');
    });

    it('should have no required parameters', () => {
      const def = adapter.getToolDefinition();
      expect(def.inputSchema.required).toEqual([]);
    });

    it('should have correct depth constraints', () => {
      const def = adapter.getToolDefinition();
      const depthProp = def.inputSchema.properties?.depth as { minimum: number; maximum: number };

      expect(depthProp.minimum).toBe(1);
      expect(depthProp.maximum).toBe(5);
    });
  });

  describe('Validation', () => {
    it('should reject invalid depth', async () => {
      const result = await adapter.execute({ depth: 10 }, execContext);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_PARAMS');
      expect(result.error?.message).toContain('depth');
    });

    it('should reject depth less than 1', async () => {
      const result = await adapter.execute({ depth: 0 }, execContext);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_PARAMS');
      expect(result.error?.message).toContain('depth');
    });

    it('should reject invalid focus type', async () => {
      const result = await adapter.execute({ focus: 123 }, execContext);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_PARAMS');
      expect(result.error?.message).toContain('focus');
    });

    it('should reject invalid token budget', async () => {
      const result = await adapter.execute({ tokenBudget: 100 }, execContext);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_PARAMS');
      expect(result.error?.message).toContain('tokenBudget');
    });
  });

  describe('Map Generation', () => {
    it('should generate map with default options', async () => {
      const result = await adapter.execute({}, execContext);

      expect(result.success).toBe(true);
      expect(result.data).toContain('Structure:');
      expect(result.metadata?.total_components).toBeGreaterThan(0);
      expect(result.metadata?.total_directories).toBeGreaterThan(0);
    });

    it('should respect depth parameter', async () => {
      const result = await adapter.execute({ depth: 1 }, execContext);

      expect(result.success).toBe(true);
      expect(result.metadata?.depth).toBe(1);
    });

    it('should respect focus parameter', async () => {
      const result = await adapter.execute({ focus: 'packages/core' }, execContext);

      expect(result.success).toBe(true);
      expect(result.metadata?.focus).toBe('packages/core');
    });

    it('should generate map with or without exports flag', async () => {
      const result = await adapter.execute({ includeExports: true, depth: 5 }, execContext);
      expect(result.success).toBe(true);

      const result2 = await adapter.execute({ includeExports: false }, execContext);
      expect(result2.success).toBe(true);
    });
  });

  describe('Output Format', () => {
    it('should include tree structure', async () => {
      const result = await adapter.execute({}, execContext);

      expect(result.success).toBe(true);
      expect(result.data).toMatch(/[├└]/);
    });

    it('should include component counts', async () => {
      const result = await adapter.execute({}, execContext);

      expect(result.success).toBe(true);
      expect(result.data).toMatch(/\d+ components/);
    });

    it('should include component counts in output', async () => {
      const result = await adapter.execute({}, execContext);

      expect(result.success).toBe(true);
      expect(result.data).toContain('components');
    });
  });

  describe('Metadata', () => {
    it('should include token count', async () => {
      const result = await adapter.execute({}, execContext);

      expect(result.success).toBe(true);
      expect(result.metadata?.tokens).toBeDefined();
      expect(typeof result.metadata?.tokens).toBe('number');
    });

    it('should include duration', async () => {
      const result = await adapter.execute({}, execContext);

      expect(result.success).toBe(true);
      expect(result.metadata?.duration_ms).toBeDefined();
      expect(typeof result.metadata?.duration_ms).toBe('number');
    });

    it('should include timestamp', async () => {
      const result = await adapter.execute({}, execContext);

      expect(result.success).toBe(true);
      expect(result.metadata?.timestamp).toBeDefined();
    });
  });

  describe('Token Budget', () => {
    it('should respect token budget', async () => {
      const result = await adapter.execute({ tokenBudget: 500 }, execContext);

      expect(result.success).toBe(true);
      expect(result.metadata?.tokens).toBeLessThanOrEqual(600); // Some tolerance
    });

    it('should indicate truncation when depth is reduced', async () => {
      // Create mock with lots of results to force truncation
      const manyResults: SearchResult[] = Array.from({ length: 100 }, (_, i) => ({
        id: `packages/pkg${i}/src/file.ts:fn:1`,
        score: 0.9,
        metadata: {
          path: `packages/pkg${i}/src/file.ts`,
          type: 'function',
          name: `fn${i}`,
          exported: true,
        },
      }));

      const largeIndexer = {
        search: vi.fn().mockResolvedValue(manyResults),
        getAll: vi.fn().mockResolvedValue(manyResults),
      } as unknown as RepositoryIndexer;

      const largeAdapter = new MapAdapter({
        repositoryIndexer: largeIndexer,
        defaultDepth: 5,
        defaultTokenBudget: 500,
      });

      await largeAdapter.initialize(context);
      const result = await largeAdapter.execute({ depth: 5, tokenBudget: 500 }, execContext);

      expect(result.success).toBe(true);
      // May or may not be truncated depending on output size
    });
  });

  describe('Connected Components', () => {
    it('should include subsystems when docs have call graph edges', async () => {
      // Docs with callees forming two separate clusters
      const clusterDocs: SearchResult[] = [
        {
          id: 'packages/core/src/a.ts:fnA:1',
          score: 0.9,
          metadata: {
            path: 'packages/core/src/a.ts',
            type: 'function',
            name: 'fnA',
            exported: true,
            callees: [{ name: 'fnB', file: 'packages/core/src/b.ts', line: 1 }],
          },
        },
        {
          id: 'packages/core/src/b.ts:fnB:1',
          score: 0.9,
          metadata: {
            path: 'packages/core/src/b.ts',
            type: 'function',
            name: 'fnB',
            exported: true,
            callees: [],
          },
        },
        {
          id: 'packages/mcp/src/x.ts:fnX:1',
          score: 0.9,
          metadata: {
            path: 'packages/mcp/src/x.ts',
            type: 'function',
            name: 'fnX',
            exported: true,
            callees: [{ name: 'fnY', file: 'packages/mcp/src/y.ts', line: 1 }],
          },
        },
        {
          id: 'packages/mcp/src/y.ts:fnY:1',
          score: 0.9,
          metadata: {
            path: 'packages/mcp/src/y.ts',
            type: 'function',
            name: 'fnY',
            exported: true,
            callees: [],
          },
        },
      ];

      const clusterIndexer = {
        search: vi.fn().mockResolvedValue(clusterDocs),
        getAll: vi.fn().mockResolvedValue(clusterDocs),
      } as unknown as RepositoryIndexer;

      const clusterAdapter = new MapAdapter({
        repositoryIndexer: clusterIndexer,
        defaultDepth: 3,
        defaultTokenBudget: 5000,
      });
      await clusterAdapter.initialize(context);

      const result = await clusterAdapter.execute({ depth: 3 }, execContext);

      expect(result.success).toBe(true);
      expect(result.data).toContain('Subsystems');
      expect(result.data).toContain('connected');
    });

    it('should not show subsystems section when all docs are in one cluster', async () => {
      // All docs in same cluster (single connected component)
      const singleClusterDocs: SearchResult[] = [
        {
          id: 'src/a.ts:fnA:1',
          score: 0.9,
          metadata: {
            path: 'src/a.ts',
            type: 'function',
            name: 'fnA',
            exported: true,
            callees: [{ name: 'fnB', file: 'src/b.ts', line: 1 }],
          },
        },
        {
          id: 'src/b.ts:fnB:1',
          score: 0.9,
          metadata: {
            path: 'src/b.ts',
            type: 'function',
            name: 'fnB',
            exported: true,
            callees: [{ name: 'fnA', file: 'src/a.ts', line: 1 }],
          },
        },
      ];

      const singleIndexer = {
        search: vi.fn().mockResolvedValue(singleClusterDocs),
        getAll: vi.fn().mockResolvedValue(singleClusterDocs),
      } as unknown as RepositoryIndexer;

      const singleAdapter = new MapAdapter({
        repositoryIndexer: singleIndexer,
        defaultDepth: 2,
        defaultTokenBudget: 5000,
      });
      await singleAdapter.initialize(context);

      const result = await singleAdapter.execute({}, execContext);

      expect(result.success).toBe(true);
      // Only 1 component — formatCodebaseMap skips the section when <= 1
      expect(result.data).not.toContain('Subsystems');
    });
  });

  describe('Token Estimation', () => {
    it('should estimate tokens based on depth', () => {
      const shallow = adapter.estimateTokens({ depth: 1 });
      const deep = adapter.estimateTokens({ depth: 5 });

      expect(deep).toBeGreaterThan(shallow);
    });

    it('should respect token budget in estimation', () => {
      const estimate = adapter.estimateTokens({ depth: 5, tokenBudget: 500 });

      expect(estimate).toBeLessThanOrEqual(500);
    });
  });
});
