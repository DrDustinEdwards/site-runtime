// Starting a routine. PLANT tests fail if the guard they name is removed.
import assert from "node:assert/strict";
import { test } from "node:test";

import { fireRoutine, routineConfig } from "../routine.mjs";

const URL_OK = "https://api.anthropic.com/v1/claude_code/routines/trig_01AbCdEfGh/fire";

test("PLANT: the token is only ever paired with Anthropic's fire URL", () => {
  for (const bad of ["https://example.com/v1/claude_code/routines/trig_01AbCdEfGh/fire", "http://api.anthropic.com/v1/claude_code/routines/trig_01AbCdEfGh/fire", URL_OK.replace("/fire", "")]) {
    assert.ok("missing" in routineConfig(bad, "tok"), bad);
  }
  assert.ok("missing" in routineConfig(URL_OK, " "));
  assert.deepEqual(routineConfig(` ${URL_OK} `, " tok "), { url: URL_OK, token: "tok" });
});

test("a fire sends the documented headers and body, and reads the session, the limit and a refusal", async () => {
  let seen;
  const answer = (status, body) => async (url, init) => ((seen = { url, init }), new Response(JSON.stringify(body), { status }));
  const config = { url: URL_OK, token: "tok" };
  assert.deepEqual(await fireRoutine(config, "x".repeat(70_000), answer(200, { claude_code_session_url: "https://claude.ai/code/session_01abc" })), { ok: true, sessionUrl: "https://claude.ai/code/session_01abc" });
  assert.equal(seen.init.headers.Authorization, "Bearer tok");
  assert.equal(seen.init.headers["anthropic-version"], "2023-06-01");
  assert.equal(JSON.parse(seen.init.body).text.length, 65_536);
  assert.deepEqual(await fireRoutine(config, "t", answer(429, { error: { type: "rate_limit_error" } })), { ok: false, retry: true, error: "429 rate_limit_error" });
  assert.deepEqual(await fireRoutine(config, "t", answer(401, {})), { ok: false, retry: false, error: "401" });
  assert.equal((await fireRoutine(config, "t", async () => { throw new Error("down"); })).retry, true);
});
