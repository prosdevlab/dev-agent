---
'@prosdevlab/dev-agent': patch
---

MCP tools improvement: faster pattern analysis, merged health into status, agent usability

- `dev_patterns` is 10-30x faster — reads from Antfly index instead of re-scanning with ts-morph
- `dev_health` merged into `dev_status` (use `section="health"`) — 6 tools reduced to 5
- `dev_patterns` parameter renamed from `query` to `filePath` to prevent LLM misuse
- New `format: "json"` option on `dev_patterns` for token-efficient agent workflows
- All tools now return `suggestion` field on errors for agent recovery guidance
- Removed stale GitHub code from health adapter
- Extracted pure pattern analyzers for testability
