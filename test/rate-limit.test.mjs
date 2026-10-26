import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { hitRules, idleDeadline, purgeExpired, limit, limitedResponse, matchRule, mustStop, ipKey } from "../rate-limit/index.mjs";

/** The Durable Object's `sql.exec(query, ...bindings).toArray()` shape, over an in-memory SQLite. */
function memorySql() {
  const db = new DatabaseSync(":memory:");
  return {
    db,
    exec(query, ...bindings) {
      const statement = db.prepare(query);
      const rows = /^\s*select/i.test(query) ? statement.all(...bindings) : (statement.run(...bindings), []);
      return { toArray: () => rows };
    },
  };
}
const rows = (sql) => sql.db.prepare("SELECT * FROM rate_window ORDER BY window_seconds").all();
const T0 = 3_600_000 * 1000; // a boundary for every window length used below
const MIN = [{ limit: 3, windowSeconds: 60 }];

test("window edges: the limit-th hit is ok, the next is limited", () => {
  const sql = memorySql();
  assert.deepEqual([1, 2, 3].map((i) => hitRules(sql, MIN, T0 + i).ok), [true, true, true]);
  const refused = hitRules(sql, MIN, T0 + 4);
  assert.equal(refused.ok, false);
  assert.equal(refused.used, 3);
});

test("window edges: the first hit after the boundary is ok and the count restarts", () => {
  const sql = memorySql();
  for (let i = 0; i < 3; i++) hitRules(sql, MIN, T0 + i);
  assert.equal(hitRules(sql, MIN, T0 + 59_999).ok, false, "the last millisecond of the window is still spent");
  const next = hitRules(sql, MIN, T0 + 60_000);
  assert.equal(next.ok, true);
  assert.equal(next.used, 1);
});

test("a limited hit writes nothing", () => {
  const sql = memorySql();
  for (let i = 0; i < 3; i++) hitRules(sql, MIN, T0);
  const before = JSON.stringify(rows(sql));
  hitRules(sql, MIN, T0 + 1);
  hitRules(sql, MIN, T0 + 2);
  assert.equal(JSON.stringify(rows(sql)), before);
});

test("two rules: when one is spent neither is counted", () => {
  const sql = memorySql();
  const rules = [{ limit: 2, windowSeconds: 60 }, { limit: 100, windowSeconds: 3600 }];
  hitRules(sql, rules, T0);
  hitRules(sql, rules, T0);
  assert.equal(hitRules(sql, rules, T0).ok, false);
  const stored = Object.fromEntries(rows(sql).map((r) => [r.window_seconds, r.count]));
  assert.deepEqual(stored, { 60: 2, 3600: 2 }, "the hour was not charged for the refused third hit");
});

test("two rules: the refusal names the rule that frees up last", () => {
  const sql = memorySql();
  const rules = [{ limit: 1, windowSeconds: 60 }, { limit: 1, windowSeconds: 3600 }];
  hitRules(sql, rules, T0);
  const refused = hitRules(sql, rules, T0 + 10_000);
  assert.equal(refused.window, 3600);
  assert.equal(refused.retryAfterSeconds, 3590);
});

test("Retry-After is the time left in the window, not the window length", () => {
  const sql = memorySql();
  for (let i = 0; i < 3; i++) hitRules(sql, MIN, T0);
  assert.equal(hitRules(sql, MIN, T0 + 15_000).retryAfterSeconds, 45);
  assert.equal(hitRules(sql, MIN, T0 + 15_500).retryAfterSeconds, 45, "44.5 seconds left rounds up, so waiting that long clears the window");
  assert.equal(hitRules(sql, MIN, T0 + 59_500).retryAfterSeconds, 1, "rounded up, never 0");
});

test("a rule with a bad limit or a repeated window is refused", () => {
  const sql = memorySql();
  assert.throws(() => hitRules(sql, [{ limit: 0, windowSeconds: 60 }], T0), TypeError);
  assert.throws(() => hitRules(sql, [{ limit: 1, windowSeconds: 60 }, { limit: 2, windowSeconds: 60 }], T0), TypeError);
  assert.throws(() => hitRules(sql, [], T0), TypeError);
});

test("idle deadline is the end of the longest window", () => {
  const rules = [{ limit: 1, windowSeconds: 60 }, { limit: 1, windowSeconds: 3600 }];
  assert.equal(idleDeadline(rules, T0 + 5), T0 + 3_600_000 - (T0 % 3_600_000));
});

function namespaceFor(behavior) {
  return { idFromName: (name) => name, get: () => ({ hit: behavior }) };
}

test("fail-closed path: a throwing or missing binding is unavailable and refuses with a 503", async () => {
  const logged = [];
  const original = console.error;
  console.error = (line) => logged.push(line);
  try {
    for (const namespace of [namespaceFor(async () => { throw new Error("DO reset"); }), undefined]) {
      const verdict = await limit(namespace, "ask:ip:1.2.3.4", MIN, { onUnavailable: "refuse" });
      assert.equal(verdict.status, "unavailable");
      assert.equal(mustStop(verdict, "refuse"), true);
      const response = limitedResponse(verdict);
      assert.equal(response.status, 503);
      assert.equal(response.headers.get("Retry-After"), "60");
    }
  } finally {
    console.error = original;
  }
  assert.equal(logged.length, 2);
  assert.ok(!logged[0].includes("1.2.3.4"), "the log line carries the bucket, not the address");
});

test("allow still reports the failure and lets the call proceed", async () => {
  const logged = [];
  const original = console.error;
  console.error = (line) => logged.push(line);
  try {
    const verdict = await limit(namespaceFor(async () => { throw new Error("down"); }), "ask:ip:x", MIN, { onUnavailable: "allow" });
    assert.equal(verdict.status, "unavailable");
    assert.equal(mustStop(verdict, "allow"), false);
  } finally {
    console.error = original;
  }
  assert.equal(logged.length, 1);
});

test("onUnavailable has no default", async () => {
  await assert.rejects(limit(namespaceFor(async () => ({})), "k", MIN, {}), TypeError);
});

test("limited answers 429 with the time left, never a success code", async () => {
  const verdict = await limit(namespaceFor(async () => ({ ok: false, used: 3, limit: 3, retryAfterSeconds: 45, window: 60 })), "k", MIN, { onUnavailable: "refuse" });
  assert.equal(verdict.status, "limited");
  const response = limitedResponse(verdict);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "45");
});

test("ipKey shares one anon bucket only without the header, and says so", () => {
  assert.deepEqual(ipKey("ask", new Request("https://x.test/", { headers: { "CF-Connecting-IP": "9.9.9.9" } })), { key: "ask:9.9.9.9", anonymous: false });
  assert.deepEqual(ipKey("ask", new Request("https://x.test/")), { key: "ask:anon", anonymous: true });
});

test("matchRule: case, slashes and percent-escapes cannot slip past a rule", () => {
  const rules = [{ path: "/login", methods: ["POST"] }, { path: "/api/auth", prefix: true }];
  for (const path of ["/login", "/LOGIN", "/login///", "//login", "/%4cogin", "/%6Cogin/"]) {
    assert.ok(matchRule(new Request(`https://x.test${path}`, { method: "POST" }), rules), path);
  }
  assert.equal(matchRule(new Request("https://x.test/login"), rules), undefined, "GET is not the rule's method");
  assert.ok(matchRule(new Request("https://x.test/api/auth/callback"), rules));
  assert.equal(matchRule(new Request("https://x.test/api/authors"), rules), undefined, "a prefix ends at a path segment");
});

test("cleanup forgets ended windows only, and reports when the rest end", () => {
  const sql = memorySql();
  const rules = [{ limit: 5, windowSeconds: 60 }, { limit: 5, windowSeconds: 3600 }];
  hitRules(sql, rules, T0);
  assert.equal(purgeExpired(sql, T0 + 30_000), T0 + 3_600_000, "nothing has ended; the hour is still the last to end");
  assert.equal(rows(sql).length, 2);
  assert.equal(purgeExpired(sql, T0 + 60_000), T0 + 3_600_000, "the minute ended, the hour did not");
  assert.deepEqual(rows(sql).map((r) => r.window_seconds), [3600]);
  assert.equal(purgeExpired(sql, T0 + 3_600_000), null);
  assert.equal(rows(sql).length, 0);
});

test("cleanup with a clock in the past leaves a live window counted", () => {
  const sql = memorySql();
  for (let i = 0; i < 3; i++) hitRules(sql, MIN, T0);
  purgeExpired(sql, T0 - 1);
  assert.equal(hitRules(sql, MIN, T0).ok, false);
});
