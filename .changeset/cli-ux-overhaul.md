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
- Ora spinners with file count during scanning
- Pre-flight model check: auto-pulls embedding model if missing
- Resilient error messages with actionable guidance (OOM, port conflict, model missing)
- Normalized `dev index .` → `dev index` (path defaults to cwd)
- Improved next steps: MCP install, try-it-out commands, `dev --help`

**Search (`dev search`)**
- Removed misleading percentage scores (RRF scores are not similarity percentages)
- Default threshold changed from 0.7 to 0 (RRF scores are much lower than cosine similarity)
- Config no longer required — defaults to current directory

**Map (`dev map`)**
- Clean output: no markdown headers, no emojis, relative paths, proper tree connectors
- Fixed `--focus` nesting bug (was showing redundant parent directories)
- Next steps with usage examples
- N+1 git fix: `calculateChangeFrequency` now uses single `git log` call with pure testable parser

**Reset (`dev reset`)**
- New command to tear down Antfly and clean all indexed data
- Supports both Docker and native cleanup

**MCP Server**
- Auto-starts Antfly on MCP server startup (no manual `dev setup` needed after reboot)
- Auto-recovery: if Antfly crashes mid-session, MCP retries tool calls after restarting the server
- Human-readable errors when Antfly is unreachable

**Removed**
- `dev init` — config is now optional, all commands default to current directory
- `dev stats` and `dev dashboard` — metrics collection removed
- Dead GitHub output functions (~200 lines)

**Internal**
- Native-first priority in `ensureAntfly` (better performance, no VM overhead)
- Port conflict detection with `lsof` guidance
- `linearMerge` per-page progress via `onProgress` callback
- `vectors.lance` → `vectors` (clean Antfly table names)
- Extended scanner exclusions: `.env*`, `*.min.js`, `*.d.ts`, `generated/`, `.terraform/`, `.claude/`
- Pure testable functions: `parseGitLogOutput`, `buildFrequencyMap`, `stripFocusPrefix`
- Upgraded ora to 9.x
