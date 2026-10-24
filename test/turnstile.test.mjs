// The widget loader against a fake document: one script for every mount, a mount removed before the script loads never
// renders, and a failed load is tried again. PLANT tests fail if the guard they name is removed.
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

/** @type {{ src: string, onload?: () => void, onerror?: () => void }[]} */
let scripts = [];
/** @type {string[]} */
let rendered = [];
const g = /** @type {Record<string, unknown>} */ (globalThis);
g.document = {
  createElement: () => ({ remove() {} }),
  head: { append: (/** @type {(typeof scripts)[number]} */ s) => scripts.push(s) },
};
const fakeTurnstile = {
  render: (/** @type {{ id: string }} */ el) => (rendered.push(el.id), `w-${el.id}`),
  remove: () => {},
};
const el = (/** @type {string} */ id) => /** @type {HTMLElement} */ (/** @type {unknown} */ ({ id }));
const tick = () => new Promise((r) => setImmediate(r));
let fresh = 0;
/** A copy of the module with no script loaded yet. */
const load = async () => /** @type {typeof import("../turnstile.mjs")} */ (await import(`../turnstile.mjs?${fresh++}`));

beforeEach(() => {
  scripts = [];
  rendered = [];
  delete g.turnstile;
});

test("PLANT: two mounts share one script, and one removed before it loads never renders", async () => {
  const { mountTurnstile } = await load();
  mountTurnstile(el("kept"), "key");
  mountTurnstile(el("gone"), "key")();
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].src, "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit");
  g.turnstile = fakeTurnstile;
  scripts[0].onload?.();
  await tick();
  assert.deepEqual(rendered, ["kept"]);
});

test("PLANT: a failed load is forgotten, so the next mount loads the script again", async () => {
  const { mountTurnstile } = await load();
  const logged = console.error;
  console.error = () => {};
  mountTurnstile(el("failed"), "key");
  scripts[0].onerror?.();
  await tick();
  console.error = logged;
  mountTurnstile(el("retry"), "key");
  assert.equal(scripts.length, 2);
});
