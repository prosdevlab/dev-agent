# @prosdevlab/dev-agent

## 0.12.2

### Patch Changes

- 96eef41: Add reverse callee index to dev_refs — callers now work. Previously "No callers found" for every function because caller detection relied on semantic search (returned similar concepts, not call sites). Now uses a persisted reverse index with 4,000+ caller entries, compound keys for O(1) lookup, and class-level aggregation.

## 0.12.1

### Patch Changes

- bc054d3: Remove misleading similarity scores from MCP search results. Search output now shows ranked results without percentages, matching industry practice (Sourcegraph Cody, Cursor, GitHub Copilot). Also fixes dev_refs failing to find symbols due to SearchService defaulting scoreThreshold to 0.7 which silently filtered all RRF results.

## 0.12.0

### Minor Changes

- fb8d163: Go callee extraction and Rust language support

  - Rust: full scanner — functions, structs, enums, traits, impl methods, imports, callees, doc comments
  - Rust: pattern rules — try operator, match expression, unsafe block, impl/trait definitions
  - Go: callee extraction for functions and methods — dev_refs now traces Go call chains
  - Go: pattern rules — error handling (if err != nil), goroutines, defer, channels
  - Generic impl type parameter stripping (Container<T>.show → Container.show)
  - All MCP tools (dev_search, dev_refs, dev_map, dev_patterns) work with Go callees and Rust

## 0.11.2

### Patch Changes

- f89069b: Add `dev refs` CLI command and fix callee path normalization

  - New `dev refs <name>` command: find callers and callees from the terminal
    - `--direction callees|callers|both` to filter results
    - `--depends-on <file>` to trace dependency paths
    - `--json` for machine-readable output
  - Normalize callee file paths: `dist/` → `src/`, `.d.ts` → `.ts`, absolute → relative
  - Fix hot paths showing build output (`packages/logger/dist/types.d.ts` → `packages/logger/src/types.ts`)
  - Fix indexer passing empty exclude array (was bypassing scanner default exclusions)

## 0.11.1

### Patch Changes

- b743ef0: Cached dependency graph for scale

  - Dependency graph built at index time and saved as JSON — `dev_map` and `dev_refs` no longer fetch all docs via `getAll`
  - Incremental graph updates via file watcher (O(changed files), not O(all files))
  - Graceful fallback to current approach if cache is missing or corrupted
  - Raises effective doc limit from 10k to 50k for graph operations

## 0.11.0

### Minor Changes

- 2955de2: Python language support

  - Index Python codebases: functions, classes, methods, imports, decorators, type hints, docstrings
  - `__all__` controls export detection, `_` prefix convention as fallback
  - Async function detection, callee extraction, code snippets
  - Pattern analysis: try/except, import style, type coverage via tree-sitter queries
  - Skip generated files (\_pb2.py, migrations)
  - `isTestFile()` refactored to language-aware pattern map (test\__.py, _\_test.py, conftest.py)
  - All MCP tools (dev_search, dev_refs, dev_map, dev_patterns, dev_status) work with Python automatically

## 0.10.6

### Patch Changes

- d40b7fe: Graph algorithms for dev_map and dev_refs

  - `dev_map` hot paths now use PageRank over the weighted dependency graph — files depended on by other important files rank higher
  - `dev_map` shows connected subsystems ("Subsystems: packages/core (45 files), packages/cli (12 files)")
  - `dev_refs` new `traceTo` parameter traces the dependency chain between files through the call graph
  - All algorithms are hand-rolled pure functions (~230 lines), no new dependencies
  - Inspired by aider's repo map (PageRank over dependency graphs)

## 0.10.5

### Patch Changes

- a780d40: AST-based pattern analysis via tree-sitter queries

  - `dev_patterns` now uses tree-sitter AST queries for more accurate detection of error handling (try/catch, promise.catch, error classes), import style (dynamic imports, precise require), and type coverage (arrow function return types)
  - Bundles tree-sitter grammars for TypeScript, TSX, JavaScript — covers the full JS/TS ecosystem
  - Regex fallback preserved for unsupported file types (.go, .md, etc.)
  - 12 verified S-expression queries with 51 tests (exact match counts, negative cases, edge cases)

## 0.10.4

### Patch Changes

- d9805ed: MCP tools improvement: faster pattern analysis, merged health into status, agent usability

  - `dev_patterns` is 10-30x faster — reads from Antfly index instead of re-scanning with ts-morph
  - `dev_health` merged into `dev_status` (use `section="health"`) — 6 tools reduced to 5
  - `dev_patterns` parameter renamed from `query` to `filePath` to prevent LLM misuse
  - New `format: "json"` option on `dev_patterns` for token-efficient agent workflows
  - All tools now return `suggestion` field on errors for agent recovery guidance
  - Removed stale GitHub code from health adapter
  - Extracted pure pattern analyzers for testability

## 0.10.3

### Patch Changes

- 3ad2316: Fix `dev setup` reporting model ready while `dev index` fails with "model not found". The CLI's `hasModel`/`pullModel` used `~/.termite/models` but the running server looked in `~/.antfly/models`. Both now use a shared `--models-dir` pointing at the server's data directory.

## 0.10.2

### Patch Changes

- 4639c52: Fix `dev mcp install` failing with "Repository not indexed" after successful indexing. Remove dead metrics module and better-sqlite3 dependency (-36 packages, -2400 lines).

## 0.10.1

### Patch Changes

- c4f6b4a: ### Docs Cleanup & Tool Refinements

  **CLI:**

  - Removed `dev explore` — merged `--similar-to` flag into `dev search`
  - Search threshold default changed from 0.7 to 0 (RRF scores are much lower than cosine similarity)

  **MCP Tools:**

  - Renamed `dev_inspect` → `dev_patterns` (focused on pattern analysis)
  - Removed `threshold` parameter from `dev_patterns`
  - Removed 3 prompts: `analyze-issue`, `search-github`, `create-plan`

  **Scanner:**

  - Extended default exclusions: `.env*`, `*.min.js`, `*.d.ts`, `generated/`, `.terraform/`, `.claude/`, `*.wasm`, `public/`, `static/`

## 0.10.0

### Minor Changes

- 622628f: ### CLI UX Overhaul

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

## 0.9.0

### Minor Changes

- b40cc41: Replace LanceDB + @xenova/transformers with Antfly for hybrid search

  - **Hybrid search**: `dev_search` now uses BM25 + vector + RRF fusion — exact keyword matches AND semantic understanding in one query
  - **New command**: `dev setup` handles search backend installation (Docker-first, native fallback)
  - **Auto-embedding**: Antfly generates embeddings locally via Termite — no separate embedding pipeline
  - **Direct key lookup**: Replaces O(n) zero-vector scan with instant key fetch
  - **Breaking**: Requires Antfly server running (`dev setup` handles this). Existing LanceDB indexes are not migrated — run `dev index . --force` to rebuild.

## 0.8.5

### Patch Changes

- d3d2126: feat(mcp): refactor dev_inspect and optimize pattern analysis

  **API Simplification:**

  - `dev_inspect` simplified to single-purpose tool (action parameter streamlined)
  - Previously: `dev_inspect({ action: "compare", query: "file.ts" })`
  - Now: `dev_inspect({ query: "file.ts" })`
  - Existing usage continues to work with dynamic MCP schema discovery

  **Major Features:**

  - Created `PatternAnalysisService` with 5 pattern extractors:
    - Import style (ESM, CJS, mixed, unknown)
    - Error handling (throw, result, callback, unknown)
    - Type coverage (full, partial, none)
    - Testing (co-located test files)
    - File size (lines vs similar files)
  - Batch scanning optimization (5-10x faster: 500-1000ms vs 2-3 seconds)
  - Embedding-based similarity search (no more false matches)
  - Extension filtering (`.ts` only compares with `.ts`)
  - Comprehensive pattern analysis (finds similar files + analyzes patterns)

  **Performance:**

  - One ts-morph initialization vs 6 separate scans
  - Batch scan all files in one pass
  - `searchByDocumentId()` for embedding-based similarity
  - Pattern analysis: 500-1000ms (down from 2-3 seconds)

  **Bug Fixes:**

  - Fixed `findSimilar` to use document embeddings instead of file paths
  - Fixed `--force` flag to properly clear old vector data
  - Fixed race condition in LanceDB table creation
  - Removed `outputSchema` from all 9 MCP adapters (Cursor/Claude compatibility)

  **New Features:**

  - Test utilities in `@prosdevlab/dev-agent-core/utils`:
    - `isTestFile()` — Check if file is a test file
    - `findTestFile()` — Find co-located test files
  - Vector store `clear()` method
  - Vector store `searchByDocumentId()` method
  - Comprehensive pattern comparison with statistical analysis

  **Migration Guide:**

  ```typescript
  // Before (v0.8.4)
  dev_inspect({ action: "compare", query: "src/auth.ts" });
  dev_inspect({ action: "validate", query: "src/auth.ts" });

  // After (v0.8.5) - Streamlined!
  dev_inspect({ query: "src/auth.ts" });
  ```

  The tool now automatically finds similar files AND performs pattern analysis. No migration needed - MCP tools discover the new schema dynamically.

  **Re-index Recommended:**

  ```bash
  dev index . --force
  ```

  This clears old data and rebuilds with improved embedding-based search.

  **Documentation:**

  - Complete rewrite of dev-inspect.mdx
  - Updated README.md with pattern categories
  - Updated CLAUDE.md with new descriptions
  - Added v0.8.5 changelog entry to website
  - Migration guide from dev_explore

  **Tests:**

  - All 1100+ tests passing
  - Added 10 new test-utils tests
  - Pattern analysis service fully tested
  - Integration tests for InspectAdapter

## 0.8.4

### Patch Changes

- 8b4972a: Remove git analytics commands to refocus on semantic value

  **BREAKING CHANGES:**

  - Remove `dev owners` command - use `git log` or GitHub contributors instead
  - Remove `dev activity` command - use `git log --since` for activity analysis

  **What's Changed:**

  - Removed 891 lines from `dev owners` command
  - Removed 175 lines from `dev activity` command
  - Cleaned up dead code in `change-frequency.ts` (calculateFileAuthorContributions)
  - Simplified metrics collection to focus on code structure introspection

  **What's Kept:**

  - `code_metadata` table for debugging/introspection of indexed code
  - `calculateChangeFrequency` for `dev_map` MCP tool (shows commit activity in codebase structure)

  **Why:**

  Dev-agent's unique value is semantic search (embeddings + AST), not git analytics which GitHub/git already provide. This change reduces complexity by ~1,200 lines and refocuses on MCP tools for AI context.

  **Migration:**

  For contributor/ownership analytics, use:

  - `git log --format="%ae" <path> | sort | uniq -c | sort -rn` for ownership
  - `git log --since="1 month" --name-only | sort | uniq -c | sort -rn` for activity
  - GitHub's Contributors page for visualization

## 0.8.3

### Patch Changes

- f20406e: # Visual Formatting & GitHub Stats Improvements

  ## Visual Enhancements ✨

  ### Tree Branches & File Icons

  All CLI outputs now use consistent tree-based formatting with file icons:

  **`dev map` hot paths:**

  ```
  ## Hot Paths (most referenced)
    ├─ 📘 **typescript.ts** • 307 refs
       /packages/core/src/scanner
    ├─ 📘 **index.ts** • 251 refs
       /packages/core/src/indexer
    └─ 📘 **go.ts** • 152 refs
       /packages/core/src/scanner
  ```

  **`dev activity` output:**

  ```
  ├─ 📘 packages/mcp-server/bin/dev-agent-mcp.ts
  │     34 commits • 1 👤 • Last: today
  │
  ├─ 📘 packages/core/src/indexer/index.ts
  │     32 commits • 1 👤 • Last: today
  ```

  ### Shared Icon Utility

  Extracted `getFileIcon()` to `@prosdevlab/dev-agent-core/utils` for reuse across packages.

  ## GitHub Stats Fix 🐛

  Fixed confusing issue/PR state display:

  **Before:**

  ```
  Issues: 68 total (14 open, 55 closed)
  Pull Requests: 97 total (14 open, 96 merged)  ❌ Wrong!
  ```

  **After:**

  ```
  Issues: 68 total (14 open, 54 closed)
  Pull Requests: 97 total (0 open, 96 merged)   ✅ Correct!
  ```

  - Added separate state tracking: `issuesByState`, `prsByState`
  - GitHub indexer now tracks issue and PR states independently
  - Stats display now shows accurate per-type counts

  ## Progress Display Improvements 📊

  ### Detailed Progress with Rates

  All indexing commands now show detailed progress:

  ```
  Scanning Repository: 1,234/4,567 files (27%, 45 files/sec)
  Embedding Vectors: 856/2,549 documents (34%, 122 docs/sec)
  ```

  Applied to:

  - `dev index` - scanning & embedding progress
  - `dev update` - changed files & embedding progress
  - `dev git index` - commit embedding progress
  - `dev github index` - document embedding progress

  ### Update Plan Display

  `dev update` now shows what will change before starting:

  ```
  Update plan:
    • Changed: 3 files
    • Added: 1 file
    • Deleted: 0 files
  ```

  ### Code Quality

  - Refactored progress logic into `ProgressRenderer.updateSectionWithRate()`
  - Reduced ~40 lines of duplicated code
  - Fixed NaN display (now shows "Discovering files..." initially)

  ## Bug Fixes 🐛

  - **`dev owners`**: Fixed "No ownership data" error when run from subdirectories
  - **Progress Display**: Fixed NaN showing during initial file discovery phase
  - **`dev update`**: Removed duplicate checkmark in success message

  ## Breaking Changes

  None - all changes are backward compatible. Old GitHub state files will fall back to aggregate counts gracefully.

## 0.8.2

### Patch Changes

- d23d1a9: Massive indexing performance and UX improvements

  **Performance Optimizations (184% faster):**

  - **63x faster metadata collection**: Eliminated 863 individual git calls by using single batched git command
  - **Removed storage size calculation**: Deferred to on-demand in `dev stats` (saves 1-3s)
  - **Simplified ownership tracking**: Author contributions now calculated on-demand in `dev owners` (1s), removed SQLite pre-indexing overhead
  - **Total speedup**: Indexing now completes in ~33s vs ~95s (61s improvement!)

  **Architecture Simplifications:**

  - Removed `file_authors` SQLite table (on-demand is fast enough)
  - Removed `appendFileAuthors()` and `getFileAuthors()` from MetricsStore
  - Removed `authorContributions` from IndexUpdatedEvent
  - Cleaner separation: metrics for analytics, ownership for developer insights

  **UX Improvements (no more silent gaps):**

  - **Section-based progress display**: Clean, informative output inspired by Homebrew/Cargo
  - **Applied to 4 commands**: `dev index`, `dev update`, `dev git index`, `dev github index`
  - **Live progress updates**: Shows current progress for each phase (scanning, embedding, git, GitHub)
  - **Clean indexing plan**: Removed INFO timestamps from plan display
  - **Helpful next steps**: Suggests relevant commands after indexing completes
  - **More frequent scanner progress**: Logs every 2 batches OR every 10 seconds (was every 50 files)
  - **Slow file detection**: Debug logs for files/batches taking >5s to process
  - **Cleaner completion summary**: Removed storage size from index output (shown in `dev stats` instead)
  - **Continuous feedback**: Maximum 1-second gaps between progress updates
  - **Context-aware `dev owners` command**: Adapts output based on git status and current directory
    - **Changed files mode**: Shows ownership of uncommitted changes with real-time git log analysis
    - **Root directory mode**: High-level overview of top areas (packages/cli/, packages/core/)
    - **Subdirectory mode**: Detailed expertise for specific area
    - **Smart ownership display**: Asymmetric icons that only flag exceptions (⚠️ for others' files, 🆕 for new files)
    - **Last touched timestamps**: Shows when files were last modified (catches stale code and active development)
    - **Recent activity detection**: Warns when others recently touched your files (prevents conflicts)
    - **Suggested reviewers**: Automatically identifies who to loop in for code reviews
    - **Visual hierarchy**: Tree branches (├─, └─) and emojis (📝, 📁, 👤) for better readability
    - **Activity-focused**: Sorted by last active, not file count (no more leaderboard vibes)
    - **Git root detection**: Works from any subdirectory within the repository
  - **Better developer grouping**: `dev owners` now groups by GitHub handle instead of email (merges multiple emails for same developer)
  - **Graceful degradation**: Verbose mode and non-TTY environments show traditional log output

  **Technical Details:**

  - Added `log-update` dependency for smooth single-line progress updates
  - New `ProgressRenderer` class for section-based progress display
  - Optimized `buildCodeMetadata()` to derive change frequency from author contributions instead of making separate git calls
  - Scanner now tracks time since last log and ensures updates every 10s
  - Storage size calculation moved from index-time to query-time (lazy evaluation)
  - TTY detection for graceful fallback in CI/CD environments

  **Before:**

  ```
  [14:27:37] typescript 3450/3730 (92%)
             ← 3 MINUTES OF SILENCE
  [14:30:09] typescript 3600/3730 (97%)
             ← EMBEDDING COMPLETES
             ← 63 SECONDS OF SILENCE
  [14:31:12] Starting git extraction
  ```

  **After:**

  ```
  ▸ Scanning Repository
    357/433 files (82%, 119 files/sec)
  ✓ Scanning Repository (3.2s)
    433 files → 2,525 components

  ▸ Embedding Vectors
    1,600/2,525 documents (63%, 108 docs/sec)
  ✓ Embedding Vectors (20.7s)
    2,525 documents

  ▸ Git History
    150/252 commits (60%)
  ✓ Git History (4.4s)
    252 commits

  ▸ GitHub Issues/PRs
    82/163 documents (50%)
  ✓ GitHub Issues/PRs (7.8s)
    163 documents

  ✓ Repository indexed successfully!

    Indexed: 433 files • 2,525 components • 252 commits • 163 GitHub docs
    Duration: 33.5s

  💡 Next steps:
     dev map       Explore codebase structure
     dev owners    See contributor stats
     dev activity  Find active files
  ```

## 0.8.1

### Patch Changes

- 5656263: ## Bug Fix & UX Improvements

  ### Fixed Native Bindings Error

  Added `better-sqlite3` as a direct dependency to fix "Could not locate the bindings file" error in globally installed package.

  ### Improved Error Messages

  Added consistent, user-friendly error messages across all commands when indexed data is missing. Commands now provide clear re-index instructions instead of cryptic errors.

  Affected commands: `dev activity`, `dev owners`, `dev map`, `dev stats`

## 0.8.0

### Minor Changes

- 0f8c4eb: ## 🎉 v0.8.0 - Major Feature Release

  This release includes 33 commits with significant new features, performance improvements, and architectural enhancements.

  ### 🚀 Major Features

  - **`dev map` command** - Visualize codebase structure with component counts, exports, and hot paths (224x performance improvement!)
  - **`dev activity` command** - Show most active files with commit counts, recency, and complexity
  - **`dev owners` command** - Developer specialization breakdown with file-level ownership
  - **Author contribution indexing** - Indexed during `dev index` for 35x faster ownership queries
  - **Service layer architecture** - 7 services with dependency injection for better testability
  - **MetricsStore with SQLite** - Persistent code analytics with `file_authors` table
  - **Code metadata system** - Factual metrics replacing risk scoring
  - **Change frequency analysis** - Git activity tracking and hotspot identification
  - **Stats comparison & export** - Historical metrics analysis

  ### 🎨 CLI/UX Improvements

  - **Compact table format** for metrics commands with factual summaries
  - **Top-level commands** - `dev activity` and `dev owners` (refactored from `dev metrics`)
  - Enhanced `dev stats` output with 10x performance boost
  - Enhanced `dev git stats` with clean, scannable format
  - Enhanced `dev compact`, `dev clean`, and MCP command outputs
  - Modernized CLI with compact, user-friendly formatting
  - Comprehensive help text with examples and use cases
  - Visual indicators (🔥 for hotspots, ✏️ for activity)
  - GitHub handle resolution for developer identification

  ### 🏗️ Architecture & Quality

  - Service-oriented architecture with dependency injection
  - Circular dependency resolution via shared types package
  - Complete Zod validation across all 9 MCP adapters and external boundaries
  - Kero logger integration throughout
  - SearchService refactor for better code reuse
  - Improved error handling and messaging

  ### ⚡ Performance Optimizations

  - **`dev map`**: 224x speedup (103s → 0.46s)
    - Added `getAll()` method for fast scans without semantic search
    - Added `skipEmbedder` option for read-only operations
    - Added `getBasicStats()` to avoid expensive git enrichment
  - **`dev owners`**: 35x speedup (17.5s → 0.5s)
    - Batched git operations during indexing (1 call vs N file calls)
    - Author contributions stored in `file_authors` table
    - Offline capability - no git access needed after indexing
  - **`dev stats`**: 10x speedup via direct JSON reads

  ### 🐛 Bug Fixes

  - Fixed component count overflow in map generation (2.4B → 3.7K)
  - Fixed detailed stats persistence in indexer
  - Fixed ENOBUFS issues

  ### 📚 Documentation

  - Updated website for v0.7.0 features
  - TypeScript standards with Zod validation examples
  - Workflow documentation with commit checkpoints
  - Enhanced CLI help text across all commands

  ### 🧪 Testing

  - All 1,918 tests passing
  - Added comprehensive test coverage for new features
  - Mock updates for new `getAll()` method

  This release represents a significant step forward in usability, performance, and code quality. Special thanks to all contributors!

## 0.7.0

### Minor Changes

- c13b24f: UX and performance improvements for TypeScript projects

  **UX Improvements:**

  - MCP install is now idempotent for Claude Code - shows positive message when server already exists instead of erroring
  - Enhanced documentation with clear customization examples for exclusion patterns

  **Performance Improvements:**

  - Add TypeScript-specific exclusion patterns to default config for 10-15% indexing performance improvement
  - Exclude mock files (_.mock.ts, _.mock.tsx, mocks/), type definition files (\*.d.ts), and test infrastructure (test-utils/, testing/)

  **Configurability:**

  - TypeScript exclusions are now fully configurable via .dev-agent/config.json
  - Users can customize patterns, include type definitions if desired, or add project-specific exclusions
  - Default config provides optimized performance while maintaining full user control

  **Semantic Value Preserved:**

  - Stories files are kept (contain valuable component documentation and usage patterns)
  - Only excludes truly low-value files while preserving semantic content for AI tools

## 0.6.1

### Patch Changes

- b675fc9: fix: improve reliability, performance, and documentation for Go support

  ## Major Features

  - **Performance Configuration**: Environment variables for fine-tuning concurrency (DEV*AGENT*\*\_CONCURRENCY)
  - **Enhanced Go Scanner**: Runtime WASM validation, improved error handling, better reliability
  - **TypeScript Improvements**: Streamlined error handling, better type checking, enhanced progress reporting
  - **System Resource Detection**: Intelligent performance defaults based on CPU and memory
  - **Architectural Utilities**: Reusable modules for WASM resolution, concurrency, and file validation

  ## New Environment Variables

  - `DEV_AGENT_TYPESCRIPT_CONCURRENCY`: Control TypeScript scanner parallelism
  - `DEV_AGENT_INDEXER_CONCURRENCY`: Configure embedding batch processing
  - `DEV_AGENT_GO_CONCURRENCY`: Tune Go scanner performance
  - `DEV_AGENT_CONCURRENCY`: General fallback for all scanners

  ## Documentation & User Experience

  - Document missing `dev update` command for incremental indexing
  - Add timing expectations (5-10 minutes for large codebases)
  - Create LANGUAGE_SUPPORT.md contributor guide
  - Enhanced troubleshooting and configuration sections
  - Remove Renovate automation for manual dependency control

  ## Technical Improvements

  - 57 new tests with comprehensive coverage
  - Dependency injection for testable file system operations
  - Centralized error handling patterns across scanners
  - Build script reliability fixes (prevent silent failures)

  This release significantly improves performance, reliability, and developer experience while maintaining backward compatibility.

## 0.6.0

### Minor Changes

- f578042: feat: Go language support

  Add comprehensive Go language support to dev-agent:

  **Go Scanner**

  - Tree-sitter WASM infrastructure (reusable for Python/Rust later)
  - Extract functions, methods, structs, interfaces, types, constants
  - Method receivers with pointer detection
  - Go 1.18+ generics support
  - Go doc comment extraction
  - Exported symbol detection (capital letter convention)
  - Generated file skipping (_.pb.go, _.gen.go, etc.)
  - 90%+ test coverage

  **Indexer Logging**

  - Add `--verbose` flag to `dev index`, `dev git index`, `dev github index`
  - Progress spinner shows actual counts: `Embedding 4480/49151 documents (9%)`
  - Structured logging with kero logger

  **Go-Specific Exclusions**

  - Protobuf: `*.pb.go`, `*.pb.gw.go`
  - Generated: `*.gen.go`, `*_gen.go`
  - Mocks: `mock_*.go`, `mocks/`
  - Test fixtures: `testdata/`

  Tested on large Go codebase (~4k files, 49k documents).

## 0.5.2

### Patch Changes

- d6e5e6f: Fix ENOBUFS error during GitHub issues/PRs indexing for large repositories

  **Problem:** When indexing repositories with many GitHub issues/PRs (especially with large issue bodies), the `dev index` command would fail with `ENOBUFS` (No buffer space available) error.

  **Solution:**

  - Increased execSync maxBuffer from default 1MB to 50MB for issue/PR fetching
  - Reduced default fetch limit from 1000 to 500 items to prevent buffer overflow
  - Added `--gh-limit` CLI flag to allow users to customize the limit
  - Improved error messages to guide users when buffer issues occur

  **Changes:**

  - `fetchIssues()` and `fetchPullRequests()` now use 50MB maxBuffer
  - Default limit changed from 1000 to 500 (per type: issues and PRs)
  - Added `--gh-limit <number>` flag to `dev index` command
  - Better error handling with helpful suggestions (use `--gh-limit 100` for very large repos)
  - Comprehensive test coverage (23 new tests for fetcher utilities)

  **Usage:**

  ```bash
  # Default (works for most repos)
  dev index

  # For large repos (200+ issues/PRs)
  dev index --gh-limit 200

  # For very active repos (500+ issues/PRs)
  dev index --gh-limit 100
  ```

  **Testing:** All 1100+ tests passing. Verified on lytics-ui repository (6989 files, 1000 issues/PRs indexed successfully).

## 0.5.1

### Patch Changes

- 579925c: Incremental indexing now works! `dev update` detects changed, new, and deleted files.

  **What's new:**

  - Only re-indexes files that actually changed (via content hash)
  - Detects new files added since last index
  - Cleans up documents for deleted files
  - Removes orphaned symbols when code is modified

  **Usage:**

  ```bash
  dev index .     # First run: full index
  dev update      # Fast incremental update
  dev index . --force  # Force full re-index
  ```

## 0.5.0

### Minor Changes

- d0481b4: feat(scanner): Extract arrow functions, function expressions, and exported constants

  ### New Features

  **Arrow Function Extraction**

  - Extract arrow functions assigned to `const`/`let` variables
  - Extract function expressions assigned to variables
  - Detect React hooks automatically (`use*` naming pattern)
  - Detect async arrow functions

  **Exported Constant Extraction**

  - Extract exported `const` with object literal initializers (config objects)
  - Extract exported `const` with array literal initializers (static lists)
  - Extract exported `const` with call expression initializers (factories like `createContext()`)

  ### API Changes

  **New DocumentType value:**

  - Added `'variable'` to `DocumentType` union

  **New metadata fields:**

  - `isArrowFunction?: boolean` - true for arrow functions (vs function expressions)
  - `isHook?: boolean` - true if name matches `/^use[A-Z]/` (React convention)
  - `isAsync?: boolean` - true for async functions
  - `isConstant?: boolean` - true for exported constants
  - `constantKind?: 'object' | 'array' | 'value'` - kind of constant initializer

  ### Examples

  Now extracts:

  ```typescript
  export const useAuth = () => { ... }           // Hook (isHook: true)
  export const fetchData = async (url) => { ... } // Async (isAsync: true)
  const validateEmail = (email: string) => ...   // Utility function
  export const API_CONFIG = { baseUrl: '...' }   // Object constant
  export const LANGUAGES = ['ts', 'js']          // Array constant
  export const AppContext = createContext({})    // Factory constant
  ```

  ### Migration

  No breaking changes. The new `'variable'` DocumentType is additive. Existing queries for `'function'`, `'class'`, etc. continue to work unchanged.

## 0.4.4

### Patch Changes

- ad4af12: ### Features

  - **Test file hints in search results**: `dev_search` now shows related test files (e.g., `utils.test.ts`) after search results. This surfaces test files without polluting semantic search rankings.

  ### Design

  - Uses structural matching (`.test.ts`, `.spec.ts` patterns) rather than semantic search
  - Keeps semantic search pure - test hints are in a separate "Related test files:" section
  - Patterns are configurable for future extensibility via function parameters

## 0.4.3

### Patch Changes

- 40192f5: Fix dev_history tool schema for Claude API compatibility

  - Removed `anyOf` from input schema (Claude API doesn't support it at top level)
  - Validation for "at least one of query or file required" is still enforced in execute()

## 0.4.2

### Patch Changes

- 4b55a04: Fix MCP server to include all 9 adapters and improve tool descriptions for better AI tool adoption

  **Bug Fix:**

  - CLI's `mcp start` command now registers all 9 adapters (was missing HealthAdapter, RefsAdapter, MapAdapter, HistoryAdapter)
  - Updated tool list in CLI output and install messages to show all 9 tools

  **Tool Description Improvements:**

  - `dev_search`: Added "USE THIS FIRST" trigger, comparison to grep for conceptual queries
  - `dev_map`: Clarified it shows component counts and exports, better than list_dir
  - `dev_explore`: Clarified workflow - use after dev_search for "similar" and "relationships" actions
  - `dev_refs`: Added guidance to use for specific symbols, use dev_search for conceptual queries
  - `dev_history`: Added "WHY" trigger, clarified semantic search over commits
  - `dev_plan`: Emphasized "ALL context in one call" value prop for GitHub issues
  - `dev_gh`: Clarified semantic search by meaning, not just keywords

  These description improvements help AI tools (Claude, Cursor) choose the right dev-agent tool for each task.

## 0.4.1

### Patch Changes

- 573ad3a: feat: unified indexing and CLI improvements

  **`dev index .`** now indexes everything in one command:

  - Code (always)
  - Git history (if in a git repo)
  - GitHub issues/PRs (if gh CLI installed)

  Shows an upfront "indexing plan" with prerequisites check.
  Use `--no-git` or `--no-github` to skip specific indexers.

  **New `dev git` commands:**

  - `dev git index` - index git history separately
  - `dev git search <query>` - semantic search over commits
  - `dev git stats` - show indexed commit count

  **Fix:** `dev --version` now correctly displays installed version (injected at build time).

## 0.4.0

### Minor Changes

- c42f5ba: feat: Intelligent Git History (v0.4.0)

  New capabilities for understanding codebase history:

  **`dev_history` tool** - Semantic search over git commits

  - Search commit messages by meaning (e.g., "authentication token fix")
  - Get file history with rename tracking
  - Token-budgeted output

  **`dev_map` enhancements** - Change frequency indicators

  - 🔥 Hot directories (5+ commits in 30 days)
  - ✏️ Active directories (1-4 commits in 30 days)
  - 📝 Recent activity (commits in 90 days)

  **`dev_plan` enhancements** - Git context in planning

  - Related commits shown alongside code snippets
  - Issue/PR references extracted from commits
  - Helps understand prior work on similar features

  **Core infrastructure:**

  - `GitIndexer` for semantic commit search
  - `LocalGitExtractor` for git operations
  - Extensible architecture for future git features

## 0.3.0

### Minor Changes

- afa8adb: feat: Context Quality release (v0.3.0)

  This release significantly enhances dev-agent's ability to provide rich, actionable context to AI assistants.

  ## New Tools

  ### `dev_refs` - Relationship Queries

  Query code relationships to understand what calls what:

  - Find all callers of a function
  - Find all callees (what a function calls)
  - Includes file paths, line numbers, and snippets

  ### `dev_map` - Codebase Overview

  Get a high-level view of repository structure:

  - Directory tree with component counts
  - **Hot Paths**: Most referenced files in the codebase
  - **Smart Depth**: Adaptive expansion based on information density
  - **Signatures**: Function/class signatures in export listings
  - Configurable depth and focus directory

  ## Enhanced Tools

  ### `dev_plan` - Context Assembler (Breaking Change)

  Completely refactored from heuristic task breakdown to context assembly:

  - Returns rich context package instead of task lists
  - Includes issue details with comments
  - Includes relevant code snippets from semantic search
  - Includes detected codebase patterns
  - Let LLMs do the reasoning with better data

  **Migration:** The old task breakdown output is removed. The new output provides strictly more information for LLMs to create their own plans.

  ### `dev_search` - Richer Results (from v0.2.0)

  - Code snippets included in results
  - Import statements for context
  - Caller/callee hints
  - Progressive disclosure based on token budget

  ## Philosophy

  This release embraces the principle: **Provide structured data, let LLMs reason.**

  Instead of trying to be smart with heuristics, dev-agent now focuses on assembling comprehensive context that AI assistants can use effectively.

## 0.2.0

### Minor Changes

- bc44ec7: chore: bump main package to match core and mcp versions

  Syncs the main `@prosdevlab/dev-agent` package version with the underlying `@prosdevlab/dev-agent-core` and `@prosdevlab/dev-agent-mcp` packages which were bumped to 0.2.0 for the "Richer Search Results" feature.
