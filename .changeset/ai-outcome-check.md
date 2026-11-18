---
"@dustinedwards/site-runtime": minor
---

`./health` gains `recordAiOutcome(kv, feature, result)` and `aiOutcomeCheck(feature, kv)`: the `ai-<feature>` warn check shows an AI feature whose last real call failed (a spend cap, a revoked key, a removed model) until a call succeeds or a day passes, while `aiCheck` still only proves the binding. It runs no model.
