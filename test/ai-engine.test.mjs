// Choosing the engine for AI work. PLANT tests fail if the guard they name is removed.
import assert from "node:assert/strict";
import { test } from "node:test";

import { MODELS, messages } from "../anthropic.mjs";
import { PRICES, costMicros, engineFor, normalizeSettings, priceOf, runAi } from "../ai-engine.mjs";

const started = { ok: true, outcome: "started", sessionUrl: "https://claude.ai/code/session_x" };
const limited = { ok: false, outcome: "rate_limited", error: "429" };
const unknown = { ok: false, outcome: "unknown", error: "no answer" };
const answer = { ok: true, text: "hi" };

function jobs(fire, call = answer) {
  const seen = { routine: 0, api: 0 };
  return {
    seen,
    routine: async () => (seen.routine++, fire),
    api: async () => (seen.api++, call),
  };
}

test("a feature follows the master unless it has its own setting; junk is dropped", () => {
  const s = normalizeSettings({
    master: "subscription",
    features: { alt: "api", seo: "nonsense" },
    apiCapMicros: "5000000",
  });
  assert.equal(engineFor(s, "alt"), "api");
  assert.equal(engineFor(s, "seo"), "subscription");
  assert.equal(s.apiCapMicros, 5_000_000);
  assert.equal(normalizeSettings(null).master, "auto");
  // An override beats the rest until its date, then lapses.
  const o = normalizeSettings({
    master: "subscription",
    override: { engine: "api", until: "2026-11-10T00:00:00Z" },
  });
  assert.equal(engineFor(o, "seo", Date.parse("2026-11-09T00:00:00Z")), "api");
  assert.equal(engineFor(o, "seo", Date.parse("2026-11-11T00:00:00Z")), "subscription");
  assert.equal(normalizeSettings({ apiCapMicros: -1 }).apiCapMicros, 0);
});

test("subscription fires the routine and never calls the API, even when the fire fails", async () => {
  const settings = normalizeSettings({ master: "subscription" });
  const ok = jobs(started);
  assert.equal((await runAi({ settings, feature: "x", ...ok })).engine, "subscription");
  assert.deepEqual(ok.seen, { routine: 1, api: 0 });
  const bad = jobs(limited);
  const run = await runAi({ settings, feature: "x", ...bad });
  assert.equal(run.ok, false);
  assert.equal(bad.seen.api, 0);
});

test("auto falls back to the API when the fire certainly started nothing", async () => {
  const j = jobs(limited);
  const run = await runAi({ settings: normalizeSettings({}), feature: "x", ...j });
  assert.equal(run.ok && run.engine, "api");
  assert.equal(run.fellBack, "rate_limited");
});

test("PLANT: auto never falls back on an unknown fire, which may have started a session", async () => {
  const j = jobs(unknown);
  const run = await runAi({ settings: normalizeSettings({}), feature: "x", ...j });
  assert.equal(run.ok, false);
  assert.equal(j.seen.api, 0);
});

test("PLANT: a reached API cap closes the API; api uses the routine, auto stops falling back", async () => {
  const capped = normalizeSettings({ master: "api", apiCapMicros: 1000 });
  const j = jobs(started);
  assert.equal(
    (await runAi({ settings: capped, feature: "x", spentMicros: 1000, ...j })).engine,
    "subscription",
  );
  assert.equal(j.seen.api, 0);
  const auto = normalizeSettings({ apiCapMicros: 1000 });
  const k = jobs(limited);
  assert.equal((await runAi({ settings: auto, feature: "x", spentMicros: 1000, ...k })).ok, false);
  assert.equal(k.seen.api, 0);
  const noRoutine = await runAi({
    settings: capped,
    feature: "x",
    spentMicros: 1000,
    api: async () => answer,
  });
  assert.equal(noRoutine.ok, false);
  // An override in force lifts the cap until its date.
  const until = (day) =>
    normalizeSettings({ apiCapMicros: 1000, override: { engine: "api", until: day } });
  const now = Date.parse("2026-11-08T00:00:00Z");
  const lifted = await runAi({
    settings: until("2026-11-10T00:00:00Z"),
    feature: "x",
    spentMicros: 5000,
    now,
    ...jobs(started),
  });
  assert.equal(lifted.ok && lifted.engine, "api");
  const expired = await runAi({
    settings: until("2026-11-07T00:00:00Z"),
    feature: "x",
    spentMicros: 5000,
    now,
    ...jobs(started),
  });
  assert.equal(expired.engine, "subscription");
});

test("PLANT: every active model has a price, found with or without its snapshot date", () => {
  for (const [id, entry] of Object.entries(MODELS))
    if (entry.state === "active") assert.ok(priceOf(id), `${id} has no price in PRICES`);
  assert.equal(priceOf("claude-haiku-4-5"), PRICES["claude-haiku-4-5-20251001"]);
  assert.equal(priceOf("claude-sonnet-5-20260101"), PRICES["claude-sonnet-5"]);
  assert.equal(priceOf("claude-unknown-1"), null);
  // 1,000 input and 100 cached reads on Sonnet 5: 1000 x $2 + 100 x $0.20 per million = 2,020 micro-dollars.
  assert.equal(
    costMicros("claude-sonnet-5", { input: 1000, output: 0, cacheRead: 100, cacheWrite: 0 }),
    2020,
  );
});

test("PLANT: one-hour cache writes and Haiku 5.5 prompts over 100,000 tokens pay their own price, per request", async () => {
  // Two requests in one call (pause_turn): the first has a 120,000-token prompt, 100,000 of it a one-hour cache
  // write; the second has 60,000 and an older response shape with no `cache_creation` split.
  const replies = [
    {
      content: [{ type: "text", text: "a" }],
      stop_reason: "pause_turn",
      usage: {
        input_tokens: 20_000,
        output_tokens: 1_000,
        cache_creation_input_tokens: 100_000,
        cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 100_000 },
      },
    },
    {
      content: [{ type: "text", text: "b" }],
      stop_reason: "end_turn",
      usage: {
        input_tokens: 2_000,
        output_tokens: 500,
        cache_read_input_tokens: 50_000,
        cache_creation_input_tokens: 8_000,
      },
    },
  ];
  let n = 0;
  const fetcher = async () => new Response(JSON.stringify(replies[n++]), { status: 200 });
  const r = await messages(
    { ANTHROPIC_API_KEY: "sk-ant-sample" },
    "sample",
    { model: "claude-haiku-5-5", max_tokens: 10, messages: [{ role: "user", content: "Hi" }] },
    { fetcher, log: false },
  );
  assert.equal(r.ok, true);
  assert.deepEqual(
    [r.usage.cacheWrite, r.usage.cacheWrite1h, r.usage.long.cacheWrite1h],
    [8_000, 100_000, 100_000],
  );
  // First at the long price: 20,000 x $0.50 + 100,000 x $1 + 1,000 x $2.50 = 112,500 micro-dollars. Second at the
  // standard price: 2,000 x $0.10 + 50,000 x $0.01 + 8,000 x $0.125 + 500 x $0.50 = 1,950.
  assert.equal(costMicros("claude-haiku-5-5", r.usage), 114_450);
  // One request on its own: the line is "over 100,000", so exactly 100,000 is still the standard price.
  const one = { output: 0, cacheRead: 0, cacheWrite: 0 };
  assert.equal(costMicros("claude-haiku-5-5", { ...one, input: 100_000 }), 10_000);
  assert.equal(costMicros("claude-haiku-5-5", { ...one, input: 100_002 }), 50_001);
  // Sonnet 5 one-hour writes at 2x input ($4), not the five-minute $2.50.
  assert.equal(costMicros("claude-sonnet-5", { ...one, input: 0, cacheWrite1h: 1_000 }), 4_000);
});
