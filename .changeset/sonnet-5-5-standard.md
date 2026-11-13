---
"@dustinedwards/site-runtime": minor
---

`MODEL_IDS.standard` is now `claude-sonnet-5-5` (was `claude-sonnet-5`): same $2 input and $10 output per MTok, cache reads half the price ($0.10). `MODELS` gains `claude-sonnet-5-5` (active, not retired before 2027-09-28, 512-token cache minimum) and `PRICES` its row, both checked against Anthropic's deprecations, prompt-caching and pricing pages on 2026-11-13.
