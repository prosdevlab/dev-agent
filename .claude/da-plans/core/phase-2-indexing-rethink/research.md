# Phase 2 Research: Indexing Libraries & Patterns

## File Watching

| Library | Downloads/wk | Historical queries | Native | Used by |
|---------|-------------|-------------------|--------|---------|
| `@parcel/watcher` | 12.6M | **Yes** (`getEventsSince()`) | C++ | VS Code, Tailwind, Nx, Nuxt |
| `chokidar` | 115M | No | JS | Webpack, Vite, Brunch |
| `fb-watchman` | 12M | Yes (clock-based) | Daemon | Jest, React Native |
| `nsfw` | 200K | No | C++ | GitKraken |
| `node:fs.watch` | built-in | No | N/A | — |

**Winner: `@parcel/watcher`** — the `getEventsSince()` API solves the "MCP server restarts,
what changed?" problem without a persistent daemon. Native C++ performance. VS Code uses it.

## Indexing patterns from industry

| Tool | Change detection | Incremental strategy |
|------|-----------------|---------------------|
| Zoekt (Sourcegraph) | Delta indexing vs stored state | Only processes changed files, merges shards |
| GitHub Code Search | Content hash (blob SHA) | Unchanged blobs never re-indexed |
| Cursor | Merkle trees, checks every 10 min | Hash mismatches → re-embed only changed files |
| Livegrep | None | Full re-index every time (anti-pattern) |

**Key pattern:** Content hashing for change detection. All major tools use it.

## Antfly Linear Merge API

Antfly has a built-in sync API designed for exactly this use case:

```bash
POST /api/v1/tables/{table}/merge
{
  "documents": {
    "doc-1": { "text": "...", "metadata": "..." },
    "doc-2": { "text": "...", "metadata": "..." }
  },
  "delete_missing": true  // Remove docs not in this batch
}
```

**What it does:**
- Content hashing server-side — unchanged documents are skipped (no re-embedding)
- New/changed documents are upserted
- With `delete_missing: true`, documents not in the payload are removed
- Returns: `{ upserted: N, skipped: N, deleted: N }`

**This replaces:** state file, hash tracking, manual upsert logic, delete-then-insert
for removed files. All handled by Antfly in one API call.

## MCP server patterns

Most MCP servers are stateless (read on demand). Notable exceptions:
- `mcp-file-context-server` — file watching + LRU cache + auto-invalidation
- `context-mode` — event log + FTS5/BM25 in SQLite

No established pattern for live-indexed MCP servers. dev-agent would be first.

MCP spec supports `roots/list_changed` notification for workspace changes.

## What to build vs reuse

| Component | Action | Tool |
|-----------|--------|------|
| File watching | Reuse | `@parcel/watcher` |
| Change detection | Reuse | Antfly Linear Merge (server-side content hashing) |
| State file / hash tracking | **Drop entirely** | Antfly handles dedup + deletion |
| Tree-sitter parsing | Already have | `web-tree-sitter` |
| Embedding | Already have | Antfly Termite |
| Batch insert | Simplify | Antfly Linear Merge (one call replaces batch loop) |
| Orchestration glue | Build | Watcher → parser → merge (the only new code) |
