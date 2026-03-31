# Phase 4: Python Language Support

**Status:** Draft

## Context

dev-agent currently supports TypeScript, JavaScript, Go, and Markdown. Python is the
#1 language for AI/ML engineers — the exact audience using MCP tools with Cursor and
Claude Code. A Python developer indexing their repo today gets only markdown and any
JS config files. Core `.py` files are invisible to search, refs, patterns, and map.

The tree-sitter infrastructure is already in place from MCP Phase 1:
- `web-tree-sitter` WASM runtime (bundled)
- `tree-sitter-python.wasm` already in `tree-sitter-wasms@0.1.13` (476KB)
- `PatternMatcher` interface accepts any tree-sitter language
- Scanner registry pattern (`GoScanner` as reference implementation)

### What Python developers use

| Framework | What to extract |
|-----------|----------------|
| **FastAPI / Flask / Django** | Route decorators, view functions, middleware |
| **pytest** | Test functions (`test_*`), fixtures (`@pytest.fixture`) |
| **Pydantic / dataclasses** | Model classes, field definitions |
| **SQLAlchemy / Django ORM** | Model classes, relationships |
| **Click / Typer** | CLI commands |
| **General** | Functions, classes, methods, imports, type hints, docstrings |

The scanner needs to handle all of these via the common Python AST — we don't
need framework-specific logic. Functions, classes, methods, decorators, and
imports cover everything.

---

## What we're building

```
┌──────────────────────────────────────────────────────────┐
│                   PythonScanner                          │
│                                                          │
│   Implements Scanner interface (same as GoScanner)       │
│                                                          │
│   tree-sitter-python.wasm                                │
│        │                                                 │
│        ▼                                                 │
│   Parse .py files → AST                                  │
│        │                                                 │
│        ▼                                                 │
│   PYTHON_QUERIES (S-expression patterns)                 │
│   ┌─────────────────────────────────────┐                │
│   │ functions    → function_definition  │                │
│   │ methods      → function_definition  │                │
│   │              inside class body      │                │
│   │ classes      → class_definition     │                │
│   │ imports      → import_statement     │                │
│   │              + import_from_statement│                │
│   │ decorators   → decorated_definition │                │
│   │ module_vars  → assignment at top    │                │
│   └─────────────────────────────────────┘                │
│        │                                                 │
│        ▼                                                 │
│   Document[] (same shape as Go/TS scanners)              │
│   - id, text, type, language: 'python'                   │
│   - metadata: name, signature, exported, docstring,      │
│     callees, isAsync, imports                             │
└──────────────────────────────────────────────────────────┘
```

### Integration with existing tools

```
Scanner Registry
  ├── TypeScriptScanner  (.ts, .tsx, .js, .jsx)  ← ts-morph
  ├── GoScanner          (.go)                    ← tree-sitter
  ├── MarkdownScanner    (.md)                    ← remark
  └── PythonScanner      (.py)                    ← tree-sitter (NEW)

All MCP tools work automatically:
  dev_search  → Python code searchable by meaning
  dev_refs    → Python call graph (callees from AST)
  dev_map     → Python files in hot paths + components
  dev_patterns → Python patterns via AST queries (error handling, imports, types)
  dev_status  → Python file count in stats
```

### What we DON'T need to build

- **No new MCP tools** — existing tools work with any language
- **No Python-specific pattern rules** (for now) — the 12 JS/TS rules don't apply,
  but error handling (try/except) and import analysis work via regex fallback
- **No framework-specific logic** — decorators, dataclasses, etc. are extracted
  as generic AST patterns. The AI agent interprets them.

---

## Python-specific considerations

### Public vs private

Python uses naming conventions, not keywords:
- `_private` — single underscore prefix = private by convention
- `__mangled` — double underscore = name-mangled (very private)
- No underscore = public
- `__all__` — explicit public API list (if present, overrides convention)

The scanner should:
- Mark functions/classes without `_` prefix as `exported: true`
- If `__all__` is defined at module level, use that instead

### Docstrings

Python docstrings are the first expression statement in a function/class body:
```python
def foo():
    """This is the docstring."""  # expression_statement > string
    pass
```

Tree-sitter node path: `function_definition > body > block > expression_statement > string`

### Callees extraction

Python function calls are `call` nodes with `function` field:
```python
result = db.query(User)  # call > function: attribute (db.query)
foo()                     # call > function: identifier (foo)
```

For cross-file resolution, we need to map imports to file paths. This is harder
than Go (where the package system is explicit) but we can do basic resolution:
- `from .models import User` → `models.py` in same package
- `import os` → stdlib (skip)
- `from myproject.db import query` → `myproject/db.py`

For Phase 4, we extract callees with names but **don't resolve file paths** for
cross-file references. This matches how the TypeScript scanner works (callees
have `name` but `file` is optional). `dev_refs` will show callers/callees by
name; cross-file resolution is a future enhancement.

### Async functions

Python `async def` maps to a `function_definition` with an `async` keyword token
as a sibling. The scanner should set `metadata.isAsync = true`.

### Type hints

Python 3 type annotations appear in the AST:
- Parameters: `typed_parameter` nodes with `type` field
- Return type: `function_definition` has `return_type` field
- Variable annotations: `type` field on assignment

The signature should include type hints for search quality:
```
def get_user(user_id: int) -> User
```

---

## Parts

| Part | Description | Risk |
|------|-------------|------|
| [4.1](./4.1-bundle-wasm-queries.md) | Bundle Python WASM, define queries, register language | Low — config + constants |
| [4.2](./4.2-python-scanner.md) | Implement PythonScanner with full extraction | Medium — main implementation |
| [4.3](./4.3-pattern-rules.md) | Add Python-specific pattern rules for dev_patterns | Low — S-expression constants |
| [4.4](./4.4-test-fixtures.md) | Test fixtures, integration tests, documentation | Low — validation |

---

## Decisions

| Decision | Rationale | Alternatives |
|----------|-----------|-------------|
| tree-sitter WASM, not AST module | Matches Go scanner pattern. WASM already bundled. 476KB. | `ast` module via Python subprocess: slower, requires Python installed |
| No cross-file callee resolution | Complex (import resolution varies by project). Name-based callees are useful enough. | Full resolution: needs import graph, virtual env analysis |
| `__all__` overrides `_` convention | Explicit is better than implicit (Python zen). | Ignore `__all__`: simpler but less accurate |
| No framework-specific extraction | Decorators and class patterns are generic. AI agent interprets. | Flask/Django extractors: high maintenance, low marginal value |
| `exported: true` for non-underscore names | Matches Python community convention. | Always true: loses signal. Always false: wrong. |
| Pattern rules in Phase 4.3 (not 4.2) | Scanner works without patterns. Patterns are additive. | All-in-one: larger PR, harder to review |

---

## Risk register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Python AST edge cases (walrus operator, match/case, PEP 695 type params) | Medium | Low | tree-sitter-python handles all modern syntax. Tests cover edge cases. |
| Large Python repos (Django, Flask projects with thousands of files) | Medium | Medium | Scanner is file-at-a-time, same as Go. No global state. |
| Import resolution too simplistic | High | Low | Phase 4 doesn't resolve imports to files. Just extracts names. Future work. |
| `__all__` parsing complexity | Low | Low | Only check for simple list literal. Complex `__all__` (computed) → fall back to `_` convention. |
| Python 2 syntax | Low | None | tree-sitter-python supports Python 2 syntax. We don't need to special-case. |
| Decorator extraction too verbose | Medium | Low | Only extract decorator name, not arguments. Keeps documents focused. |
| Generated files indexed (protobuf stubs, migrations) | Medium | Low | Skip `_pb2.py`, `_pb2_grpc.py`, files with `# Generated by` header. |
| `isTestFile` doesn't recognize Python conventions | High | Medium | Update utility to handle `test_*.py`, `*_test.py`, `conftest.py`. |
| `WasmPatternMatcher` rejects `'python'` language | High | High | Add `'python'` to both `EXTENSION_TO_LANGUAGE` and hardcoded `supportedLanguages` set. |

---

## Test strategy

| Test | Priority | What it verifies |
|------|----------|-----------------|
| Extract functions with type hints | P0 | Core scanner functionality |
| Extract classes with methods | P0 | Class + method detection |
| Extract imports (import, from...import) | P0 | Import extraction |
| Extract decorated functions | P0 | Decorator handling |
| Extract async functions | P0 | isAsync flag |
| Extract docstrings | P0 | First-expression docstring detection |
| Public/private via `_` convention | P0 | exported flag |
| `__all__` overrides convention | P1 | Explicit API |
| Extract callees from function bodies | P1 | Call graph |
| Scan real Python project (fixture) | P1 | Integration |
| Pattern rules: try/except | P0 | Error handling detection |
| Pattern rules: import style | P0 | Import analysis |
| Pattern rules: type hint coverage | P0 | Type annotation detection |
| Snippet field on every Document | P0 | Search result previews |
| isTestFile recognizes test_*.py, conftest.py | P0 | Test detection |
| Skip _pb2.py generated files | P1 | Noise reduction |
| WasmPatternMatcher accepts 'python' | P0 | Pattern analysis works |
| Dataclass fixture extracted correctly | P1 | Common Python pattern |
| __init__.py re-exports and __all__ | P1 | Package API |
| Nested functions intentionally excluded | P1 | Scope boundary |
| dev_search finds Python code | P1 | End-to-end via Antfly |
| dev_refs shows Python callers/callees | P1 | End-to-end |
| dev_map includes Python in hot paths | P1 | End-to-end |

---

## Verification checklist

- [ ] `tree-sitter-python.wasm` bundled in dist
- [ ] `parseCode('def foo(): pass', 'python')` works
- [ ] `PythonScanner.scan()` extracts functions, classes, methods, imports
- [ ] Docstrings extracted from function/class bodies
- [ ] `exported: true` for non-underscore names
- [ ] `isAsync: true` for `async def` functions
- [ ] Signatures include type hints
- [ ] Callees extracted from function call nodes
- [ ] Pattern rules detect try/except, import style, type hints
- [ ] `WasmPatternMatcher` accepts `'python'` language (not silently rejected)
- [ ] `isTestFile()` recognizes `test_*.py`, `*_test.py`, `conftest.py`
- [ ] Generated files (`_pb2.py`) skipped
- [ ] Snippet field populated on every Document
- [ ] Test fixtures cover real Python patterns (FastAPI, pytest, dataclass, __init__.py)
- [ ] `pnpm build && pnpm test` passes
- [ ] `dev index` on a Python repo produces searchable documents
- [ ] `dev_search "authentication"` finds Python code

---

## Dependencies

- MCP Phase 1 (tree-sitter infrastructure) — merged
- `tree-sitter-python.wasm` in `tree-sitter-wasms@0.1.13` — confirmed (476KB)
- Scanner registry pattern — established by GoScanner
