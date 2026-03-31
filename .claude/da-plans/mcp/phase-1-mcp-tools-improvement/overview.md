# Phase 1: MCP Tools Improvement

**Status:** Complete (all parts merged)

## Context

The 6 MCP tools (`dev_search`, `dev_refs`, `dev_map`, `dev_patterns`, `dev_status`,
`dev_health`) are functional but have two categories of issues:

1. **Performance:** `dev_patterns` re-scans files with ts-morph on every call (1-3s)
   instead of reading from the Antfly index.
2. **Agent usability:** inconsistent error recovery guidance, overlapping tools
   (`dev_status` vs `dev_health`), misleading parameter names, and verbose output
   that wastes LLM context tokens.

The other 5 tools already read from the index and are fast (<100ms). This phase
brings `dev_patterns` to the same standard and makes all tools more effective for
AI agents.

See [user-stories.md](./user-stories.md) for the user stories driving this work.

---

## Current architecture (dev_patterns)

```
dev_patterns request
  → InspectAdapter.execute()
    → SearchService.findSimilar(file)          ← Antfly (fast, ~50ms)
    → PatternAnalysisService.comparePatterns()
      → scanRepository({ include: allFiles })   ← RE-PARSES with ts-morph (SLOW)
      → analyzeFileWithDocs()
        → fs.readFile() × 2 (duplicate reads)
        → regex on content (error handling)
        → regex on signatures (type coverage)
      → compare*() methods                      ← pure logic (fast)
```

## Proposed architecture

```
dev_patterns request
  → InspectAdapter.execute()
    → SearchService.findSimilar(file)          ← Antfly (fast, ~50ms)
    → PatternAnalysisService.comparePatterns()
      → getDocsByFilePath(paths)                ← Antfly (fast, ~20ms)
      → analyzeFileFromIndex()
        → extract type coverage from indexed signatures
        → fs.readFile() ONCE (line count + error handling regex)
      → compare*() methods                      ← unchanged
```

**Performance:** 1-3s → ~100ms (10-30x faster)

**Note on mixed data sources:** `analyzeFileFromIndex` reads from two sources —
indexed metadata for type coverage/signatures, disk for line count and error
handling regex. Line count and raw content patterns are not stored in the index.
This is an acceptable trade-off: line count is a cheap stat call.

---

## Parts

| Part | Description | Risk |
|------|-------------|------|
| [1.1](./1.1-pure-extractors.md) | Extract pure testable pattern analyzers | Low — refactor only |
| [1.2](./1.2-index-based-analysis.md) | Add `getDocsByFilePath`, index analysis path, wire VectorStorage | Medium — new code path |
| [1.3](./1.3-cleanup.md) | Consolidate reads, remove dead code, remove GitHub from health | Low — cleanup |
| [1.4](./1.4-agent-usability.md) | Merge status/health, add error suggestions, rename params, JSON output | Medium — tool surface change |
| [1.5](./1.5-ast-pattern-analysis.md) | AST-based pattern analysis via tree-sitter queries | Low — additive, regex fallback |
| [1.6](./1.6-pagerank-map.md) | Graph algorithms: PageRank, connected components, shortest path | Low — replaces simple counting |

### Part 1.6 Commit Plan

| # | Commit | What changes |
|---|--------|-------------|
| 1 | `feat(core): add graph algorithms — PageRank, connected components, shortest path` | New `graph.ts` with pure functions + `graph.test.ts` (~20 tests). No wiring. |
| 2 | `feat(core): replace ref counting with PageRank in dev_map` | Wire PageRank into `computeHotPaths`. Add `score` to `HotPath`. Rewrite 3 callers→callees tests. |
| 3 | `feat(core): wire connected components into dev_map output` | Add `components` to `CodebaseMap` + `formatCodebaseMap`. |
| 4 | `feat(mcp): add path tracing to dev_refs` | New `trace` param on RefsAdapter. Schema + tests. |
| 5 | `docs: complete MCP Phase 1, attribution, plan status` | Plan updates, aider attribution, mark Phase 1 complete. |

---

## Decisions

| Decision | Rationale | Alternatives |
|----------|-----------|-------------|
| Optional `vectorStorage` in config | Preserves fallback for tests and offline (US-4) | Required — breaks all existing tests |
| `getDocsByFilePath()` with capped `getAll` + exact filter | Reliable exact-match. BM25 search tokenizes paths unpredictably. | BM25 search — fragile, noise in results |
| Cap `getAll` at 5,000 docs | Covers most repos. Warns if exceeded. | No cap — memory risk on large repos |
| Use `SearchResult` type | Matches actual VectorStorage return type | Inline type — fragile, loses safety |
| Merge `dev_health` into `dev_status` | Removes tool overlap that confuses agents (US-8) | Keep both — agents waste turns choosing |
| Rename `query` → `filePath` in `dev_patterns` | Prevents LLMs from passing natural language | Keep `query` — higher misuse rate |
| Add `format: "json"` to `dev_patterns` | Token-efficient for agent workflows (US-9) | Markdown only — wastes ~2000 tokens per call |
| ast-grep for pattern analysis (optional) | More accurate AST matching than regex. Falls back to regex if not installed. | Use ts-morph directly — too slow. Regex only — less accurate. |
| PageRank for hot paths | Captures graph centrality, not just direct refs. Inspired by aider. | Keep ref counting — simpler but misses bridge files. |
| Catch ENOENT in analyzeFileFromIndex | File may be deleted between index and analysis | Let it throw — worse UX |

---

## Risk register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `getDocsByFilePath` slow on 50k+ doc repos | Medium | Medium | Cap at 5,000 docs. Warn if exceeded. Future: add server-side path filter to Antfly SDK |
| Indexed metadata missing fields (partial index) | Low | Low | Fallback path preserved via optional vectorStorage |
| Error handling regex misses patterns | Low | Low | Existing behavior unchanged. AST is separate future work |
| File deleted between index and analysis | Low | Low | ENOENT caught, partial results returned |
| Disk content differs from index | Medium | Low | Documented trade-off. Line count from disk, types from index |
| ast-grep not installed on user machine | Medium | None | Regex fallback — all functionality works without ast-grep |
| PageRank changes hot paths ordering | High | Low | Better ranking is the goal. Users may notice different order — this is an improvement. |
| Merging status/health breaks `dev_health` callers | Low | Medium | `dev_health` was rarely used directly. `dev_status section="health"` is equivalent. |
| Agents pass natural language to `filePath` param | Low | Low | Description explicitly says "file path" with example |

---

## Test strategy

| Test | Priority | Location |
|------|----------|----------|
| `extractImportStyleFromContent` — ESM, CJS, mixed, unknown | P1 | `core/services/__tests__/pattern-analysis-service.test.ts` |
| `extractErrorHandlingFromContent` — throw, result, mixed, unknown | P1 | same |
| `extractTypeCoverageFromSignatures` — full, partial, minimal, none | P1 | same |
| `analyzeFileFromIndex` — real file + mock index docs | P1 | same |
| `analyzeFileFromIndex` — ENOENT (deleted file) | P1 | same |
| `getDocsByFilePath` — filters exact match, ignores noise | P1 | `core/vector/__tests__/` or inline |
| `comparePatterns` with mock vectorStorage — fast path | P1 | same |
| `comparePatterns` without vectorStorage — fallback path | P1 | same |
| `comparePatterns` — search returns noise, zero results | P1 | same |
| Error `suggestion` fields on all 6 adapters | P2 | adapter test files |
| `dev_status section="health"` returns health data | P2 | `mcp-server/adapters/__tests__/status-adapter.test.ts` |
| PageRank — basic graph, cycles, disconnected | P1 | `core/map/__tests__/pagerank.test.ts` |
| buildDependencyGraph from callees metadata | P1 | same |
| ast-grep detection — try/catch, throw (if installed) | P2 | `core/services/__tests__/ast-patterns.test.ts` |
| Regex fallback when ast-grep unavailable | P1 | `core/services/__tests__/pattern-analysis-service.test.ts` |
| Existing 30+ tests unchanged (regression) | P1 | same |

---

## Verification checklist

- [ ] `pnpm build` passes
- [ ] `pnpm test` — all tests pass (existing + new)
- [ ] Manual: `dev_patterns` returns results via MCP
- [ ] Manual: `dev_patterns` response time < 200ms
- [ ] Manual: `dev_status section="health"` works
- [ ] Manual: `dev_health` is no longer listed in tools
- [ ] All error paths return `suggestion` field
- [ ] `dev_patterns` accepts `filePath` parameter
- [ ] `dev_patterns format="json"` returns structured data
- [ ] `dev_map` hot paths use PageRank (order may differ from before — expected)
- [ ] PageRank unit tests pass (cycles, disconnected nodes, convergence)
- [ ] Pattern analysis uses ast-grep when installed, regex otherwise
- [ ] Attribution noted in ARCHITECTURE.md for aider and ast-grep inspiration
