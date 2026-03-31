# Scratchpad

## Known Limitations

- **`getDocsByFilePath` fetches all docs client-side (capped at 5k).** Uses `getAll(limit: 5000)` + exact path filter. Fine for single repos (dev-agent has ~2,200 docs). Won't scale to monorepos with 50k+ files. Future fix: server-side path filter in Antfly SDK.

## Open Questions

- Can Antfly SDK support server-side path filtering? Would eliminate the 5k doc cap in `getDocsByFilePath`. Worth raising with Antfly team after MCP Phase 1 ships.

## Future Work

- Antfly SDK: server-side path filter for `getDocsByFilePath` (eliminates 5k cap)
- Wire `shortestPath` into `dev_refs` as a "trace path" feature (graph.ts is ready, adapter wiring is separate scope)
- Wire `connectedComponents` into `dev_map` verbose output (graph.ts is ready)
- Betweenness centrality — identifies bridge files between subsystems. Worth adding if agents need refactoring guidance. graphology (MIT, 1.6k stars) is the upgrade path if we need more than 3 hand-rolled algorithms.
- E2E tests in CI — blocked on Antfly memory requirements vs GitHub runner limits (7GB)
- **Python language support** — tree-sitter-python WASM is ~300KB, already in tree-sitter-wasms. Needs a Python scanner (document extraction) + Python-specific pattern rules. High demand — large ecosystem. Worth a standalone plan covering: scanner, pattern rules, test fixtures, indexer integration. The PatternMatcher interface from 1.5 is language-agnostic so pattern rules slot right in; the scanner is the real work.
- Vue/Svelte SFC support — `.vue`/`.svelte` files have embedded `<script lang="ts">` blocks. Would need script block extraction before tree-sitter parsing. Lower priority — co-located `.ts` files in those projects already get full analysis.
- Swap `WasmPatternMatcher` to `@ast-grep/napi` if bulk scanning perf becomes an issue (~4x faster native Rust). Interface is ready; implementation is mechanical.

## Flaky Tests

- **`packages/cli/src/commands/commands.test.ts:119` — "should display indexing summary without storage size"** times out at 30s on GitHub CI runners. The test indexes files and the slower CI runner can't finish in time. Needs either a higher timeout, a smaller test fixture, or mocking the indexer. Seen on PR #17 CI run.

## Test Gaps

- **InspectAdapter integration test with PatternMatcher.** The InspectAdapter test constructs without a `patternMatcher` — the AST path is never exercised through the MCP layer. Needs a test that constructs `InspectAdapter` with `createPatternMatcher()`, mocks the search service, calls `execute()`, and verifies AST-enhanced results flow through. Requires mock search service setup — larger integration test scope.

## Notes

- Both pattern analysis paths (index vs scan) must use the same pure extractors from 1.1 to avoid drift. Test this explicitly.
- Log which path is used (index vs scanner) at debug level so we can verify the fast path fires in production.
