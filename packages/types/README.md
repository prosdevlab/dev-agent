# @prosdevlab/dev-agent-types

Shared TypeScript type definitions for dev-agent packages.

## Purpose

This package provides common type definitions that are shared across multiple dev-agent packages, preventing circular dependencies and ensuring type consistency.

## Structure

- `github.ts` - GitHub-related types (documents, search, indexing)
- `index.ts` - Main exports

## Usage

```typescript
import type { GitHubDocument, GitHubSearchResult } from '@prosdevlab/dev-agent-types/github';
```

## Why a Separate Package?

This package exists to break circular dependencies between:
- `@prosdevlab/dev-agent-core` (services)
- `@prosdevlab/dev-agent-subagents` (GitHub indexer, agents)
- `@prosdevlab/dev-agent-mcp` (MCP adapters)

By extracting shared types into a separate package that all others depend on, we maintain a clean dependency graph while ensuring type safety.

