# Phase 6: Reverse Callee Index for dev_refs

## Status: Draft (revised after 4 review passes)

## Context

`dev_refs` can find callees (what a function calls) but **callers are broken**.
Both CLI and MCP adapter find callers by semantic-searching the target name,
then scanning each candidate's callees list. Semantic search returns
*similar concepts*, not *call sites* — so `validateArgs` returns other
validators, not the 5 adapters that call it. The search is also capped at
100 candidates, meaning callers outside that window are invisible.

### What exists

- Each indexed component stores `callees: CalleeInfo[]` with name, file, line
- Dependency graph (`dependency-graph.json`) tracks file→file edges only
- Callee names vary by language: `this.searchService.search` (TS),
  `fmt.Println` (Go), `self.validate` (Python), `Vec::new` (Rust)
- Incremental indexer updates graph on file changes via `updateGraphIncremental`
- CLI (`refs.ts:112-140`) and MCP (`refs-adapter.ts:326-365`) duplicate
  the same broken caller logic

### What we're building

A **reverse callee index** — a map from compound callee key (`file:name`)
to the components that call it. Built at index time, persisted inside the
dependency graph artifact (v2), updated atomically with the graph, used by
both CLI and MCP via a shared lookup function in core.

## Parts

| Part | Description | Risk |
|------|-------------|------|
| 6.1 | Build + persist reverse index in core | Low |
| 6.2 | Shared caller lookup function in core | Low |
| 6.3 | Wire into CLI refs + MCP refs adapter | Medium |
| 6.4 | Incremental updates | Medium |
| 6.5 | Tests + verification | Low |

## Architecture

```
dev index
    │
    ▼
scanRepository() → EmbeddingDocument[] (with callees metadata)
    │
    ▼
buildIndexes(docs)
    ├─► buildDependencyGraph()      → graph (file→file edges)
    └─► buildReverseCalleeIndex()   → reverseIndex (file:name → callers)
    │
    ▼
serializeCachedGraph(graph, reverseIndex) → dependency-graph.json v2
    (single artifact, atomic write, shared lifecycle)

dev refs "validateArgs"
    │
    ├─► findBestMatch()  → target component (via search, unchanged)
    ├─► callees          → from target.metadata.callees (unchanged)
    └─► callers          → lookupCallers(reverseIndex, target)
                            Compound key: O(1) exact match
                            Bare name: O(1) via name→keys secondary map
```

## Key Design Decisions

| Decision | Choice | Rationale | Alternatives |
|----------|--------|-----------|-------------|
| Index key format | Compound `file:name` when file resolved, bare name otherwise | Unique identity per callee for TS (ts-morph resolves files). Tree-sitter languages (Go, Rust, Python) don't resolve callee files — degrades to bare name keys with name-index fallback | Bare name only (collisions), full symbol ID (not available) |
| Bare-name lookup | Secondary `Map<bareName, compoundKey[]>` built in memory at load | Agent queries `"search"` not `"search-service.ts:search"`. Secondary map resolves bare→compound in O(1) | endsWith scan O(n) — slower, same result |
| Storage | Inside `dependency-graph.json` v2, not a separate file | Same source data, same lifecycle, atomic write. Prevents drift between graph and reverse index | Separate file (two caches, one truth — will drift) |
| Graph version | Bump CachedGraph version 1→2. v2 adds `reverseIndex` field. Deserializer handles v1 (no reverse index) gracefully | Backward compatible — v1 files load fine, just no callers | New file format (drift risk) |
| Module location | New `packages/core/src/map/reverse-index.ts` | graph.ts is already ~350 lines. Reverse index is conceptually distinct | graph.ts (God module) |
| Missing index fallback | Return empty callers + log warning to re-index | No expensive rebuild on hot path. Old repos just show "no callers" until re-indexed | Rebuild from 50k docs on every call (multi-second blocking) |
| Dedup granularity | By caller file+name, not by call site line | Agents want "who calls this" not "every call site" | Per call site (noisier) |
| Class-level queries | `lookupClassCallers()` helper in core | Aggregates callers of `new ClassName` + all `ClassName.*` methods. In core, not duplicated in callers | Push to adapter (duplication) |
| CLI/MCP duplication | Consolidate into shared functions in core | Single implementation, tested once | Keep duplicated (drift risk) |
| Incremental updates | Atomic update of both graph + reverse index in single write | Mirrors `updateGraphIncremental` pattern, prevents partial-write drift | Independent writes (drift risk) |

## Data Structures

### CallerEntry (stored in reverse index)

```typescript
interface CallerEntry {
  name: string;       // Caller component name ("SearchAdapter.execute")
  file: string;       // Caller file path
  line: number;       // Call site line in caller
  type: string;       // Caller component type (function, method, class)
}
```

No `calleeFile` needed — disambiguation is built into the compound key.

### CachedGraph v2 (updated serialization envelope)

```typescript
interface CachedGraph {
  version: 2;                                        // bumped from 1
  generatedAt: string;
  nodeCount: number;
  edgeCount: number;
  graph: Record<string, WeightedEdge[]>;
  reverseIndex?: Record<string, CallerEntry[]>;      // NEW — compound key
  reverseIndexEntryCount?: number;                    // NEW
}
```

v1 files (no `reverseIndex`) deserialize fine — callers just return empty.

### lookupCallers (shared function)

```typescript
function lookupCallers(
  reverseIndex: Map<string, CallerEntry[]>,
  targetName: string,
  targetFile: string,
  options?: { limit?: number; nameIndex?: Map<string, string[]> }
): CallerEntry[]
```

Matching logic:
1. Try compound key: `reverseIndex.get("${targetFile}:${targetName}")`
2. If no compound match, use nameIndex for bare-name lookup
3. Deduplicate by caller file+name, cap at limit

### lookupClassCallers (class aggregation)

```typescript
function lookupClassCallers(
  reverseIndex: Map<string, CallerEntry[]>,
  className: string,
  classFile: string,
  options?: { limit?: number; nameIndex?: Map<string, string[]> }
): CallerEntry[]
```

Aggregates callers of `new ClassName` + all `ClassName.*` methods found
in the name index.

### buildNameIndex (secondary bare-name map)

```typescript
function buildNameIndex(
  reverseIndex: Map<string, CallerEntry[]>
): Map<string, string[]>
```

Maps last segment of compound key to full keys:
`"search"` → `["search-service.ts:search", "indexer.ts:search"]`

Built in memory at load time. Not persisted.

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Large repos produce huge index | Medium | Low | JSON fine up to 250k entries. Single file with graph keeps overhead contained |
| Stale entries after incremental update | Medium | Medium | Remove all entries by caller file before rebuilding; test with add/edit/delete |
| Dangling edges to deleted files | Medium | Medium | Prune entries where compound key's file is in deletedFiles |
| File path format mismatch | Medium | Medium | Invariant: all paths relative to repo root. Normalize at build time |
| v1→v2 graph migration | Low | Low | Deserializer handles v1 gracefully (no reverse index). `dev index` rebuilds v2 |
| Concurrent incremental writes | Low | Medium | Watcher serializes flushes via promise chain. Single atomic write for both |

## Test Strategy

| Test | Priority | File |
|------|----------|------|
| `buildReverseCalleeIndex` from mock docs | P0 | `reverse-index.test.ts` |
| Serialization round-trip (v2 graph with reverse index) | P0 | `graph.test.ts` |
| Deserialize v1 graph (no reverse index) → empty callers | P0 | `graph.test.ts` |
| `lookupCallers` compound key exact match | P0 | `reverse-index.test.ts` |
| `lookupCallers` bare-name via nameIndex | P0 | `reverse-index.test.ts` |
| `lookupClassCallers` aggregation | P1 | `reverse-index.test.ts` |
| `buildNameIndex` mapping | P0 | `reverse-index.test.ts` |
| Incremental update: add file | P0 | `reverse-index.test.ts` |
| Incremental update: delete file | P0 | `reverse-index.test.ts` |
| Incremental update: change file (rename callees) | P0 | `reverse-index.test.ts` |
| Incremental update does not mutate original map | P1 | `reverse-index.test.ts` |
| MCP refs adapter uses lookupCallers | P1 | `refs-adapter.test.ts` |
| CLI refs uses lookupCallers | P1 | manual verification |
| Empty callers when reverse index missing (v1 graph) | P1 | `refs-adapter.test.ts` |
| dev_refs MCP tool returns callers for validateArgs | P0 | manual e2e |

## Verification Checklist

- [ ] `dev index` writes dependency-graph.json with version 2 + reverseIndex
- [ ] `dev refs "validateArgs"` shows callers (SearchAdapter, RefsAdapter, etc.)
- [ ] `dev refs "CompactFormatter"` shows callers of `new CompactFormatter`
- [ ] `dev refs "SearchAdapter"` aggregates callers across class methods
- [ ] MCP `dev_refs` returns callers (restart MCP server, test via tool call)
- [ ] File edit triggers atomic incremental update of graph + reverse index
- [ ] File delete removes stale caller entries
- [ ] Old v1 graph files load fine — callers return empty, no error
- [ ] `pnpm test` passes, `pnpm typecheck` passes

## Files Modified

| File | Change |
|------|--------|
| `packages/core/src/map/reverse-index.ts` | NEW — build, lookup, lookupClass, nameIndex, incremental update |
| `packages/core/src/map/types.ts` | Add CallerEntry type |
| `packages/core/src/map/graph.ts` | Update CachedGraph to v2, serialize/deserialize for v2 |
| `packages/core/src/map/index.ts` | Export reverse-index functions, destructure loadOrBuildGraph in MapService |
| `packages/core/src/indexer/index.ts` | Wire reverse index build alongside dependency graph (line 191) |
| `packages/cli/src/commands/refs.ts` | Replace caller logic with lookupCallers from core |
| `packages/mcp-server/src/adapters/built-in/refs-adapter.ts` | Replace getCallers with lookupCallers from core |
| `packages/mcp-server/src/watcher/incremental-indexer.ts` | Atomic update of graph + reverse index together |
| `packages/mcp-server/bin/dev-agent-mcp.ts` | No new config — reverse index comes from graph |
| `packages/core/src/map/__tests__/reverse-index.test.ts` | NEW — tests for all reverse index functions |
| `packages/core/src/map/__tests__/graph.test.ts` | Update for v2 serialization |
| `packages/mcp-server/src/adapters/__tests__/refs-adapter.test.ts` | Update caller tests |

## References

- Current callers logic (CLI): `packages/cli/src/commands/refs.ts:112-140`
- Current callers logic (MCP): `packages/mcp-server/src/adapters/built-in/refs-adapter.ts:326-365`
- Dependency graph builder: `packages/core/src/map/graph.ts:46-78`
- Graph serialization: `packages/core/src/map/graph.ts:280-340`
- Incremental graph update: `packages/core/src/map/graph.ts:353-372`
- Incremental indexer: `packages/mcp-server/src/watcher/incremental-indexer.ts`
- Storage paths: `packages/core/src/storage/path.ts:118`
- CalleeInfo type: `packages/core/src/scanner/types.ts:30-37`
- PR #34: fix(mcp) drop search scores — fixed scoreThreshold blocking refs
