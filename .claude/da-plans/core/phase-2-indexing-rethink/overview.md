# Phase 2: Rethink Indexing & Search Flow

**Status:** Draft

## Context

Phase 1 replaced the storage layer (LanceDB → Antfly) but kept the old indexing
flow intact. That flow was designed around LanceDB constraints: local file storage,
manual embedding pipeline, batch sizing tuned for ONNX model memory, state files
for incremental updates.

With Antfly as the backend, many of these constraints no longer exist. Rather than
patching the old flow, we should redesign it around what Antfly enables and what
developers actually need.

See [user-stories.md](./user-stories.md) for the full set of user stories driving
this redesign.

## Current flow (what exists)

```
dev setup              → start Antfly (one-time)
dev index .            → scan all files → batch insert into Antfly → save state file
  ├─ Phase 1: Scan     → ts-morph/tree-sitter/remark → Document[]
  ├─ Phase 2: Store     → batch HTTP inserts (32 docs × CONCURRENCY parallel)
  ├─ Phase 3: Git       → extract commits → separate table
  ├─ Phase 4: GitHub    → fetch issues/PRs via gh CLI → separate table
  └─ Save state         → indexer-state.json (file hashes for incremental)
dev search "query"     → hybrid search via Antfly
```

### Problems with current flow

1. **Manual trigger required** — developer must remember to run `dev index .` after
   code changes. AI tools get stale context. (violates US-4)

2. **State file complexity** — tracks file hashes, document IDs per file, timestamps.
   But Antfly does upsert natively — inserting an existing key overwrites. Do we need
   the state file at all?

3. **Embedding delay invisible** — Antfly embeds asynchronously (~2s). `dev index .`
   completes before embeddings are ready. Immediate search may return nothing. (violates US-3)

4. **Three separate VectorStorage instances** — created because LanceDB needed separate
   directories. With Antfly, these are just three tables. But the code creates three
   separate VectorStorage objects with separate connections.

5. **Batch sizing is wrong** — indexer uses batch=32 (tuned for ONNX). Antfly can handle
   500 per request. We're making 15x more HTTP calls than needed.

6. **Git and GitHub coupled to index command** — `dev index .` does code + git + GitHub
   in one big command. These are different data sources with different update patterns.

## Proposed flow

### The big idea: file watcher + on-demand indexing

```
dev setup              → start Antfly + start file watcher (background)
                         watcher detects file changes → re-indexes changed files automatically

dev index .            → full scan (first time or explicit refresh)
dev index . --force    → clear + full scan

# These become separate, optional commands:
dev git index          → index git history (already exists)
dev github index       → index GitHub issues/PRs (already exists)
```

**US-4 solved:** The file watcher keeps the index fresh without manual intervention.
Developer saves a file, the watcher re-indexes it within seconds.

### Alternative: no watcher, just fast incremental

If a file watcher is too complex for Phase 2, the simpler approach:

```
dev index .            → fast incremental (only changed files, <5s for small changes)
                         runs automatically on MCP server startup
                         runs automatically before search if stale (>5 min since last update)
```

### Simplifications enabled by Antfly

| Old complexity | New simplification |
|---------------|-------------------|
| State file (file hashes, doc IDs) | Antfly upsert by key — just re-insert, it overwrites |
| Three VectorStorage instances | One AntflyClient, three table names |
| Batch size 32 + CONCURRENCY | Single batch size 500, let Antfly handle parallelism |
| Manual embedding step | Antfly auto-embeds on insert |
| Wait for embedding completion | BM25 search works immediately; vector search ready in ~2s |

### State file: keep or drop?

**Keep a minimal version.** We still need to know:
- Which files have been indexed (to detect deleted files → remove from Antfly)
- Last index timestamp (to detect staleness)

**Drop:**
- File hashes (just re-insert everything that changed based on mtime)
- Document IDs per file (Antfly handles dedup by key)
- Embedding metadata (Antfly owns this)

## Parts

| Part | Description | User stories |
|------|-------------|-------------|
| 2.1 | Simplify indexer: drop state complexity, use Antfly upsert | US-3, US-5 |
| 2.2 | Increase batch size, single AntflyClient | US-6 |
| 2.3 | Wait for embedding completion (or BM25 fallback) | US-3 |
| 2.4 | Decouple git/github from `dev index .` | US-10, US-11 |
| 2.5 | Auto-index on MCP server startup | US-4, US-12 |
| 2.6 | File watcher for continuous indexing (stretch) | US-4 |
| 2.7 | `dev status` rework — show Antfly table stats | US-13 |

## Decisions to make

1. **File watcher or fast incremental?** Watcher is better UX but more complexity.
   Fast incremental (<5s) on MCP startup might be enough.

2. **State file: minimal or none?** We need *something* to detect deleted files.
   Could query Antfly for existing keys and diff, but that's O(n) on every run.

3. **Git/GitHub: part of `dev index .` or separate?** Currently bundled.
   Separating them makes `dev index .` faster and each concern independent.

4. **Embedding completion: wait or don't?** Antfly's BM25 index is immediate.
   Vector search has ~2s delay. Should we wait, or document the tradeoff?

## Open questions

- What does the MCP server startup look like? Does it auto-index?
- How does Cursor's workspace detection interact with auto-indexing?
- Should `dev index .` be a command users run, or should it be invisible?
- What's the right granularity for file watching? (per-file? per-save? debounced?)

## Dependencies

- Phase 1 (Antfly migration) — merged
- Antfly server running
- Understanding of MCP server lifecycle (how/when it starts)
