# Contributing to Dev-Agent

## Prerequisites

- **Node.js >= 22** (LTS)
- **pnpm** — `npm install -g pnpm`
- **Claude Code** — [install](https://claude.com/claude-code). We use Claude Code + dev-agent for development.
- **dev-agent** — `npm install -g @prosdevlab/dev-agent`
- **Antfly** — local search backend. Run `dev setup` after install.

## Getting started

```bash
# Clone and install
git clone https://github.com/prosdevlab/dev-agent.git
cd dev-agent
pnpm install

# Start Antfly (one-time setup)
dev setup

# Index the codebase
dev index

# Install MCP server for Claude Code
dev mcp install

# Build and test
pnpm build
pnpm test
```

## Development workflow

We use Claude Code with dev-agent's MCP tools for development. The tools
provide semantic code search, call graph tracing, pattern analysis, and
codebase structure — saving significant context window usage.

### Before you code

1. **Index the repo:** `dev index` (run after pulling changes)
2. **Understand the area:** `dev search "your topic"`, `dev map --focus packages/core`
3. **Plan non-trivial features:** Write a plan in `.claude/da-plans/` and run the `plan-reviewer` agent before implementation

### While you code

```bash
pnpm dev                  # Watch mode
pnpm test                 # Run tests (from root, NOT turbo test)
pnpm lint                 # Biome lint
pnpm typecheck            # Type check (AFTER pnpm build)
```

### Before you PR

1. Run the `code-reviewer` agent on your branch diff
2. Address any CRITICAL or WARNING findings
3. Add a changeset: `pnpm changeset` (only for `@prosdevlab/dev-agent` or `@prosdevlab/kero`)
4. Update release notes in `website/content/updates/index.mdx` and `website/content/latest-version.ts`

## Commit convention

[Conventional Commits](https://www.conventionalcommits.org/) enforced by commitlint.

```
type(scope): description

feat(mcp): add health check adapter
fix(core): resolve vector search timeout
docs: update CLAUDE.md
chore: update dependencies
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`, `ci`

## Pull request process

1. Create a branch: `git checkout -b feat/my-feature`
2. Make your changes with tests
3. Run the full validation suite: `pnpm build && pnpm test && pnpm typecheck && pnpm lint`
4. Run `code-reviewer` agent on the diff
5. Add a changeset if the change affects published packages
6. Push and create a PR to `main`

## CLI tools (available after `dev index`)

```bash
dev search "authentication"              # Semantic code search
dev refs "functionName"                  # Find callers/callees
dev refs "fn" --depends-on "src/db.ts"   # Trace dependency chain
dev map                                   # Codebase structure overview
dev map --focus packages/core --depth 3   # Focused map
```

## Agent system (`.claude/agents/`)

We use Claude Code agents for code review, research, and planning:

| Agent | Purpose |
|-------|---------|
| `code-reviewer` | Orchestrates security, logic, and quality review in parallel |
| `research-planner` | Maps internal code + delegates external research to sub-agents |
| `plan-reviewer` | Two-pass plan review (engineer + SDET) |
| `bug-investigator` | Systematic root cause analysis |
| `quick-scout` | Fast codebase exploration |

Agents use dev-agent's MCP tools (`dev_search`, `dev_refs`, `dev_map`, `dev_patterns`)
to understand the codebase without reading every file.

## Architecture

See [CLAUDE.md](./CLAUDE.md) for the full monorepo structure, build order,
MCP tools reference, and non-negotiables.

## Testing

- **Tests run from root only:** `pnpm test`
- **Build before typecheck:** `pnpm build` then `pnpm typecheck`
- **Biome for linting:** `pnpm lint` (not ESLint)

| Code type | Coverage target |
|-----------|----------------|
| Pure utilities | 100% |
| Integration | >80% |
| CLI/UI | >60% |

See [TESTABILITY.md](./docs/TESTABILITY.md) for detailed guidelines.

## Changesets

We use [Changesets](https://github.com/changesets/changesets) for versioning.
Only `@prosdevlab/dev-agent` and `@prosdevlab/kero` are published — all other
packages are private and bundled.

```bash
pnpm changeset            # Create a changeset
```

When adding a changeset, also update:
1. `website/content/updates/index.mdx` — release notes
2. `website/content/latest-version.ts` — latest version callout

## Questions?

Open an issue or discussion in the repository.
