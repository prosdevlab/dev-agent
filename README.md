# dev-agent

[![Node.js](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-8.15.4-orange.svg)](https://pnpm.io/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Local semantic code search for Cursor and Claude Code via MCP.**

> dev-agent started as a hack project at [Lytics](https://github.com/lytics/dev-agent) and is now maintained independently as an open source project.

## What it does

dev-agent indexes your codebase and provides 5 MCP tools to AI assistants. Instead of grepping through files, they can ask conceptual questions like "where do we handle authentication?"

- `dev_search` — Hybrid search (BM25 + vector + RRF) — returns code snippets, not just paths
- `dev_refs` — Find callers/callees of any function
- `dev_map` — Codebase structure with hot paths (most referenced files)
- `dev_patterns` — Compare coding patterns against similar files
- `dev_status` — Repository indexing status, health checks, and Antfly stats

## Quick Start

```bash
# Install
npm install -g @prosdevlab/dev-agent

# One-time setup (installs Antfly, pulls embedding model, starts server)
dev setup

# Index your repository
cd /path/to/your/repo
dev index

# Connect to your AI tool
dev mcp install --cursor  # For Cursor
dev mcp install           # For Claude Code
```

## How it works

1. **Scanner** parses code using ts-morph (TypeScript/JS) and tree-sitter (Go)
2. **Antfly** generates embeddings locally via Termite (ONNX, BAAI/bge-small-en-v1.5)
3. **Hybrid search** combines BM25 keyword matching with vector similarity via RRF
4. **File watcher** auto-reindexes on save while the MCP server runs

Everything runs locally. Your code never leaves your machine.

## CLI Commands

```bash
# Setup
dev setup                              # Start Antfly search backend
dev setup --docker                     # Use Docker instead of native
dev reset                              # Tear down and start fresh

# Indexing
dev index                              # Index current repository
dev index --force                      # Force full re-index

# Search
dev search "authentication middleware"  # Semantic search
dev search "error handling" --verbose   # With signatures and docs
dev search --similar-to src/auth.ts    # Find similar code

# Codebase structure
dev map                                # Overview with hot paths
dev map --depth 3                      # Deeper structure
dev map --focus packages/core          # Focus on a directory

# Maintenance
dev compact                            # Optimize vector storage
dev clean --force                      # Remove all indexed data
dev storage path                       # Show storage location
```

## MCP Tools

### `dev_search` — Semantic Code Search

Hybrid search that combines keyword matching (BM25) and semantic understanding (vector similarity), fused via Reciprocal Rank Fusion. Returns ranked results with code snippets, imports, and call graph data.

```
Find authentication middleware that handles JWT tokens
```

### `dev_refs` — Call Graph Queries

Find what calls a function and what it calls. Uses the call graph extracted at index time.

```
Find all callers of the authenticate function
Find what functions validateToken calls
```

### `dev_map` — Codebase Overview

Directory structure with component counts and hot paths (most referenced files).

```
Show me the codebase structure
Focus on the packages/core directory
```

### `dev_patterns` — Pattern Analysis

Compare a file's coding patterns (imports, error handling, type coverage, testing, size) against similar files in the codebase.

```
Analyze patterns in src/auth/middleware.ts
```

### `dev_status` — Repository Status & Health

Indexing status, document counts, Antfly stats, file watcher state, and health checks (`section="health"`).

## Supported Languages

| Language | Scanner | Features |
|----------|---------|----------|
| TypeScript/JavaScript | ts-morph | Functions, classes, interfaces, types, arrow functions, hooks |
| Python | tree-sitter | Functions, classes, methods, decorators, type hints, docstrings |
| Go | tree-sitter | Functions, methods, structs, interfaces, generics |
| Markdown | remark | Documentation sections |

## Technology

- **[Antfly](https://antfly.io)** — Hybrid search (BM25 + vector + RRF), local embeddings via Termite (ONNX)
- **ts-morph** — TypeScript/JavaScript AST analysis
- **tree-sitter** — Python and Go analysis (WASM)
- **@parcel/watcher** — File change detection for auto-reindexing
- **MCP** — Model Context Protocol for AI tool integration

## Prerequisites

- Node.js 22+ (LTS)
- [Antfly](https://antfly.io) — installed automatically by `dev setup`

## Development

```bash
pnpm install
pnpm build
pnpm test        # 1,600+ tests
pnpm typecheck   # After build
pnpm lint
```

## Project Structure

```
packages/
  core/          # Scanner, vector storage, indexer, services
  cli/           # Commander.js CLI
  mcp-server/    # MCP server with 5 tool adapters
  subagents/     # Explorer, planner, PR agents
  integrations/  # Claude Code, VS Code, Cursor
  logger/        # @prosdevlab/kero centralized logging
  types/         # Shared TypeScript types
  dev-agent/     # Root package (CLI entry point)
```

## Contributing

Contributions welcome. Follow conventional commit format and include tests.

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[MIT](LICENSE)
