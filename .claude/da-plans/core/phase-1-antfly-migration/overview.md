# Phase 1: Migrate from LanceDB + @xenova/transformers to Antfly

## Context

dev-agent currently uses **LanceDB** for vector storage and **@xenova/transformers** for local
embeddings (all-MiniLM-L6-v2, 384-dim). These are wired together via a `VectorStorage` facade
in `packages/core/src/vector/`.

[Antfly](https://antfly.io) is an AI database that combines vector search, BM25 full-text search,
local embedding generation (Termite), chunking, and reranking into a single service. It runs
locally, has a TypeScript SDK (`@antfly/sdk`), and is open source.

### Why migrate

| Current (LanceDB + transformers) | Antfly |
|----------------------------------|--------|
| Vector-only similarity search | Hybrid search: BM25 + vector + RRF/RSF fusion |
| Manual embedding pipeline (@xenova/transformers) | Auto-embedding on insert via Termite (ONNX, local) |
| Custom upsert logic (mergeInsert) | Batch insert/delete by key |
| No full-text fallback | BM25 for exact keyword matches (error codes, function names) |
| No reranking | Cross-encoder reranking built in |
| No result pruning | Score-based pruning (min_score_ratio, gap detection) |
| ~1200 lines of vector plumbing | SDK handles storage + embeddings + search |

**Biggest win:** `dev_search` goes from pure vector similarity to hybrid search (BM25 + vector + RRF).
For code search, this is a massive upgrade — exact matches on function names AND semantic understanding
of what code does, fused into one ranked result set.

### What exists today

**Three separate vector stores** at runtime:

| Store | Path | Content | Created by |
|-------|------|---------|------------|
| vectors/ | `~/.dev-agent/indexes/{repo}/vectors` | Code components (functions, classes, types) | `RepositoryIndexer` |
| vectors-git/ | `~/.dev-agent/indexes/{repo}/vectors-git` | Git commits | `GitIndexer` |
| vectors-github/ | `~/.dev-agent/indexes/{repo}/vectors-github` | GitHub issues/PRs | `GitHubIndexer` |

Each goes through the same pipeline:
```
Scanner/Extractor → EmbeddingDocument → TransformersEmbedder.embedBatch() → LanceDBVectorStore.add()
```

**After migration**, these become three antfly tables in one server:
```
Scanner/Extractor → JSON document → AntflyClient.tables.batch() → auto-embedded by Termite
```

---

## Architecture

### Current layers

```
┌─────────────────────────────────────────────┐
│  Consumers (CLI, MCP, Services, Subagents)  │
├─────────────────────────────────────────────┤
│  VectorStorage (facade)                     │  ← packages/core/src/vector/index.ts
│    ├── TransformersEmbedder                 │  ← packages/core/src/vector/embedder.ts
│    └── LanceDBVectorStore                   │  ← packages/core/src/vector/store.ts
├─────────────────────────────────────────────┤
│  Interfaces: VectorStore, EmbeddingProvider │  ← packages/core/src/vector/types.ts
└─────────────────────────────────────────────┘
```

### After migration

```
┌─────────────────────────────────────────────┐
│  Consumers (CLI, MCP, Services, Subagents)  │  ← NO CHANGES
├─────────────────────────────────────────────┤
│  VectorStorage (facade — simplified)        │  ← delegates to AntflyVectorStore
│    └── AntflyVectorStore                    │  ← replaces both embedder + store
│         └── @antfly/sdk (AntflyClient)      │
├─────────────────────────────────────────────┤
│  Interfaces: VectorStore                    │  ← EmbeddingProvider removed or no-op'd
└─────────────────────────────────────────────┘
│                                             │
│  antfly server (local, runs Termite)        │  ← `antfly swarm` — manages embeddings,
│                                             │     search, storage, reranking
└─────────────────────────────────────────────┘
```

**Key insight:** nothing above `VectorStorage` changes. The facade preserves the interface contract.
Indexers, services, CLI, and MCP all consume `VectorStorage` — they don't know what's underneath.

---

## Surface area (from research)

### Files that change

| File | Change | Reason |
|------|--------|--------|
| `core/src/vector/store.ts` | **Rewrite** | LanceDBVectorStore → AntflyVectorStore |
| `core/src/vector/embedder.ts` | **Remove or no-op** | Antfly handles embeddings via Termite |
| `core/src/vector/index.ts` | **Simplify** | VectorStorage facade drops embedder orchestration |
| `core/src/vector/types.ts` | **Update** | Config changes (storePath → antfly connection), EmbeddingProvider optional |
| `core/package.json` | **Swap deps** | Remove @lancedb/lancedb, @xenova/transformers; add @antfly/sdk |
| `dev-agent/package.json` | **Swap deps** | Same for bundled binary |
| `core/src/vector/__tests__/*` | **Rewrite** | New integration tests against antfly |
| `dev-agent/tsup.config.ts` | **Update** | Remove @lancedb/@xenova externals, add @antfly/sdk |
| `.github/workflows/ci.yml` | **Update** | Add docker-based integration test job with antfly |
| `cli/src/commands/map.ts` | **Update** | Remove `skipEmbedder: true` (no longer needed) |
| `cli/src/commands/setup.ts` | **New** | `dev setup` command (Part 1.5) |

### Files that DON'T change (32+ consumers)

All indexers, services, CLI commands, MCP adapters, and subagents consume `VectorStorage`
via the interface contract. None of them import LanceDB or transformers directly.

Verified consumers (no changes needed):
- `core/src/indexer/index.ts` — RepositoryIndexer
- `core/src/git/indexer.ts` — GitIndexer
- `subagents/src/github/indexer.ts` — GitHubIndexer
- `core/src/services/search-service.ts` — SearchService
- `core/src/services/health-service.ts` — HealthService
- `core/src/services/git-history-service.ts` — GitHistoryService
- `cli/src/commands/index.ts` — CLI index command
- `mcp-server/bin/dev-agent-mcp.ts` — MCP server entry

---

## Antfly API mapping

### Table creation (one per store type)

```typescript
// Code components table
await client.tables.create('dev-agent-code', {
  indexes: {
    content: {
      type: 'embeddings',
      template: '{{text}}',
      embedder: {
        provider: 'termite',
        model: 'BAAI/bge-small-en-v1.5',
      },
    },
  },
});
```

Three tables: `dev-agent-code`, `dev-agent-git`, `dev-agent-github` — replacing three
separate LanceDB directories.

### Method mapping

| Our VectorStore method | Antfly SDK | Notes |
|------------------------|-----------|-------|
| `initialize()` | `client.tables.create(table, { indexes })` | Creates table + embedding index if not exists |
| `add(docs, embeddings)` | `client.tables.batch(table, { inserts: { [id]: fields } })` | **Embeddings auto-generated** — we pass text, antfly embeds via Termite |
| `search(embedding, opts)` | `client.query({ table, semantic_search: text, full_text_search?, limit })` | Hybrid search! We pass the query TEXT, not a vector. Antfly embeds + searches |
| `get(id)` | `client.tables.lookup(table, id)` | Direct key lookup — replaces O(n) zero-vector hack |
| `delete(ids)` | `client.tables.batch(table, { deletes: ids })` | Batch delete by key |
| `count()` | `client.tables.get(table)` → stats | Table info likely includes doc count |
| `optimize()` | No-op | Antfly manages compaction internally |
| `close()` | No-op | SDK is stateless HTTP client |
| `getAll()` | `client.tables.query(table, { limit: large })` or `client.query(...)` | Full scan without vector query |
| `searchByDocumentId(id)` | Lookup doc → query with its text | Two-step: fetch doc, then `semantic_search` with its text |
| `EmbeddingProvider.embed(text)` | **Not needed** | Antfly embeds at query time |
| `EmbeddingProvider.embedBatch(texts)` | **Not needed** | Antfly embeds at insert time |

### The big decision: let Antfly own embeddings

**Yes.** This is the right call. Benefits:

1. **No separate embedding pipeline to maintain** — drop @xenova/transformers entirely
2. **Auto re-embedding when you swap models** — change the index config, antfly re-embeds
3. **Consistent embedding** — same model for indexing and querying, guaranteed
4. **Background processing** — antfly embeds asynchronously on insert, no blocking
5. **Model flexibility** — swap bge-small-en-v1.5 for a larger model later without code changes

Tradeoff: we lose control over embedding timing. But since antfly embeds in the background
and we can monitor progress via `antfly index list`, this is manageable.

### Hybrid search upgrade for dev_search

Current `dev_search`:
```
query → embed(query) → vector similarity → results
```

After migration:
```
query → antfly hybrid search (BM25 + vector + RRF) → rerank → prune → results
```

This means:
- Searching "validateUser" finds the exact function name (BM25) AND semantically related auth code (vector)
- Searching "authentication middleware" finds related concepts even without exact keyword matches
- RRF fusion combines both signals without tuning
- Optional: add reranking + pruning for even better precision

---

## Parts

| Part | Description | Risk | Commits |
|------|-------------|------|---------|
| 1.1 | Spike: install antfly, create table, insert, search, validate API | Low | 0 (throwaway) |
| 1.2 | Implement AntflyVectorStore class | Medium | 1-2 |
| 1.3 | Update VectorStorage facade, drop embedder dependency | Low | 1 |
| 1.4 | Swap dependencies, update integration tests | Medium | 1 |
| 1.5 | `dev setup` command + antfly health check | Low | 1 |
| 1.6 | Update docs, README, CLAUDE.md with new prerequisites | Low | 1 |

### Part 1.1 — Spike (no code committed)

Install antfly locally, pull bge-small-en-v1.5 model, and manually test:

```bash
brew install --cask antflydb/antfly/antfly
antfly termite pull --variants i8 BAAI/bge-small-en-v1.5
antfly swarm
```

Then write a throwaway script that:
1. Creates a table with an embedding index
2. Batch-inserts 100 code documents
3. Runs a hybrid search query
4. Runs a key lookup
5. Runs a delete + re-insert (upsert simulation)
6. Confirms count/stats

**Resolve these open questions:**
- Does batch insert with an existing key overwrite (upsert) or error?
- How long does background embedding take for 100 docs? 1000? 10000?
- Can we query immediately after insert or do we need to wait for embedding?
- What does `client.tables.get()` return? (need count)
- What's the latency of `client.tables.lookup()` vs current O(n) get?

### Part 1.2 — AntflyVectorStore

New file: `packages/core/src/vector/antfly-store.ts`

Implements `VectorStore` interface. Key design:
- Constructor takes `{ baseUrl, table }` config
- `initialize()` creates table with embedding index if not exists
- `add()` converts `EmbeddingDocument[]` to antfly batch insert (ignores embeddings param — antfly generates them)
- `search()` takes query TEXT (not vector), uses `client.query()` with hybrid search
- `get()` uses `client.tables.lookup()`
- `delete()` uses `client.tables.batch({ deletes })`

**Interface change:** `search()` currently takes `queryEmbedding: number[]`. After migration
it should take `queryText: string` since antfly embeds the query. This is an interface-level
change — but since VectorStorage facade controls the call, we can handle the translation there.

### Part 1.3 — Update VectorStorage facade

Simplify `VectorStorage` (currently in `index.ts`):
- Remove `TransformersEmbedder` instantiation
- Remove `embedBatch()` calls in `add()` pipeline
- Change `search()` to pass query text instead of embedding
- Keep the facade interface identical to consumers

### Part 1.4 — Swap deps + tests

- Remove `@lancedb/lancedb` and `@xenova/transformers` from both package.json files
- Add `@antfly/sdk`
- Update vector integration tests to use real antfly (requires running server)
- Existing mock-based tests (indexer, services) should pass unchanged

### Part 1.5 — `dev setup` command + auto-start

One-time `dev setup`: checks antfly binary, pulls embedding model, starts server.
All commands auto-start antfly if not running — user never types `antfly` directly.
If antfly binary is missing, clear error with install instructions.

### Part 1.6 — Documentation

- Update README: add antfly as prerequisite
- Update CLAUDE.md: mention antfly
- Update doc site install page
- Update troubleshooting guide

---

## Decisions

| Decision | Rationale | Alternatives |
|----------|-----------|-------------|
| Let Antfly own embeddings (drop @xenova/transformers) | Eliminates embedding pipeline, auto re-embed on model swap, consistent index/query | Keep transformers and pass pre-computed vectors (more control, more plumbing) |
| Default to bge-small-en-v1.5 via Termite, allow user to choose | Good default for speed/quality balance. Advanced users can pick a larger model (mxbai-embed-large-v1) or use external providers via Termite. Model stored in config, used at table creation. | Hardcode model (inflexible), expose full Termite config (too complex for most users) |
| Three antfly tables (not one with type field) | Clean separation, independent index configs, matches current architecture | One table with metadata filtering (complicates queries, mixes schemas) |
| Use hybrid search (BM25 + vector + RRF) by default | Strictly better for code search — exact matches + semantic, no tuning needed | Pure vector (current, inferior), pure BM25 (misses semantics) |
| CLI fully owns antfly lifecycle | `dev setup` handles one-time install check + model pull. All commands auto-start the server if not running. User never types `antfly` directly. | Require user to manage antfly manually (leaky abstraction), setup-only start without auto-start (fragile) |
| No feature flag | Clean cut — antfly is strictly better; dual-backend adds complexity for no benefit | Ship behind --backend flag (delays migration, doubles test surface) |
| Require re-index on upgrade | Different embedding model (bge-small-en vs MiniLM) means vectors are incompatible | Dual-read from old + new (massive complexity for temporary benefit) |

---

## Risk register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Antfly server must be running for dev-agent to work | Certain | Medium | CLI auto-starts via `ensureAntfly()`; `dev setup` handles first-time install |
| Antfly SDK is early (v0.0.14) — API may change | Medium | Medium | Pin SDK version; wrapped behind our VectorStore interface anyway |
| Background embedding means queries may miss recently-inserted docs | Medium | Low | Monitor embedding progress; optionally wait for completion in index command |
| Search result ranking changes (hybrid vs pure vector) | Certain | Low | Expected and desired — hybrid should be better; benchmark to confirm |
| `searchByDocumentId` behavior changes (vector → text-based) | Certain | Low | Text-based similarity + hybrid search should be equivalent or better for code |
| antfly swarm startup time adds latency to first command | Low | Low | Auto-start polls for readiness; MCP health check already exists |
| Need to rollback | Low | Low | Revert commits — clean fork, no existing users, no data migration |

---

## Test strategy

| Test | Priority | Description |
|------|----------|-------------|
| `antfly-store.test.ts` | P0 | AntflyVectorStore: create, insert, search, lookup, delete against running antfly |
| `vector.test.ts` (updated) | P0 | VectorStorage facade: end-to-end insert → search via antfly |
| Existing mock-based tests | P0 | All indexer/service tests use mocked VectorStorage — should pass unchanged |
| Hybrid search quality | P1 | Compare dev_search results before/after for 10 known queries |
| `dev index .` end-to-end | P1 | Full indexing pipeline with antfly backend |
| Performance benchmark | P2 | Index time + search latency: LanceDB vs antfly on this repo |
| Background embedding timing | P2 | Measure delay between insert and searchability |

---

## Verification checklist

- [ ] `pnpm build` passes
- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` — all existing tests pass (mock-based tests unchanged)
- [ ] `dev index .` works end-to-end with antfly
- [ ] `dev_search` returns relevant results via MCP (hybrid search)
- [ ] `dev_search "validateUser"` finds exact function (BM25 signal)
- [ ] `dev_search "authentication middleware"` finds related code (vector signal)
- [ ] `dev_history` returns relevant git commits
- [ ] `dev_gh` returns relevant GitHub issues
- [ ] `client.tables.lookup()` works for `dev_refs` and `dev_inspect`
- [ ] No `@lancedb/lancedb` or `@xenova/transformers` in any package.json
- [ ] `dev setup` works end-to-end (checks binary, pulls model, starts server)
- [ ] `dev index .` auto-starts antfly if not running (no user intervention)
- [ ] README and doc site document `dev setup` and what it does (no surprises)
- [ ] Antfly binary missing → clear error with install instructions

---

## Dependencies

- **antfly binary** — `dev setup` prompts to install automatically (brew on macOS, curl on Linux) with user confirmation
- **Termite model** — `dev setup` handles this automatically
- **antfly server** — auto-started by CLI, user never runs it directly
- **@antfly/sdk** — `pnpm add @antfly/sdk` in core + dev-agent packages
- Part 1.1 spike must be completed before Part 1.2 begins
