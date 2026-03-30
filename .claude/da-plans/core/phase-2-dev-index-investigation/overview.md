# Phase 2: `dev index .` Investigation & Hardening

**Status:** Draft — investigate before implementing fixes.

## Context

`dev index .` is dev-agent's most important command. It scans a repository, extracts
code components, and stores them in Antfly for hybrid search. The antfly migration
(Phase 1) replaced the entire storage layer underneath it, but the indexing pipeline
itself wasn't tested end-to-end against a real repository.

This phase investigates what works, what's broken, and what needs hardening.

## What `dev index .` does (traced)

```
dev index .
  ├─ Check prerequisites (git repo, gh CLI)
  ├─ Load config, resolve storage paths
  ├─ Create RepositoryIndexer + VectorStorage
  ├─ indexer.initialize()
  │   └─ VectorStorage → AntflyVectorStore → create table if not exists
  │
  ├─ Phase 1: Scan repository
  │   └─ scanRepository() → glob files → parse with ts-morph/tree-sitter/remark
  │   └─ Returns: Document[] (functions, classes, types, etc.)
  │
  ├─ Phase 2: Prepare + store documents
  │   └─ prepareDocumentsForEmbedding() → EmbeddingDocument[]
  │   └─ Batch insert into Antfly (BATCH_SIZE=500, parallelism via CONCURRENCY)
  │   └─ Antfly auto-embeds via Termite (~2s delay)
  │
  ├─ Phase 3: Git history (if enabled)
  │   └─ Separate VectorStorage instance → vectors-git table
  │   └─ Extract commits → batch insert
  │
  ├─ Phase 4: GitHub issues/PRs (if enabled)
  │   └─ Separate VectorStorage instance → vectors-github table
  │   └─ Fetch via gh CLI → batch insert
  │
  └─ Save state, emit events, close
```

## What works well

- **Scanner pipeline** — ts-morph (TS/JS), tree-sitter (Go), remark (Markdown) are
  unchanged and well-tested (hundreds of existing tests)
- **Document preparation** — `prepareDocumentsForEmbedding()` is pure transformation,
  no storage dependency
- **State management** — indexer-state.json for incremental updates, file hash tracking
- **Three separate tables** — clean separation of code/git/github data
- **Error handling** — batch failures are caught and reported

## Known risks (from Phase 1 spike + migration)

### 1. Embedding availability timing (HIGH)

Antfly embeds documents asynchronously in the background (~2s delay per batch).
After `dev index .` completes, newly-inserted documents may not be searchable yet.

**Question:** Does `dev index .` need to wait for all embeddings to complete before
declaring success? Currently it doesn't — it returns as soon as all HTTP inserts succeed.

**Impact:** User runs `dev index .` then immediately `dev_search` — gets no results.

**Options:**
- a. Poll antfly for embedding completion before returning
- b. Add a brief sleep after all inserts
- c. Return immediately, note "embeddings processing" in output
- d. Antfly's full-text index (BM25) is immediate — only vector search is delayed

### 2. Network dependency (MEDIUM)

All storage operations are now HTTP calls to Antfly. Previously they were local disk writes.

**What could go wrong:**
- Antfly server goes down mid-index → partial index, unclear state
- Network timeout on large batches → batch retry needed
- Port conflict → ensureAntfly fails silently

**Question:** What happens if antfly crashes during `dev index .`? Is the state file
consistent with what's actually in antfly?

### 3. Batch size mismatch (LOW)

The indexer uses `batchSize=32` for its internal batching (parallelized with CONCURRENCY).
AntflyVectorStore has its own `BATCH_SIZE=500` for HTTP requests. These are independent —
the indexer sends 32 docs to `addDocuments()`, which passes them straight through since
32 < 500.

**Question:** Is this efficient? Should we increase the indexer batch size to match
antfly's capacity? Or does the parallelism (multiple batches of 32 in flight) compensate?

### 4. Incremental update + antfly dedup (LOW)

Incremental updates detect changed files, delete old documents, and insert new ones.
Antfly deduplicates by key (upsert on insert). The delete step might be redundant.

**Question:** Can we simplify incremental updates by just re-inserting (antfly overwrites)?
Or do we need the explicit delete for documents that no longer exist (removed code)?

### 5. deriveTableName edge cases (LOW)

`deriveTableName()` converts storePath to an antfly table name. It handles the three
known patterns (vectors, vectors-git, vectors-github) but may break on edge cases:
- Paths with special characters
- Very long project directory names
- Paths that don't match expected structure

### 6. No end-to-end test (CRITICAL)

We have 20 unit tests for AntflyVectorStore and hundreds of mock-based tests for the
indexer, but **no test that runs `dev index .` against a real repository with a real
antfly server**. This is the biggest gap.

## Investigation plan

### Step 1: Run `dev index .` on this repo

```bash
dev index .
```

Observe:
- Does it complete without errors?
- How long does it take?
- How many documents are indexed?
- Can we immediately search after?

### Step 2: Test search after indexing

```bash
dev search "authentication middleware"
dev search "VectorStorage"
dev search "handleError"
```

Observe:
- Do results come back?
- Are they relevant?
- Does hybrid search (exact + semantic) work?

### Step 3: Test incremental update

```bash
# Edit a file
echo "// test change" >> packages/core/src/vector/antfly-store.ts
dev update
# Revert
git checkout packages/core/src/vector/antfly-store.ts
```

Observe:
- Does incremental detect the change?
- Does it only re-index the changed file?
- Is the updated document searchable?

### Step 4: Test git history indexing

```bash
dev git search "antfly migration"
```

### Step 5: Test GitHub indexing

```bash
dev github search "hybrid search"
```

### Step 6: Test `--force` re-index

```bash
dev index . --force
```

Observe:
- Does it clear antfly tables and recreate?
- Is state file reset?
- Does it complete cleanly?

## Parts (if fixes are needed)

| Part | Description | Risk |
|------|-------------|------|
| 2.1 | E2E test: index a real repo, search, verify results | Low |
| 2.2 | Embedding completion: wait/poll after insert | Medium |
| 2.3 | Error recovery: handle antfly failures mid-index | Medium |
| 2.4 | Batch size optimization: tune for antfly throughput | Low |
| 2.5 | Incremental update simplification | Low |

## Dependencies

- Antfly server must be running
- Phase 1 (antfly migration) must be merged
