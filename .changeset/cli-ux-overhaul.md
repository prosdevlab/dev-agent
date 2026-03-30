---
"@prosdevlab/dev-agent": minor
---

### CLI UX Overhaul

**Setup (`dev setup`)**
- Native-first: Antfly native binary is now the default, Docker available via `--docker` flag
- Consistent ora spinners throughout (no more mixed logger/spinner output)
- Docker model pull: setup now pulls the embedding model inside Docker containers
- Docker memory warning: warns if Docker has less than 4GB allocated

**Index (`dev index`)**
- 7x faster: removed `buildCodeMetadata` (32s of N+1 git calls → 0s)
- Auto-starts Antfly if not running — no more "fetch failed" errors
- Ora spinners with file count during scanning, elapsed timer during embedding
- Pre-flight model check: auto-pulls embedding model if missing
- Resilient error messages with actionable guidance (OOM, port conflict, model missing)
- Normalized `dev index .` → `dev index` (path defaults to cwd)
- Improved next steps: MCP install, try-it-out commands, `dev --help`
- Removed dead "Git history" line from indexing plan

**Reset (`dev reset`)**
- New command to tear down Antfly and clean all indexed data
- Supports both Docker and native cleanup
- Directs users to `dev setup` to start fresh

**MCP Server**
- Auto-starts Antfly on MCP server startup (no manual `dev setup` needed after reboot)
- Auto-recovery: if Antfly crashes mid-session, MCP retries tool calls after restarting the server
- Human-readable errors when Antfly is unreachable

**Antfly Resilience**
- Native-first priority in `ensureAntfly` (better performance, no VM overhead)
- Port conflict detection with `lsof` guidance
- `linearMerge` now reports per-page progress via `onProgress` callback
- Upgraded ora to 9.x
