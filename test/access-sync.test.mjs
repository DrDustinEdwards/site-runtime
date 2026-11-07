// The access sync call against a fake Capsid: the list goes lower-cased with the removed names that are not still
// members, the key only in the Authorization header, and every kind of answer becomes a result, never a throw.
import assert from "node:assert/strict";
import { test } from "node:test";

import { postAccessSync } from "../access-sync.mjs";

const KEY = "sample-key";
const base = { key: KEY, namespace: "sample", members: ["Alex@Example.com"] };

/** @param {Response | Error} answer */
function fake(answer) {
  /** @type {{ url: string, init: RequestInit }[]} */
  const calls = [];
  /** @type {typeof fetch} */
  const fetcher = async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { calls, fetcher };
}

test("posts the whole list, and turns every answer into a result", async () => {
  const ok = fake(Response.json({ ok: true, added: ["a"], dropped: ["b", "c"] }));
  const sent = await postAccessSync({
    ...base,
    removed: ["alex@example.com", "Sam@example.com"],
    fetch: ok.fetcher,
  });
  assert.deepEqual(sent, { ok: true, added: 1, dropped: 2 });
  assert.equal(ok.calls[0]?.url, "https://mcp.dustinedwards.info/ops/access-sync");
  assert.equal(new Headers(ok.calls[0]?.init.headers).get("authorization"), `Bearer ${KEY}`);
  assert.deepEqual(JSON.parse(String(ok.calls[0]?.init.body)), {
    namespace: "sample",
    members: ["alex@example.com"],
    removed: ["sam@example.com"],
  });

  const cloudflare = fake(
    Response.json({ ok: false, refusal: "Cloudflare refused: locked" }, { status: 409 }),
  );
  assert.deepEqual(await postAccessSync({ ...base, fetch: cloudflare.fetcher }), {
    ok: false,
    refusal: "Cloudflare refused: locked",
  });

  const unset = fake(new Response("CF_ACCESS_SYNC_TOKEN is not set", { status: 503 }));
  const notSetUp = await postAccessSync({ ...base, fetch: unset.fetcher });
  assert.equal(notSetUp.ok, false);
  assert.match(
    notSetUp.ok ? "" : notSetUp.refusal,
    /^Capsid answered 503: .*not set up yet at Capsid/,
  );

  const words = fake(new Response("unauthorized: not scoped to this tool.", { status: 403 }));
  assert.deepEqual(await postAccessSync({ ...base, fetch: words.fetcher }), {
    ok: false,
    refusal: "Capsid answered 403: unauthorized: not scoped to this tool.",
  });

  const down = fake(new Error("connection refused"));
  assert.deepEqual(await postAccessSync({ ...base, fetch: down.fetcher }), {
    ok: false,
    refusal: "Capsid could not be reached: connection refused",
  });

  // The body fails after the headers arrived: still a result, not a rejection.
  const cut = new Response(
    new ReadableStream({ pull: (controller) => controller.error(new Error("connection reset")) }),
  );
  assert.deepEqual(await postAccessSync({ ...base, fetch: fake(cut).fetcher }), {
    ok: false,
    refusal: "Capsid could not be reached: connection reset",
  });
  assert.ok(!JSON.stringify([notSetUp]).includes(KEY));
});
