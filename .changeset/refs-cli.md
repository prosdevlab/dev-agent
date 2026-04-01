---
'@prosdevlab/dev-agent': patch
---

Add `dev refs` CLI command and fix callee path normalization

- New `dev refs <name>` command: find callers and callees from the terminal
  - `--direction callees|callers|both` to filter results
  - `--depends-on <file>` to trace dependency paths
  - `--json` for machine-readable output
- Normalize callee file paths: `dist/` → `src/`, `.d.ts` → `.ts`, absolute → relative
- Fix hot paths showing build output (`packages/logger/dist/types.d.ts` → `packages/logger/src/types.ts`)
- Fix indexer passing empty exclude array (was bypassing scanner default exclusions)
