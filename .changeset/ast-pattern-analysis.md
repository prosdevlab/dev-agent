---
'@prosdevlab/dev-agent': patch
---

AST-based pattern analysis via tree-sitter queries

- `dev_patterns` now uses tree-sitter AST queries for more accurate detection of error handling (try/catch, promise.catch, error classes), import style (dynamic imports, precise require), and type coverage (arrow function return types)
- Bundles tree-sitter grammars for TypeScript, TSX, JavaScript — covers the full JS/TS ecosystem
- Regex fallback preserved for unsupported file types (.go, .md, etc.)
- 12 verified S-expression queries with 51 tests (exact match counts, negative cases, edge cases)
