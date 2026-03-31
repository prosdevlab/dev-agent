---
"@prosdevlab/dev-agent": patch
---

Fix `dev setup` reporting model ready while `dev index` fails with "model not found". The CLI's `hasModel`/`pullModel` used `~/.termite/models` but the running server looked in `~/.antfly/models`. Both now use a shared `--models-dir` pointing at the server's data directory.
