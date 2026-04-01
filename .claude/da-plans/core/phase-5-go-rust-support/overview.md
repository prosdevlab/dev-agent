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
| Validate grammar before building | Step 0 parse test confirms node names. Prevents building on wrong assumptions. | Trust docs: risky, grammar may differ from documentation |
| Recursive AST walk for callees (not query) | Matches Python pattern, handles nested calls naturally | tree-sitter query: harder to capture all nesting levels |
| `call_expression` for all Rust calls | tree-sitter-rust uses `call_expression` for bare calls AND method calls (via `field_expression` child). No separate `method_call` node. | N/A — grammar doesn't offer alternatives |
| Full selector text for Go callees | `"fmt.Println"` not `"Println"`. Matches TS scanner behavior, gives agents package context. | Short name only: loses context |
| `impl_item.type` field for method naming | Use the `type` field on `impl_item` — holds the concrete type in both `impl Type` and `impl Trait for Type`. Strip generic params (`<T>`) for document name. | Positional child walking: fragile, depends on child order |
| Strip generic type params from impl | `Container<T>.show` → `Container.show`. Use `.replace(/<.*>/, '')` (mirrors Go scanner's `replace(/\[.*\]/, '')` for type params). | Keep full generic name: hurts search matching |
| Skip macro callees (`println!`, `vec!`) | Macros are `macro_invocation` nodes, not `call_expression`. Different semantics. Explicit negative test locks in decision. | Include: would need `macro_invocation` node handling |
| `pub` keyword for export detection | Rust's visibility is explicit. `pub fn` = exported, `fn` = private. All `visibility_modifier` variants (`pub`, `pub(crate)`, `pub(super)`) → exported: true. | N/A — pragmatic v1 |
| Async via AST child node, not regex | tree-sitter-rust exposes `async` as a keyword child on `function_item`. More reliable than regex against full text. | Regex: fragile if text includes "async" in comments |
| Doc comments via `///` prefix only | tree-sitter-rust exposes as `line_comment` nodes. `//!` inner docs and `/** */` block docs deferred to v2. | Include all doc forms: more complex, diminishing returns |
| Test detection: `tests/` dir + `_test.rs` | Covers integration tests and the common convention. Inline `#[cfg(test)]` deferred. | Parse `#[cfg(test)]`: would flag functions inside test modules — more complex |
| Self-contained fixtures, real-repo local test | Unit tests with fixtures for CI. Clone real repos for manual verification. | Real-repo in CI: too slow, too flaky |
| Type is `PatternMatchRule` with `{ id, category, query }` | Matches existing interface and all rules in `rules.ts`. All queries need `@match` capture alias. | N/A — compiler enforces |

---

## Risk register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| tree-sitter-rust grammar node names differ from docs | Medium | Low | Step 0 validation test confirms names before building. Keep test as reference. |
| `impl` block association misses trait impls | Medium | Low | Handle both `impl Type` and `impl Trait for Type` in v1. Test both forms. |
| Generic impl names include type params | Medium | Low | Strip `<...>` from type name. Explicit test: `Container.show` not `Container<T>.show`. |
| Go callee extraction too noisy (stdlib calls) | Low | Low | Callees already include all calls in TS/Python — consistent |
| Rust WASM grammar large or slow | Low | Low | Python WASM is 476KB, Go is similar. Lazy-loaded per file. |
| Real-repo test finds edge cases we can't handle | Medium | Low | Track in scratchpad as known limitations. Don't block on edge cases. |
| Malformed Rust files crash scanner | Low | Medium | Explicit test with `rust-malformed.rs` fixture. Scanner returns empty, no crash. |
| `.go` extension missing from pattern matcher | Already broken | Low | Fix in Part 5.1 with regression test for `resolveLanguage('.go')` |
| Block doc comments (`/** */`) missed | Low | Low | Track in scratchpad. `///` covers 95%+ of real Rust code. |

---

## Test strategy

| Test | Priority | What it verifies |
|------|----------|-----------------|
| Go: callee extraction from functions | P0 | `walkCallNodes` returns correct callees |
| Go: callee name format (full selector) | P0 | `"fmt.Println"` not `"Println"` |
| Go: callee extraction from methods | P0 | Methods have callees with correct names/lines |
| Go: callee deduplication | P1 | Same call on same line not duplicated |
| Go: no callees for interfaces/types | P1 | Non-callable types return no callees |
| Go: pattern rules fire | P1 | Error handling, goroutine, defer patterns detected |
| Go: resolveLanguage('.go') | P0 | Bug fix regression test |
| Rust: Step 0 grammar validation | P0 | Confirm node names before building scanner |
| Rust: canHandle('.rs') | P0 | Scanner claims Rust files |
| Rust: extract functions | P0 | Free functions with name, line, signature, exported |
| Rust: extract methods from impl | P0 | `Type.method` naming, correct line numbers |
| Rust: impl Trait for Type | P0 | `Server.handle` uses concrete type, `Server.fmt` for Display |
| Rust: extract structs/enums/traits | P0 | All type definitions captured |
| Rust: extract imports | P0 | `use` declarations captured |
| Rust: callee extraction | P0 | Function calls and method calls in callees |
| Rust: macros NOT in callees | P0 | `println!`, `format!` excluded from callee list |
| Rust: doc comment extraction | P1 | `///` comments extracted as docstrings |
| Rust: pub vs non-pub | P1 | `pub fn` → exported: true, `fn` → exported: false |
| Rust: pattern rules fire | P1 | Result/Option, unsafe, match patterns detected |
| Rust: isTestFile for tests/ dir | P1 | Files in tests/ directory flagged |
| Rust: malformed file resilience | P0 | Scanner returns empty documents, no crash |
| Rust: generic impl type param stripping | P0 | `Container.show` not `Container<T>.show` |
| Rust: `pub(crate)` visibility | P1 | `pub(crate) fn` → exported: true |
| Rust: callees inside closures | P1 | `transform` in `.map(\|x\| transform(x))` captured |
| Rust: async via AST child | P1 | `async fn` detected via keyword child, not regex |
| Rust: `self.field` NOT a callee | P1 | Field access excluded, only `self.method()` calls |
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

## Known Limitations (v1)

Intentional scope limits, documented for transparency. Not bugs — tracked for v2.

1. **`//!` inner doc comments not extracted.** Module-level docs (`//!` at top of `lib.rs`) are skipped. Only `///` outer doc comments (item-level) are captured.
2. **`/** */` block doc comments not extracted.** Rare in practice — `///` covers 95%+ of real Rust code.
3. **Trait default method bodies not extracted.** `trait Foo { fn bar(&self) { ... } }` — the default implementation body and its callees are not captured. Only the trait definition itself is indexed.
4. **`#[cfg(test)]` inline test modules not detected.** `isTestFile` only checks path patterns (`tests/`, `_test.rs`). Functions inside `#[cfg(test)] mod tests { ... }` are not flagged as test code.
5. **Macro invocations not in callees.** `println!`, `vec!`, `format!` etc. are intentionally excluded. They're `macro_invocation` nodes, not function calls.

---

## Dependencies

- Phase 4 (Python support) — merged
- `tree-sitter-wasms@0.1.13` — already bundled, includes `tree-sitter-rust.wasm`
- No new npm dependencies
