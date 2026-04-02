---
"@prosdevlab/dev-agent": patch
---

Remove misleading similarity scores from MCP search results. Search output now shows ranked results without percentages, matching industry practice (Sourcegraph Cody, Cursor, GitHub Copilot). Also fixes dev_refs failing to find symbols due to SearchService defaulting scoreThreshold to 0.7 which silently filtered all RRF results.
