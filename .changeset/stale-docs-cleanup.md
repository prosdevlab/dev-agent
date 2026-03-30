---
"@prosdevlab/dev-agent": patch
---

### Docs Cleanup & Tool Refinements

**CLI:**
- Removed `dev explore` — merged `--similar-to` flag into `dev search`
- Search threshold default changed from 0.7 to 0 (RRF scores are much lower than cosine similarity)

**MCP Tools:**
- Renamed `dev_inspect` → `dev_patterns` (focused on pattern analysis)
- Removed `threshold` parameter from `dev_patterns`
- Removed 3 prompts: `analyze-issue`, `search-github`, `create-plan`

**Scanner:**
- Extended default exclusions: `.env*`, `*.min.js`, `*.d.ts`, `generated/`, `.terraform/`, `.claude/`, `*.wasm`, `public/`, `static/`
