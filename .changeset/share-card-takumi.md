---
"@dustinedwards/site-runtime": minor
---

Share cards no longer use workers-og. workers-og pins satori 0.15.2 and bundles its own copy, which carries GHSA-wx4j-mvgx-mqwp (fixed in satori 0.33.5), so a lockfile bump changed nothing, and satori 0.33.5 and later cannot run on Workers (their harfbuzz WASM is compiled from bytes, which Workers refuse). `./share-card-draw` now exports `drawShareCard`, Takumi's WebAssembly renderer (takumi-js 2.20.0), which reads the card's HTML itself. `renderShareCard` and `shareCardResponse` take it as their first argument in place of workers-og's `ImageResponse` class: a site imports `drawShareCard` from `@dustinedwards/site-runtime/share-card-draw`, passes it, and drops workers-og from its dependencies. Needs a bundler that compiles a `.wasm` import (wrangler and the Cloudflare Vite plugin do). Takumi decodes entities, so "&amp;" in card text now draws as "&".
