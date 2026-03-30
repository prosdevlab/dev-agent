# User Stories: MCP Tools Improvement

## Pattern Analysis

**US-1: Fast pattern analysis during code review**
As a developer reviewing a pull request,
when my AI tool calls `dev_patterns` on a changed file,
I should get results in under 200ms (not 1-3 seconds),
so that the code review doesn't stall waiting for pattern analysis.

**US-2: Pattern analysis on large repos**
As a developer on a monorepo with 10k+ files,
when my AI tool calls `dev_patterns`,
it should not fetch the entire index into memory,
so that the MCP server stays responsive.

**US-3: Consistent pattern analysis without re-scanning**
As a developer editing files rapidly,
when my AI tool calls `dev_patterns` on a file I just saved,
it should use the already-indexed metadata (not re-parse from disk),
so that results reflect the indexed state without redundant work.

> **Note:** Line count and error handling analysis still read from disk since this
> data isn't in the index. Type coverage and import style use indexed metadata.
> Documented trade-off in the decisions table.

**US-4: Pattern analysis without Antfly**
As a developer running tests or in CI,
when `dev_patterns` is called without a live Antfly server,
it should fall back to scanning files directly,
so that tests and offline usage still work.

## Agent Usability

**US-5: AI knows which tool to use**
As a developer asking "check this file for consistency,"
when my AI tool reads the MCP tool descriptions,
it should immediately know to call `dev_patterns` (not `dev_search`),
so that it picks the right tool without trial and error.

**US-6: AI doesn't call removed tools**
As a developer with dev-agent installed,
when my AI tool lists available tools,
it should only see the current tools (no stale references to removed ones),
so that it doesn't waste turns calling tools that don't exist.

> **Note:** US-6 is already resolved by the docs sweep in `fix/stale-docs-cleanup`.

**US-7: Accurate health reporting**
As a developer asking "is dev-agent working?",
when my AI tool calls a health/status tool,
the response should reflect the actual system (no GitHub references),
so that the output is trustworthy.

**US-8: AI doesn't confuse overlapping tools**
As a developer asking "what's the status of dev-agent?",
when my AI tool sees `dev_status` and `dev_health` in the tool list,
it should not have to guess which one to call,
so that it gets the right answer on the first try.

**US-9: Token-efficient responses**
As a developer in a long conversation,
when my AI tool calls `dev_patterns`,
the response should be structured and compact (not verbose markdown),
so that the AI has room in its context for actual work.

**US-10: AI recovers from errors**
As a developer whose Antfly server crashed,
when my AI tool calls any dev-agent tool and gets an error,
the error should tell the AI exactly what to do next,
so that it can recover without human intervention.

## Analysis Quality

**US-11: Accurate pattern detection**
As a developer running `dev_patterns` on a file with try/catch, .catch(), and async error handling,
the tool should detect all these patterns (not just throw statements),
so that the pattern analysis is trustworthy for code review decisions.

**US-12: Meaningful file importance in codebase map**
As a developer exploring an unfamiliar codebase via `dev_map`,
the hot paths should show architecturally central files (not just frequently imported ones),
so that I understand which files are the critical connective tissue of the codebase.
