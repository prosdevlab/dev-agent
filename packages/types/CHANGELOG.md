# @prosdevlab/dev-agent-types

## 0.2.1

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

## 0.2.0

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
