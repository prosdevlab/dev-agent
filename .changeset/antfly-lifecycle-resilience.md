---
'@prosdevlab/dev-agent': minor
---

Antfly lifecycle resilience: graceful MCP startup, `dev doctor`, Podman support, captured startup logs

- **MCP server no longer dies when Antfly is down.** The stdio handshake completes immediately; backend init (Antfly auto-start, index load, watcher catchup) runs behind a gate. Tool calls wait for it, and a failed init returns a legible error pointing at `dev doctor` — with automatic retry on the next call once the backend is reachable.
- **New `dev doctor` command** diagnoses the stack from the CLI (install, server reachability, port conflicts, embedding model, repository index) — works when the MCP server itself can't start.
- **Podman support.** All container fallbacks detect Docker or Podman instead of assuming Docker.
- **Antfly startup output is captured** to `~/.antfly/antfly.log` (rotated at 5MB) instead of being discarded, so failed starts are diagnosable.
- **`dev search`, `dev refs`, and `dev map` auto-start the backend** like `dev index` already did.
- One shared lifecycle implementation in core replaces three divergent copies (CLI utils, MCP entry point, adapter registry) — the MCP copies were missing `--data-dir` and port-conflict detection.
