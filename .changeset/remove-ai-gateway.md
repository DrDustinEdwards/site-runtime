---
"@dustinedwards/site-runtime": minor
---

Removes `./ai-gateway` (`anthropicRoute`): no site or package calls it, and `./anthropic` has always called Anthropic directly. The 1.7.12 comments on Better Auth's behavior now name 1.7.25, which the dist and a run confirm.
