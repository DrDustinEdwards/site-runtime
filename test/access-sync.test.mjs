// The access sync call against a fake Capsid: the list goes lower-cased with the removed names that are not still
// members, the key only in the Authorization header, and every kind of answer becomes a result, never a throw.
import assert from "node:assert/strict";
import { test } from "node:test";

import { postAccessSync } from "../access-sync.mjs";

const KEY = "sample-key";

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

test("posts the whole list, lower-cased, and frees only the people no longer on it", async () => {
  const { calls, fetcher } = fake(Response.json({ ok: true, added: ["a"], dropped: ["b", "c"] }));
  const result = await postAccessSync({
    key: KEY,
    namespace: "sample",
    members: ["Alex@Example.com"],
    removed: ["alex@example.com", "Sam@example.com"],
    fetch: fetcher,
  });
  assert.deepEqual(result, { ok: true, added: 1, dropped: 2 });
  assert.equal(calls[0]?.url, "https://mcp.dustinedwards.info/ops/access-sync");
  assert.equal(new Headers(calls[0]?.init.headers).get("authorization"), `Bearer ${KEY}`);
  assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), {
    namespace: "sample",
    members: ["alex@example.com"],
    removed: ["sam@example.com"],
  });
});

test("a refusal is Capsid's own words, and a network failure is a result", async () => {
  const cloudflare = fake(
    Response.json({ ok: false, refusal: "Cloudflare refused: policy locked" }, { status: 409 }),
  );
  assert.deepEqual(
    await postAccessSync({ key: KEY, namespace: "sample", members: [], fetch: cloudflare.fetcher }),
    {
      ok: false,
      refusal: "Cloudflare refused: policy locked",
    },
  );

  const plain = fake(new Response("CF_ACCESS_SYNC_TOKEN is not set", { status: 503 }));
  const notSetUp = await postAccessSync({
    key: KEY,
    namespace: "sample",
    members: [],
    fetch: plain.fetcher,
  });
  assert.equal(notSetUp.ok, false);
  assert.match(
    notSetUp.ok ? "" : notSetUp.refusal,
    /^Capsid answered 503: .*not set up yet at Capsid/,
  );

  const down = fake(new Error("connection refused"));
  assert.deepEqual(
    await postAccessSync({ key: KEY, namespace: "sample", members: [], fetch: down.fetcher }),
    {
      ok: false,
      refusal: "Capsid could not be reached: connection refused",
    },
  );
  assert.ok(!JSON.stringify([notSetUp]).includes(KEY));
});
