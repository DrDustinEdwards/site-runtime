---
"@dustinedwards/site-runtime": patch
---

`./sri` finds an `import()` whose specifier is a template literal, as Vite's minifier writes it, so those chunks get their modulepreload with integrity too. Before, Capsomer's site-header-search chunk had none and Integrity-Policy would have blocked it.
