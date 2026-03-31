# Scratchpad

## Known Limitations

- **`getDocsByFilePath` fetches all docs client-side (capped at 5k).** Uses `getAll(limit: 5000)` + exact path filter. Fine for single repos (dev-agent has ~2,200 docs). Won't scale to monorepos with 50k+ files. Future fix: server-side path filter in Antfly SDK.

## Open Questions

- Can Antfly SDK support server-side path filtering? Would eliminate the 5k doc cap in `getDocsByFilePath`. Worth raising with Antfly team after MCP Phase 1 ships.

## Future Work

- Antfly SDK: server-side path filter for `getDocsByFilePath` (eliminates 5k cap)
- `dev_patterns format: "json"` for token-efficient agent output (MCP Phase 1, Part 1.4)
- ast-grep as optional dep for pattern analysis (MCP Phase 1, Part 1.5)
- PageRank for `dev_map` hot paths (MCP Phase 1, Part 1.6)
- E2E tests in CI — blocked on Antfly memory requirements vs GitHub runner limits (7GB)

## Notes

- Both pattern analysis paths (index vs scan) must use the same pure extractors from 1.1 to avoid drift. Test this explicitly.
- Log which path is used (index vs scanner) at debug level so we can verify the fast path fires in production.
