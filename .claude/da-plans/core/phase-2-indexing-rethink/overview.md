# Phase 2: Rethink Indexing & Search Flow

**Status:** Draft

## Context

Phase 1 replaced the storage layer (LanceDB → Antfly) but kept the old indexing
flow intact. That flow was overengineered for its original constraints: local file
storage, manual embedding pipeline, state files tracking file hashes and document IDs.

Research (see [research.md](./research.md)) found two production-grade tools that
eliminate most of our custom plumbing:

1. **`@parcel/watcher`** — native file watcher with `getEventsSince()` that tracks
   changes even when our process isn't running (used by VS Code)
2. **Antfly Linear Merge** — server-side content hashing, dedup, and deletion in
   one API call. Replaces our state file, hash tracking, and upsert logic.

See [user-stories.md](./user-stories.md) for the user stories driving this redesign.

---

## Current flow (what we're replacing)

```
dev index .
  ├─ Scan ALL files (glob + parse)
  ├─ Prepare EmbeddingDocument[] from scan results
  ├─ Batch insert (32 docs × CONCURRENCY parallel HTTP calls)
  ├─ Track state: file hashes, document IDs, timestamps → indexer-state.json
  ├─ Git: extract commits → separate table
  ├─ GitHub: fetch issues/PRs → separate table
  └─ Emit events, close

Problems:
  - Manual trigger required (US-4: changes should be automatic)
  - State file tracks what Antfly already knows (redundant)
  - Batch size 32 when Antfly handles 500 (15x too many HTTP calls)
  - No way to know what changed while MCP server was off
  - Git/GitHub coupled to code indexing
```

---

## Proposed flow

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    MCP Server (always running)               │
│                                                              │
│  ┌──────────────┐     ┌──────────────┐     ┌─────────────┐  │
│  │  @parcel/     │────▶│   Scanner    │────▶│   Antfly    │  │
│  │  watcher      │     │  (ts-morph,  │     │   Linear    │  │
│  │              │     │  tree-sitter) │     │   Merge     │  │
│  │ getEventsSince│     └──────────────┘     └─────────────┘  │
│  └──────────────┘                                            │
│         │                                                    │
│         │ on file change                                     │
│         ▼                                                    │
│  ┌──────────────┐                                            │
│  │  Debounce    │  (batch changes, wait 500ms of quiet)     │
│  │  + Filter    │  (ignore node_modules, dist, .git)        │
│  └──────────────┘                                            │
└─────────────────────────────────────────────────────────────┘
```

### The flow

**First time (`dev index .`):**
```
1. Scan all files → parse → extract code components
2. Antfly Linear Merge (delete_missing: true): send all documents
   → Antfly hashes content, stores new docs, skips unchanged, removes stale
   → Returns: { upserted: 2525, skipped: 0, deleted: 0 }
3. Save @parcel/watcher snapshot to ~/.dev-agent/indexes/{hash}/watcher-snapshot
4. Start watching for changes
```

**Ongoing (automatic, no user command):**
```
1. @parcel/watcher fires: files A, B, C changed; file D deleted
2. Debounce (wait 500ms of quiet)
3. Parse only changed files → extract components
4. For changed files: Antfly Linear Merge (delete_missing: false) — upsert only
5. For deleted files: explicitly delete doc IDs that belonged to those files
6. MCP tools immediately have fresh data
```

**MCP server restart:**
```
1. @parcel/watcher.getEventsSince(snapshotPath)
   → "files X, Y, Z changed while you were off"
2. If snapshot missing: fall back to full index (same as first time)
3. If snapshot exists: parse only changed files → merge (delete_missing: false)
4. Save new snapshot, resume watching
```

**Force re-index (`dev index . --force`):**
```
1. Antfly: drop table, recreate
2. Full scan + merge (same as first time)
```

### Critical: `delete_missing` scoping

| Operation | `delete_missing` | Why |
|-----------|-----------------|-----|
| `dev index .` (full) | `true` | Clean slate — remove docs for deleted files |
| `dev index . --force` | N/A — drops table | Complete rebuild |
| Watcher incremental | `false` | Only upsert changed; delete removed files explicitly |
| MCP restart catchup | `false` | Only process changes since snapshot |

**Safety rule:** Incremental paths NEVER use `delete_missing: true`. Only full index does.
Unit test enforces this.

### What we drop

| Old complexity | Replaced by |
|---------------|-------------|
| `indexer-state.json` (file hashes, doc IDs) | `@parcel/watcher` snapshots + Antfly Linear Merge |
| Manual `dev index .` after every change | Automatic via file watcher |
| Batch size 32 + CONCURRENCY parallelism | Single Linear Merge call per change batch |
| Three separate VectorStorage instances | One AntflyClient, one table |
| `TransformersEmbedder` pipeline | Antfly auto-embeds via Termite |
| Hash comparison in RepositoryIndexer | Antfly server-side content hashing |

### What we keep

- **Scanner pipeline** — ts-morph, tree-sitter, remark (proven, well-tested)
- **Document preparation** — `prepareDocumentsForEmbedding()` (pure transform)
- **VectorStorage facade** — thin wrapper over AntflyVectorStore (Phase 1 established this)
- **MCP adapter layer** — unchanged, consumes search results
- **`LocalGitExtractor`** — used by `dev_map` for change frequency (shells out to git directly)

### What we deprecate

- **Git history indexing** (`dev_history`, `dev git index`) — `git log`, `git blame`,
  and AI tools can run git commands directly.
- **GitHub indexing** (`dev_gh`, `dev github index`) — GitHub's own MCP server handles
  this. Not everyone uses GitHub — teams use Linear, Jira, Notion, Shortcut.
- **`dev_plan`** context assembly — was valuable when it bundled issue + code + commits.
  With git/github dropped, revisit if needed.

This reduces from 3 Antfly tables to 1, 9 MCP tools to 6, and removes 2 indexing phases.

---

## Plan B: If Linear Merge doesn't exist

If the spike (Part 2.1) reveals that Antfly does not have a Linear Merge API or it
lacks content hashing:

**Fallback:** Client-side content hashing with existing `batchOp`.

```typescript
// Lightweight hash file: ~/.dev-agent/indexes/{hash}/doc-hashes.json
// Format: { "doc-id": "sha256-of-text" }

// On index:
for (const doc of documents) {
  const hash = sha256(doc.text);
  if (existingHashes[doc.id] === hash) continue; // Skip unchanged
  inserts[doc.id] = { text: doc.text, metadata: ... };
  newHashes[doc.id] = hash;
}
await batchOp({ inserts });
```

This is worse than server-side hashing (local state file, more code) but works
with the existing API. The watcher flow stays the same — only the merge step changes.

**Decision point:** The spike resolves this. If Linear Merge exists, use it. If not,
use Plan B. The rest of the plan (watcher, debounce, git/gh removal) is unaffected.

---

## Decisions

| Decision | Rationale | Alternatives |
|----------|-----------|-------------|
| Use `@parcel/watcher` | Native, `getEventsSince()` survives restarts, VS Code uses it | chokidar (no historical queries), watchman (requires daemon) |
| Use Antfly Linear Merge (or Plan B) | Server-side content hashing eliminates state file. Plan B if unavailable. | Keep full state file (Phase 1 approach, more code) |
| Watch from MCP server process | MCP server is the long-running process; watcher lives there | Separate daemon (more complexity), CLI-only (no auto-update) |
| Drop git/github indexing | GitHub has its own MCP server; git CLI is excellent; not everyone uses GH. Focus on code search — our unique value. | Keep as optional plugins (future, if demand) |
| Debounce file changes (500ms) | Avoid re-indexing mid-save; batch rapid changes | Per-file immediate (too many API calls), longer debounce (stale data) |
| Drop indexer-state.json | Antfly + watcher replace all its functions | Keep for Plan B (lightweight hash file only) |
| Watcher snapshot at `~/.dev-agent/indexes/{hash}/watcher-snapshot` | Colocated with project index data, survives process restarts | In repo dir (pollutes project), in memory (lost on restart) |
| Concurrent MCP instances are safe | Antfly Linear Merge is idempotent (content-hashed). Two watchers writing same data = redundant but harmless. | File-based advisory lock (complexity for rare case) |

---

## Parts

| Part | Description | User stories | Risk |
|------|-------------|-------------|------|
| 2.1 | Spike: verify Antfly Linear Merge API + `@parcel/watcher` | — | Low |
| 2.2 | Replace batch insert with Antfly Linear Merge (or Plan B) | US-3, US-5, US-6 | Low |
| 2.3 | Simplify RepositoryIndexer, drop state file | US-3, US-6 | Medium |
| 2.4 | Add `@parcel/watcher` + debounced auto-index to MCP server | US-4, US-12 | Medium |
| 2.5 | `getEventsSince` on MCP server startup | US-4b, US-5, US-12 | Low |
| 2.6a | Remove MCP adapters (history, github, plan) + CLI commands (git, github) | US-12 | Medium |
| 2.6b | Remove core services, subagent github module, types, update exports | US-12 | Medium |
| 2.7 | `dev status` rework — Antfly table stats + watcher status | US-13 | Low |
| 2.8 | E2E tests: index this repo, search, verify results | US-3, US-8, US-9 | Low |

---

## Migration (Phase 1 → Phase 2 upgrade)

For users running Phase 1 (Antfly migration already merged):

- **`indexer-state.json` exists** → log info "Migrating to new indexing system",
  delete the file. No user action needed.
- **Old git/github vector tables in Antfly** → left in place (harmless).
  `dev clean` removes them if user wants.
- **No watcher snapshot exists** → first run does a full index (same as fresh install).
  No `--force` required.
- **Removed CLI commands (`dev git`, `dev github`)** → if user runs them, they get
  "Unknown command" error. Release notes document the deprecation.

---

## Risk register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Antfly Linear Merge API doesn't exist | Medium | High | Spike verifies; Plan B (client-side hashing) documented above |
| `@parcel/watcher` native addon install issues | Medium | Medium | Fall back to chokidar; bundle prebuilt binaries |
| Incremental merge accidentally deletes docs | Low | Critical | `delete_missing` scoping rules above; unit test enforces |
| File watcher misses changes (edge cases) | Low | Medium | `dev index .` always available as manual fallback |
| Git branch switch creates hundreds of changes | Medium | Low | Debounce handles; watcher batches all changes in 500ms window |
| Watcher snapshot corrupted or missing | Low | Low | Fall back to full index (same as first run) |
| Two MCP instances on same repo | Medium | Low | Antfly merge is idempotent; redundant but safe |
| Large repos overwhelm watcher (10k+ files) | Low | Medium | Filter aggressively (node_modules, dist, .git, etc.) |
| `dev_map` breaks after LocalGitExtractor changes | Low | Medium | Keep LocalGitExtractor for now; shells out to git directly |
| Git/github removal ripple effects (38 files) | Medium | Medium | Split into 2.6a/2.6b; `pnpm typecheck` after each deletion |

---

## Test strategy

### Unit tests (P0)

| Test | What it verifies |
|------|-----------------|
| `debounce.test.ts` | Debounce batches rapid changes; fires after 500ms quiet; cancels on new event |
| `watcher-filter.test.ts` | Excludes node_modules, dist, .git, dotfiles; includes .ts, .js, .go, .md |
| `linear-merge-scoping.test.ts` | Full index uses `delete_missing: true`; incremental uses `false`; NEVER true for incremental |
| `derive-table-name.test.ts` | Edge cases: special chars, long names, unexpected path structures |
| `document-preparation.test.ts` | Existing tests — verify unchanged after refactor |

### Integration tests (P0)

| Test | What it verifies |
|------|-----------------|
| `linear-merge.integration.test.ts` | Insert → update → verify dedup. Content hash skips unchanged. Delete missing removes stale. |
| `watcher-pipeline.integration.test.ts` | Create file → watcher fires → scanner parses → merge upserts → searchable |
| `get-events-since.integration.test.ts` | Write snapshot → change files offline → `getEventsSince` returns correct diff |
| `mcp-tools-regression.test.ts` | All 6 remaining tools (search, refs, map, inspect, status, health) work after adapter removal |

### Error handling tests (P1)

| Test | What it verifies |
|------|-----------------|
| `antfly-down.test.ts` | Index/search fails gracefully with clear error; MCP tools return error not crash |
| `watcher-failure.test.ts` | Watcher error → log warning, continue serving stale data |
| `snapshot-missing.test.ts` | No snapshot → full re-index (same as first run), no crash |
| `snapshot-corrupted.test.ts` | Invalid snapshot → fall back to full re-index |

### E2E tests (P1)

| Test | What it verifies |
|------|-----------------|
| `e2e-index-dev-agent.test.ts` | Index this repo → search for known code → verify results |
| `e2e-index-graphweave.test.ts` | Index graphweave repo → search → verify (dogfooding) |
| `e2e-incremental.test.ts` | Edit a file → watcher detects → re-indexes → new content searchable |
| `e2e-force-reindex.test.ts` | `dev index . --force` → table dropped → full rebuild → search works |

### Performance tests (P2)

| Test | Target | Measured on |
|------|--------|------------|
| Initial index | < 60s for 1k files, < 5 min for 10k files | dev-agent (~400 files), graphweave (~200 files) |
| Incremental (watcher) | < 3s for 10 changed files | Edit 10 files, measure time to searchable |
| MCP restart catchup | < 10s for 50 changed files | Simulate restart with `getEventsSince` |
| Search latency | < 500ms per query | Hybrid search on 2k+ indexed documents |

---

## Verification checklist

- [ ] `dev index .` works end-to-end (Linear Merge or Plan B)
- [ ] File watcher detects changes and auto-re-indexes
- [ ] MCP server restart catches up via `getEventsSince`
- [ ] Snapshot missing → falls back to full index, no crash
- [ ] `dev_search "validateUser"` returns exact match (BM25)
- [ ] `dev_search "authentication middleware"` returns semantic matches (vector)
- [ ] `dev index . --force` clears and rebuilds
- [ ] Incremental NEVER uses `delete_missing: true`
- [ ] `dev status` shows fresh Antfly stats + watcher status
- [ ] No `indexer-state.json` written or read
- [ ] Old `indexer-state.json` detected → deleted with info message
- [ ] Git/GitHub adapters removed (dev_history, dev_gh, dev_plan)
- [ ] MCP tools reduced from 9 to 6 (search, refs, map, inspect, status, health)
- [ ] Two MCP instances on same repo don't conflict
- [ ] Works on this repo (dev-agent) end-to-end
- [ ] Initial index < 60s on dev-agent repo
- [ ] Incremental update < 3s for 10 files

---

## Dependencies

- Phase 1 (Antfly migration) — merged
- Antfly Linear Merge API — verify in spike (Part 2.1); Plan B if absent
- `@parcel/watcher` — npm install in mcp-server package
- `@parcel/watcher` snapshot path added to `getStorageFilePaths()`
