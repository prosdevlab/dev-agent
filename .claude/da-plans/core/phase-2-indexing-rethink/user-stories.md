# User Stories: Indexing & Search Flow

## Setup

**US-1: First-time setup**
As a developer installing dev-agent for the first time,
when I run `dev setup`,
I should have a working search backend with zero knowledge of Antfly,
so that I can immediately start indexing.

**US-2: Team onboarding**
As a developer joining a team that uses dev-agent,
when I clone the repo and run `dev setup && dev index .`,
I should have full search working within minutes,
so that I don't need to read docs to get started.

## Indexing

**US-3: First index**
As a developer with a new codebase,
when I run `dev index .`,
I should see clear progress and have searchable code when it completes,
so that I can immediately ask my AI tools about the codebase.

**US-4: Ongoing development**
As a developer actively writing code,
when I save files and switch to my AI tool,
my recent changes should be searchable without running any command,
so that the AI always has current context.

**US-5: Coming back to a project**
As a developer returning to a project after days/weeks,
when I run `dev index .` again,
it should only process what changed (fast incremental),
so that I'm not waiting for a full re-index.

**US-6: Large codebase**
As a developer on a monorepo with 10k+ files,
when I run `dev index .`,
it should complete in reasonable time with clear progress,
so that I know it's working and can estimate when it'll finish.

**US-7: Force re-index**
As a developer who changed embedding models or suspects stale data,
when I run `dev index . --force`,
it should clear everything and rebuild from scratch,
so that I have a clean, consistent index.

## Search

**US-8: Find code by concept**
As a developer asking "where do we handle authentication?",
when my AI tool calls `dev_search`,
I should get the actual auth functions ranked by relevance (not just file paths),
so that the AI can read and reason about the right code.

**US-9: Find code by exact name**
As a developer asking "find the validateUser function",
when my AI tool calls `dev_search`,
the exact function should be the top result (BM25 keyword match),
so that exact lookups are instant and precise.

**US-10: Search git history**
As a developer asking "when did we add rate limiting?",
when my AI tool calls `dev_history`,
I should get relevant commits with context,
so that the AI understands the evolution of the code.

**US-11: Search GitHub issues**
As a developer asking "what bugs are open about search?",
when my AI tool calls `dev_gh`,
I should get matching issues/PRs,
so that the AI can reference project context.

## Lifecycle

**US-12: No babysitting**
As a developer using dev-agent day-to-day,
I should never need to think about Antfly, servers, or background processes,
so that dev-agent feels like a native part of my workflow.

**US-13: Transparent status**
As a developer unsure if my index is current,
when I run `dev status`,
I should see what's indexed, when it was last updated, and if anything is stale,
so that I can trust the search results.

**US-14: Clean uninstall**
As a developer removing dev-agent,
when I run `dev clean --all`,
it should remove all indexed data, Antfly containers, and config,
so that nothing is left behind.

## Multi-project

**US-15: Multiple repos**
As a developer working across several repositories,
each repo should have its own index that doesn't interfere with others,
so that search results are scoped to the right project.

**US-16: Workspace switching**
As a developer switching between projects in Cursor,
dev-agent should automatically use the right index for the current workspace,
so that I don't need to re-configure anything.
