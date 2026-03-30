/**
 * Context Assembler
 * Assembles rich context packages for LLM consumption
 *
 * Philosophy: Provide raw, structured context - let the LLM do the reasoning
 *
 * Note: GitHub issue fetching was removed in Phase 2. Use GitHub's own MCP
 * server or the gh CLI for issue context.
 */

import type { RepositoryIndexer } from '@prosdevlab/dev-agent-core';
import type {
  CodebasePatterns,
  ContextAssemblyOptions,
  ContextMetadata,
  ContextPackage,
  IssueContext,
  RelatedHistory,
  RelevantCodeContext,
} from '../context-types';

/** Default options for context assembly */
const DEFAULT_OPTIONS: Required<ContextAssemblyOptions> = {
  includeCode: true,
  includeHistory: true,
  includePatterns: true,
  includeGitHistory: true,
  maxCodeResults: 10,
  maxHistoryResults: 5,
  maxGitCommitResults: 5,
  tokenBudget: 4000,
};

/**
 * Context for assembly
 */
export interface ContextAssemblyContext {
  indexer: RepositoryIndexer | null;
}

/**
 * Assemble a context package for a GitHub issue
 *
 * @param issueNumber - GitHub issue number
 * @param indexer - Repository indexer for code search
 * @param repositoryPath - Path to repository
 * @param options - Assembly options
 * @returns Complete context package
 */
export async function assembleContext(
  issueNumber: number,
  indexer: RepositoryIndexer | null,
  repositoryPath: string,
  options?: ContextAssemblyOptions
): Promise<ContextPackage>;

/**
 * Assemble a context package with context object
 *
 * @param issueNumber - GitHub issue number
 * @param context - Context with indexer
 * @param repositoryPath - Path to repository
 * @param options - Assembly options
 * @returns Complete context package
 */
export async function assembleContext(
  issueNumber: number,
  context: ContextAssemblyContext,
  repositoryPath: string,
  options?: ContextAssemblyOptions
): Promise<ContextPackage>;

export async function assembleContext(
  issueNumber: number,
  indexerOrContext: RepositoryIndexer | null | ContextAssemblyContext,
  repositoryPath: string,
  options: ContextAssemblyOptions = {}
): Promise<ContextPackage> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Normalize input
  const context: ContextAssemblyContext =
    indexerOrContext && 'indexer' in indexerOrContext
      ? indexerOrContext
      : { indexer: indexerOrContext as RepositoryIndexer | null };

  // GitHub issue fetching removed in Phase 2 — use GitHub MCP server
  // or gh CLI for issue context. Create a placeholder issue context.
  const issueContext: IssueContext = {
    number: issueNumber,
    title: `Issue #${issueNumber}`,
    body: '',
    labels: [],
    author: 'unknown',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    state: 'open',
    comments: [],
  };

  // Search for relevant code
  let relevantCode: RelevantCodeContext[] = [];
  if (opts.includeCode && context.indexer) {
    relevantCode = await findRelevantCode(issueContext, context.indexer, opts.maxCodeResults);
  }

  // Detect codebase patterns
  let codebasePatterns: CodebasePatterns = {};
  if (opts.includePatterns && context.indexer) {
    codebasePatterns = await detectCodebasePatterns(context.indexer);
  }

  // Related history (no longer fetched)
  const relatedHistory: RelatedHistory[] = [];

  // Calculate approximate token count
  const tokensUsed = estimateTokens(issueContext, relevantCode, codebasePatterns, relatedHistory);

  // Assemble metadata
  const metadata: ContextMetadata = {
    generatedAt: new Date().toISOString(),
    tokensUsed,
    codeSearchUsed: opts.includeCode && context.indexer !== null,
    historySearchUsed: false,
    gitHistorySearchUsed: false,
    repositoryPath,
  };

  return {
    issue: issueContext,
    relevantCode,
    codebasePatterns,
    relatedHistory,
    relatedCommits: [],
    metadata,
  };
}

/**
 * Find relevant code using semantic search
 */
async function findRelevantCode(
  issue: IssueContext,
  indexer: RepositoryIndexer,
  maxResults: number
): Promise<RelevantCodeContext[]> {
  // Build search query from issue title and body
  const searchQuery = buildSearchQuery(issue);

  try {
    const results = await indexer.search(searchQuery, {
      limit: maxResults,
      scoreThreshold: 0.5,
    });

    return results.map((r) => ({
      file: (r.metadata.path as string) || (r.metadata.file as string) || '',
      name: (r.metadata.name as string) || 'unknown',
      type: (r.metadata.type as string) || 'unknown',
      snippet: (r.metadata.snippet as string) || '',
      relevanceScore: r.score,
      reason: inferRelevanceReason(r.metadata, issue),
    }));
  } catch {
    // Return empty array if search fails
    return [];
  }
}

/**
 * Build a search query from issue content
 */
function buildSearchQuery(issue: IssueContext): string {
  // Combine title and first part of body for search
  const bodyPreview = (issue.body || '').slice(0, 500);

  // Extract key terms (simple heuristic)
  const combined = `${issue.title} ${bodyPreview}`;

  // Remove markdown artifacts
  const cleaned = combined
    .replace(/```[\s\S]*?```/g, '') // Remove code blocks
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Remove links, keep text
    .replace(/[#*_`]/g, '') // Remove markdown formatting
    .trim();

  return cleaned;
}

/**
 * Infer why a code result is relevant
 */
function inferRelevanceReason(metadata: Record<string, unknown>, issue: IssueContext): string {
  const name = (metadata.name as string) || '';
  const type = (metadata.type as string) || '';
  const title = issue.title.toLowerCase();

  // Simple heuristics for reason
  if (title.includes(name.toLowerCase())) {
    return `Name matches issue title`;
  }

  if (type === 'function' || type === 'method') {
    return `Similar function pattern`;
  }

  if (type === 'class') {
    return `Related class structure`;
  }

  if (type === 'interface' || type === 'type') {
    return `Relevant type definition`;
  }

  return `Semantic similarity`;
}

/**
 * Detect codebase patterns from indexed data
 */
async function detectCodebasePatterns(indexer: RepositoryIndexer): Promise<CodebasePatterns> {
  // Search for test files to detect test pattern
  let testPattern: string | undefined;
  let testLocation: string | undefined;

  try {
    const testResults = await indexer.search('test describe it expect', {
      limit: 5,
      scoreThreshold: 0.5,
    });

    if (testResults.length > 0) {
      const testPath = (testResults[0].metadata.path as string) || '';
      if (testPath.includes('.test.')) {
        testPattern = '*.test.ts';
      } else if (testPath.includes('.spec.')) {
        testPattern = '*.spec.ts';
      }

      if (testPath.includes('__tests__')) {
        testLocation = '__tests__/';
      } else if (testPath.includes('/test/')) {
        testLocation = 'test/';
      }
    }
  } catch {
    // Ignore errors in pattern detection
  }

  return {
    testPattern,
    testLocation,
  };
}

/**
 * Estimate token count for context package
 */
function estimateTokens(
  issue: IssueContext,
  code: RelevantCodeContext[],
  patterns: CodebasePatterns,
  history: RelatedHistory[]
): number {
  // Rough estimation: ~4 chars per token
  let chars = 0;

  // Issue content
  chars += issue.title.length;
  chars += issue.body.length;
  chars += issue.comments.reduce((sum, c) => sum + c.body.length, 0);

  // Code snippets
  chars += code.reduce(
    (sum, c) => sum + (c.snippet?.length || 0) + c.file.length + c.name.length,
    0
  );

  // Patterns (small)
  chars += JSON.stringify(patterns).length;

  // History
  chars += history.reduce((sum, h) => sum + h.title.length + (h.summary?.length || 0), 0);

  return Math.ceil(chars / 4);
}

/**
 * Format context package for LLM consumption
 */
export function formatContextPackage(context: ContextPackage): string {
  const lines: string[] = [];

  // Issue section
  lines.push(`# Issue #${context.issue.number}: ${context.issue.title}`);
  lines.push('');
  lines.push(
    `**Author:** ${context.issue.author} | **State:** ${context.issue.state} | **Labels:** ${context.issue.labels.join(', ') || 'none'}`
  );
  lines.push('');
  lines.push('## Description');
  lines.push('');
  lines.push(context.issue.body || '_No description provided_');
  lines.push('');

  // Comments
  if (context.issue.comments.length > 0) {
    lines.push('## Comments');
    lines.push('');
    for (const comment of context.issue.comments) {
      lines.push(`**${comment.author}** (${comment.createdAt}):`);
      lines.push(comment.body);
      lines.push('');
    }
  }

  // Relevant code
  if (context.relevantCode.length > 0) {
    lines.push('## Relevant Code');
    lines.push('');
    for (const code of context.relevantCode) {
      lines.push(`### ${code.name} (${code.type})`);
      lines.push(
        `**File:** \`${code.file}\` | **Relevance:** ${(code.relevanceScore * 100).toFixed(0)}%`
      );
      lines.push(`**Reason:** ${code.reason}`);
      lines.push('');
      if (code.snippet) {
        lines.push('```typescript');
        lines.push(code.snippet);
        lines.push('```');
        lines.push('');
      }
    }
  }

  // Codebase patterns
  if (context.codebasePatterns.testPattern || context.codebasePatterns.testLocation) {
    lines.push('## Codebase Patterns');
    lines.push('');
    if (context.codebasePatterns.testPattern) {
      lines.push(`- **Test naming:** ${context.codebasePatterns.testPattern}`);
    }
    if (context.codebasePatterns.testLocation) {
      lines.push(`- **Test location:** ${context.codebasePatterns.testLocation}`);
    }
    lines.push('');
  }

  // Related history
  if (context.relatedHistory.length > 0) {
    lines.push('## Related History');
    lines.push('');
    for (const item of context.relatedHistory) {
      const typeLabel = item.type === 'pr' ? 'PR' : 'Issue';
      lines.push(`- **${typeLabel} #${item.number}:** ${item.title} (${item.state})`);
    }
    lines.push('');
  }

  // Related commits
  if (context.relatedCommits.length > 0) {
    lines.push('## Related Commits');
    lines.push('');
    for (const commit of context.relatedCommits) {
      const issueLinks =
        commit.issueRefs.length > 0
          ? ` (refs: ${commit.issueRefs.map((n) => `#${n}`).join(', ')})`
          : '';
      lines.push(`- **\`${commit.hash}\`** ${commit.subject}${issueLinks}`);
      lines.push(`  - *${commit.author}* on ${commit.date.split('T')[0]}`);
      if (commit.filesChanged.length > 0) {
        const files =
          commit.filesChanged.length <= 3
            ? commit.filesChanged.map((f) => `\`${f}\``).join(', ')
            : `${commit.filesChanged
                .slice(0, 3)
                .map((f) => `\`${f}\``)
                .join(', ')} +${commit.filesChanged.length - 3} more`;
        lines.push(`  - Files: ${files}`);
      }
    }
    lines.push('');
  }

  // Metadata
  lines.push('---');
  lines.push(
    `*Context assembled at ${context.metadata.generatedAt} | ~${context.metadata.tokensUsed} tokens*`
  );

  return lines.join('\n');
}
