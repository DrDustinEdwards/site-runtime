import assert from "node:assert/strict";
import test from "node:test";

import { directSessionReads } from "../session-check.mjs";

test("directSessionReads flags a getSession call written by hand and passes sessionLookup and comments", () => {
  const source = [
    "const ok = await auth.api.getSession(sessionLookup(request));", // 1
    "const bad = await (await getAuth(env)).api.getSession({ headers: request.headers, request });", // 2
    "// auth.api.getSession({ headers }) in a comment", // 3
    'fetch("https://example.com/x"); const also = await auth.api', // 4
    "  .getSession({", // 5
    "    headers,", // 6
    "  });", // 7
    "/* api.getSession({ headers }) */ const client = await authClient.getSession();", // 8
  ].join("\n");
  assert.deepEqual(directSessionReads(source), [2, 4]);
});
