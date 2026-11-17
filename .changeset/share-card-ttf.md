---
"@dustinedwards/site-runtime": patch
---

`googleFont` fetches TTF, not WOFF. Takumi, which draws the share cards since 0.164.0, rejects the WOFF Google serves to an old Internet Explorer User-Agent ("Unsupported font format"); the "Mozilla/4.0" User-Agent gets one TTF with every glyph. The cached copy is keyed `<family>-<weight>.ttf`, so a WOFF kept under the old `.font` key is never read.
