/**
 * Tests for RefsAdapter
 */

import type { SearchResult, SearchService } from '@prosdevlab/dev-agent-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConsoleLogger } from '../../utils/logger';
import { RefsAdapter } from '../built-in/refs-adapter';
import type { AdapterContext, ToolExecutionContext } from '../types';

describe('RefsAdapter', () => {
  let mockSearchService: SearchService;
  let adapter: RefsAdapter;
  let context: AdapterContext;
  let execContext: ToolExecutionContext;

  // Mock search results with callees
  const mockSearchResults: SearchResult[] = [
    {
      id: 'src/planner.ts:createPlan:10',
      score: 0.95,
      metadata: {
        path: 'src/planner.ts',
        type: 'function',
        name: 'createPlan',
        startLine: 10,
        endLine: 50,
        language: 'typescript',
        exported: true,
        signature: 'export function createPlan(issue: Issue): Plan',
        callees: [
          { name: 'fetchIssue', line: 15, file: 'src/github.ts' },
          { name: 'analyzeCode', line: 20 },
          { name: 'generateTasks', line: 30, file: 'src/tasks.ts' },
        ],
      },
    },
    {
      id: 'src/executor.ts:runPlan:5',
      score: 0.85,
      metadata: {
        path: 'src/executor.ts',
        type: 'function',
        name: 'runPlan',
        startLine: 5,
        endLine: 40,
        language: 'typescript',
        exported: true,
        callees: [
          { name: 'createPlan', line: 10, file: 'src/planner.ts' },
          { name: 'execute', line: 20 },
        ],
      },
    },
    {
      id: 'src/cli.ts:main:1',
      score: 0.8,
      metadata: {
        path: 'src/cli.ts',
        type: 'function',
        name: 'main',
        startLine: 1,
        endLine: 30,
        language: 'typescript',
        exported: true,
        callees: [{ name: 'createPlan', line: 15, file: 'src/planner.ts' }],
      },
    },
  ];

  beforeEach(async () => {
    // Create mock search service
    mockSearchService = {
      search: vi.fn().mockResolvedValue(mockSearchResults),
    } as unknown as SearchService;

    // Create mock indexer for reverse index building
    const mockIndexer = {
      getAll: vi.fn().mockResolvedValue(mockSearchResults),
      initialize: vi.fn(),
      close: vi.fn(),
    };

    // Create adapter with indexer so reverse index can be built
    adapter = new RefsAdapter({
      searchService: mockSearchService,
      indexer: mockIndexer as any,
      defaultLimit: 20,
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

      expect(def.name).toBe('dev_refs');
      expect(def.description).toContain('calls');
      expect(def.inputSchema.type).toBe('object');
      expect(def.inputSchema.properties).toHaveProperty('name');
      expect(def.inputSchema.properties).toHaveProperty('direction');
      expect(def.inputSchema.properties).toHaveProperty('limit');
      expect(def.inputSchema.required).toContain('name');
    });

    it('should have correct direction enum', () => {
      const def = adapter.getToolDefinition();
      const directionProp = def.inputSchema.properties?.direction;

      expect(directionProp).toBeDefined();
      expect(directionProp).toHaveProperty('enum');
      expect((directionProp as { enum: string[] }).enum).toEqual(['callees', 'callers', 'both']);
    });
  });

  describe('Validation', () => {
    it('should reject empty name', async () => {
      const result = await adapter.execute({ name: '' }, execContext);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_PARAMS');
      expect(result.error?.message).toContain('name');
    });

    it('should reject invalid direction', async () => {
      const result = await adapter.execute(
        { name: 'createPlan', direction: 'invalid' },
        execContext
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_PARAMS');
      expect(result.error?.message).toContain('direction');
    });

    it('should reject invalid limit', async () => {
      const result = await adapter.execute({ name: 'createPlan', limit: 100 }, execContext);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_PARAMS');
      expect(result.error?.message).toContain('limit');
    });
  });

  describe('Callee Queries', () => {
    it('should return callees for a function', async () => {
      const result = await adapter.execute(
        { name: 'createPlan', direction: 'callees' },
        execContext
      );

      expect(result.success).toBe(true);
      // Check formatted string includes callees
      expect(result.data).toContain('Callees');
      expect(result.data).toContain('fetchIssue');
    });

    it('should include callee file paths when available', async () => {
      const result = await adapter.execute(
        { name: 'createPlan', direction: 'callees' },
        execContext
      );

      expect(result.success).toBe(true);
      // Check formatted string includes file path
      expect(result.data).toContain('fetchIssue');
      expect(result.data).toContain('src/github.ts');
    });

    it('should not include callers when direction is callees', async () => {
      const result = await adapter.execute(
        { name: 'createPlan', direction: 'callees' },
        execContext
      );

      expect(result.success).toBe(true);
      // When direction is callees, output should not include callers section
      expect(result.data).not.toContain('Callers:');
    });
  });

  describe('Caller Queries', () => {
    it('should return callers for a function', async () => {
      const result = await adapter.execute(
        { name: 'createPlan', direction: 'callers' },
        execContext
      );

      expect(result.success).toBe(true);
      // Check formatted string includes callers
      expect(result.data).toContain('Callers');
      // runPlan and main both call createPlan
      expect(result.data).toContain('runPlan');
      expect(result.data).toContain('main');
    });

    it('should not include callees when direction is callers', async () => {
      const result = await adapter.execute(
        { name: 'createPlan', direction: 'callers' },
        execContext
      );

      expect(result.success).toBe(true);
      // When direction is callers, output should not include callees section
      expect(result.data).not.toContain('Callees:');
    });
  });

  describe('Bidirectional Queries', () => {
    it('should return both callees and callers when direction is both', async () => {
      const result = await adapter.execute({ name: 'createPlan', direction: 'both' }, execContext);

      expect(result.success).toBe(true);
      // Check formatted string includes both sections
      expect(result.data).toContain('Callees');
      expect(result.data).toContain('Callers');
    });

    it('should use both as default direction', async () => {
      const result = await adapter.execute({ name: 'createPlan' }, execContext);

      expect(result.success).toBe(true);
      // Check formatted string includes both sections
      expect(result.data).toContain('Callees');
      expect(result.data).toContain('Callers');
    });
  });

  describe('Output Formatting', () => {
    it('should include target information', async () => {
      const result = await adapter.execute({ name: 'createPlan' }, execContext);

      expect(result.success).toBe(true);
      // Check formatted string includes target information
      expect(result.data).toContain('createPlan');
      expect(result.data).toContain('src/planner.ts');
      expect(result.data).toContain('function');
    });

    it('should format output as markdown', async () => {
      const result = await adapter.execute({ name: 'createPlan' }, execContext);

      expect(result.success).toBe(true);
      expect(result.data).toContain('# References for createPlan');
      expect(result.data).toContain('## Callees');
      expect(result.data).toContain('## Callers');
    });

    it('should include token count in metadata', async () => {
      const result = await adapter.execute({ name: 'createPlan' }, execContext);

      expect(result.success).toBe(true);
      expect(result.metadata?.tokens).toBeDefined();
      expect(typeof result.metadata?.tokens).toBe('number');
    });

    it('should include duration in metadata', async () => {
      const result = await adapter.execute({ name: 'createPlan' }, execContext);

      expect(result.success).toBe(true);
      expect(result.metadata?.duration_ms).toBeDefined();
      expect(typeof result.metadata?.duration_ms).toBe('number');
    });
  });

  describe('Dependency Path Tracing (dependsOn)', () => {
    let adapterWithIndexer: RefsAdapter;

    // Mock indexer that returns docs with callees forming a chain:
    // src/planner.ts → src/github.ts → src/api.ts
    const chainDocs: SearchResult[] = [
      {
        id: '1',
        score: 0.9,
        metadata: {
          path: 'src/planner.ts',
          callees: [{ name: 'fetchIssue', file: 'src/github.ts', line: 15 }],
        },
      },
      {
        id: '2',
        score: 0.9,
        metadata: {
          path: 'src/github.ts',
          callees: [{ name: 'httpGet', file: 'src/api.ts', line: 5 }],
        },
      },
      {
        id: '3',
        score: 0.9,
        metadata: {
          path: 'src/api.ts',
          callees: [],
        },
      },
    ];

    beforeEach(async () => {
      const mockIndexer = {
        getAll: vi.fn().mockResolvedValue(chainDocs),
      };

      adapterWithIndexer = new RefsAdapter({
        searchService: mockSearchService,
        indexer: mockIndexer as unknown as import('@prosdevlab/dev-agent-core').RepositoryIndexer,
        defaultLimit: 20,
      });

      await adapterWithIndexer.initialize(context);
    });

    it('should trace dependency path between files', async () => {
      const result = await adapterWithIndexer.execute(
        { name: 'createPlan', dependsOn: 'src/api.ts' },
        execContext
      );

      expect(result.success).toBe(true);
      expect(result.data).toContain('Dependency Path');
      expect(result.data).toContain('src/planner.ts');
      expect(result.data).toContain('src/api.ts');
      expect(result.data).toContain('→');
    });

    it('should report hop count', async () => {
      const result = await adapterWithIndexer.execute(
        { name: 'createPlan', dependsOn: 'src/api.ts' },
        execContext
      );

      expect(result.success).toBe(true);
      expect(result.data).toContain('2 hops');
    });

    it('should report when no path exists', async () => {
      const result = await adapterWithIndexer.execute(
        { name: 'createPlan', dependsOn: 'src/nonexistent.ts' },
        execContext
      );

      expect(result.success).toBe(true);
      expect(result.data).toContain('No Path Found');
      expect(result.data).toContain('separate subsystems');
    });

    it('should return error when indexer is not available', async () => {
      // Create an adapter without indexer — dependsOn requires it
      const adapterNoIndexer = new RefsAdapter({
        searchService: mockSearchService,
        defaultLimit: 20,
      });
      await adapterNoIndexer.initialize(context);

      const result = await adapterNoIndexer.execute(
        { name: 'createPlan', dependsOn: 'src/api.ts' },
        execContext
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INDEX_REQUIRED');
    });
  });

  describe('Not Found', () => {
    it('should return error when function not found', async () => {
      // Mock empty results
      (mockSearchService.search as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      const result = await adapter.execute({ name: 'nonExistentFunction' }, execContext);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('NOT_FOUND');
    });
  });

  describe('Token Estimation', () => {
    it('should estimate tokens based on limit and direction', () => {
      const bothTokens = adapter.estimateTokens({ limit: 10, direction: 'both' });
      const singleTokens = adapter.estimateTokens({ limit: 10, direction: 'callees' });

      // Both directions should estimate more tokens
      expect(bothTokens).toBeGreaterThan(singleTokens);
    });
  });
});
