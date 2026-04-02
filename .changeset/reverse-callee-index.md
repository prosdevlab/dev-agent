---
"@prosdevlab/dev-agent": patch
---

Add reverse callee index to dev_refs — callers now work. Previously "No callers found" for every function because caller detection relied on semantic search (returned similar concepts, not call sites). Now uses a persisted reverse index with 4,000+ caller entries, compound keys for O(1) lookup, and class-level aggregation.
