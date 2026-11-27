// What a site's Sentry report carries, proved through the real SDK pipeline: withSiteSentry around a logged handler,
// an error-level log line and a throw inside it, and the envelopes the SDK posts read off a stubbed fetch.
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { test } from "node:test";

import { logEvent, tokenPattern, withRequestLog } from "../log.mjs";
import { withSiteSentry } from "../sentry.mjs";

/** Runs `fetch` under withSiteSentry with `env`, and returns the bodies the SDK sent. */
async function sentBy(env, fetch) {
  const g = /** @type {any} */ (globalThis);
  const had = { als: g.AsyncLocalStorage, fetch: g.fetch, error: console.error };
  g.AsyncLocalStorage = AsyncLocalStorage; // the Workers runtime's, under nodejs_compat or nodejs_als
  delete g.__SENTRY_CLOUDFLARE_CLIENT__; // the SDK keeps one client per isolate; each case starts without it
  /** @type {string[]} */
  const sent = [];
  g.fetch = async (/** @type {any} */ _url, /** @type {RequestInit} */ init) => {
    const body = init.body;
    sent.push(
      typeof body === "string" ? body : new TextDecoder().decode(/** @type {any} */ (body)),
    );
    return new Response("{}");
  };
  console.error = () => {};
  /** @type {Promise<unknown>[]} */
  const waits = [];
  const ctx = {
    waitUntil: (/** @type {Promise<unknown>} */ p) => void waits.push(p),
    passThroughOnException() {},
    props: {},
  };
  try {
    const tokenPath = tokenPattern(["u"]);
    const worker = withSiteSentry({ fetch: withRequestLog(fetch, { tokenPath }) }, { tokenPath });
    const request = new Request(
      "https://example.com/u/tok_SECRET123?token=QTOKEN&email=jane@example.com",
      {
        method: "POST",
        headers: { "x-customer-email": "jane@example.com", cookie: "session=COOKIEVALUE" },
        body: JSON.stringify({ customer_email: "jane@example.com" }),
      },
    );
    await worker.fetch(request, env, /** @type {any} */ (ctx)).catch(() => {});
    await Promise.all(waits);
  } finally {
    g.AsyncLocalStorage = had.als;
    g.fetch = had.fetch;
    console.error = had.error;
  }
  return sent.join("\n");
}

const failing = async () => {
  logEvent(
    "billing_failed",
    {
      path: "/u/tok_PATH?x=1",
      error: new Error("insert failed\nparams: jane@example.com,Jane Doe"),
    },
    { level: "error", tokenPath: tokenPattern(["u"]) },
  );
  throw new Error("boom for bob@example.org at https://example.com/x?q=QSTRING");
};

test("an error line and a throw are reported, with nothing personal in them", async () => {
  const text = await sentBy({ SENTRY_DSN: "https://key@o1.ingest.example.com/1" }, failing);
  assert.match(text, /"event":"billing_failed"/);
  assert.match(text, /boom for \[email\]/);
  assert.doesNotMatch(text, /"type":"transaction"/);
  assert.doesNotMatch(text, /"event":"request"/);
  for (const needle of [
    "tok_SECRET123",
    "tok_PATH",
    "QTOKEN",
    "QSTRING",
    "COOKIEVALUE",
    "jane@example.com",
    "bob@example.org",
    "Jane Doe",
  ])
    assert.ok(!text.includes(needle), needle);
});

test("with no SENTRY_DSN nothing leaves the Worker", async () => {
  assert.equal(await sentBy({}, failing), "");
});

test("the same error line sent again and again is one report an hour, with the count after it", async () => {
  const { repeatedReports, REPORT_REPEAT_MS } = await import("../sentry.mjs");
  const key = "flood\nsame failure";
  const t = 1_000_000;
  assert.equal(repeatedReports(key, t), 0);
  for (let i = 1; i <= 50; i++) assert.equal(repeatedReports(key, t + i), null);
  assert.equal(repeatedReports("flood\nanother failure", t + 60), 0);
  assert.equal(repeatedReports(key, t + REPORT_REPEAT_MS), 50);
  assert.equal(repeatedReports(key, t + REPORT_REPEAT_MS + 1), null);
});
