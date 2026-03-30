---
"@prosdevlab/dev-agent-core": minor
"@prosdevlab/dev-agent-cli": minor
"@prosdevlab/dev-agent": minor
---

Replace LanceDB + @xenova/transformers with Antfly for hybrid search

- **Hybrid search**: `dev_search` now uses BM25 + vector + RRF fusion — exact keyword matches AND semantic understanding in one query
- **New command**: `dev setup` handles search backend installation (Docker-first, native fallback)
- **Auto-embedding**: Antfly generates embeddings locally via Termite — no separate embedding pipeline
- **Direct key lookup**: Replaces O(n) zero-vector scan with instant key fetch
- **Breaking**: Requires Antfly server running (`dev setup` handles this). Existing LanceDB indexes are not migrated — run `dev index . --force` to rebuild.
