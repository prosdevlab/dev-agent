/**
 * Refs Adapter
 * Provides call graph queries via the dev_refs tool
 */

import type {
  CalleeInfo,
  CallerEntry,
  RepositoryIndexer,
  SearchResult,
  SearchService,
} from '@prosdevlab/dev-agent-core';
import {
  buildNameIndex,
  loadOrBuildGraph,
  lookupCallers,
  lookupClassCallers,
  shortestPath,
} from '@prosdevlab/dev-agent-core';
import { estimateTokensForText, startTimer } from '../../formatters/utils';
import { RefsArgsSchema } from '../../schemas/index.js';
import { ToolAdapter } from '../tool-adapter';
import type { AdapterContext, ToolDefinition, ToolExecutionContext, ToolResult } from '../types';
import { validateArgs } from '../validation.js';

/**
 * Direction of relationship query
 */
export type RefDirection = 'callees' | 'callers' | 'both';

/**
 * Refs adapter configuration
 */
export interface RefsAdapterConfig {
  /**
   * Search service instance
   */
  searchService: SearchService;

  /**
   * Repository indexer — needed for path tracing (optional)
   */
  indexer?: RepositoryIndexer;

  /**
   * Path to cached dependency-graph.json
   */
  graphPath?: string;

  /**
   * Default result limit
   */
  defaultLimit?: number;
}

/**
 * Reference result for output
 */
interface RefResult {
  name: string;
  file?: string;
  line: number;
  type?: string;
  snippet?: string;
}

/**
 * Refs Adapter
 * Implements the dev_refs tool for querying call relationships
 */
export class RefsAdapter extends ToolAdapter {
  readonly metadata = {
    name: 'refs-adapter',
    version: '1.0.0',
    description: 'Call graph relationship adapter',
    author: 'Dev-Agent Team',
  };

  private searchService: SearchService;
  private config: {
    searchService: SearchService;
    defaultLimit: number;
  };

  private indexer?: RepositoryIndexer;
  private graphPath?: string;
  private cachedGraph?: Map<string, import('@prosdevlab/dev-agent-core').WeightedEdge[]>;
  private cachedReverseIndex: Map<string, CallerEntry[]> | null = null;
  private cachedNameIndex: Map<string, string[]> | null = null;
  private cachedGraphTime = 0;

  constructor(config: RefsAdapterConfig) {
    super();
    this.searchService = config.searchService;
    this.indexer = config.indexer;
    this.graphPath = config.graphPath;
    this.config = {
      searchService: config.searchService,
      defaultLimit: config.defaultLimit ?? 20,
    };
  }

  async initialize(context: AdapterContext): Promise<void> {
    context.logger.info('RefsAdapter initialized', {
      defaultLimit: this.config.defaultLimit,
    });
  }

  /**
   * Get dependency graph, cached for 60 seconds.
   * Avoids rebuilding the full graph on every dependsOn call.
   */
  private async getDependencyGraph(): Promise<
    Map<string, import('@prosdevlab/dev-agent-core').WeightedEdge[]>
  > {
    const CACHE_TTL_MS = 60_000;
    if (this.cachedGraph && Date.now() - this.cachedGraphTime < CACHE_TTL_MS) {
      return this.cachedGraph;
    }

    const result = await loadOrBuildGraph(this.graphPath, async () => {
      if (!this.indexer) return [];
      const DOC_LIMIT = 50_000;
      const allDocs = await this.indexer.getAll({ limit: DOC_LIMIT });
      if (allDocs.length >= DOC_LIMIT) {
        console.error(
          `[dev-agent] Warning: dependency graph hit ${DOC_LIMIT} doc limit. Results may be incomplete.`
        );
      }
      return allDocs;
    });
    this.cachedGraph = result.graph;
    this.cachedReverseIndex = result.reverseIndex;
    this.cachedNameIndex = result.reverseIndex ? buildNameIndex(result.reverseIndex) : null;
    this.cachedGraphTime = Date.now();
    return this.cachedGraph;
  }

  getToolDefinition(): ToolDefinition {
    return {
      name: 'dev_refs',
      description:
        'Find who calls a function and what it calls. Use when you have a SPECIFIC symbol name and need to trace dependencies. ' +
        'For conceptual queries like "where is auth used", use dev_search instead.',
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description:
              'Name of the function or method to query (e.g., "createPlan", "SearchAdapter.execute")',
          },
          direction: {
            type: 'string',
            enum: ['callees', 'callers', 'both'],
            description:
              'Direction of query: "callees" (what this calls), "callers" (what calls this), or "both" (default)',
            default: 'both',
          },
          limit: {
            type: 'number',
            description: `Maximum number of results per direction (default: ${this.config.defaultLimit})`,
            minimum: 1,
            maximum: 50,
            default: this.config.defaultLimit,
          },
          dependsOn: {
            type: 'string',
            description:
              "Trace the call chain from this function's file to a target it depends on " +
              '(e.g., "src/database.ts"). Follows call direction: A calls B, B calls C.',
          },
        },
        required: ['name'],
      },
    };
  }

  async execute(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
    // Validate args with Zod
    const validation = validateArgs(RefsArgsSchema, args);
    if (!validation.success) {
      return validation.error;
    }

    const { name, direction, limit, dependsOn } = validation.data;

    try {
      const timer = startTimer();
      context.logger.debug('Executing refs query', { name, direction, limit, dependsOn });

      // First, find the target component
      const searchResults = await this.searchService.search(name, { limit: 10 });
      const target = this.findBestMatch(searchResults, name);

      if (!target) {
        return {
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: `Could not find function or method named "${name}"`,
            suggestion:
              'Verify the function name exists with dev_search first. Names are case-sensitive.',
          },
        };
      }

      // Handle dependsOn — find shortest dependency path
      if (dependsOn && !this.indexer) {
        return {
          success: false,
          error: {
            code: 'INDEX_REQUIRED',
            message: 'Dependency path tracing requires a repository index.',
            suggestion: 'Run "dev index" to index the repository first.',
          },
        };
      }

      if (dependsOn && this.indexer) {
        const sourceFile = (target.metadata.path as string) || '';
        const graph = await this.getDependencyGraph();
        const path = shortestPath(graph, sourceFile, dependsOn);

        const content = path
          ? `## Dependency Path: ${sourceFile} → ${dependsOn}\n\n${path.join(' → ')}\n\n**${path.length - 1} hop${path.length - 1 === 1 ? '' : 's'}**`
          : `## No Path Found\n\nNo dependency chain from \`${sourceFile}\` to \`${dependsOn}\`.\nThese files may be in separate subsystems.`;

        return {
          success: true,
          data: content,
          metadata: {
            tokens: estimateTokensForText(content),
            duration_ms: timer.elapsed(),
            timestamp: new Date().toISOString(),
            cached: false,
          },
        };
      }

      const result: {
        target: {
          name: string;
          file: string;
          line: number;
          type: string;
        };
        callees?: RefResult[];
        callers?: RefResult[];
      } = {
        target: {
          name: target.metadata.name || name,
          file: target.metadata.path || '',
          line: target.metadata.startLine || 0,
          type: (target.metadata.type as string) || 'unknown',
        },
      };

      // Get callees if requested
      if (direction === 'callees' || direction === 'both') {
        result.callees = this.getCallees(target, limit);
      }

      // Get callers if requested
      if (direction === 'callers' || direction === 'both') {
        // Ensure graph (and reverse index) is loaded before looking up callers
        await this.getDependencyGraph();
        result.callers = this.getCallersFromIndex(target, limit);
      }

      const content = this.formatOutput(result, direction);
      const duration_ms = timer.elapsed();

      context.logger.info('Refs query completed', {
        name,
        direction,
        calleesCount: result.callees?.length ?? 0,
        callersCount: result.callers?.length ?? 0,
        duration_ms,
      });

      const tokens = estimateTokensForText(content);

      // Return formatted content (MCP will wrap in content blocks)
      return {
        success: true,
        data: content,
        metadata: {
          tokens,
          duration_ms,
          timestamp: new Date().toISOString(),
          cached: false,
        },
      };
    } catch (error) {
      context.logger.error('Refs query failed', { error });
      return {
        success: false,
        error: {
          code: 'REFS_FAILED',
          message: error instanceof Error ? error.message : 'Unknown error',
          suggestion: 'Try dev_search to find the correct function name first.',
        },
      };
    }
  }

  /**
   * Find the best matching result for a name query
   */
  private findBestMatch(results: SearchResult[], name: string): SearchResult | null {
    if (results.length === 0) return null;

    // Exact name match takes priority
    const exactMatch = results.find(
      (r) => r.metadata.name === name || r.metadata.name?.endsWith(`.${name}`)
    );
    if (exactMatch) return exactMatch;

    // Otherwise return the highest scoring result
    return results[0];
  }

  /**
   * Get callees from the target's metadata
   */
  private getCallees(target: SearchResult, limit: number): RefResult[] {
    const callees = target.metadata.callees as CalleeInfo[] | undefined;
    if (!callees || callees.length === 0) return [];

    return callees.slice(0, limit).map((c) => ({
      name: c.name,
      file: c.file,
      line: c.line,
    }));
  }

  /**
   * Find callers using the reverse callee index.
   * Falls back to empty results if no reverse index is available (v1 graph).
   */
  private getCallersFromIndex(target: SearchResult, limit: number): RefResult[] {
    if (!this.cachedReverseIndex || !this.cachedNameIndex) return [];

    const targetName = (target.metadata.name as string) || '';
    const targetFile = (target.metadata.path as string) || '';
    const targetType = target.metadata.type as string;

    const callers =
      targetType === 'class'
        ? lookupClassCallers(
            this.cachedReverseIndex,
            this.cachedNameIndex,
            targetName,
            targetFile,
            limit
          )
        : lookupCallers(
            this.cachedReverseIndex,
            this.cachedNameIndex,
            targetName,
            targetFile,
            limit
          );

    return callers.map((c) => ({
      name: c.name,
      file: c.file,
      line: c.line,
      type: c.type,
    }));
  }

  /**
   * Format the output as readable text
   */
  private formatOutput(
    result: {
      target: { name: string; file: string; line: number; type: string };
      callees?: RefResult[];
      callers?: RefResult[];
    },
    direction: RefDirection
  ): string {
    const lines: string[] = [];

    lines.push(`# References for ${result.target.name}`);
    lines.push(`**Location:** ${result.target.file}:${result.target.line}`);
    lines.push(`**Type:** ${result.target.type}`);
    lines.push('');

    if (direction === 'callees' || direction === 'both') {
      lines.push('## Callees (what this calls)');
      if (result.callees && result.callees.length > 0) {
        for (const callee of result.callees) {
          const location = callee.file ? `${callee.file}:${callee.line}` : `line ${callee.line}`;
          lines.push(`- \`${callee.name}\` at ${location}`);
        }
      } else {
        lines.push('*No callees found*');
      }
      lines.push('');
    }

    if (direction === 'callers' || direction === 'both') {
      lines.push('## Callers (what calls this)');
      if (result.callers && result.callers.length > 0) {
        for (const caller of result.callers) {
          const location = caller.file ? `${caller.file}:${caller.line}` : `line ${caller.line}`;
          lines.push(`- \`${caller.name}\` (${caller.type}) at ${location}`);
        }
      } else {
        lines.push('*No callers found in indexed code*');
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  estimateTokens(args: Record<string, unknown>): number {
    const { limit = this.config.defaultLimit, direction = 'both' } = args;
    const multiplier = direction === 'both' ? 2 : 1;
    return (limit as number) * 15 * multiplier + 50;
  }
}
