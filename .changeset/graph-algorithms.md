---
'@prosdevlab/dev-agent': patch
---

Graph algorithms for dev_map and dev_refs

- `dev_map` hot paths now use PageRank over the weighted dependency graph — files depended on by other important files rank higher
- `dev_map` shows connected subsystems ("Subsystems: packages/core (45 files), packages/cli (12 files)")
- `dev_refs` new `traceTo` parameter traces the dependency chain between files through the call graph
- All algorithms are hand-rolled pure functions (~230 lines), no new dependencies
- Inspired by aider's repo map (PageRank over dependency graphs)
