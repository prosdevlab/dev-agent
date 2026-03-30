/**
 * MCP Prompts Registry
 * Defines reusable prompt templates that guide users through common workflows
 */

import type { PromptDefinition } from './protocol/types';

/**
 * Prompt message with role and content
 */
export interface PromptMessage {
  role: 'user' | 'assistant';
  content: {
    type: 'text';
    text: string;
  };
}

/**
 * Complete prompt with messages
 */
export interface Prompt {
  description?: string;
  messages: PromptMessage[];
}

/**
 * Registry of all available prompts
 */
export class PromptRegistry {
  private prompts: Map<
    string,
    { definition: PromptDefinition; generator: (args: Record<string, string>) => Prompt }
  > = new Map();

  constructor() {
    this.registerDefaultPrompts();
  }

  /**
   * Register default prompts that ship with dev-agent
   */
  private registerDefaultPrompts(): void {
    // Search for Code Pattern
    this.register(
      {
        name: 'find-pattern',
        description: 'Search the codebase for specific patterns or functionality',
        arguments: [
          {
            name: 'description',
            description:
              'What to search for (e.g., "authentication middleware", "database queries")',
            required: true,
          },
          {
            name: 'file_types',
            description: 'Comma-separated file extensions to filter (e.g., ".ts,.js")',
            required: false,
          },
        ],
      },
      (args) => ({
        description: `Find code matching: ${args.description}`,
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Find all code related to "${args.description}" in the repository.

Use dev_search to search for: ${args.description}${args.file_types ? `\nNote: You can use fileTypes parameter if needed` : ''}

Then provide:
1. Summary of what you found
2. Key files and their purposes
3. Common patterns or approaches used
4. Suggestions for modifications if relevant`,
            },
          },
        ],
      })
    );

    // Repository Status Overview
    this.register(
      {
        name: 'repo-overview',
        description: 'Get comprehensive overview of repository health and statistics',
        arguments: [],
      },
      () => ({
        description: 'Repository health and statistics overview',
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Provide a comprehensive overview of the repository status:

1. Use dev_status with section "summary" and format "verbose" for detailed stats
2. Summarize:
   - Repository health (indexing status, storage size)
   - Code metrics (files, components, vectors)
   - Any recommendations for maintenance`,
            },
          },
        ],
      })
    );

    // Find Similar Code
    this.register(
      {
        name: 'find-similar',
        description: 'Find code similar to a specific file or component',
        arguments: [
          {
            name: 'file_path',
            description: 'Path to the file to find similar code for',
            required: true,
          },
          {
            name: 'threshold',
            description: 'Similarity threshold (0-1, default: 0.7)',
            required: false,
          },
        ],
      },
      (args) => ({
        description: `Find code similar to ${args.file_path}`,
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Find code that is similar to "${args.file_path}":

Use dev_patterns with:
- query: "${args.file_path}"${args.threshold ? `\n- threshold: ${args.threshold}` : ''}
- format: "verbose"

Then explain:
1. What patterns the file uses (import style, error handling, type coverage)
2. Other files with similar patterns
3. How they compare (consistent vs different patterns)
4. Opportunities for refactoring or code reuse`,
            },
          },
        ],
      })
    );

    // Code Relationships
    this.register(
      {
        name: 'explore-relationships',
        description: 'Explore dependencies and relationships in the codebase',
        arguments: [
          {
            name: 'file_path',
            description: 'Path to the file to analyze relationships for',
            required: true,
          },
        ],
      },
      (args) => ({
        description: `Explore relationships for ${args.file_path}`,
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Analyze the relationships and dependencies for "${args.file_path}":

Use dev_refs to find what calls or is called by functions in this file.

Alternatively, use dev_patterns with:
- query: "${args.file_path}"
- format: "verbose"

to find similar implementations and pattern analysis.

Then explain:
1. What this file depends on (imports)
2. What depends on this file (used by)
3. Key integration points
4. Impact analysis (what breaks if this changes)
5. Refactoring considerations`,
            },
          },
        ],
      })
    );

    // Quick Search
    this.register(
      {
        name: 'quick-search',
        description: 'Quick semantic search across the codebase',
        arguments: [
          {
            name: 'query',
            description: 'What to search for',
            required: true,
          },
          {
            name: 'limit',
            description: 'Number of results (default: 10)',
            required: false,
          },
        ],
      },
      (args) => ({
        description: `Search for: ${args.query}`,
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Search the codebase for "${args.query}":

Use dev_search with:
- query: "${args.query}"
- format: "verbose"${args.limit ? `\n- limit: ${args.limit}` : ''}

Summarize the findings and their relevance.`,
            },
          },
        ],
      })
    );
  }

  /**
   * Register a prompt
   */
  private register(
    definition: PromptDefinition,
    generator: (args: Record<string, string>) => Prompt
  ): void {
    this.prompts.set(definition.name, { definition, generator });
  }

  /**
   * Get all prompt definitions
   */
  listPrompts(): PromptDefinition[] {
    return Array.from(this.prompts.values()).map((p) => p.definition);
  }

  /**
   * Get a specific prompt with arguments
   */
  getPrompt(name: string, args: Record<string, string> = {}): Prompt | null {
    const prompt = this.prompts.get(name);
    if (!prompt) {
      return null;
    }

    // Validate required arguments
    const required = prompt.definition.arguments?.filter((arg) => arg.required) || [];
    for (const arg of required) {
      if (!args[arg.name]) {
        throw new Error(`Missing required argument: ${arg.name}`);
      }
    }

    return prompt.generator(args);
  }

  /**
   * Check if a prompt exists
   */
  hasPrompt(name: string): boolean {
    return this.prompts.has(name);
  }
}
