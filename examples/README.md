# Dev-Agent Examples

Real-world usage patterns for dev-agent MCP tools.

## Quick Start

```bash
# Install dev-agent
npm install -g dev-agent

# Index your repository
cd /path/to/your/project
dev index

# Install MCP for Cursor
dev mcp install --cursor

# Restart Cursor - tools are now available!
```

---

## Tool Examples

### `dev_search` - Semantic Code Search

Find code by meaning, not exact text:

```
# Find authentication logic
dev_search: "user authentication and login flow"

# Find error handling patterns
dev_search: "how errors are caught and handled"

# Find API endpoints
dev_search: "REST API route handlers"
```

**With options:**
```
dev_search:
  query: "database connection pooling"
  limit: 5
  scoreThreshold: 0.4
  tokenBudget: 2000
```

**Output includes:**
- Code snippets (up to 50 lines)
- Import statements
- File locations
- Relevance scores

---

### `dev_refs` - Relationship Queries

Understand code dependencies:

```
# What calls this function?
dev_refs:
  name: "validateUser"
  direction: "callers"

# What does this function call?
dev_refs:
  name: "processPayment"
  direction: "callees"

# Both directions
dev_refs:
  name: "AuthService"
  direction: "both"
```

**Use cases:**
- Impact analysis before refactoring
- Understanding code flow
- Finding entry points

---

### `dev_map` - Codebase Overview

Get a high-level view of the codebase:

```
# Basic map (depth 2)
dev_map

# Deeper exploration
dev_map:
  depth: 4

# Focus on specific directory
dev_map:
  focus: "src/api"
  depth: 3

# Include hot paths (most referenced files)
dev_map:
  includeHotPaths: true
  smartDepth: true

# Show change frequency (v0.4+)
dev_map:
  includeChangeFrequency: true
```

**Output shows:**
- Directory structure
- Component counts per directory
- Exported symbols with signatures
- Hot paths (frequently referenced files)
- Change frequency indicators (🔥 hot, ✏️ active, 📝 recent)

---

### `dev_patterns` - File Analysis

Inspect files and compare implementations:

```
# Compare similar implementations
dev_patterns:
  action: "compare"
  query: "src/utils/retry.ts"

# Validate pattern consistency (coming soon)
dev_patterns:
  action: "validate"
  query: "src/hooks/useAuth.ts"
```

---

### `dev_status` - Repository Status

Check indexing status:

```
dev_status

# Specific section
dev_status:
  section: "indexes"
```

---

### `dev_health` - Health Check

Diagnose issues:

```
dev_health

# Verbose output
dev_health:
  verbose: true
```

---

## Workflow Examples

### Starting a New Feature

1. **Understand the codebase:**
   ```
   dev_map: { depth: 3, includeHotPaths: true }
   ```

2. **Find related code:**
   ```
   dev_search: "similar feature implementation"
   ```

3. **Check what calls the area you'll modify:**
   ```
   dev_refs: { name: "TargetModule", direction: "callers" }
   ```

### Bug Investigation

1. **Search for the bug area:**
   ```
   dev_search: "error message from bug report"
   ```

2. **Trace the code path:**
   ```
   dev_refs: { name: "suspectFunction", direction: "callees" }
   ```

### Code Review Prep

1. **Understand the change area:**
   ```
   dev_map: { focus: "path/to/changed/dir", includeChangeFrequency: true }
   ```

2. **Check impact:**
   ```
   dev_refs: { name: "changedFunction", direction: "callers" }
   ```

---

## Tips

### Search Quality

- **Use natural language** - "how users are authenticated" not "authUser function"
- **Describe behavior** - "retry logic with exponential backoff"
- **Lower threshold for exploration** - `scoreThreshold: 0.3`

### Token Management

- Use `tokenBudget` to control output size
- `compact` format for quick lookups
- `verbose` format for deep dives

### Keeping Index Fresh

```bash
# After major changes
dev index

# Check health
dev_health
```

---

## CLI Examples

```bash
# Index everything
dev index

# Search code
dev search "authentication" --limit 5 --threshold 0.4

# View codebase map
dev map --depth 3
```

---

## Integration Patterns

### With Cursor

Cursor automatically detects workspace changes. Just:
1. `dev mcp install --cursor`
2. Restart Cursor
3. Use tools in chat

### With Claude Code

```bash
dev mcp install
# Tools available immediately
```

---

## Troubleshooting

### "No results found"

```bash
# Check status
dev_status

# Re-index
dev index
```

### "Repository not indexed"

```bash
dev index
dev mcp install --cursor
# Restart Cursor
```

### Slow responses

- Reduce `limit`
- Use `compact` format
- Check `dev_health`

---

**More help:** See [Troubleshooting Guide](../TROUBLESHOOTING.md)
