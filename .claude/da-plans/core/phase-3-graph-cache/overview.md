# Phase 3: Cached Dependency Graph for Scale

**Status:** Draft

## Context

Phase 2 established the indexing pipeline (scan → Linear Merge → Antfly). MCP Phase 1
added graph algorithms (PageRank, connected components, shortest path) that operate
over the dependency graph built from indexed `callees` metadata.

The current approach rebuilds the dependency graph from scratch on every `dev_map` and
`dev_refs dependsOn` call by fetching all documents via `getAll(limit: 10000)`. This
works at our current scale (~2,200 docs) but breaks at medium-to-large repos:

| Repo size | Docs | Current behavior |
|-----------|------|-----------------|
| Small (dev-agent) | ~2k | Works. Graph build <1ms, PageRank 4ms. |
| Medium (product monorepo) | 10-15k | **Silently truncated** at 10k. Graph is incomplete. |
| Large (platform monorepo) | 20-50k | Completely broken. Missing most of the graph. |

### What breaks

1. **`getAll(limit: 10000)` hard wall** — docs beyond 10k are silently dropped.
   The graph is incomplete with no indication. PageRank scores are wrong.

2. **Memory** — 50k docs × ~5KB each = ~250MB just for raw data. The graph itself
   is much smaller (~50k nodes × ~5 edges × 16 bytes = ~4MB).

3. **Latency per request** — `dev_refs dependsOn` fetches all docs and rebuilds the
   graph on every call. For a 10k-doc repo, that's ~50ms fetch + ~5ms graph build
   on every MCP request. The RefsAdapter has a 60s cache but it still rebuilds from
   scratch after expiry.

### What we already have

- `buildDependencyGraph(docs)` — pure function, returns `Map<string, WeightedEdge[]>`
- `pageRank(graph)` — pure function, weighted with dangling nodes
- `connectedComponents(graph)` — pure function, BFS on undirected graph
- `shortestPath(graph, from, to)` — pure function, BFS on directed graph
- File watcher that detects changes and triggers incremental re-indexing
- Storage paths at `~/.dev-agent/indexes/{hash}/` with `metadata.json` and `watcher-snapshot`

---

## Proposed architecture

### Current flow (what we're fixing)

```
┌──────────────────────────────────────────────────────────┐
│                  dev_map / dev_refs                       │
│                                                          │
│   getAll(limit: 10000)  ──────────►  Antfly              │
│         │                            (fetch ALL docs)    │
│         │ ~250MB for 50k docs                            │
│         ▼                                                │
│   buildDependencyGraph()                                 │
│         │ rebuild from scratch every time                │
│         ▼                                                │
│   pageRank() / shortestPath()                            │
└──────────────────────────────────────────────────────────┘

Problem: fetches ALL docs (truncated at 10k), rebuilds graph every call
```

### Proposed flow

```
┌──────────────────────────────────────────────────────────┐
│                  Index time (dev index)                   │
│                                                          │
│   scan ──► prepareDocuments ──► linearMerge ──► Antfly   │
│                    │                                     │
│                    │ NEW: also build graph               │
│                    ▼                                     │
│            buildDependencyGraph()                        │
│                    │                                     │
│                    ▼                                     │
│            dependency-graph.json  (~1-5MB)               │
│            ~/.dev-agent/indexes/{hash}/                   │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│              dev_map / dev_refs (query time)              │
│                                                          │
│   Load dependency-graph.json  ──► Map<string, Edge[]>    │
│         │ ~50ms for 5MB                                  │
│         │ (no getAll, no Antfly fetch)                   │
│         ▼                                                │
│   pageRank() / shortestPath() / connectedComponents()    │
└──────────────────────────────────────────────────────────┘

Fix: graph built once at index time, loaded from disk at query time
```

### Incremental updates (file watcher)

```
┌──────────────────────────────────────────────────────────┐
│              File change detected                        │
│                                                          │
│   @parcel/watcher: files A, B changed; file C deleted    │
│         │                                                │
│         ▼                                                │
│   scan changed files ──► batchUpsertAndDelete ──► Antfly │
│         │                                                │
│         │ NEW: also update graph                         │
│         ▼                                                │
│   Load existing graph                                    │
│   Remove edges for changed/deleted files                 │
│   Add edges from re-scanned callees                      │
│   Save updated graph                                     │
│                                                          │
│   O(changed files), not O(all files)                     │
└──────────────────────────────────────────────────────────┘
```

### Storage layout

```
~/.dev-agent/indexes/{hash}/
    ├── metadata.json            (existing — index config)
    ├── watcher-snapshot         (existing — @parcel/watcher state)
    └── dependency-graph.json    (NEW — ~1-5MB, serialized graph)
```

### Graph JSON format

```json
{
  "version": 1,
  "generatedAt": "2026-03-31T20:00:00Z",
  "nodeCount": 2214,
  "edgeCount": 8456,
  "graph": {
    "src/services/search.ts": [
      { "target": "src/vector/index.ts", "weight": 1.414 },
      { "target": "src/scanner/types.ts", "weight": 1.0 }
    ]
  }
}
```

### Consumer changes

| Consumer | Before | After |
|----------|--------|-------|
| `dev_map` (generateCodebaseMap) | `getAll(10000)` → build graph → PageRank | Load cached graph → PageRank |
| `dev_refs dependsOn` | `getAll(10000)` → build graph → shortestPath | Load cached graph → shortestPath |
| `dev_map` (directory tree) | Still needs `getAll` for component counts + exports | Unchanged — separate concern |

**Important:** `generateCodebaseMap` still needs `getAll` for the directory tree
(component counts, exports). But the graph algorithms no longer depend on it.
The directory tree already has its own limit handling. Only the graph operations
are decoupled.

### Incremental updates

When the file watcher detects changes and calls `applyIncremental`:
1. Load existing graph JSON
2. Remove edges from changed/deleted files
3. Add edges from newly scanned files' callees
4. Save updated graph JSON

This is O(changed files), not O(all files). The graph stays up to date without
a full rebuild.

---

## Parts

| Part | Description | Risk |
|------|-------------|------|
| [3.1](./3.1-index-time-graph.md) | Build and save dependency graph at index time | Low — additive |
| [3.2](./3.2-load-on-demand.md) | Load cached graph in dev_map + dev_refs, remove getAll dependency | Medium — changes data flow |
| [3.3](./3.3-incremental-graph.md) | Incremental graph updates via file watcher | Medium — new update path |

---

## Decisions

| Decision | Rationale | Alternatives |
|----------|-----------|-------------|
| JSON file, not DB | Graph is small (~1-5MB), read-only between updates, JSON is debuggable | SQLite: overkill. Antfly: no server-side graph API. |
| Build at index time | Amortizes cost. Graph only changes when index changes. | Build on demand: current approach, doesn't scale. |
| Incremental updates | Watcher already knows which files changed. Graph update is O(changed). | Full rebuild on every change: wasteful at scale. |
| Keep getAll for directory tree | Directory tree needs component counts and exports which aren't in the graph. | Index component counts separately: premature optimization. |
| Version field in JSON | Allows schema evolution without migration headaches. | No version: breaks silently on format change. |

---

## Risk register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Graph JSON out of sync with index | Medium | Medium | Rebuild graph on `dev index --force`. Watcher keeps it updated incrementally. |
| Graph file corrupted or missing | Low | Low | Fallback to current approach (getAll + build). Never crash. |
| Graph file too large for huge repos | Low | Low | 50k nodes × 5 edges × ~50 bytes = ~12MB. Acceptable. |
| Incremental update misses edge cases | Medium | Medium | Full rebuild always available via `dev index --force`. Incremental is best-effort. |
| JSON parse performance | Low | Low | 5MB JSON parses in <50ms. Not a bottleneck. |

---

## Test strategy

| Test | Priority | What it verifies |
|------|----------|-----------------|
| Build graph from scan results and save JSON | P0 | Index time graph generation |
| Load graph JSON and run PageRank | P0 | Cached graph → algorithms work |
| Missing graph file → fallback to getAll | P0 | Graceful degradation |
| Corrupted graph file → fallback to getAll | P0 | Error handling |
| Incremental: add file → graph updated | P0 | Watcher integration |
| Incremental: delete file → edges removed | P0 | Watcher integration |
| Graph version mismatch → full rebuild | P1 | Schema evolution |
| 10k+ node graph serialization round-trip | P1 | Scale |
| dev_map uses cached graph (not getAll) | P1 | Integration |
| dev_refs dependsOn uses cached graph | P1 | Integration |

---

## Verification checklist

- [ ] `dev index` produces `dependency-graph.json` alongside `metadata.json`
- [ ] `dev_map` loads cached graph instead of calling `getAll` for PageRank
- [ ] `dev_refs dependsOn` loads cached graph
- [ ] Missing graph file → falls back to getAll (current behavior)
- [ ] `dev index --force` rebuilds graph from scratch
- [ ] File watcher change → graph incrementally updated
- [ ] Graph JSON < 15MB for 50k-node repo
- [ ] PageRank on cached 50k-node graph < 500ms
- [ ] `pnpm build && pnpm test` passes

---

## Dependencies

- Phase 2 (indexing rethink) — merged
- MCP Phase 1 Part 1.6 (graph algorithms) — merged (pending PR #19)
- `getStorageFilePaths` in `packages/core/src/storage/path.ts` — add `dependencyGraph` path
