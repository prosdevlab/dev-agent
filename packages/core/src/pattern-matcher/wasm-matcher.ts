/**
 * WASM Pattern Matcher — tree-sitter query-based pattern detection.
 *
 * Uses web-tree-sitter (WASM) to parse source code and run S-expression
 * queries. Handles tree cleanup (WASM heap is not GC'd by JS).
 *
 * Designed for future swap to @ast-grep/napi — the PatternMatcher interface
 * is runtime-agnostic.
 */

import type { TreeSitterLanguage } from '../scanner/tree-sitter.js';
import { runQueries } from '../scanner/tree-sitter.js';

/**
 * A pattern rule — S-expression query with metadata.
 */
export interface PatternMatchRule {
  id: string;
  category: string;
  query: string;
}

/**
 * Runtime-agnostic pattern matcher interface.
 * Returns match counts per query ID.
 */
export interface PatternMatcher {
  match(
    source: string,
    language: string,
    queries: PatternMatchRule[]
  ): Promise<Map<string, number>>;
}

/**
 * File extension → tree-sitter language mapping.
 */
const EXTENSION_TO_LANGUAGE: Record<string, TreeSitterLanguage> = {
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.jsx': 'javascript',
};

/**
 * Resolve a file extension to a tree-sitter language.
 * Returns undefined for unsupported extensions.
 */
export function resolveLanguage(filePath: string): TreeSitterLanguage | undefined {
  const ext = `.${filePath.split('.').pop()?.toLowerCase() ?? ''}`;
  return EXTENSION_TO_LANGUAGE[ext];
}

/**
 * WASM-based PatternMatcher using web-tree-sitter.
 */
class WasmPatternMatcher implements PatternMatcher {
  async match(
    source: string,
    language: string,
    queries: PatternMatchRule[]
  ): Promise<Map<string, number>> {
    // Validate language is supported
    const supportedLanguages = new Set<string>(['typescript', 'tsx', 'javascript', 'go']);
    if (!supportedLanguages.has(language)) {
      return new Map();
    }

    return runQueries(source, language as TreeSitterLanguage, queries);
  }
}

/**
 * Create a PatternMatcher instance.
 * Currently returns WasmPatternMatcher. Future: could return NapiPatternMatcher
 * based on availability.
 */
export function createPatternMatcher(): PatternMatcher {
  return new WasmPatternMatcher();
}
