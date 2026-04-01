# Phase 5: Go Callee Extraction + Rust Language Support

**Status:** Draft

## Context

Phase 4 added Python support. The scanner pipeline now handles TypeScript/JavaScript
(ts-morph), Go (tree-sitter), Python (tree-sitter), and Markdown (remark).

Go has a working scanner but **no callee extraction** — functions and methods are indexed
but the call graph is empty for Go files. This means `dev_refs` can't trace Go call chains
and `dev_map` hot paths miss Go dependencies.

Rust has **no scanner at all**. `tree-sitter-rust.wasm` is already bundled in
`tree-sitter-wasms@0.1.13` — zero new deps needed. The registry already maps `.rs` to
`rust` in `getExtensionsForLanguage`. The wiring is ready, just needs the scanner.

### What exists

```
┌──────────────────────────────────────────────────────────────┐
│  Language   │ Scanner │ Callees │ Patterns │ Test Detection  │
├─────────────┼─────────┼─────────┼──────────┼─────────────────┤
│ TypeScript  │   ts-morph  │    ✓    │    ✓     │ .test., .spec.  │
│ JavaScript  │   ts-morph  │    ✓    │    ✓     │ .test., .spec.  │
│ Python      │ tree-sitter │    ✓    │    ✓     │ test_*, *_test   │
│ Go          │ tree-sitter │    ✗    │    ✗     │ _test.go         │
│ Rust        │    none     │    ✗    │    ✗     │     none         │
│ Markdown    │   remark    │   n/a   │   n/a    │     n/a          │
└─────────────┴─────────────┴─────────┴──────────┴─────────────────┘
```

### What this phase delivers

```
┌──────────────────────────────────────────────────────────────┐
│  Language   │ Scanner │ Callees │ Patterns │ Test Detection  │
├─────────────┼─────────┼─────────┼──────────┼─────────────────┤
│ Go          │ tree-sitter │    ✓    │    ✓     │ _test.go         │
│ Rust        │ tree-sitter │    ✓    │    ✓     │ tests/, _test.rs │
└─────────────┴─────────────┴─────────┴──────────┴─────────────────┘
```

After Phase 5, all MCP tools (`dev_search`, `dev_refs`, `dev_map`, `dev_patterns`) work
with Go and Rust automatically.

---

## Proposed architecture

### Go callee extraction

```
┌──────────────────────────────────────────────────┐
│  go.ts (existing)                                │
│                                                  │
│  extractFunctions()  ──► now includes callees    │
│  extractMethods()    ──► now includes callees    │
│         │                                        │
│         ▼                                        │
│  walkCallNodes(node)                             │
│    recursive walk, same pattern as python.ts     │
│    node.type === 'call_expression'               │
│    callee text from 'function' child             │
│    line from node.startPosition.row              │
└──────────────────────────────────────────────────┘

Go call_expression structure:
  (call_expression
    function: (selector_expression     ← fmt.Println
      operand: (identifier)            ← fmt
      field: (field_identifier))       ← Println
    arguments: (argument_list ...))

  (call_expression
    function: (identifier)             ← localFunc
    arguments: (argument_list ...))
```

### Rust scanner

```
┌──────────────────────────────────────────────────┐
│  rust.ts (new)                                   │
│                                                  │
│  canHandle('.rs')                                │
│  scan(files, repoRoot)                           │
│    ├── extractFunctions()    ← function_item     │
│    ├── extractStructs()      ← struct_item       │
│    ├── extractEnums()        ← enum_item         │
│    ├── extractTraits()       ← trait_item        │
│    ├── extractMethods()      ← impl_item > fn    │
│    ├── extractImports()      ← use_declaration   │
│    └── extractCallees()      ← call_expression   │
│                                                  │
│  rust-queries.ts                                 │
│    S-expression queries for each node type       │
└──────────────────────────────────────────────────┘

Rust impl block association:
  (impl_item
    type: (type_identifier) @receiver    ← Server
    body: (declaration_list
      (function_item
        name: (identifier) @name         ← handle_request
        ...)))

  → document name: "Server.handle_request"
```

### Pipeline wiring (both languages)

```
Touch points:
  tree-sitter.ts        → add 'rust' to TreeSitterLanguage union
  scanner/index.ts      → import + register RustScanner
  wasm-matcher.ts       → add '.go': 'go' and '.rs': 'rust'
  copy-wasm.js          → add 'rust' to SUPPORTED_LANGUAGES
  test-utils.ts         → add Rust entries to TEST_PATTERNS + TEST_PATH_GENERATORS
  pattern-analysis.ts   → add 'go' and 'rust' to QUERIES_BY_LANGUAGE map
  rules.ts              → add ALL_GO_QUERIES and ALL_RUST_QUERIES
```

---

## Parts

| Part | Description | Risk |
|------|-------------|------|
| [5.1](./5.1-go-callees.md) | Go callee extraction + Go pattern rules + fixture + tests | Low — existing scanner, additive |
| [5.2](./5.2-rust-scanner.md) | Rust scanner + queries + pattern rules + fixtures + tests | Medium — new scanner, impl block logic |
| [5.3](./5.3-wiring-and-verification.md) | Pipeline wiring, docs, local real-repo verification | Low — mechanical |

---

## Decisions

| Decision | Rationale | Alternatives |
|----------|-----------|-------------|
| Recursive AST walk for callees (not query) | Matches Python pattern, handles nested calls naturally | tree-sitter query: harder to capture all nesting levels |
| `impl_item` parent walk for method naming | Rust methods are inside impl blocks — need parent context | Flat function extraction: loses the `Type.method` naming |
| Skip macro callees (`println!`, `vec!`) | Macros aren't function calls — different semantics. Include as future work. | Include: would need `macro_invocation` node handling |
| `pub` keyword for export detection | Rust's visibility is explicit. `pub fn` = exported, `fn` = private. | Parse `pub(crate)`, `pub(super)`: future refinement |
| Doc comments via `///` prefix | tree-sitter-rust exposes these as `line_comment` nodes. Filter by `///` prefix. | Attribute doc: `#[doc = "..."]` — rare, skip for now |
| Test detection: `tests/` dir + `_test.rs` | Covers integration tests and the common convention. Inline `#[cfg(test)]` deferred. | Parse `#[cfg(test)]`: would flag functions inside test modules — more complex |
| Self-contained fixtures, real-repo local test | Unit tests with fixtures for CI. Clone real repos for manual verification. | Real-repo in CI: too slow, too flaky |

---

## Risk register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| tree-sitter-rust grammar node names differ from docs | Medium | Low | Validate with parse test before writing queries |
| `impl` block association misses trait impls | Medium | Low | Start with `impl Type`, add `impl Trait for Type` as follow-up |
| Go callee extraction too noisy (stdlib calls) | Low | Low | Callees already include all calls in TS/Python — consistent |
| Rust WASM grammar large or slow | Low | Low | Python WASM is 476KB, Go is similar. Lazy-loaded per file. |
| Real-repo test finds edge cases we can't handle | Medium | Low | Track in scratchpad as known limitations. Don't block on edge cases. |

---

## Test strategy

| Test | Priority | What it verifies |
|------|----------|-----------------|
| Go: callee extraction from functions | P0 | `walkCallNodes` returns correct callees |
| Go: callee extraction from methods | P0 | Methods have callees with correct names/lines |
| Go: callee deduplication | P1 | Same call on same line not duplicated |
| Go: no callees for interfaces/types | P1 | Non-callable types return no callees |
| Go: pattern rules fire | P1 | Error handling, goroutine, defer patterns detected |
| Rust: canHandle('.rs') | P0 | Scanner claims Rust files |
| Rust: extract functions | P0 | Free functions with name, line, signature, exported |
| Rust: extract methods from impl | P0 | `Type.method` naming, correct line numbers |
| Rust: extract structs/enums/traits | P0 | All type definitions captured |
| Rust: extract imports | P0 | `use` declarations captured |
| Rust: callee extraction | P0 | Function calls and method calls in callees |
| Rust: doc comment extraction | P1 | `///` comments extracted as docstrings |
| Rust: pub vs non-pub | P1 | `pub fn` → exported: true, `fn` → exported: false |
| Rust: pattern rules fire | P1 | Result/Option, unsafe, match patterns detected |
| Rust: isTestFile for tests/ dir | P1 | Files in tests/ directory flagged |
| Local: `dev index` on cli/cli (Go) | P0 | Indexes without crash, callees populated |
| Local: `dev index` on ripgrep (Rust) | P0 | Indexes without crash, functions/structs captured |
| Local: `dev map` on both repos | P1 | Hot paths show real Go/Rust files |
| Local: `dev refs` on both repos | P1 | Callers/callees work for Go/Rust symbols |

---

## Verification checklist

### Automated (CI)
- [ ] Go callee tests pass
- [ ] Rust scanner tests pass (all extraction types)
- [ ] Pattern rules tests pass for Go and Rust
- [ ] `pnpm build && pnpm test` passes
- [ ] `pnpm typecheck` clean
- [ ] `pnpm lint` clean

### Manual (local, real repos)

**Go — clone `cli/cli`:**
```bash
cd /tmp && git clone --depth 1 https://github.com/cli/cli.git gh-cli
cd gh-cli && dev index
dev map --depth 2               # Should show Go hot paths
dev refs "NewCmdRoot"           # Should find callers/callees
dev search "authentication"     # Should find Go auth code
```

**Rust — clone `BurntSushi/ripgrep`:**
```bash
cd /tmp && git clone --depth 1 https://github.com/BurntSushi/ripgrep.git
cd ripgrep && dev index
dev map --depth 2               # Should show Rust hot paths
dev refs "main"                 # Should find callers/callees
dev search "grep pattern"       # Should find search code
```

- [ ] Go repo indexes without crash
- [ ] Go repo has callees in `dev refs` output
- [ ] Go repo `dev map` shows hot paths (not all empty)
- [ ] Rust repo indexes without crash
- [ ] Rust repo `dev refs` shows callers/callees
- [ ] Rust repo `dev map` shows hot paths

---

## Commit strategy

```
1. feat(core): add Go callee extraction and pattern rules
2. feat(core): add Rust scanner with full extraction
3. feat(core): wire Go and Rust into pattern matcher and pipeline
4. docs: update language lists and add changelog
```

---

## Dependencies

- Phase 4 (Python support) — merged
- `tree-sitter-wasms@0.1.13` — already bundled, includes `tree-sitter-rust.wasm`
- No new npm dependencies
