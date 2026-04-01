---
'@prosdevlab/dev-agent': minor
---

Python language support

- Index Python codebases: functions, classes, methods, imports, decorators, type hints, docstrings
- `__all__` controls export detection, `_` prefix convention as fallback
- Async function detection, callee extraction, code snippets
- Pattern analysis: try/except, import style, type coverage via tree-sitter queries
- Skip generated files (_pb2.py, migrations)
- `isTestFile()` refactored to language-aware pattern map (test_*.py, *_test.py, conftest.py)
- All MCP tools (dev_search, dev_refs, dev_map, dev_patterns, dev_status) work with Python automatically
