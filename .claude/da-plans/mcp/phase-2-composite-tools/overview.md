# MCP Phase 2: Composite Tools — dev_review and dev_research

**Status:** Draft

## Context

MCP Phase 1 delivered 5 low-level tools: `dev_search`, `dev_refs`, `dev_map`,
`dev_patterns`, `dev_status`. Each returns focused context for a specific query.

AI assistants using these tools must orchestrate them manually — call `dev_search`
to find relevant code, `dev_refs` to trace call chains, `dev_patterns` to compare
conventions, `dev_map` for structural context. A typical review requires 5-10 tool
calls, burning 3,000-5,000 tokens on orchestration alone.

### The opportunity

Composite tools run multiple low-level tools internally and return **workflow-ready
context** in a single call. The AI assistant gets pre-digested analysis instead of
raw data. One call replaces 5-10.

### The swarm pattern

Inspired by multi-agent swarm architectures where a coordinator delegates to
specialists and synthesizes results. Our composite tools use the same pattern
internally:

```
┌──────────────────────────────────────────────────┐
│  dev_review (composite MCP tool)                 │
│                                                  │
│  Coordinator: receives file/diff + focus area    │
│       │                                          │
│       ├── Specialist: impact analysis            │
│       │   └── dev_refs (callers/callees)         │
│       │   └── dependency graph (affected files)  │
│       │                                          │
│       ├── Specialist: pattern comparison         │
│       │   └── dev_patterns (conventions)         │
│       │   └── dev_search (similar code)          │
│       │                                          │
│       ├── Specialist: structural context         │
│       │   └── dev_map (hot paths, subsystems)    │
│       │                                          │
│       └── Synthesizer: combine into report       │
│                                                  │
│  Returns: structured analysis, not raw data      │
└──────────────────────────────────────────────────┘
```

The specialists run in parallel internally. The coordinator and synthesizer are
pure functions — no LLM calls, just structured data composition. The intelligence
is in choosing WHAT to query and HOW to combine results.

### Updated mission

> **Dev-Agent is a repository-aware context engine for AI tools.** It indexes your
> codebase locally, builds a semantic understanding (search, call graphs, patterns,
> structure), and delivers that context to AI assistants efficiently — from low-level
> queries to workflow-ready analysis.

---

## What this phase delivers

### `dev_review` — Change analysis in one call

```typescript
dev_review {
  target: "packages/core/src/scanner/rust.ts",  // file, dir, or git diff
  focus?: "security" | "quality" | "performance" | "all",
  depth?: "quick" | "standard" | "deep"
}
```

Returns:

```markdown
## Review Context: packages/core/src/scanner/rust.ts

### Impact Analysis
- Called by: 3 files across 2 packages
- Calls: 12 functions in 4 files
- Hot path rank: #8 (PageRank 0.023)
- Subsystem: packages/core/src/scanner (14 files)

### Pattern Comparison
- Error handling: uses try/catch (consistent with 85% of codebase)
- Naming: follows camelCase convention
- Similar implementations: python.ts (87% pattern overlap), go.ts (72%)

### Similar Code
- normalizeAndRelativize() at typescript.ts:27 — similar path normalization
- walkCallNodes() at python.ts:468 — same AST walking pattern

### Structural Context
- This file is in the scanner subsystem (14 files, 3rd largest)
- scanner/ accounts for 223 of 2,220 indexed components
- Recent churn: 4 commits in last 30 days
```

The AI assistant reads this once and has everything it needs to review the code.
No follow-up tool calls needed. It can then add its own analysis (security concerns,
logic issues, style) ON TOP of this context.

### `dev_research` — Codebase research in one call

```typescript
dev_research {
  query: "how is authentication handled",
  scope?: "architecture" | "implementation" | "usage",
  depth?: "quick" | "standard" | "deep"
}
```

Returns:

```markdown
## Research: how is authentication handled

### Relevant Code (ranked by relevance)
1. packages/mcp-server/src/server/auth.ts — token validation middleware
2. packages/core/src/services/github-service.ts — GitHub OAuth flow
3. packages/cli/src/utils/config.ts — credential storage

### Call Graph
auth.ts → validateToken() → github-service.ts → getUser()
         → rateLimit() → rate-limiter.ts

### Patterns Found
- Token validation: 3 files use the same pattern
- Error handling: auth errors return 401 with structured message
- No password storage — all OAuth-based

### Architecture
- Auth is centralized in mcp-server, consumed by 5 adapters
- GitHub service handles all external auth
- Tokens stored via gh CLI, not in dev-agent

### Related
- Similar pattern: packages/core/src/services/search-service.ts (service pattern)
- Test coverage: 2 test files, 8 test cases
```

For the AI assistant, this replaces the typical "let me search for auth... now let
me read that file... now let me trace the callers..." cycle. One call, full picture.

---

## Architecture

### Composite adapter pattern

```
┌──────────────────────────────────────────────────────────┐
│  packages/mcp-server/src/adapters/built-in/              │
│                                                          │
│  Existing (low-level):                                   │
│    search-adapter.ts                                     │
│    refs-adapter.ts                                       │
│    map-adapter.ts                                        │
│    inspect-adapter.ts (dev_patterns)                     │
│    status-adapter.ts                                     │
│                                                          │
│  New (composite):                                        │
│    review-adapter.ts  ──► uses search, refs, map,        │
│                           inspect internally             │
│    research-adapter.ts ──► uses search, refs, map,       │
│                            inspect internally            │
│                                                          │
│  Composite adapters receive other adapters at             │
│  construction time (dependency injection).                │
│  They orchestrate, not duplicate.                        │
└──────────────────────────────────────────────────────────┘
```

### Internal orchestration (not LLM-based)

The composite tools do NOT call an LLM to synthesize. They use structured
data composition:

```typescript
class ReviewAdapter extends ToolAdapter {
  constructor(config: {
    searchAdapter: SearchAdapter;
    refsAdapter: RefsAdapter;
    mapAdapter: MapAdapter;
    inspectAdapter: InspectAdapter;
    indexer: RepositoryIndexer;
  }) { ... }

  async execute(args: ReviewArgs, context: ToolExecutionContext): Promise<ToolResult> {
    // Run specialists in parallel
    const [impact, patterns, structure] = await Promise.all([
      this.analyzeImpact(args.target),      // refs + graph
      this.comparePatterns(args.target),     // patterns + search
      this.getStructuralContext(args.target), // map
    ]);

    // Synthesize into structured markdown (no LLM call)
    return this.formatReport(impact, patterns, structure, args.focus);
  }
}
```

This is key: **the composite tool is deterministic.** Same input, same output.
No LLM variance. The AI assistant provides the judgment; we provide the facts.

### Depth levels

| Depth | What it does | Token cost | Latency |
|-------|-------------|-----------|---------|
| `quick` | search + refs only | ~500 | <2s |
| `standard` | search + refs + patterns + map | ~1,500 | <5s |
| `deep` | all tools + change frequency + similar files | ~3,000 | <10s |

The default is `standard`. The AI assistant can request `quick` for small changes
or `deep` for major refactors.

### CLI exposure

```bash
# Standalone CLI (works without AI assistant)
dev review packages/core/src/scanner/rust.ts
dev review --focus security --depth deep
dev review --diff HEAD~1        # review last commit
dev review --pr 31              # review a PR (via gh API)

dev research "authentication flow"
dev research "error handling patterns" --depth deep
```

CLI output is the same structured markdown. User reads it directly or pipes
it into an AI assistant.

---

## Parts

| Part | Description | Risk |
|------|-------------|------|
| [2.1](./2.1-review-adapter.md) | `dev_review` MCP adapter — impact, patterns, structure | Medium — composing existing tools |
| [2.2](./2.2-research-adapter.md) | `dev_research` MCP adapter — relevant code, call graph, patterns | Medium — query interpretation |
| [2.3](./2.3-cli-commands.md) | `dev review` and `dev research` CLI commands | Low — wiring to adapters |
| [2.4](./2.4-docs-and-agents.md) | Update CLAUDE.md, agents, doc site, changelog | Low — docs only |

---

## Decisions

| Decision | Rationale | Alternatives |
|----------|-----------|-------------|
| Composite adapter pattern (DI) | Adapters receive other adapters, not services. Reuses existing test infrastructure. | Direct service calls: bypasses adapter validation/formatting |
| No LLM in composite tools | Deterministic output. AI assistant adds judgment. We provide facts. | LLM synthesis: adds latency, cost, variance, API key dependency |
| Parallel specialist execution | Impact, patterns, structure are independent. Parallel saves 2-3x latency. | Sequential: simpler but slower |
| Structured markdown output | Consistent format. AI assistants parse it reliably. Humans can read it too. | JSON: harder for humans. Free text: harder for AI to parse. |
| Depth levels | Users control token/latency trade-off. Quick for small changes, deep for major ones. | Always deep: wastes tokens on trivial changes. Always quick: misses context on complex ones. |
| Diff support via git | `--diff HEAD~1` and `--pr 31` use `git diff` and `gh api`. No custom diff parsing. | Custom diff parser: unnecessary when git handles it |
| CLI outputs same format as MCP | One rendering path. CLI users and MCP users get identical reports. | Separate formats: maintenance burden |

---

## Risk register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Composite tool too slow (>10s) | Medium | Medium | Parallel execution + depth levels. Quick mode for fast feedback. |
| Output too large for AI context | Medium | Medium | Depth levels cap output. Quick: ~500 tokens, Standard: ~1,500, Deep: ~3,000. |
| Adapter-to-adapter coupling | Low | Medium | DI pattern. Composites depend on interfaces, not implementations. |
| Review output not useful enough | Medium | High | Test against real PRs. Compare: does this report answer the questions a reviewer would ask? |
| File vs diff confusion | Low | Low | Clear parameter: `target` for files, `--diff` for git ranges. |

---

## Test strategy

| Test | Priority | What it verifies |
|------|----------|-----------------|
| ReviewAdapter returns impact analysis | P0 | refs + graph queried, results in output |
| ReviewAdapter returns pattern comparison | P0 | patterns + search queried, results in output |
| ReviewAdapter returns structural context | P0 | map queried, hot path rank included |
| ReviewAdapter parallel execution | P1 | specialists run concurrently (timing test) |
| ReviewAdapter depth levels | P0 | quick returns less than deep |
| ReviewAdapter handles missing index | P0 | graceful error, not crash |
| ResearchAdapter returns relevant code | P0 | search results ranked and formatted |
| ResearchAdapter returns call graph | P0 | refs traced for top results |
| ResearchAdapter returns patterns | P1 | pattern comparison for relevant files |
| CLI `dev review` outputs markdown | P0 | structured report on stdout |
| CLI `dev review --diff HEAD~1` | P1 | git diff integrated |
| CLI `dev review --pr 31` | P1 | GitHub PR diff via gh API |
| MCP tool definition valid | P0 | schema accepted by MCP clients |
| Token estimation accurate | P1 | estimateTokens matches actual output |

---

## Verification checklist

### Automated (CI)
- [ ] ReviewAdapter tests pass
- [ ] ResearchAdapter tests pass
- [ ] CLI command tests pass
- [ ] `pnpm build && pnpm test` passes
- [ ] `pnpm typecheck` clean

### Manual
- [ ] `dev review packages/core/src/scanner/typescript.ts` produces useful report
- [ ] `dev review --diff HEAD~1` reviews last commit
- [ ] `dev research "error handling"` returns relevant code + patterns
- [ ] MCP tool works in Claude Code: `dev_review { target: "..." }`
- [ ] MCP tool works in Cursor
- [ ] Report answers the questions a human reviewer would ask

---

## Commit strategy

```
1. feat(mcp): add dev_review composite adapter
2. feat(mcp): add dev_research composite adapter
3. feat(cli): add dev review and dev research commands
4. docs: update CLAUDE.md, agents, and doc site for composite tools
```

---

## Dependencies

- MCP Phase 1 (5 low-level tools) — merged
- Core Phase 3 (cached dependency graph) — merged
- No new npm dependencies
- No LLM API key required (composite tools are deterministic)

---

## Future work

- **LLM-powered synthesis** — optional `--ai` flag that uses an API key to add
  LLM judgment on top of the factual report. Phase 3 scope.
- **Cached research** — index external repos once, reference in future sessions.
  `dev research --index ripgrep` → clones, indexes, caches for reuse.
- **Custom review profiles** — `.dev-agent/review.yml` config for team-specific
  review focuses (e.g., "always check for SQL injection in this repo").
- **PR integration** — `dev review --pr 31 --comment` posts the report as a
  GitHub PR comment.
