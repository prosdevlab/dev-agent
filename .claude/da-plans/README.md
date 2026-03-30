# Dev-Agent — Plans

Plans for the dev-agent project, organized by package.

Each plan is written before implementation, reviewed by the plan-reviewer agent, and committed.
Implementation deviations are logged at the bottom of each plan file.

## Tracks

| Track | Description | Status |
|-------|-------------|--------|
| [Core](core/) | Scanner, vector storage, services, indexer | Phase 1: Merged, Phase 2: Draft (indexing rethink) |
| [CLI](cli/) | Command-line interface | Not started |
| [MCP Server](mcp-server/) | Model Context Protocol server + adapters | Phase 1: Draft (blocked on core/phase-1) |
| [Subagents](subagents/) | Coordinator, explorer, planner, GitHub agents | Not started |
| [Integrations](integrations/) | Claude Code, VS Code, Cursor | Not started |
| [Logger](logger/) | @prosdevlab/kero centralized logging | Not started |

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
