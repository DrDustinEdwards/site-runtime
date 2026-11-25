---
"@dustinedwards/site-runtime": patch
---

Tidy-up with no change to what any export does. `./prose`'s voice measure now lives in its own module, `prose-voice.mjs`, which `./prose` re-exports. The registry lookups `siteEntry`, `siteForOrigin` and `siteOverrides` are gone from the unexported sites.mjs (the `./sites` export keeps them). The image audit's file reader moved to bin/image-file.mjs. History notes are cut from comments.
