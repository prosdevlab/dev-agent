/**
 * AST Pattern Rules — verified S-expression queries for tree-sitter.
 *
 * All queries validated against web-tree-sitter@0.25.10 + tree-sitter-wasms@0.1.13
 * by parsing real TypeScript/JavaScript snippets and inspecting AST output.
 *
 * These are string constants, not a DSL. If we ever swap to @ast-grep/napi,
 * add a translation layer at that time (YAGNI).
 */

import type { PatternMatchRule } from './wasm-matcher.js';

// ============================================================================
// Error Handling (5 rules)
// ============================================================================

export const ERROR_HANDLING_QUERIES: PatternMatchRule[] = [
  {
    id: 'try-catch',
    category: 'error-handling',
    query: '(try_statement) @match',
  },
  {
    id: 'throw',
    category: 'error-handling',
    query: '(throw_statement) @match',
  },
  {
    id: 'promise-catch',
    category: 'error-handling',
    query:
      '(call_expression function: (member_expression property: (property_identifier) @method (#eq? @method "catch"))) @match',
  },
  {
    // Intentionally narrow: only catches const/let declarations with await
    // inside try blocks. Does NOT catch bare `await foo()` as expression
    // statements or await nested inside if/for within try.
    id: 'await-in-try',
    category: 'error-handling',
    query:
      '(try_statement body: (statement_block (lexical_declaration (variable_declarator value: (await_expression))))) @match',
  },
  {
    // Matches any class with an extends clause — catches custom error
    // hierarchies (extends BaseError, extends HttpError, etc.), not just
    // direct `extends Error`. May have false positives for non-error classes
    // with extends, but these are rare in error-handling analysis context.
    id: 'error-class',
    category: 'error-handling',
    query: '(class_declaration (class_heritage (extends_clause))) @match',
  },
];

// ============================================================================
// Import Style (3 rules)
// ============================================================================

export const IMPORT_STYLE_QUERIES: PatternMatchRule[] = [
  {
    id: 'dynamic-import',
    category: 'import-style',
    query: '(call_expression function: (import)) @match',
  },
  {
    id: 're-export',
    category: 'import-style',
    query: '(export_statement source: (string)) @match',
  },
  {
    id: 'require',
    category: 'import-style',
    query: '(call_expression function: (identifier) @fn (#eq? @fn "require")) @match',
  },
];

// ============================================================================
// Type Coverage (2 rules)
// ============================================================================

export const TYPE_COVERAGE_QUERIES: PatternMatchRule[] = [
  {
    // Arrow functions with return type — the main win over regex.
    // Regex is fragile on `(a: number, b: number): number => ...`
    id: 'arrow-return-type',
    category: 'type-coverage',
    query: '(arrow_function return_type: (type_annotation)) @match',
  },
  {
    id: 'function-return-type',
    category: 'type-coverage',
    query: '(function_declaration return_type: (type_annotation)) @match',
  },
  {
    // Count ALL arrow functions (typed or not) for accurate denominator
    id: 'arrow-total',
    category: 'type-coverage',
    query: '(arrow_function) @match',
  },
  {
    // Count ALL function declarations (typed or not) for accurate denominator
    id: 'function-total',
    category: 'type-coverage',
    query: '(function_declaration) @match',
  },
];

// ============================================================================
// All rules combined
// ============================================================================

export const ALL_QUERIES: PatternMatchRule[] = [
  ...ERROR_HANDLING_QUERIES,
  ...IMPORT_STYLE_QUERIES,
  ...TYPE_COVERAGE_QUERIES,
];

// ============================================================================
// Python Error Handling (3 rules)
// ============================================================================

export const PYTHON_ERROR_HANDLING_QUERIES: PatternMatchRule[] = [
  {
    id: 'try-except',
    category: 'error-handling',
    query: '(try_statement) @match',
  },
  {
    id: 'raise',
    category: 'error-handling',
    query: '(raise_statement) @match',
  },
  {
    id: 'except-clause',
    category: 'error-handling',
    query: '(except_clause) @match',
  },
];

// ============================================================================
// Python Import Style (3 rules)
// ============================================================================

export const PYTHON_IMPORT_QUERIES: PatternMatchRule[] = [
  {
    id: 'import-module',
    category: 'import-style',
    query: '(import_statement) @match',
  },
  {
    id: 'from-import',
    category: 'import-style',
    query: '(import_from_statement) @match',
  },
  {
    id: 'relative-import',
    category: 'import-style',
    query: '(import_from_statement module_name: (relative_import)) @match',
  },
];

// ============================================================================
// Python Type Coverage (3 rules)
// ============================================================================

export const PYTHON_TYPE_QUERIES: PatternMatchRule[] = [
  {
    id: 'typed-parameter',
    category: 'type-coverage',
    query: '(typed_parameter) @match',
  },
  {
    id: 'py-function-return-type',
    category: 'type-coverage',
    query: '(function_definition return_type: (type)) @match',
  },
  {
    id: 'py-function-total',
    category: 'type-coverage',
    query: '(function_definition) @match',
  },
];

// ============================================================================
// All Python rules combined
// ============================================================================

export const ALL_PYTHON_QUERIES: PatternMatchRule[] = [
  ...PYTHON_ERROR_HANDLING_QUERIES,
  ...PYTHON_IMPORT_QUERIES,
  ...PYTHON_TYPE_QUERIES,
];

// ============================================================================
// Go Error Handling + Concurrency (5 rules)
// ============================================================================

export const GO_ERROR_HANDLING_QUERIES: PatternMatchRule[] = [
  {
    id: 'go-if-err',
    category: 'error-handling',
    query: '(if_statement condition: (binary_expression right: (nil))) @match',
  },
  {
    id: 'go-defer',
    category: 'error-handling',
    query: '(defer_statement) @match',
  },
];

export const GO_CONCURRENCY_QUERIES: PatternMatchRule[] = [
  {
    id: 'go-goroutine',
    category: 'concurrency',
    query: '(go_statement) @match',
  },
  {
    id: 'go-channel-send',
    category: 'concurrency',
    query: '(send_statement) @match',
  },
];

export const ALL_GO_QUERIES: PatternMatchRule[] = [
  ...GO_ERROR_HANDLING_QUERIES,
  ...GO_CONCURRENCY_QUERIES,
];

// ============================================================================
// Rust Error Handling + Unsafe + Types (5 rules)
// ============================================================================

export const RUST_ERROR_HANDLING_QUERIES: PatternMatchRule[] = [
  {
    id: 'rust-try-operator',
    category: 'error-handling',
    query: '(try_expression) @match',
  },
  {
    id: 'rust-match',
    category: 'error-handling',
    query: '(match_expression) @match',
  },
];

export const RUST_UNSAFE_QUERIES: PatternMatchRule[] = [
  {
    id: 'rust-unsafe-block',
    category: 'unsafe',
    query: '(unsafe_block) @match',
  },
];

export const RUST_TYPE_QUERIES: PatternMatchRule[] = [
  {
    id: 'rust-impl-block',
    category: 'types',
    query: '(impl_item) @match',
  },
  {
    id: 'rust-trait-def',
    category: 'types',
    query: '(trait_item) @match',
  },
];

export const ALL_RUST_QUERIES: PatternMatchRule[] = [
  ...RUST_ERROR_HANDLING_QUERIES,
  ...RUST_UNSAFE_QUERIES,
  ...RUST_TYPE_QUERIES,
];
