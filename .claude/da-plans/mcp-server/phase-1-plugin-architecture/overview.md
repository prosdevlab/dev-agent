# Phase 1: Plugin Architecture for MCP Adapters

**Status:** Not started — depends on antfly migration (core/phase-1) completing first.

## Context

dev-agent's MCP server currently has 9 adapters that follow a class-based pattern:
extend `ToolAdapter`, implement `getToolDefinition()` + `execute()`, register manually
in `bin/dev-agent-mcp.ts`. This works but is rigid — adding adapters requires touching
multiple files, config is scattered, and there's no plugin lifecycle.

[sdk-kit](https://github.com/lytics/sdk-kit) (a Lytics open-source project) provides a
proven plugin architecture: `use()`, `ns()`, `expose()`, `defaults()`, event-driven
coordination, and capability injection. This pattern maps naturally to MCP adapters.

## Vision

Each MCP adapter becomes a plugin that:
- **Registers itself** via `use()` — no manual wiring in entry point
- **Declares its config defaults** via `defaults()` — no scattered config
- **Exposes its tools** via `expose()` — type-safe tool registration
- **Emits events** — `tool:search:start`, `tool:search:complete` for observability
- **Declares dependencies** — e.g., search adapter requires vector storage

Third-party adapters become possible: `dev mcp add @someone/dev-agent-jira-adapter`.

## What we'd lift from sdk-kit

| sdk-kit concept | MCP adapter equivalent |
|-----------------|----------------------|
| `plugin.ns('transport')` | `adapter.ns('dev_search')` |
| `plugin.defaults({...})` | `adapter.defaults({ limit: 10, threshold: 0.3 })` |
| `plugin.expose({ send })` | `adapter.expose({ toolDefinition, execute })` |
| `plugin.emit('transport:send')` | `adapter.emit('tool:search:start', query)` |
| `plugin.hold({ log })` | `adapter.hold({ vectorStorage })` — shared capabilities |
| `sdk.use(transportPlugin)` | `server.use(searchAdapter)` |

## Also relevant from sdk-kit

- **Transport plugin** — `sendWithRetry` pattern with exponential backoff, skip 4xx
- **Poll plugin** — `waitFor` pattern for async conditions (server readiness, etc.)
- **Lifecycle** — `sdk:init`, `sdk:ready`, `sdk:destroy` events for clean startup/shutdown

## Why this matters

1. **Community adapters** — third parties can build MCP tools as plugins
2. **Config in one place** — each adapter declares defaults, user overrides via config file
3. **Observability** — event emission gives free logging/metrics hooks
4. **Testability** — plugins are pure functions, easy to test in isolation
5. **Reduced boilerplate** — no manual registration, no entry point changes per adapter

## Scope

This is a significant architectural refactor:
- Core plugin system (from sdk-kit patterns)
- Rewrite 9 adapters as plugins
- New adapter registration/discovery
- Config system changes
- Event bus integration
- Third-party adapter loading

## Parts (to be detailed)

| Part | Description |
|------|-------------|
| 1.1 | Design: adapt sdk-kit core for MCP context (spike) |
| 1.2 | Implement plugin core (use, ns, expose, defaults, emit) |
| 1.3 | Convert SearchAdapter as first plugin (proof of concept) |
| 1.4 | Convert remaining 8 adapters |
| 1.5 | Third-party adapter loading (`dev mcp add`) |
| 1.6 | Documentation and migration guide |

## Dependencies

- **core/phase-1 (antfly migration)** must complete first — the vector storage layer
  is a shared capability that adapters depend on, and it's changing
- **sdk-kit source** — reference implementation at github.com/lytics/sdk-kit

## Open questions

1. Do we vendor sdk-kit core, fork it, or depend on it as a package?
2. How do third-party adapters discover the MCP server? npm package convention?
3. Does the event bus replace or complement the existing `AsyncEventBus` in core?
4. How does this interact with the antfly client (shared capability via `hold()`)?

---

*This plan will be fleshed out after the antfly migration lands. The overview here
captures the vision and key decisions so the idea isn't lost.*
