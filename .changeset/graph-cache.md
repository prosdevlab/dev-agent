---
'@prosdevlab/dev-agent': patch
---

Cached dependency graph for scale

- Dependency graph built at index time and saved as JSON — `dev_map` and `dev_refs` no longer fetch all docs via `getAll`
- Incremental graph updates via file watcher (O(changed files), not O(all files))
- Graceful fallback to current approach if cache is missing or corrupted
- Raises effective doc limit from 10k to 50k for graph operations
