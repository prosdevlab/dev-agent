/**
 * Pattern Matcher — AST-based pattern detection via tree-sitter queries.
 *
 * Provides a runtime-agnostic interface for structural code pattern matching.
 * Current implementation uses web-tree-sitter (WASM). Designed for future
 * swap to @ast-grep/napi (native Rust) if performance requires it.
 */

export {
  ALL_QUERIES,
  ERROR_HANDLING_QUERIES,
  IMPORT_STYLE_QUERIES,
  TYPE_COVERAGE_QUERIES,
} from './rules.js';
export {
  createPatternMatcher,
  type PatternMatcher,
  type PatternMatchRule,
} from './wasm-matcher.js';
