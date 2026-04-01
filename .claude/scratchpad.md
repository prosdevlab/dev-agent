# Scratchpad

## Known Limitations

- **`getDocsByFilePath` fetches all docs client-side (capped at 5k).** Uses `getAll(limit: 5000)` + exact path filter. Fine for single repos (dev-agent has ~2,200 docs). Won't scale to monorepos with 50k+ files. Future fix: server-side path filter in Antfly SDK.
- **Two clones of the same repo share one index.** Storage path is hashed from git remote URL (`prosdevlab/dev-agent` → `a1b2c3d4`). Two local clones on different branches share the same index, graph cache, and watcher snapshot. Stale data possible if branches diverge significantly. Pre-existing design — not introduced by graph cache. Fix would be to include branch or worktree path in the hash.

## Open Questions

- Can Antfly SDK support server-side path filtering? Would eliminate the 5k doc cap in `getDocsByFilePath`. Worth raising with Antfly team after MCP Phase 1 ships.

## Future Work

- Antfly SDK: server-side path filter for `getDocsByFilePath` (eliminates 5k cap)
- Betweenness centrality — identifies bridge files between subsystems. Worth adding if agents need refactoring guidance. graphology (MIT, 1.6k stars) is the upgrade path if we need more than 3 hand-rolled algorithms.
- **Connected components hub filtering** — widely-shared utility files (e.g., logger.ts imported by 50+ files) merge separate subsystems into one component. Filter out hub nodes (high in-degree) before computing components for better subsystem identification.
- **PageRank at 10k+ nodes** — convergence tolerance 1e-6 may require all 100 iterations for large sparse graphs. Monitor performance. Consider reducing maxIterations or loosening tolerance for dev_map where approximate ranks are fine.
- **getAll(limit: 10000) truncation** — medium-large monorepos may exceed 10k docs. Warning is logged but results are silently incomplete. Long-term: paginate or make limit configurable.
- E2E tests in CI — blocked on Antfly memory requirements vs GitHub runner limits (7GB)
- Vue/Svelte SFC support — `.vue`/`.svelte` files have embedded `<script lang="ts">` blocks. Would need script block extraction before tree-sitter parsing. Lower priority — co-located `.ts` files in those projects already get full analysis.
- Swap `WasmPatternMatcher` to `@ast-grep/napi` if bulk scanning perf becomes an issue (~4x faster native Rust). Interface is ready; implementation is mechanical.

## Flaky Tests

- **`packages/cli/src/commands/commands.test.ts:119` — "should display indexing summary without storage size"** times out at 30s on GitHub CI runners. The test indexes files and the slower CI runner can't finish in time. Needs either a higher timeout, a smaller test fixture, or mocking the indexer. Seen on PR #17 CI run.

## Test Gaps

- **InspectAdapter integration test with PatternMatcher.** The InspectAdapter test constructs without a `patternMatcher` — the AST path is never exercised through the MCP layer. Needs a test that constructs `InspectAdapter` with `createPatternMatcher()`, mocks the search service, calls `execute()`, and verifies AST-enhanced results flow through. Requires mock search service setup — larger integration test scope.

## Tech Debt


## Notes

- Both pattern analysis paths (index vs scan) must use the same pure extractors from 1.1 to avoid drift. Test this explicitly.
- Log which path is used (index vs scanner) at debug level so we can verify the fast path fires in production.
