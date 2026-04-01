/**
 * Pattern Matcher — AST-based pattern detection via tree-sitter queries.
 *
 * Provides a runtime-agnostic interface for structural code pattern matching.
 * Current implementation uses web-tree-sitter (WASM). Designed for future
 * swap to @ast-grep/napi (native Rust) if performance requires it.
 */

export {
  ALL_PYTHON_QUERIES,
  ALL_QUERIES,
  ERROR_HANDLING_QUERIES,
  IMPORT_STYLE_QUERIES,
  PYTHON_ERROR_HANDLING_QUERIES,
  PYTHON_IMPORT_QUERIES,
  PYTHON_TYPE_QUERIES,
  TYPE_COVERAGE_QUERIES,
} from './rules.js';
export {
  createPatternMatcher,
  type PatternMatcher,
  type PatternMatchRule,
} from './wasm-matcher.js';
