# Dev-Agent — AI Assistant Context

## The mission

**Local-first repository context for AI tools — no hallucinations.**

Hybrid search (BM25 + vector), code analysis, and GitHub integration through MCP.
Powered by [Antfly](https://antfly.io) for search and embeddings.
Everything runs on your machine. No data leaves.

---

## Package manager

- **pnpm** for everything. Never npm or yarn.
- Node.js >= 22 (LTS).

---

## Monorepo structure

```
packages/
  core/          # Scanner (ts-morph, tree-sitter), vector storage (Antfly), services
  cli/           # Commander.js CLI — dev index, dev mcp install, etc.
  mcp-server/    # MCP server with 6 built-in adapters
  subagents/     # Coordinator, explorer, planner, PR agents
  integrations/  # Claude Code, VS Code, Cursor
  logger/        # @prosdevlab/kero — centralized logging
  types/         # Shared TypeScript types
  dev-agent/     # Root package (CLI entry point)
```

---

## Build order

Turborepo handles this, but know the chain:

1. `@prosdevlab/kero` (no deps)
2. `@prosdevlab/dev-agent-core` (depends on logger)
3. `@prosdevlab/dev-agent-cli` (depends on core)
4. `@prosdevlab/dev-agent-subagents` (depends on core)
5. `@prosdevlab/dev-agent-mcp` (depends on core, subagents)
6. `@prosdevlab/dev-agent-integrations` (depends on multiple)

**Critical:** `pnpm build` before `pnpm typecheck` — TypeScript needs `.d.ts` files.

---

## Commands

```bash
pnpm install              # Install deps
pnpm build                # Build all packages
pnpm test                 # Run tests from root (NOT turbo test)
pnpm typecheck            # Type check (AFTER build)
pnpm lint                 # Biome lint
pnpm format               # Biome format
pnpm dev                  # Watch mode
pnpm clean                # Clean build outputs
pnpm changeset            # Document changes for release
dev setup                 # One-time: start Antfly search backend
```

---

## Non-negotiables

- **Biome** for linting and formatting. No ESLint.
- **Conventional commits** enforced by Commitlint + Husky.
- **Workspace protocol** for internal deps: `"@prosdevlab/dev-agent-core": "workspace:*"`
- **Tests run from root only:** `pnpm test` — centralized Vitest config.
- **Logger:** Use `@prosdevlab/kero` — never `console.log` in packages.
- **Local-first:** No data sent externally. Embeddings via Antfly/Termite (local ONNX).
- **Code review before PR.** Always run the `code-reviewer` agent (which
  launches security-reviewer, logic-reviewer, and quality-reviewer in
  parallel) on the branch diff before creating a pull request. Address
  any CRITICAL or WARNING findings before merging.
- **Plan before building.** For non-trivial features, write a plan in
  `.claude/da-plans/` and run the `plan-reviewer` agent before implementation.
- **Changesets target published packages only.** Only `@prosdevlab/dev-agent`
  and `@prosdevlab/kero` are published to npm. All other packages are private
  and bundled into dev-agent via tsup. Never add private packages to changesets.
- **Changesets include doc site updates.** When adding a changeset, also:
  1. Add a release entry to `website/content/updates/index.mdx`
  2. Update `website/content/latest-version.ts` to match the new version

---

## Agents (`.claude/agents/`)

```
code-reviewer     — orchestrates 3 reviewers in parallel before PRs
security-reviewer — command injection, secrets, MCP security, supply chain
logic-reviewer    — correctness, race conditions, cross-package data flow
quality-reviewer  — tests, conventions, readability (caps at 5 suggestions)
quick-scout       — fast "where is X?" codebase explorer (haiku)
bug-investigator  — systematic root cause analysis + fix + regression test
pr-composer       — validation suite + PR description composer
plan-reviewer     — two-pass plan review (engineer + SDET)
research-planner  — investigation planning before implementation
```

### Agent → MCP Tool Matrix

Agents dogfood the dev-agent MCP tools. ★ = high impact, ● = useful.

```
┌───────────────────┬────────────┬──────────┬─────────┬──────────────┐
│       Agent       │ dev_search │ dev_refs │ dev_map │ dev_patterns │
├───────────────────┼────────────┼──────────┼─────────┼──────────────┤
│ bug-investigator  │     ★      │    ★     │    ●    │              │
│ quick-scout       │     ★      │    ★     │    ●    │              │
│ research-planner  │     ★      │    ●     │    ★    │      ★       │
│ logic-reviewer    │     ●      │    ★     │         │      ●       │
│ security-reviewer │     ★      │    ★     │         │      ★       │
│ quality-reviewer  │     ●      │          │         │      ★       │
│ plan-reviewer     │            │    ★     │    ★    │      ●       │
│ pr-composer       │            │          │    ●    │              │
│ code-reviewer*    │            │          │         │              │
└───────────────────┴────────────┴──────────┴─────────┴──────────────┘

* code-reviewer is an orchestrator — it delegates to security/logic/quality reviewers.
```

---

## Plans (`.claude/da-plans/`)

Phase-based planning docs written before implementation. Organized by package track.

- Small phases (1-2 commits): single `.md` file
- Large phases (3+ commits): folder with `overview.md` + numbered parts
- Max 400 lines per part, 500 for overview
- Each plan: context, architecture, decisions, risks, test strategy, verification

See `.claude/da-plans/README.md` for status and format details.

---

## MCP tools (6 adapters)

| Tool | Purpose |
|------|---------|
| `dev_search` | Hybrid code search — BM25 + vector + RRF (use FIRST for conceptual queries) |
| `dev_refs` | Find callers/callees of functions |
| `dev_map` | Codebase structure with change frequency |
| `dev_patterns` | File pattern analysis (similar code, error handling, types) |
| `dev_status` | Repository indexing status + Antfly stats + watcher status |
| `dev_health` | Server health checks (Antfly connectivity) |

---

## Adding a new MCP adapter

1. Create in `packages/mcp-server/src/adapters/built-in/`
2. Extend `ToolAdapter`, implement `getToolDefinition()` + `execute()`
3. Add tests in `__tests__/`
4. Register in `bin/dev-agent-mcp.ts`
5. Export from `built-in/index.ts`

---

## Workflow

> See [`WORKFLOW.md`](./WORKFLOW.md) for branch naming, commit format, PR process, and testing standards.

```bash
# Common workflows
pnpm install && pnpm build && pnpm test  # Full setup
dev setup                                 # One-time: start Antfly
dev index                                 # Index repository
dev mcp install                           # Install for Claude Code
dev mcp install --cursor                  # Install for Cursor
```

---

## Commit format

```
type(scope): description

feat(mcp): add health check adapter
fix(core): resolve vector search timeout
docs: update CLAUDE.md
chore: update dependencies
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`, `ci`
