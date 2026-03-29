# Dev-Agent Roadmap

> **Mission:** Be the best context provider for AI coding tools. Don't compete with LLMs—empower them.

Dev-agent provides semantic code search, codebase intelligence, and GitHub integration through MCP (Model Context Protocol). The LLM does the reasoning; we provide the context.

---

## Philosophy

**What we are:**
- Best-in-class code indexing (fast, accurate, multi-language)
- Relationship intelligence (call graphs, dependencies, imports)
- Structured data provider (let LLMs synthesize)
- Token-efficient context (progressive disclosure)
- Local-first (no API keys, no cloud dependency)

**What we are NOT:**
- An AI coding assistant (that's Claude/Cursor's job)
- A natural language summarizer (LLMs do this better)
- A task planner (provide context, let LLMs plan)

---

## Completed ✅

### Phase 1: Core Intelligence Layer

| Feature | Status | Package |
|---------|--------|---------|
| TypeScript scanner (ts-morph) | ✅ Done | `@prosdevlab/dev-agent-core` |
| Repository indexer | ✅ Done | `@prosdevlab/dev-agent-core` |
| Vector storage (LanceDB) | ✅ Done | `@prosdevlab/dev-agent-core` |
| Embeddings (@xenova/transformers) | ✅ Done | `@prosdevlab/dev-agent-core` |
| Semantic search | ✅ Done | `@prosdevlab/dev-agent-core` |
| CLI interface | ✅ Done | `@prosdevlab/dev-agent-cli` |
| Centralized logging | ✅ Done | `@prosdevlab/kero` |

### Phase 2: MCP Integration

| Feature | Status | Package |
|---------|--------|---------|
| MCP server architecture | ✅ Done | `@prosdevlab/dev-agent-mcp` |
| Adapter framework | ✅ Done | `@prosdevlab/dev-agent-mcp` |
| `dev_search` - Semantic code search | ✅ Done | MCP adapter |
| `dev_status` - Repository status | ✅ Done | MCP adapter |
| `dev_inspect` - File analysis | ✅ Done | MCP adapter |
| `dev_plan` - Issue planning | ✅ Done | MCP adapter |
| `dev_gh` - GitHub search | ✅ Done | MCP adapter |
| `dev_health` - Health checks | ✅ Done | MCP adapter |
| Cursor integration | ✅ Done | CLI command |
| Claude Code integration | ✅ Done | CLI command |
| Rate limiting (token bucket) | ✅ Done | MCP server |
| Retry logic (exponential backoff) | ✅ Done | MCP server |

### Phase 3: Subagent Infrastructure

| Feature | Status | Package |
|---------|--------|---------|
| Coordinator architecture | ✅ Done | `@prosdevlab/dev-agent-subagents` |
| Context manager | ✅ Done | `@prosdevlab/dev-agent-subagents` |
| Task queue | ✅ Done | `@prosdevlab/dev-agent-subagents` |
| Explorer agent | ✅ Done | `@prosdevlab/dev-agent-subagents` |
| Planner agent | ✅ Done | `@prosdevlab/dev-agent-subagents` |
| GitHub indexer | ✅ Done | `@prosdevlab/dev-agent-subagents` |

### Infrastructure

| Feature | Status |
|---------|--------|
| Monorepo (Turborepo + pnpm) | ✅ Done |
| Test suite (1100+ tests, Vitest) | ✅ Done |
| CI/CD (GitHub Actions) | ✅ Done |
| Linting/formatting (Biome) | ✅ Done |
| Documentation site (Nextra) | ✅ Done |

---

## Completed: Context Quality (v0.3.0) ✅

Released in v0.3.0 - dev-agent now provides *actually useful* context for LLM reasoning.

### Principle: Structured Data Over Summaries

Don't generate prose—provide structured data and let the LLM synthesize.

### Richer Search Results ✅

| Feature | Status |
|---------|--------|
| Code snippets in search results | ✅ Done |
| Import/export context | ✅ Done |
| Callers/callees hints | ✅ Done |
| Token budget management | ✅ Done |
| Progressive disclosure | ✅ Done |

### Relationship Queries (`dev_refs`) ✅

| Feature | Status |
|---------|--------|
| Callee extraction during indexing | ✅ Done |
| `dev_refs` MCP adapter | ✅ Done |
| Bidirectional queries (callers/callees) | ✅ Done |
| Token budget support | ✅ Done |

### Codebase Map (`dev_map`) ✅

| Feature | Status |
|---------|--------|
| Directory tree with component counts | ✅ Done |
| `dev_map` MCP adapter | ✅ Done |
| Configurable depth (1-5) | ✅ Done |
| Focus on specific directories | ✅ Done |
| Export signatures | ✅ Done |
| Hot paths (most referenced files) | ✅ Done |
| Smart depth (adaptive expansion) | ✅ Done |

### Refactored Planner → Context Assembler ✅

| Feature | Status |
|---------|--------|
| Removed heuristic task breakdown | ✅ Done |
| Returns `ContextPackage` with raw issue + code | ✅ Done |
| Includes codebase patterns | ✅ Done |
| Related PR/issue history | ✅ Done |

---

## Completed: Polish & Stabilize (v0.3.x) ✅

Focus on quality, documentation, and developer experience.

### Documentation ✅

| Task | Status |
|------|--------|
| CLI reference docs | ✅ Done |
| Configuration guide | ✅ Done |
| Troubleshooting guide | ✅ Done |
| Examples for new tools | ✅ Done |

### Code Quality ✅

| Task | Status |
|------|--------|
| Fix lint warnings | ✅ Done |
| Context assembler tests | ✅ Done |
| Integration tests | ✅ Done |

---

## Completed: Intelligent Git History (v0.4.0) ✅

> "Who changed what and why" - completing the context picture.

**Epic:** #90

### Philosophy

Git history is valuable context that LLMs can't easily access. We add intelligence:
- **Semantic search** over commit messages (can't do with `git log --grep`)
- **Change frequency** insights (which code is "hot"?)
- **Auto-inclusion** in planning context

### Tasks

| Task | Issue | Status |
|------|-------|--------|
| Git types and extractor infrastructure | #91 | ✅ Done |
| Commit indexing in core | #92 | ✅ Done |
| `dev_history` MCP adapter | #93 | ✅ Done |
| Change frequency in `dev_map` | #94 | ✅ Done |
| History integration in `dev_plan` | #95 | ✅ Done |

### Architecture

- `GitExtractor` interface (pluggable for future GitHub API)
- `GitCommit` type with PR/issue refs (for future linking)
- Blame methods stubbed (for future `dev_blame`)
- Cross-repo `repository` field in types

---

## Current: Quality & Thoroughness (v0.4.x)

> Addressing gaps identified in benchmark study comparing dev-agent vs baseline Claude Code.

**Context:** Benchmarks showed dev-agent provides 44% cost savings and 19% faster responses, but with quality trade-offs. These improvements close the gap.

### Benchmark-Driven Improvements

| Task | Gap Identified | Priority | Status |
|------|----------------|----------|--------|
| Diagnostic command suggestions | Baseline provided shell commands for debugging; dev-agent didn't | 🔴 High | 🔲 Todo |
| Test file inclusion hints | Baseline read test files; dev-agent skipped them | 🔴 High | ✅ Done |
| Code example extraction | Baseline included more code snippets in responses | 🟡 Medium | 🔲 Todo |
| Exhaustive mode for debugging | Option for thorough exploration vs fast satisficing | 🟡 Medium | 🔲 Todo |
| Related files suggestions | "You might also want to check: X, Y, Z" | 🟡 Medium | 🔲 Todo |

### Test File Hints - Design (v0.4.4)

**Problem:** Benchmark showed baseline Claude read test files, but dev-agent didn't surface them.

**Root cause:** Test files have *structural* relationship (same name), not *semantic* relationship:
- Searching "authentication middleware" finds `auth/middleware.ts` (semantic match ✓)
- `auth/middleware.test.ts` might NOT appear because test semantics differ
- "describe('AuthMiddleware', () => {...})" doesn't semantically match the query

**Design decision:** Keep semantic search pure. Add "Related files:" section using filesystem lookup.

| Approach | Decision | Rationale |
|----------|----------|-----------|
| Filename matching | ✅ Chosen | Fast, reliable, honest about what it is |
| Boost test queries | ❌ Rejected | Might return unrelated tests |
| Index-time metadata | ❌ Rejected | Requires re-index, complex |

**Phased rollout:**

| Phase | Tool | Status |
|-------|------|--------|
| 1 (v0.4.4) | `dev_search` | ✅ Done |
| 2 | `dev_refs`, `dev_inspect` | ✅ Done |
| 3 | `dev_map`, `dev_status` | ✅ Done |

**Implementation (Phase 1):**
- After search results, check filesystem for test siblings
- Patterns: `*.test.ts`, `*.spec.ts`, `__tests__/*.ts`
- Add "Related files:" section to output
- No change to semantic search scoring

### Tool Description Refinements (Done in v0.4.2)

| Task | Status |
|------|--------|
| Improved dev_search description ("USE THIS FIRST") | ✅ Done |
| Improved dev_map description (vs list_dir) | ✅ Done |
| Improved dev_inspect description (file analysis) | ✅ Done |
| Improved dev_refs description (specific symbols) | ✅ Done |
| All 9 adapters registered in CLI | ✅ Done |

---

## Current: Performance & Reliability (v0.6.x - v0.7.x)

> Critical high-impact improvements for production readiness and user experience.

**Epic:** #104 (Progress: 6/9 complete)

### Completed Improvements ✅

| Feature | Status | Version | Impact |
|---------|--------|---------|--------|
| Index size reporting | ✅ Done | v0.4.3 | Track disk usage growth |
| Adaptive concurrency | ✅ Done | v0.6.0 | Auto-detect optimal batch size by CPU/memory |
| Incremental indexing | ✅ Done | v0.5.1 | <30s updates for single file changes (#122) |
| Progress indicators | ✅ Done | v0.1.0 | Real-time feedback for long operations |
| Error handling | ✅ Done | v0.3.0 | Graceful degradation |
| Basic validation | ✅ Done | v0.2.0 | Git repo and path checks |

### Remaining Work 🔄

| Issue | Priority | Impact | Status |
|-------|----------|--------|--------|
| #152 - MCP lazy initialization | P0 | Reduce startup from 2-5s to <500ms | 🔲 Todo |
| #153 - GitHub history in planner | P0 | Add commit context to AI plans | 🔲 Todo |
| #154 - Memory monitoring | P1 | Prevent leaks, maintain <500MB usage | 🔲 Todo |

**Success Metrics:**
- ✅ Large repo indexing: <5min for 50k files
- ✅ Incremental updates: <30s for single file changes
- 🔲 MCP server startup: <500ms (currently 2-5s)
- 🔲 Memory usage: <500MB steady state
- 🔲 Planner quality: Include git history context

---

## Next: Extended Git Intelligence (v0.5.0)

> Building on git history with deeper insights.

### Git Tasks

| Task | Priority | Status |
|------|----------|--------|
| `dev_blame` - line attribution | 🟡 Medium | 🔲 Todo |
| PR/issue linking from commits | 🟡 Medium | 🔲 Todo |
| Contributor expertise mapping | 🟢 Low | 🔲 Todo |
| Cross-repo history | 🟢 Low | 🔲 Todo |

### Tool Improvements

| Task | Rationale | Priority | Status |
|------|-----------|----------|--------|
| Generalize `dev_plan` → `dev_context` | Currently requires GitHub issue; should work with any task description | 🔴 High | 🔲 Todo |
| Freeform context assembly | `dev_context "Add rate limiting"` without needing issue # | 🔴 High | 🔲 Todo |
| Multiple input modes | `--issue 42`, `--file src/auth.ts`, or freeform query | 🟡 Medium | 🔲 Todo |

**Why:** `dev_plan` is really a context assembler but is tightly coupled to GitHub issues. Generalizing it:
- Works without GitHub
- Easier to benchmark (no real issues needed)
- Name matches function (assembles context, doesn't "plan")
- More useful for ad-hoc implementation tasks

### Benchmark Improvements

| Task | Rationale | Priority | Status |
|------|-----------|----------|--------|
| Add implementation task types | Current benchmark only tests exploration; missing `dev_plan`/`dev_gh` coverage | 🟡 Medium | 🔲 Todo |
| Generic implementation patterns | "Add a new adapter similar to X" — tests pattern discovery | 🟡 Medium | 🔲 Todo |
| Snapshotted issue tests | Capture real issues for reproducible `dev_plan` testing | 🟢 Low | 🔲 Todo |

---

## Next: Dashboard & Visualization (v0.7.1)

> Making codebase insights visible and accessible.

**Epic:** #145

### Philosophy

Dev-agent provides rich context about codebases, but it's currently text-only. A dashboard makes insights:
- **Visible** - See language breakdown, component types, health status at a glance
- **Interactive** - Explore relationships, drill into packages
- **Actionable** - Identify areas needing attention

### Goals

1. **Enhanced CLI** (`dev dashboard`) - Terminal-based stats with rich formatting
2. **Web Dashboard** - Next.js app with real-time insights
3. **Data Infrastructure** - Aggregate stats during indexing for efficient display

### Components

| Component | Status | Priority |
|-----------|--------|----------|
| **CLI Enhancements** | | |
| Language breakdown display | 🔲 Todo | 🔴 High |
| Component type statistics | 🔲 Todo | 🔴 High |
| Package-level stats (monorepo) | 🔲 Todo | 🔴 High |
| Rich formatting (tables, colors) | 🔲 Todo | 🔴 High |
| **Core Data Collection** | | |
| Track language metrics in indexer | 🔲 Todo | 🔴 High |
| Aggregate component type counts | 🔲 Todo | 🔴 High |
| Package-level aggregation | 🔲 Todo | 🟡 Medium |
| Change frequency tracking | 🔲 Todo | 🟡 Medium |
| **Web Dashboard** | | |
| Next.js app setup (`apps/dashboard/`) | 🔲 Todo | 🔴 High |
| Tremor component library | 🔲 Todo | 🔴 High |
| API routes (stats, health) | 🔲 Todo | 🔴 High |
| Real-time stats display | 🔲 Todo | 🔴 High |
| Language distribution charts | 🔲 Todo | 🟡 Medium |
| Component type visualizations | 🔲 Todo | 🟡 Medium |
| Health status indicators | 🔲 Todo | 🟡 Medium |
| Vector index metrics (simple) | 🔲 Todo | 🟡 Medium |
| Basic package list (monorepo) | 🔲 Todo | 🟡 Medium |

### Architecture

```
apps/
└── dashboard/          # Next.js 16 + React 19 + Tremor
    ├── app/
    │   ├── page.tsx    # Main dashboard
    │   └── api/
    │       └── stats/  # Next.js API routes
    └── components/
        └── tremor/     # Tremor dashboard components

packages/core/
└── src/
    └── indexer/
        └── stats-aggregator.ts  # New: Collect detailed stats
```

### Implementation Plan

**Implementation Phases:**

**Phase 1: Data Foundation**
- Enhance IndexStats with language/component breakdowns
- Aggregate stats during indexing (minimal overhead)
- Foundation for all visualizations

**Phase 2: CLI Enhancements**
- Rich terminal output with tables and colors
- Package-level breakdown for monorepos
- Immediate user value

**Phase 3: Web Dashboard**
- Next.js 16 app in `apps/dashboard/`
- Tremor component setup
- Basic stats display with charts

**Phase 4: Advanced Features**
- Interactive exploration
- Package explorer (monorepo support)
- Real-time updates

---

## Next: Advanced LanceDB Visualizations (v0.7.2)

> Making vector embeddings visible and explorable.

### Philosophy

LanceDB stores 384-dimensional embeddings for semantic search, but these are invisible to users. Advanced visualizations reveal:
- **Where code lives** in semantic space (2D projections)
- **What's related** beyond imports (similarity networks)
- **How embeddings evolve** over time (drift tracking)
- **Search quality** insights (what works, what doesn't)

### Goals

1. **Semantic Code Map** - 2D/3D projection of vector space
2. **Similarity Explorer** - Interactive component relationship graph
3. **Search Quality Dashboard** - Analyze search performance
4. **Embedding Health** - Coverage and quality metrics per directory

### Components

| Component | Description | Priority |
|-----------|-------------|----------|
| **Semantic Code Map** | | |
| t-SNE/UMAP projection to 2D | Visualize embedding space | 🔴 High |
| Interactive scatter plot | Click to see code snippet | 🔴 High |
| Color by language/type | Visual code categorization | 🟡 Medium |
| Cluster detection | Auto-identify code groups | 🟡 Medium |
| **Similarity Network** | | |
| Component relationship graph | Force-directed layout | 🔴 High |
| Semantic similarity edges | Show hidden relationships | 🔴 High |
| Interactive exploration | Zoom, pan, filter | 🟡 Medium |
| Duplication detection | High similarity alerts | 🟡 Medium |
| **Search Quality** | | |
| Search metrics dashboard | Track performance over time | 🔴 High |
| Query similarity heatmap | Understand search patterns | 🟡 Medium |
| "Dead zone" detection | Queries with poor results | 🟡 Medium |
| Recommendation engine | Suggest better queries | 🟢 Low |
| **Embedding Health** | | |
| Coverage heatmap by directory | Identify blind spots | 🔴 High |
| Quality scoring per file | Flag low-quality embeddings | 🟡 Medium |
| Drift tracking over time | Monitor embedding changes | 🟡 Medium |
| Re-index recommendations | Suggest what needs updating | 🟢 Low |

### Architecture

```
Dashboard UI
    ↓
Advanced Viz Components (D3.js, Plotly, or similar)
    ↓
New API Routes
    ├─ GET /api/embeddings/projection (t-SNE/UMAP data)
    ├─ GET /api/embeddings/similarity (network graph)
    ├─ GET /api/embeddings/quality (coverage metrics)
    └─ GET /api/embeddings/search-history (query analysis)
    ↓
LanceDB + Vector Analysis
    └─ Dimensionality reduction, similarity queries, metrics
```

### Dependencies

**New:**
- `umap-js` or `tsne-js` - Dimensionality reduction
- `d3` or `@visx/visx` - Advanced visualizations
- `react-force-graph` - Network graphs (or `sigma.js`)
- `@tensorflow/tfjs` (optional) - Advanced vector operations

### Implementation Phases

**Phase 1: Semantic Code Map**
- Implement t-SNE/UMAP projection
- Create 2D scatter plot visualization
- Add basic interactivity (hover, click)

**Phase 2: Similarity Network**
- Build component similarity graph
- Implement force-directed layout
- Add filtering and exploration

**Phase 3: Search Quality**
- Track search queries and results
- Build metrics dashboard
- Implement quality scoring

**Phase 4: Embedding Health**
- Coverage analysis by directory
- Quality scoring per file
- Drift detection system

### Success Metrics

- Developers can visually explore codebase semantics
- Identify code duplication without running analysis tools
- Understand which areas need re-indexing
- Improve search query formulation based on insights

---

## Future: Extended Intelligence (v0.8+)

### Multi-Language Support

| Language | Status | Priority |
|----------|--------|----------|
| TypeScript/JavaScript | ✅ Done | - |
| Markdown | ✅ Done | - |
| Python | 🔲 Planned | 🟡 Medium |
| Go | 🔲 Planned | 🟢 Low |
| Rust | 🔲 Planned | 🟢 Low |

### Test Coverage Intelligence

| Feature | Priority |
|---------|----------|
| Map tests to source files | 🟢 Low |
| "What tests cover this code?" | 🟢 Low |
| Test file suggestions | 🟢 Low |

### IDE Integrations

| Integration | Status | Priority |
|-------------|--------|----------|
| Cursor (via MCP) | ✅ Done | - |
| Claude Code (via MCP) | ✅ Done | - |
| VS Code extension | 🔲 Planned | 🟢 Low |

---

## Shelved / Reconsidered

These were in the original plan but have been deprioritized or reconsidered:

| Feature | Reason |
|---------|--------|
| LLM integration | Dev-agent provides context, not reasoning. LLM is external. |
| Effort estimation | Heuristics are unreliable. Let LLMs estimate with context. |
| PR description generation | LLM's job, not ours. Provide context instead. |
| Task breakdown logic | Generic tasks aren't useful. Return raw data. |
| Express API server | MCP is the interface. No need for REST API. |

---

## Technology Stack

### Current
- **Language:** TypeScript (strict mode)
- **Runtime:** Node.js >= 22 (LTS)
- **Package Manager:** pnpm 8.15.4
- **Build:** Turborepo
- **Linting:** Biome
- **Testing:** Vitest (1379+ tests)
- **Vector Storage:** LanceDB (embedded, no server)
- **Embeddings:** @xenova/transformers (all-MiniLM-L6-v2)
- **AI Integration:** MCP (Model Context Protocol)
- **Code Analysis:** ts-morph (TypeScript Compiler API)

### Considered but Not Adopted
- ChromaDB → LanceDB (embedded is simpler)
- TensorFlow.js → @xenova/transformers (better models)
- Express → MCP (protocol is the interface)

---

## Package Structure

```
packages/
├── core/           # Scanner, indexer, vector storage, utilities
├── cli/            # Command-line interface
├── mcp-server/     # MCP server + adapters
├── subagents/      # Coordinator, explorer, planner, GitHub
├── integrations/   # Claude Code, VS Code (future)
├── logger/         # @prosdevlab/kero logging
└── dev-agent/      # Unified CLI entry point
```

---

## Success Metrics

How we know dev-agent is working:

1. **Search quality:** Relevant results in top 3
2. **Token efficiency:** Context fits in reasonable budget (<5k tokens)
3. **Response time:** Search <100ms, index <5min for 10k files
4. **Daily use:** We actually use it ourselves (dogfooding)
5. **LLM effectiveness:** Claude/Cursor make better suggestions with dev-agent

### Benchmark Results (v0.4.3)

#### By Task Type

| Task Type | Cost Savings | Time Savings | Why |
|-----------|--------------|--------------|-----|
| **Debugging** | **42%** | 37% | Semantic search beats grep chains |
| **Exploration** | **44%** | 19% | Find code by meaning |
| **Implementation** | **29%** | 22% | Context bundling via `dev_plan` |
| **Simple lookup** | ~0% | ~0% | Both approaches are fast |

**Key insight:** Savings scale with task complexity.

#### Why It Saves Money

| What dev-agent does | Manual equivalent | Impact |
|---------------------|-------------------|--------|
| Returns code snippets in search | Read entire files | 99% fewer input tokens |
| `dev_plan` bundles issue + code + commits | 5-10 separate tool calls | 29% cost reduction |
| Semantic search finds relevant code | grep chains + filtering | 42% cost reduction |

#### Token Analysis (Debugging Task)

| Metric | Without dev-agent | With dev-agent | Difference |
|--------|-------------------|----------------|------------|
| Input tokens | 18,800 | 65 | **99.7% less** |
| Output tokens | 12,200 | 6,200 | **49% less** |
| Files read | 10 | 5 | **50% less** |

**Trade-offs identified:**
- Baseline provides more diagnostic shell commands
- Baseline reads more files (sometimes helpful for thoroughness)

**Target users:** Engineers working on complex exploration, debugging, or implementation tasks in large/unfamiliar codebases.

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup and guidelines.

**Quick start:**
```bash
pnpm install
pnpm build
pnpm test
```

---

*Last updated: November 29, 2025 at 02:30 PST*
