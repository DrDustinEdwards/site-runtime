// Choosing the engine for AI work. PLANT tests fail if the guard they name is removed.
import assert from "node:assert/strict";
import { test } from "node:test";

import { costMicros, engineFor, normalizeSettings, runAi } from "../ai-engine.mjs";

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

test("api calls the API and not the routine", async () => {
  const j = jobs(started);
  const run = await runAi({ settings: normalizeSettings({ master: "api" }), feature: "x", ...j });
  assert.equal(run.engine, "api");
  assert.deepEqual(j.seen, { routine: 0, api: 1 });
});

test("auto uses the subscription when it starts", async () => {
  const j = jobs(started);
  const run = await runAi({ settings: normalizeSettings({}), feature: "x", ...j });
  assert.equal(run.engine, "subscription");
  assert.equal(j.seen.api, 0);
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
});

test("a missing route is reported, not guessed", async () => {
  const run = await runAi({
    settings: normalizeSettings({ master: "subscription" }),
    feature: "x",
    api: async () => answer,
  });
  assert.equal(run.ok, false);
  assert.equal(
    (await runAi({ settings: normalizeSettings({}), feature: "x", api: async () => answer }))
      .engine,
    "api",
  );
});

test("cost is tokens times the listed price", () => {
  assert.equal(
    costMicros("claude-haiku-5-5", {
      input: 1_000_000,
      output: 1_000_000,
      cacheRead: 0,
      cacheWrite: 0,
    }),
    600_000,
  );
  assert.equal(
    costMicros("unknown-model", { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }),
    null,
  );
});
