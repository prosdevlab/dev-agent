# Dev-Agent — Plans

Plans for the dev-agent project, organized by package.

Each plan is written before implementation, reviewed by the plan-reviewer agent, and committed.
Implementation deviations are logged at the bottom of each plan file.

## Tracks

| Track | Phase | Description | Status |
|-------|-------|-------------|--------|
| [Core](core/) | Phase 1 | Antfly migration | Merged |
| [Core](core/) | Phase 2 | Indexing rethink (Linear Merge, incremental) | Merged |
| [Core](core/) | Phase 3 | Cached dependency graph for scale | Merged |
| [Core](core/) | Phase 4 | Python language support | Merged |
| [Core](core/) | Phase 5 | Go callee extraction + Rust language support | Merged |
| [Core](core/) | Phase 6 | Reverse callee index for dev_refs callers | Draft |
| [MCP](mcp/) | Phase 1 | Tools improvement (patterns, consolidation, AST, graph algorithms) | Merged |
| [MCP](mcp/) | Phase 2 | Composite tools — dev_review and dev_research | Draft |

## Plan Format

- **Small phases** (1-2 commits): single `.md` file
- **Large phases** (3+ commits): folder with `overview.md` + numbered `N.X-*.md` parts
- Max 400 lines per part file
- Max 500 lines for overview

Each plan must include:
- Context (what exists, what's missing, dependencies)
- Parts table (part | description | risk)
- Architecture diagram (ASCII)
- Decisions table (decision | rationale | alternatives)
- Risk register (likelihood, impact, mitigation)
- Test strategy (specific test names, priorities)
- Verification checklist (manual acceptance criteria)

## Status Legend

- **Merged** — implemented, tested, merged to main
- **In progress** — implementation underway
- **Approved** — plan reviewed and approved, not yet started
- **Draft** — plan written, pending review
- **Not started** — plan not yet written
