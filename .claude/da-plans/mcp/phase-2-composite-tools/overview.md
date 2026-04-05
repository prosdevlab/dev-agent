# MCP Phase 2: Composite Tools — dev_review and dev_research

**Status:** Draft (revised after AI agent architect review)

## Context

MCP Phase 1 delivered 5 low-level tools: `dev_search`, `dev_refs`, `dev_map`,
`dev_patterns`, `dev_status`. Each returns focused context for a specific query.

AI assistants using these tools must orchestrate them manually — call `dev_search`
to find relevant code, `dev_refs` to trace call chains, `dev_patterns` to compare
conventions, `dev_map` for structural context. This works, but:

1. **Round-trip latency** — 5 sequential tool calls take 5x the time of one
2. **Planning overhead** — the AI spends tokens deciding which tool to call next
3. **Incomplete coverage** — the AI may skip cross-package impact analysis or
   pattern comparison because it doesn't know to ask

### The insight

Dev-agent is an MCP server. The AI assistant (Claude Code, Cursor) IS the LLM.
We don't need to bring our own. Our job is to give the assistant the best possible
context so it can do what it does best — reason, research, and synthesize.

**Composite tools deliver workflow-ready context in a single call.** The assistant
reads it and applies judgment. We handle the data; it handles the intelligence.

```
┌──────────────────────────────────────────────────────────┐
│                  The Partnership                         │
│                                                          │
│  dev-agent (MCP)           │  AI assistant (LLM)         │
│  ─────────────────         │  ─────────────────          │
│  Internal knowledge:       │  External research:         │
│    What does our code do?  │    What should it do?       │
│    Who calls what?         │    What do best practices   │
│    What patterns exist?    │    say?                     │
│    Where does it fit?      │    How do popular projects  │
│                            │    handle this?             │
│                            │                             │
│  dev_review returns:       │  AI assistant adds:         │
│    impact analysis         │    security concerns        │
│    pattern comparison      │    logic issues             │
│    structural context      │    recommendations          │
│    similar code            │    evidence from web/docs   │
│                            │                             │
│  dev_research returns:     │  AI assistant adds:         │
│    relevant code           │    external comparisons     │
│    call graphs             │    best practice research   │
│    architecture            │    synthesis + plan         │
└──────────────────────────────────────────────────────────┘

CLI is the degraded experience: structured data, no synthesis.
Still useful — developers can read the report. But the magic
happens in the AI assistant.
```

### What this phase delivers

Two composite MCP tools that run low-level tools in parallel and return
enriched, structured context:

- **`dev_review`** — Everything an AI needs to review a file or change
- **`dev_research`** — Everything an AI needs to understand a concept in the codebase

Two MCP resources that provide ambient codebase context without tool calls:

- **`dev-agent://map`** — Codebase structure (packages, key files, hot paths)
- **`dev-agent://conventions`** — Coding patterns (error handling, imports, naming)

Resources mean the LLM starts every conversation already knowing the codebase
shape and conventions. Zero tool calls for structural awareness.

Plus CLI commands (`dev review`, `dev research`) for standalone terminal use.

---

## Architecture

### Shared analysis services (not adapter DI)

The AI agent architect review identified a key problem: existing adapters contain
inline analysis logic that would be duplicated by composites. The `refs` CLI command
already duplicates RefsAdapter's caller resolution algorithm.

Fix: extract analysis logic into shared services in `packages/core/src/services/`.
Both MCP adapters and CLI commands call these services.

```
┌──────────────────────────────────────────────────────────┐
│  packages/core/src/services/                             │
│                                                          │
│  review-analysis.ts     ← impact, patterns, structure    │
│  research-analysis.ts   ← search, enrich, format         │
│                                                          │
│  Pure functions. Take indexer + search service + graph.   │
│  Return structured data. No MCP, no CLI, no formatting.  │
└──────────────────────────────────────────────────────────┘
         ▲                   ▲                   ▲
         │                   │                   │
┌────────┴─────────┐ ┌──────┴──────────┐ ┌──────┴──────────┐
│  MCP Adapters    │ │  MCP Resources  │ │  CLI Commands    │
│  review-adapter  │ │  map resource   │ │  dev review      │
│  research-adapter│ │  conventions    │ │  dev research    │
│                  │ │                 │ │                  │
│  Format for MCP  │ │  Passive context│ │  Format for term │
│  (markdown)      │ │  (text/markdown)│ │  (chalk/plain)   │
└──────────────────┘ └─────────────────┘ └──────────────────┘
```

This also sets up the path to refactor existing adapters (refs, map, etc.) to
use shared services — eliminating the CLI duplication problem. That refactor is
out of scope for Phase 2 but enabled by this architecture.

### Parallel query composition

Composites run analysis functions in parallel via `Promise.all`. This is not a
"swarm" or multi-agent system — it's parallel query composition with structured
formatting. The AI assistant provides the intelligence; we provide the data.

```typescript
// review-analysis.ts — pure functions, no adapter dependencies
export async function analyzeForReview(
  target: string[],
  indexer: RepositoryIndexer,
  searchService: SearchService,
  graphPath?: string,
  options?: { depth: 'quick' | 'standard' | 'deep' }
): Promise<ReviewAnalysis> {

  const [impact, patterns, structure] = await Promise.all([
    analyzeImpact(target, indexer, graphPath),
    comparePatterns(target, searchService),
    getStructuralContext(target, indexer, graphPath),
  ]);

  return { impact, patterns, structure };
}
```

### Depth levels

| Depth | What it runs | Latency | Best for |
|-------|-------------|---------|----------|
| `quick` | impact only (refs + graph) | <2s | Small changes, quick check |
| `standard` | impact + patterns + structure | <5s | Normal PRs, most reviews |
| `deep` | all + similar code + change frequency | <10s | Major refactors, new features |

### Partial failure behavior

When one specialist fails (e.g., patterns times out but refs succeeds):
- Return a partial report with available sections
- Add a warning note: "Pattern analysis unavailable — index may need refresh"
- Never crash. Always return something useful.

---

## Parts

| Part | Description | Risk |
|------|-------------|------|
| [2.1](./2.1-review-adapter.md) | Shared review analysis service + `dev_review` MCP adapter | Medium |
| [2.2](./2.2-research-adapter.md) | Shared research analysis service + `dev_research` MCP adapter | Medium |
| [2.3](./2.3-cli-commands.md) | `dev review` and `dev research` CLI commands (using shared services) | Low |
| [2.4](./2.4-docs-and-agents.md) | Update CLAUDE.md, agents, doc site, changelog | Low |
| [2.5](./2.5-mcp-resources.md) | MCP resources — ambient codebase context (map + conventions) | Low |

---

## Decisions

| Decision | Rationale | Alternatives |
|----------|-----------|-------------|
| No LLM in composite tools | AI assistant IS the LLM. We provide context, it provides judgment. No API key, no cost, no extra dependency. | LLM in tool: competes with a superior model, adds complexity |
| Shared services in core, not adapter DI | Avoids duplication between CLI and MCP. Pure functions, testable. Adapters are thin wrappers. | Adapter DI: creates coupling between MCP adapters. Service bypass: duplicates logic. |
| Parallel query composition, not "swarm" | Honest naming. It's Promise.all on analysis functions. No dynamic routing, no agent autonomy. | "Swarm" label: misleading, creates confusion with subagents package |
| Partial failure → partial report | Always return something useful. A review with impact but no patterns is better than an error. | Fail entirely: wastes the successful queries. Retry: adds latency. |
| MCP is primary, CLI is secondary | Our users are AI assistant users. MCP delivers the full experience. CLI is the degraded-but-functional fallback. | CLI-first: would need its own LLM, adds cost and complexity |
| dev_review description triggers on "review a PR/change" | Disambiguates from dev_patterns (single file analysis) and dev_search (conceptual query). | Generic description: AI won't know when to use it |
| dev_research enriches ALL results by default | Scope controls emphasis in output, not which data is collected. Avoids the counterintuitive "usage skips call graphs" problem. | Scope skips enrichments: confusing mapping, loses useful data |
| MCP resources for passive context | LLM starts with codebase structure + conventions in context — zero tool calls for basic awareness. Resources are read-only, lightweight, and the client controls whether to load them. | Embed context in tool descriptions: too limited. Auto-call dev_map on start: wastes a tool call every conversation. |
| Two resources (map + conventions), not more | Start small. Each resource consumes context window. Two focused resources cover the highest-value ambient knowledge. Add more if usage data supports it. | One resource: misses conventions. Many resources: bloats context. |

---

## Risk register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| AI assistant doesn't call composite tools | Medium | High | Tool descriptions must clearly signal WHEN to use them. Test with Claude Code and Cursor. |
| Composite too slow (>10s) | Medium | Medium | Parallel execution + depth levels. Quick mode for fast feedback. |
| Output too large for AI context | Medium | Medium | Depth levels cap output. Quick: ~500, Standard: ~1,500, Deep: ~3,000 tokens. |
| AI makes worse decisions with composite than manual tools | Low | High | Test: compare review quality with composite vs 5 manual tool calls. If worse, the composite is failing. |
| Shared services create unwanted coupling | Low | Medium | Services are pure functions with minimal interface. No state, no side effects. |
| CLI experience too degraded without LLM | Medium | Low | CLI returns structured markdown that developers can read. Add LLM synthesis in Phase 3. |
| Resources bloat LLM context window | Medium | Medium | Keep resources concise (~500 tokens each). Client decides whether to load. Provide summary, not exhaustive data. |
| Resources become stale mid-session | Low | Low | Resources reflect indexed state. Stale data is still useful for structure. LLM can call dev_status to check freshness. |

---

## Test strategy

| Test | Priority | What it verifies |
|------|----------|-----------------|
| analyzeImpact returns callers/callees/rank | P0 | Core impact analysis works |
| comparePatterns returns convention comparison | P0 | Pattern analysis works |
| getStructuralContext returns subsystem + hot paths | P0 | Map integration works |
| ReviewAdapter returns combined report | P0 | MCP tool composes correctly |
| ReviewAdapter depth levels | P0 | Quick returns less than deep |
| ReviewAdapter partial failure | P0 | One specialist fails → partial report, not crash |
| ReviewAdapter file target | P0 | Single file resolved |
| ReviewAdapter git diff target | P1 | git range parsed, files extracted |
| ReviewAdapter invalid target | P0 | Graceful error for nonexistent file/bad git range |
| ResearchAdapter returns relevant code + enrichment | P0 | Search + enrichment pipeline works |
| ResearchAdapter scope controls output emphasis | P0 | All data collected, scope affects formatting |
| ResearchAdapter empty results | P0 | Helpful message, not crash |
| Tool descriptions disambiguate from low-level tools | P1 | AI chooses correctly in test scenarios |
| CLI `dev review <file>` produces report | P0 | Standalone CLI works |
| CLI `dev research <query>` produces report | P0 | Standalone CLI works |
| Shared services called by both MCP and CLI | P1 | No logic duplication |
| resources/list returns map + conventions | P0 | Resources registered correctly |
| resources/read returns markdown for each URI | P0 | Resource content generated |
| Resources stay under ~500 tokens each | P1 | Context window budget respected |
| Resources reflect current index state | P1 | Not hardcoded, generated from index |
| Composite quick depth completes in <5s | P2 | Latency smoke test (order-of-magnitude check) |
| Composite standard depth completes in <10s | P2 | Latency smoke test (catches regressions) |

---

## Verification checklist

### Automated (CI)
- [ ] Review analysis service tests pass
- [ ] Research analysis service tests pass
- [ ] MCP adapter tests pass
- [ ] CLI command tests pass
- [ ] `pnpm build && pnpm test` passes
- [ ] `pnpm typecheck` clean

### Manual
- [ ] `dev_review` in Claude Code: AI uses the report to produce a quality review
- [ ] `dev_review` in Cursor: same experience
- [ ] `dev_research` in Claude Code: AI combines our context with its own web research
- [ ] AI chooses `dev_review` over `dev_search` + `dev_refs` when reviewing a PR
- [ ] CLI `dev review` produces readable terminal output
- [ ] CLI `dev research` produces readable terminal output
- [ ] Resources visible in Claude Code (LLM has ambient codebase awareness)
- [ ] Resources visible in Cursor
- [ ] LLM uses resource context to skip unnecessary dev_map calls

---

## Commit strategy

```
1. feat(core): add review analysis service
2. feat(mcp): add dev_review composite adapter
3. feat(mcp): add MCP resources for ambient codebase context
4. feat(core): add research analysis service
5. feat(mcp): add dev_research composite adapter
6. feat(cli): add dev review and dev research commands
7. docs: update CLAUDE.md, agents, and doc site for composite tools + resources
```

**Dependency note:** Commit 3 (resources) depends only on existing core
services (`RepositoryIndexer`, `SearchService`, `PatternAnalysisService`) and
the cached dependency graph — NOT on the new review-analysis or research-analysis
services from commits 1 and 4. Resources and composite tools are independent
consumers of the same underlying services.

---

## Dependencies

- MCP Phase 1 (5 low-level tools) — merged
- Core Phase 3 (cached dependency graph) — merged
- No new npm dependencies
- No LLM API key required

---

## Future work (Phase 3)

- **LLM synthesis for CLI** — Optional `ANTHROPIC_API_KEY` or Ollama integration
  adds AI-powered synthesis to CLI output. MCP users already get this from their
  AI assistant.
- **Cached external research** — `dev research --index ripgrep` clones, indexes,
  and caches an external repo for comparison. Reusable across sessions.
- **Custom review profiles** — `.dev-agent/review.yml` for team-specific review
  focuses.
- **PR integration** — `dev review --pr 31 --comment` posts report as GitHub PR
  comment.
- **Refactor existing adapters** — Migrate refs, map, etc. to shared services
  pattern, eliminating CLI duplication.
