# Scratchpad

## Known Limitations

- **`getDocsByFilePath` fetches all docs client-side (capped at 5k).** Uses `getAll(limit: 5000)` + exact path filter. Fine for single repos (dev-agent has ~2,200 docs). Won't scale to monorepos with 50k+ files. Future fix: server-side path filter in Antfly SDK.

## Open Questions

- Can Antfly SDK support server-side path filtering? Would eliminate the 5k doc cap in `getDocsByFilePath`. Worth raising with Antfly team after MCP Phase 1 ships.

## Future Work

- Antfly SDK: server-side path filter for `getDocsByFilePath` (eliminates 5k cap)
- PageRank for `dev_map` hot paths (MCP Phase 1, Part 1.6)
- E2E tests in CI — blocked on Antfly memory requirements vs GitHub runner limits (7GB)
- **Python language support** — tree-sitter-python WASM is ~300KB, already in tree-sitter-wasms. Needs a Python scanner (document extraction) + Python-specific pattern rules. High demand — large ecosystem. Worth a standalone plan covering: scanner, pattern rules, test fixtures, indexer integration. The PatternMatcher interface from 1.5 is language-agnostic so pattern rules slot right in; the scanner is the real work.
- Vue/Svelte SFC support — `.vue`/`.svelte` files have embedded `<script lang="ts">` blocks. Would need script block extraction before tree-sitter parsing. Lower priority — co-located `.ts` files in those projects already get full analysis.
- Swap `WasmPatternMatcher` to `@ast-grep/napi` if bulk scanning perf becomes an issue (~4x faster native Rust). Interface is ready; implementation is mechanical.

## Notes

- Both pattern analysis paths (index vs scan) must use the same pure extractors from 1.1 to avoid drift. Test this explicitly.
- Log which path is used (index vs scanner) at debug level so we can verify the fast path fires in production.
