// Choosing the engine for AI work. PLANT tests fail if the guard they name is removed.
import assert from "node:assert/strict";
import { test } from "node:test";

import { MODELS } from "../anthropic.mjs";
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
