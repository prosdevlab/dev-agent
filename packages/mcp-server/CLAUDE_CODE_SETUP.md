# Claude Code MCP Setup Guide

This guide shows how to integrate dev-agent with Claude Code for seamless AI-powered code assistance.

## Quick Setup (Recommended)

The easiest way to set up dev-agent with Cursor:

```bash
# 1. Install dev-agent globally
npm install -g dev-agent

# 2. Index your repository
cd /path/to/your/repository
dev index

# 3. Install MCP integration for Claude Code (one command!)
dev mcp install
```

That's it! **Restart Claude Code** and dev-agent tools will be available.

## What You Get

Once installed, Claude Code gains access to these powerful tools:

### `dev_search` - Semantic Code Search
Search your codebase using natural language.

```
Find authentication middleware that handles JWT tokens
```

**Parameters:**
- `query` (required): Natural language search query
- `format`: `compact` (default) or `verbose`
- `limit`: Number of results (1-50, default: 10)
- `tokenBudget`: Maximum tokens for results (500-10000)

### `dev_status` - Repository Status
Get indexing status and repository health information.

```
Show me the repository status
```

**Parameters:**
- `section`: `summary`, `repo`, `indexes`, `github`, `health` (default: `summary`)
- `format`: `compact` (default) or `verbose`

### `dev_patterns` - File Analysis
Inspect specific files, compare implementations, validate patterns.

```
Compare src/auth/middleware.ts with similar implementations
```

**Actions:**
- `compare`: Find similar code implementations
- `validate`: Check pattern consistency (coming soon)

**Parameters:**
- `action`: Inspection type (required)
- `query`: File path to inspect (required)
- `threshold`: Similarity threshold (0-1, default: 0.7)
- `limit`: Number of results (default: 10, for compare action)
- `format`: Output format (`compact` or `verbose`)

### `dev_health` - Server Health Check
Check the health of dev-agent MCP server and its components.

```
Check server health
```

**Parameters:**
- `verbose`: Include detailed diagnostics (default: false)

**Checks:**
- Vector storage (indexed code)
- Repository accessibility
- GitHub index status and age

## Management Commands

```bash
# List configured MCP servers in Claude Code
dev mcp list

# Uninstall dev-agent from Claude Code
dev mcp uninstall
```

## Claude Code Configuration

Claude Code uses different config locations than Claude Desktop:

- **User Config:** `~/.claude.json` - Works for all your projects
- **Project Config:** `.mcp.json` in repository root - Shared via git
- **Local Config:** `~/.claude.json [project: /path]` - Private, project-specific

**Recommendation:** The CLI uses `claude mcp add` which configures dev-agent automatically. No manual JSON editing needed!

## GitHub Integration

GitHub issues and PRs are indexed automatically when you run `dev index`. To enable GitHub search, make sure the `gh` CLI is installed and authenticated:

```bash
gh auth status
# If not logged in:
gh auth login

# Then index (includes GitHub data by default)
cd /path/to/your/repository
dev index
```

## Manual Configuration (Advanced)

If you prefer manual setup instead of using `dev mcp install`, you can configure Claude Code directly:

**Using Claude CLI:**
```bash
claude mcp add --transport stdio dev-agent \
  --env REPOSITORY_PATH=/path/to/your/repo \
  -- dev mcp start
```

**Config Locations:**
- **User config**: `~/.claude.json` (all projects)
- **Project config**: `.mcp.json` in repo root (shared in git)

**Example `.mcp.json` for project-specific setup:**
```json
{
  "mcpServers": {
    "dev-agent": {
      "command": "dev",
      "args": ["mcp", "start"],
      "env": {
        "REPOSITORY_PATH": ".",
        "LOG_LEVEL": "info"
      }
    }
  }
}
```

**Note:** The `dev mcp install` command uses `claude mcp add` automatically, so manual config is rarely needed.

## Verification

After setup and Claude Code restart:

1. Open a file in your repository
2. Try a search: `Find database connection logic`
3. Check status: `Show repository status`
4. Check health: `Check server health`

You should see semantic search results and repository information.

## Troubleshooting

### Server Not Starting

1. **Check Repository is Indexed:**
   ```bash
   cd /path/to/your/repository
   dev index
   ```

2. **Verify MCP Installation:**
   ```bash
   dev mcp list
   ```
   Should show `dev-agent` entry.

3. **Check Claude Code Logs:**
   - Open Claude Code CLI
   - Check system logs for MCP errors
   - Look for connection issues

4. **Try Verbose Mode:**
   Edit `mcp.json` and set:
   ```json
   "env": {
     "LOG_LEVEL": "debug"
   }
   ```

### No Search Results

**Cause:** Repository not indexed or stale index.

**Solution:**
```bash
cd /path/to/your/repository
dev index
```

### GitHub Tools Not Working

**Cause:** GitHub data not indexed, or `gh` CLI not authenticated.

**Solution:**
```bash
gh auth status
cd /path/to/your/repository
dev index
```

### Zombie Processes

If you notice multiple `dev` processes:

**Solution:**
- Restart Claude Code
- The latest version includes robust process cleanup

**Verification:**
```bash
ps aux | grep "dev mcp start"
```

Should show one process for Claude Code.

### Rate Limiting

If you see "Rate limit exceeded" errors:

**Cause:** Too many requests in short time (default: 100 requests/minute per tool).

**Solution:**
- Wait for the specified `retryAfterMs` period
- Check health: `Check server health`
- Rate limits reset automatically

### Health Check Issues

Run `dev_health` tool to diagnose:

```
Check server health with verbose details
```

**Common Issues:**
- **Vector storage warning:** Run `dev index`
- **GitHub index stale (>24h):** Run `dev index`
- **Repository not accessible:** Check paths and permissions

## Production Features

Dev-agent includes production-ready stability features:

- **Memory Management:** Circular buffers prevent memory leaks
- **Rate Limiting:** Token bucket algorithm (100 req/min burst, configurable)
- **Retry Logic:** Exponential backoff with jitter for transient failures
- **Health Monitoring:** Proactive component health checks
- **Graceful Shutdown:** Proper cleanup, no zombie processes

## Multiple Repositories

For multiple repositories, you have two options:

**Option 1: User Config** (Recommended)
```bash
# Each install adds to ~/.claude.json
cd /path/to/project-a
dev mcp install

cd /path/to/project-b  
dev mcp install
```

The CLI uses `claude mcp add` to register each repository in your user config.

**Option 2: Project-Specific Configs**

Create `.mcp.json` in each repository root (shared via git):
```json
{
  "mcpServers": {
    "dev-agent": {
      "command": "dev",
      "args": ["mcp", "start"],
      "env": {
        "REPOSITORY_PATH": "."
      }
    }
  }
}
```

This way your team members can use the same MCP configuration.

## Updating

When updating dev-agent:

```bash
# Update globally
npm update -g dev-agent

# Rebuild indexes (recommended)
cd /path/to/your/repository
dev index

# Restart Claude Code
```

No need to reinstall MCP integration - it automatically uses the latest version.

## Performance Tips

1. **Index Incrementally:** Run `dev index` after major changes
2. **GitHub Index:** Re-run `dev index` to refresh GitHub data
3. **Health Checks:** Use `dev_health` to monitor component status
4. **Verbose Only When Needed:** Keep `LOG_LEVEL: info` for production

## Next Steps

- See [README.md](./README.md) for MCP server architecture
- See [../../WORKFLOW.md](../../WORKFLOW.md) for development workflow
- See [TROUBLESHOOTING.md](../../TROUBLESHOOTING.md) for detailed troubleshooting

## Need Help?

- Check logs: `LOG_LEVEL: debug` in `mcp.json`
- Run health check: `dev_health` tool
- File an issue: https://github.com/your-org/dev-agent/issues

---

**Last Updated:** 2025-11-26  
**Version:** 0.1.0  
**Status:** Production-ready with comprehensive stability features
