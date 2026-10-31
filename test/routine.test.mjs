// Starting a routine. PLANT tests fail if the guard they name is removed.
import assert from "node:assert/strict";
import { test } from "node:test";

import { DatabaseSync } from "node:sqlite";

import { ROUTINE_FIRES_SQL, d1FireStore, fireOnce, fireRoutine, routineConfig } from "../routine.mjs";

const URL_OK = "https://api.anthropic.com/v1/claude_code/routines/trig_01AbCdEfGh/fire";
const config = { url: URL_OK, token: "tok", routineId: "trig_01AbCdEfGh" };
const STARTED = { type: "routine_fire", claude_code_session_id: "session_01abcdefgh", claude_code_session_url: "https://claude.ai/code/session_01abcdefgh" };
const answer = (status, body, headers = {}) => async () => new Response(JSON.stringify(body), { status, headers });

test("PLANT: the token is only ever paired with Anthropic's fire URL", () => {
  for (const bad of ["https://example.com/v1/claude_code/routines/trig_01AbCdEfGh/fire", "http://api.anthropic.com/v1/claude_code/routines/trig_01AbCdEfGh/fire", URL_OK.replace("/fire", "")]) {
    assert.ok("missing" in routineConfig(bad, "tok"), bad);
  }
  assert.ok("missing" in routineConfig(URL_OK, " "));
  assert.deepEqual(routineConfig(` ${URL_OK} `, " tok "), config);
});

test("a fire sends the documented headers and body, and reads the session, the limit and a refusal", async () => {
  let seen;
  const fetcher = async (url, init) => ((seen = { url, init }), new Response(JSON.stringify(STARTED), { status: 200 }));
  assert.deepEqual(await fireRoutine(config, "x".repeat(70_000), fetcher), { ok: true, outcome: "started", status: 200, sessionId: "session_01abcdefgh", sessionUrl: "https://claude.ai/code/session_01abcdefgh" });
  assert.equal(seen.init.headers.Authorization, "Bearer tok");
  assert.equal(seen.init.headers["anthropic-version"], "2023-06-01");
  assert.equal(JSON.parse(seen.init.body).text.length, 65_536);
  assert.deepEqual(await fireRoutine(config, "t", answer(401, {})), { ok: false, outcome: "refused", retry: false, status: 401, error: "401" });
});

test("429 carries Retry-After as seconds, from a number or a date, and 503 overloaded is retried", async () => {
  const limited = await fireRoutine(config, "t", answer(429, { error: { type: "rate_limit_error" } }, { "Retry-After": "120" }));
  assert.deepEqual(limited, { ok: false, outcome: "rate_limited", retry: true, status: 429, error: "429 rate_limit_error", retryAfter: 120 });
  const date = new Date(Date.now() + 90_000).toUTCString();
  const fromDate = await fireRoutine(config, "t", answer(429, {}, { "Retry-After": date }));
  assert.ok(fromDate.retryAfter >= 88 && fromDate.retryAfter <= 91, String(fromDate.retryAfter));
  assert.equal("retryAfter" in (await fireRoutine(config, "t", answer(429, {}, { "Retry-After": "soon" }))), false);
  const overloaded = await fireRoutine(config, "t", answer(503, { error: { type: "overloaded_error" } }));
  assert.deepEqual(overloaded, { ok: false, outcome: "unavailable", retry: true, status: 503, error: "503 overloaded_error" });
});

test("PLANT: a fire that may have reached Anthropic is unknown, never retried; only a connection never made is", async () => {
  const timeout = await fireRoutine(config, "t", async () => { throw new DOMException("The operation was aborted due to timeout", "TimeoutError"); });
  assert.equal(timeout.outcome, "unknown");
  assert.equal(timeout.retry, false);
  assert.equal((await fireRoutine(config, "t", async () => { throw new TypeError("Network connection lost"); })).outcome, "unknown");
  const refused = await fireRoutine(config, "t", async () => { throw new TypeError("fetch failed", { cause: Object.assign(new Error("connect"), { code: "ECONNREFUSED" }) }); });
  assert.deepEqual([refused.outcome, refused.retry], ["unreachable", true]);
  // A 2xx is a session even when its answer cannot be read.
  const unreadable = await fireRoutine(config, "t", answer(200, { type: "something_else" }));
  assert.deepEqual([unreadable.ok, unreadable.outcome, unreadable.retry], [false, "unknown", false]);
  const idOnly = await fireRoutine(config, "t", answer(200, { type: "routine_fire", claude_code_session_id: "session_01abcdefgh", claude_code_session_url: "https://evil.example/session_01abcdefgh" }));
  assert.equal(idOnly.sessionUrl, "https://claude.ai/code/session_01abcdefgh");
});

test("PLANT: fireOnce, on its D1 store, refuses a job key already fired or unknown, frees it after a sure failure, and yields to force", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(ROUTINE_FIRES_SQL);
  const d1 = { prepare: (sql) => ({ bind: (...v) => ({ first: async () => sqlite.prepare(sql).get(...v) ?? null, run: async () => sqlite.prepare(sql).run(...v) }) }) };
  const store = d1FireStore(d1);
  const kv = {
    get: (k) => sqlite.prepare("SELECT value FROM routine_fires WHERE key = ?").get(k)?.value,
    get size() { return sqlite.prepare("SELECT count(*) AS n FROM routine_fires").get().n; },
  };
  await assert.rejects(fireOnce({ ...store, add: undefined }, "job-0", config, "t"), /atomic add/);
  let posts = 0;
  const counting = (fetcher) => async (...args) => (posts++, fetcher(...args));

  assert.equal((await fireOnce(store, "job-1", config, "t", { fetcher: counting(answer(503, {})) })).outcome, "unavailable");
  assert.equal(kv.size, 0);
  assert.equal((await fireOnce(store, "job-1", config, "t", { fetcher: counting(answer(200, STARTED)) })).ok, true);
  const again = await fireOnce(store, "job-1", config, "t", { fetcher: counting(answer(200, STARTED)) });
  assert.equal(again.outcome, "already_fired");
  assert.equal(again.record.sessionUrl, STARTED.claude_code_session_url);
  assert.equal(posts, 2);

  const lost = async () => { throw new DOMException("timeout", "TimeoutError"); };
  assert.equal((await fireOnce(store, "job-2", config, "t", { fetcher: lost })).outcome, "unknown");
  assert.equal((await fireOnce(store, "job-2", config, "t", { fetcher: counting(answer(200, STARTED)) })).outcome, "already_fired");
  assert.equal(posts, 2);
  assert.equal((await fireOnce(store, "job-2", config, "t", { fetcher: counting(answer(200, STARTED)), force: true })).ok, true);
  const later = new Date(Date.now() + 31 * 60_000);
  assert.equal((await fireOnce(store, "job-2", config, "t", { fetcher: counting(answer(200, STARTED)), refireAfterMs: 30 * 60_000, now: later })).ok, true);
  assert.equal(posts, 4);

  // Two fires at once: the reservation stops the second before it posts.
  let release;
  const slow = async () => (await new Promise((r) => (release = r)), new Response(JSON.stringify(STARTED)));
  const first = fireOnce(store, "job-3", config, "t", { fetcher: slow });
  await new Promise((r) => setImmediate(r));
  assert.equal((await fireOnce(store, "job-3", config, "t", { fetcher: counting(answer(200, STARTED)) })).outcome, "already_fired");
  release();
  assert.equal((await first).ok, true);

  // A sure non-start whose delete fails leaves `failed`, which blocks nothing; a reservation left by a dead worker is unknown.
  const flaky = { ...store, delete: async () => { throw new Error("busy"); } };
  assert.equal((await fireOnce(flaky, "job-4", config, "t", { fetcher: answer(400, {}) })).unrecorded, undefined);
  assert.equal(JSON.parse(kv.get("routine-fire:job-4")).state, "failed");
  assert.equal((await fireOnce(store, "job-4", config, "t", { fetcher: answer(200, STARTED) })).ok, true);
  await store.put("routine-fire:job-5", JSON.stringify({ state: "firing", at: new Date(Date.now() - 11 * 60_000).toISOString() }));
  assert.equal((await fireOnce(store, "job-5", config, "t", { fetcher: answer(200, STARTED) })).record.state, "unknown");
});
