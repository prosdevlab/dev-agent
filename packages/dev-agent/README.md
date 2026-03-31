# @prosdevlab/dev-agent

**Deep code intelligence + AI subagents via MCP**

Local-first semantic code search, GitHub integration, and development planning for AI tools like Cursor and Claude Code.

## Quick Start

```bash
# Install globally
npm install -g @prosdevlab/dev-agent

# One-time setup (starts Antfly search backend)
dev setup

# Index your repository
cd /path/to/your/repo
dev index

# Install MCP integration
dev mcp install --cursor  # For Cursor IDE
dev mcp install           # For Claude Code

# Start using dev-agent in your AI tool!
```

## Features

- 🔍 **Semantic Code Search** - Natural language queries across your codebase
- 🔎 **Code Exploration** - Discover patterns, find similar code, analyze relationships
- 💚 **Health Monitoring** - Check component status and system health
- 📊 **Repository Status** - View indexing progress and statistics

## MCP Tools

When integrated with Cursor or Claude Code, you get 6 powerful tools:

- `dev_search` - Semantic code search
- `dev_refs` - Find callers/callees of functions
- `dev_map` - Codebase structure with change frequency
- `dev_patterns` - File analysis and pattern checking
- `dev_status` - Repository status, health checks, and Antfly stats

## Requirements

- Node.js >= 22 (LTS)

## Production Features

- 🛡️ Rate limiting (100 req/min burst per tool)
- 🔄 Automatic retry with exponential backoff
- 💚 Health checks for all components
- 🧹 Memory-safe (circular buffers, proper cleanup)
- 🔌 Graceful shutdown (no zombie processes)

## Documentation

- **Full Documentation:** https://github.com/prosdevlab/dev-agent
- **Troubleshooting:** https://github.com/prosdevlab/dev-agent/blob/main/TROUBLESHOOTING.md
- **Cursor Setup:** https://github.com/prosdevlab/dev-agent/blob/main/packages/mcp-server/CURSOR_SETUP.md
- **Claude Code Setup:** https://github.com/prosdevlab/dev-agent/blob/main/packages/mcp-server/CLAUDE_CODE_SETUP.md

## CLI Commands

```bash
# Indexing
dev index                    # Index current repository
dev github index                   # Index GitHub issues/PRs

# MCP Server Integration
dev mcp install --cursor       # Install for Cursor
dev mcp install                # Install for Claude Code
dev mcp uninstall [--cursor]   # Remove integration
dev mcp list [--cursor]        # List installed servers
dev mcp start [--verbose]      # Start MCP server manually

# Help
dev --help                     # Show all commands
dev <command> --help           # Help for specific command
```

## How It Works

1. **Index** - Scans your TypeScript/JavaScript codebase and builds semantic vectors
2. **Search** - Uses local embeddings (BAAI/bge-small-en-v1.5) for semantic understanding
3. **Store** - Antfly hybrid search (BM25 + vector), all data stays on your machine
4. **Integrate** - MCP protocol connects to Cursor/Claude Code
5. **Query** - AI tools can now understand your codebase semantically

## Local-First

All processing happens on your machine:
- ✅ No cloud services required
- ✅ No API keys needed
- ✅ Your code never leaves your computer
- ✅ Works completely offline (after initial model download)

## Technology

- **Analysis:** TypeScript Compiler API + ts-morph
- **Embeddings:** Antfly Termite (ONNX, BAAI/bge-small-en-v1.5)
- **Vector Storage:** Antfly (hybrid search: BM25 + vector + RRF)
- **GitHub:** GitHub CLI for local metadata
- **Protocol:** Model Context Protocol (MCP)

## Examples

```bash
# Find authentication-related code
dev_search: "JWT token validation middleware"

# Analyze coding patterns
dev_patterns: { filePath: "src/auth/middleware.ts" }

# Check system health
dev_status: { section: "health" }
```

## Support

- **GitHub Issues:** https://github.com/prosdevlab/dev-agent/issues
- **Discussions:** https://github.com/prosdevlab/dev-agent/discussions

## License

MIT

---

**Status:** Production-ready v0.1.0 | **Tests:** 1100+ passing | **Node:** >=22 LTS

