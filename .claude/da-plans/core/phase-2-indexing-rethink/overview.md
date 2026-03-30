# Phase 2: Rethink Indexing & Search Flow

**Status:** Spike complete, Plan A confirmed

## Context

Phase 1 replaced the storage layer (LanceDB → Antfly) but kept the old indexing
flow intact. That flow was overengineered for its original constraints: local file
storage, manual embedding pipeline, state files tracking file hashes and document IDs.

Research (see [research.md](./research.md)) found two production-grade tools that
eliminate most of our custom plumbing:

1. **`@parcel/watcher`** — native file watcher with `getEventsSince()` that tracks
   changes even when our process isn't running (used by VS Code)
2. **Antfly Linear Merge** — server-side content hashing and dedup in one API call.
   Used for full-index; incremental paths use `batchOp` instead (see spike findings).

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
│  │  watcher      │     │  (ts-morph,  │     │  Merge /    │  │
│  │              │     │  tree-sitter) │     │  batchOp    │  │
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
2. Antfly Linear Merge: send ALL documents (sorted by key)
   → Antfly hashes content, stores new docs, skips unchanged, deletes stale
   → Range covers all keys → absent docs auto-removed
   → Returns: { upserted: 2525, skipped: 0, deleted: 0 }
3. Save @parcel/watcher snapshot to ~/.dev-agent/indexes/{hash}/watcher-snapshot
4. Start watching for changes
```

**Ongoing (automatic, no user command):**
```
1. @parcel/watcher fires: files A, B, C changed; file D deleted
2. Debounce (wait 500ms of quiet)
3. Parse only changed files → extract components
4. For changed files: Antfly batchOp — upsert changed docs
5. For deleted files: Antfly batchOp — explicit delete by doc ID
6. MCP tools immediately have fresh data
```

**MCP server restart:**
```
1. @parcel/watcher.getEventsSince(snapshotPath)
   → "files X, Y, Z changed while you were off"
2. If snapshot missing: fall back to full index (same as first time)
3. If snapshot exists: parse only changed files → batchOp (upsert + delete)
4. Save new snapshot, resume watching
```

**Force re-index (`dev index . --force`):**
```
1. Antfly: drop table, recreate
2. Full scan + Linear Merge (same as first time)
```

### Critical: API selection by operation

Linear Merge always deletes absent keys within the batch's key range (see
[2.1-spike-findings.md](./2.1-spike-findings.md)). There is no `delete_missing`
toggle — deletion is range-scoped and automatic. This drives API selection:

| Operation | API | Why |
|-----------|-----|-----|
| `dev index .` (full) | Linear Merge | All docs sent → range covers everything → stale docs auto-deleted |
| `dev index . --force` | Drop table → Linear Merge | Complete rebuild |
| Watcher incremental | `batchOp` (inserts + deletes) | Only changed files; explicit delete for removed files |
| MCP restart catchup | `batchOp` (inserts + deletes) | Same as watcher — only process changes since snapshot |

**Safety rule:** Incremental paths NEVER use Linear Merge. Only full index does.
Linear Merge's range-scoped deletion would incorrectly delete docs outside the
changed file set. Unit test enforces this.

### What we drop

| Old complexity | Replaced by |
|---------------|-------------|
| `indexer-state.json` (file hashes, doc IDs) | `@parcel/watcher` snapshots + Antfly Linear Merge |
| Manual `dev index .` after every change | Automatic via file watcher |
| Batch size 32 + CONCURRENCY parallelism | Linear Merge for full index, batchOp for incremental |
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
  With git/github dropped, the CLI command is removed. `PlannerAgent` survives for
  code-context-only planning.
- **`dev_explore`** — subagent-based exploration, replaced by direct MCP tool usage.
- **`dev update`** — replaced by automatic file watcher. `dev index .` is the manual
  fallback.

This reduces from 3 Antfly tables to 1, 9 MCP tools to 6, and removes 2 indexing phases.

---

## Spike resolution (Plan A confirmed)

The Part 2.1 spike (see [2.1-spike-findings.md](./2.1-spike-findings.md)) confirmed:

1. **Linear Merge API exists** in `@antfly/sdk@0.0.14` via `client.getRawClient().POST()`
2. **Content hashing works** — unchanged docs return `skipped` (no re-embedding)
3. **Deletion is range-scoped** — no `delete_missing` toggle; absent keys within
   `[last_merged_id, max_key_in_batch]` are auto-deleted
4. **`@parcel/watcher`** — all APIs work: `subscribe()`, `writeSnapshot()`, `getEventsSince()`

**Plan B (client-side hashing) is not needed.** Removed from consideration.

---

## Decisions

| Decision | Rationale | Alternatives |
|----------|-----------|-------------|
| Use `@parcel/watcher` | Native, `getEventsSince()` survives restarts, VS Code uses it | chokidar (no historical queries), watchman (requires daemon) |
| Linear Merge for full index, batchOp for incremental | Linear Merge's range-scoped deletion handles full-index cleanup. batchOp gives precise control for incremental. | Linear Merge for everything (risk: range-scoped deletion breaks incremental) |
| Watch from MCP server process | MCP server is the long-running process; watcher lives there | Separate daemon (more complexity), CLI-only (no auto-update) |
| Drop git/github indexing | GitHub has its own MCP server; git CLI is excellent; not everyone uses GH. Focus on code search — our unique value. | Keep as optional plugins (future, if demand) |
| Debounce file changes (500ms) | Avoid re-indexing mid-save; batch rapid changes | Per-file immediate (too many API calls), longer debounce (stale data) |
| Drop indexer-state.json | Antfly + watcher replace all its functions | Keep as backup (unnecessary — spike confirmed server-side hashing) |
| Watcher snapshot at `~/.dev-agent/indexes/{hash}/watcher-snapshot` | Colocated with project index data, survives process restarts | In repo dir (pollutes project), in memory (lost on restart) |
| Concurrent MCP instances are safe | Incremental uses batchOp (safe for concurrent writes). Full-index Linear Merge is NOT safe for overlapping key ranges, but two instances doing full-index simultaneously is rare and the worst case is redundant work, not data loss. | File-based advisory lock (complexity for rare case) |

---

## Parts

| Part | Description | User stories | Risk |
|------|-------------|-------------|------|
| 2.1 | Spike: verify Antfly Linear Merge API + `@parcel/watcher` | — | Low |
| 2.2 | Add Linear Merge (full index) + batchOp (incremental) to AntflyVectorStore | US-3, US-5, US-6 | Low |
| 2.3 | Simplify RepositoryIndexer, drop state file | US-3, US-6 | Medium |
| 2.4 | Add `@parcel/watcher` + debounced auto-index to MCP server | US-4, US-12 | Medium |
| 2.5 | `getEventsSince` on MCP server startup | US-4b, US-5, US-12 | Low |
| 2.6a | Remove MCP adapters (history, github, plan, explore) + CLI commands (git, github, plan, update) | US-12 | Medium |
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
- **Removed CLI commands (`dev git`, `dev github`, `dev plan`, `dev update`)** →
  if user runs them, they get "Unknown command" error. Release notes document:
  - `dev git` / `dev github`: use `git` CLI, `gh` CLI, or GitHub MCP server
  - `dev plan`: use `PlannerAgent` directly (GitHub issue fetching removed)
  - `dev update`: replaced by automatic file watcher; use `dev index .` for manual

---

## Risk register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| ~~Antfly Linear Merge API doesn't exist~~ | ~~Medium~~ | ~~High~~ | **Resolved:** Spike confirmed API exists and works (2.1-spike-findings.md) |
| `@parcel/watcher` native addon install issues | Medium | Medium | Fall back to chokidar; bundle prebuilt binaries |
| Incremental accidentally deletes docs | Low | Critical | Incremental uses batchOp (no auto-deletion). Linear Merge restricted to full-index only. Unit test enforces API selection. |
| File watcher misses changes (edge cases) | Low | Medium | `dev index .` always available as manual fallback |
| Git branch switch creates hundreds of changes | Medium | Low | Debounce handles; watcher batches all changes in 500ms window |
| Watcher snapshot corrupted or missing | Low | Low | Fall back to full index (same as first run) |
| Two MCP instances on same repo | Medium | Low | Incremental uses batchOp (concurrent-safe). Simultaneous full-index is rare; worst case is redundant work. |
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
| `api-selection.test.ts` | Full index uses Linear Merge; incremental uses batchOp; NEVER Linear Merge for incremental |
| `derive-table-name.test.ts` | Edge cases: special chars, long names, unexpected path structures |
| `document-preparation.test.ts` | Existing tests — verify unchanged after refactor |

### Integration tests (P0)

| Test | What it verifies |
|------|-----------------|
| `linear-merge.integration.test.ts` | Insert → update → verify dedup. Content hash skips unchanged. Range-scoped deletion removes stale. |
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

- [ ] `dev index .` works end-to-end (Linear Merge)
- [ ] File watcher detects changes and auto-re-indexes
- [ ] MCP server restart catches up via `getEventsSince`
- [ ] Snapshot missing → falls back to full index, no crash
- [ ] `dev_search "validateUser"` returns exact match (BM25)
- [ ] `dev_search "authentication middleware"` returns semantic matches (vector)
- [ ] `dev index . --force` clears and rebuilds
- [ ] Incremental NEVER uses Linear Merge (uses batchOp instead)
- [ ] `dev status` shows fresh Antfly stats + watcher status
- [ ] No `indexer-state.json` written or read
- [ ] Old `indexer-state.json` detected → deleted with info message
- [ ] Git/GitHub adapters removed (dev_history, dev_gh, dev_plan, dev_explore)
- [ ] MCP tools reduced from 9 to 6 (search, refs, map, inspect, status, health)
- [ ] Two MCP instances on same repo don't conflict
- [ ] Works on this repo (dev-agent) end-to-end
- [ ] Initial index < 60s on dev-agent repo
- [ ] Incremental update < 3s for 10 files

---

## Dependencies

- Phase 1 (Antfly migration) — merged
- Antfly Linear Merge API — **confirmed in spike** (Part 2.1)
- `@parcel/watcher@2.5.6` — installed in mcp-server package
- `@parcel/watcher` snapshot path added to `getStorageFilePaths()`
