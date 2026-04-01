---
'@prosdevlab/dev-agent': minor
---

Go callee extraction and Rust language support

- Rust: full scanner — functions, structs, enums, traits, impl methods, imports, callees, doc comments
- Rust: pattern rules — try operator, match expression, unsafe block, impl/trait definitions
- Go: callee extraction for functions and methods — dev_refs now traces Go call chains
- Go: pattern rules — error handling (if err != nil), goroutines, defer, channels
- Generic impl type parameter stripping (Container<T>.show → Container.show)
- All MCP tools (dev_search, dev_refs, dev_map, dev_patterns) work with Go callees and Rust
