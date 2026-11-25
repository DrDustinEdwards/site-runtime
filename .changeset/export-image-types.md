---
"@dustinedwards/site-runtime": patch
---

`ImagesLike`, `ImagesOutput` and `R2ObjectLike` are exported from `./image`. `defineImages` returns them, and a project with a composite tsconfig failed to typecheck (TS2883) when it kept the result.
