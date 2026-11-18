---
"@dustinedwards/site-runtime": minor
---

`./doc-room`: the suggest gate (`suggestOnly`) now refuses a suggester's change to anyone else's suggestions, not only one that makes them more. Before, a hand-built update could reword another person's pending insertion at the same length, and that person could then accept words they never wrote.

- Breaking: the room's `DocModel` takes `suggestions(json)`, each person's suggested content by id (compared as JSON), in place of `suggestionCounts(json)`. Pass Capsomer collab-editor's per-person suggestions (insertions and deletions with their text) once it exports them.
