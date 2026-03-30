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

See [user-stories.md](./user-stories.md) for the 16 user stories driving this redesign.

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
2. Antfly Linear Merge: send all documents
   → Antfly hashes content, stores new docs, skips unchanged
   → Returns: { upserted: 2525, skipped: 0, deleted: 0 }
3. Save watcher snapshot (for getEventsSince on restart)
4. Start watching for changes
```

**Ongoing (automatic, no user command):**
```
1. @parcel/watcher fires: files A, B, C changed
2. Debounce (wait 500ms of quiet)
3. Parse only changed files → extract components
4. Antfly Linear Merge: send only changed documents
   → Returns: { upserted: 3, skipped: 0, deleted: 1 }
5. MCP tools immediately have fresh data
```

**MCP server restart:**
```
1. @parcel/watcher.getEventsSince(lastSnapshot)
   → "files X, Y, Z changed while you were off"
2. Parse only those files → extract → merge
3. Resume watching
```

**Force re-index (`dev index . --force`):**
```
1. Antfly: drop tables, recreate
2. Full scan + merge (same as first time)
```

### What we drop

| Old complexity | Replaced by |
|---------------|-------------|
| `indexer-state.json` (file hashes, doc IDs) | `@parcel/watcher` snapshots + Antfly Linear Merge |
| Manual `dev index .` after every change | Automatic via file watcher |
| Batch size 32 + CONCURRENCY parallelism | Single Linear Merge call per change batch |
| Three separate VectorStorage instances | One AntflyClient, three table names |
| `TransformersEmbedder` pipeline | Antfly auto-embeds via Termite |
| Hash comparison in RepositoryIndexer | Antfly server-side content hashing |

### What we keep

- **Scanner pipeline** — ts-morph, tree-sitter, remark (proven, well-tested)
- **Document preparation** — `prepareDocumentsForEmbedding()` (pure transform)
- **MCP adapter layer** — unchanged, consumes search results

### What we deprecate

- **Git history indexing** (`dev_history`, `dev git index`) — `git log`, `git blame`,
  and AI tools can run git commands directly. Semantic commit search is a nice-to-have
  but not worth the indexing cost.
- **GitHub indexing** (`dev_gh`, `dev github index`) — GitHub's own MCP server handles
  issues, PRs, and repo context natively. `gh` CLI is excellent. No reason to maintain
  a separate index of the same data.
- **`dev_plan`** context assembly — was valuable when it bundled issue + code + commits.
  With git/github dropped, this becomes just a code search wrapper. Can revisit if needed.

This reduces from 3 Antfly tables to 1 (code only), and removes 2 indexing phases.

## Decisions

| Decision | Rationale | Alternatives |
|----------|-----------|-------------|
| Use `@parcel/watcher` | Native, `getEventsSince()` survives restarts, VS Code uses it | chokidar (no historical queries), watchman (requires daemon) |
| Use Antfly Linear Merge | Server-side content hashing eliminates state file entirely | Keep state file + manual upsert (more code, same result) |
| Watch from MCP server process | MCP server is the long-running process; watcher lives there | Separate daemon (more complexity), CLI-only (no auto-update) |
| Drop git/github indexing entirely | GitHub has its own MCP server; `gh` and `git` CLIs are excellent; AI tools call them directly. Not everyone uses GitHub — teams use Linear, Jira, Notion, Shortcut. By not coupling to GH, we stay tool-agnostic. Focus on code search — our unique value. | Keep as optional plugins (future, if demand) |
| Debounce file changes (500ms) | Avoid re-indexing mid-save; batch rapid changes | Per-file immediate (too many API calls), longer debounce (stale data) |
| Drop indexer-state.json | Antfly + watcher replace all its functions | Keep for backward compat (dead code) |

## Parts

| Part | Description | User stories | Risk |
|------|-------------|-------------|------|
| 2.1 | Spike: verify Antfly Linear Merge API + `@parcel/watcher` | — | Low |
| 2.2 | Replace batch insert with Antfly Linear Merge | US-3, US-5, US-6 | Low |
| 2.3 | Simplify RepositoryIndexer, drop state file | US-3, US-6 | Medium |
| 2.4 | Add `@parcel/watcher` + debounced auto-index to MCP server | US-4, US-12 | Medium |
| 2.5 | `getEventsSince` on MCP server startup | US-5, US-12 | Low |
| 2.6 | Deprecate git/github indexing, remove adapters | US-12 | Low |
| 2.7 | `dev status` rework — Antfly table stats + watcher status | US-13 | Low |
| 2.8 | E2E tests: index this repo, search, verify results | US-3, US-8, US-9 | Low |

## Risk register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `@parcel/watcher` native addon install issues | Medium | Medium | Fall back to chokidar; or bundle prebuilt binaries |
| Antfly Linear Merge API doesn't exist yet in SDK | Medium | High | Verify in spike; use raw REST if SDK missing |
| File watcher misses changes (edge cases) | Low | Medium | `dev index .` always available as manual fallback |
| Large repos overwhelm watcher (10k+ files) | Low | Medium | Filter aggressively (ignore node_modules, dist, etc.) |
| Debounce window too long/short | Low | Low | Make configurable; 500ms default is standard |

## Verification checklist

- [ ] `dev index .` works end-to-end with Linear Merge
- [ ] File watcher detects changes and auto-re-indexes
- [ ] MCP server restart catches up via `getEventsSince`
- [ ] `dev_search "validateUser"` returns exact match (BM25)
- [ ] `dev_search "authentication middleware"` returns semantic matches (vector)
- [ ] `dev index . --force` clears and rebuilds
- [ ] `dev status` shows fresh Antfly stats + watcher status
- [ ] No `indexer-state.json` written or read
- [ ] Git/GitHub adapters removed (dev_history, dev_gh, dev_plan)
- [ ] MCP tools reduced from 9 to 6 (search, refs, map, inspect, status, health)
- [ ] Works on this repo (dev-agent) end-to-end

## Dependencies

- Phase 1 (Antfly migration) — merged
- Antfly Linear Merge API — verify in spike (Part 2.1)
- `@parcel/watcher` — npm install
