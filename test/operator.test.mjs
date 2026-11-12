// The operator door: the bearer is the whole boundary (a wrong, missing or unset token runs nothing), and a call
// reaches only a named tool. PLANT tests fail if the guard they name is removed.
import assert from "node:assert/strict";
import { test } from "node:test";
import { OperatorError, callOperator, operatorResponse } from "../operator.mjs";

const TOKEN = "t".repeat(40);
const limiter = {
  idFromName: () => "id",
  get: () => ({
    hit: async () => ({ ok: true, used: 1, limit: 30, retryAfterSeconds: 0, window: 60 }),
  }),
};
const call = (
  /** @type {Record<string, string>} */ headers,
  body = JSON.stringify({ tool: "backup_status" }),
  method = "POST",
) =>
  new Request("https://site.example.com/api/operator", {
    method,
    headers: { "content-type": "application/json", ...headers },
    ...(method === "POST" ? { body } : {}),
  });

function tools() {
  /** @type {unknown[]} */
  const ran = [];
  return {
    ran,
    tools: {
      backup_status: {
        description: "Reads the backup state.",
        run: async (/** @type {unknown} */ args) =>
          (ran.push(args), { age_hours: 1 }),
      },
    },
  };
}

test("PLANT: an unset, short, wrong or missing token runs nothing; the right one runs only a named tool", async () => {
  for (const [token, headers, status] of /** @type {const} */ ([
    [undefined, { authorization: `Bearer ${TOKEN}` }, 503],
    ["short", { authorization: "Bearer short" }, 503],
    [TOKEN, { authorization: `Bearer ${"x".repeat(40)}` }, 401],
    [TOKEN, {}, 401],
  ])) {
    const t = tools();
    const res = await operatorResponse(call(headers), { token, limiter, tools: t.tools });
    assert.equal(res.status, status);
    assert.equal(t.ran.length, 0);
    assert.doesNotMatch(await res.text(), /t{40}/, "the token is never echoed");
  }
  // The right token lists the tools, runs a named one with its args, and refuses an unknown one.
  const t = tools();
  const auth = { authorization: `Bearer ${TOKEN}` };
  const list = await (
    await operatorResponse(call(auth, "", "GET"), { token: TOKEN, limiter, tools: t.tools })
  ).json();
  assert.deepEqual(list.data.tools, [
    { name: "backup_status", description: "Reads the backup state." },
  ]);
  const res = await operatorResponse(
    call(auth, JSON.stringify({ tool: "backup_status", args: { a: 1 } })),
    { token: TOKEN, limiter, tools: t.tools },
  );
  assert.deepEqual(await res.json(), { ok: true, data: { age_hours: 1 } });
  assert.deepEqual(t.ran, [{ a: 1 }]);
  const unknown = await operatorResponse(call(auth, JSON.stringify({ tool: "toString" })), {
    token: TOKEN,
    limiter,
    tools: t.tools,
  });
  assert.equal(unknown.status, 400);
  assert.equal(t.ran.length, 1);
  // A throw says only a reference; an OperatorError's words go back as they are.
  const throwing = {
    boom: {
      description: "x",
      run: () => {
        throw new Error("SELECT * FROM secrets /srv/app.js");
      },
    },
    refuse: {
      description: "x",
      run: () => {
        throw new OperatorError("first-publish-requires-admin");
      },
    },
  };
  const run = (/** @type {string} */ tool) =>
    operatorResponse(call(auth, JSON.stringify({ tool })), {
      token: TOKEN,
      limiter,
      tools: throwing,
    });
  const boom = await run("boom");
  assert.equal(boom.status, 500);
  assert.match(
    JSON.stringify(await boom.json()),
    /^\{"ok":false,"error":"The tool failed \(ref [0-9a-f]{8}\)\."\}$/,
  );
  const refused = await run("refuse");
  assert.deepEqual(
    [refused.status, (await refused.json()).error],
    [400, "first-publish-requires-admin"],
  );
});

test("callOperator speaks the door's format: data on success, the refusal by status, nothing thrown", async () => {
  const t = tools();
  /** @type {typeof fetch} */
  const door = async (input, init) =>
    operatorResponse(new Request(/** @type {string} */ (input), init), {
      token: TOKEN,
      limiter,
      tools: t.tools,
    });
  const url = "https://site.example.com/api/operator";
  const ok = await callOperator(url, TOKEN, "backup_status", { fetch: door, args: { a: 1 } });
  assert.deepEqual(ok, { ok: true, status: 200, data: { age_hours: 1 }, error: null });
  assert.deepEqual(t.ran, [{ a: 1 }]);
  const wrong = await callOperator(url, "x".repeat(40), "backup_status", { fetch: door });
  assert.equal(wrong.ok, false);
  assert.equal(wrong.status, 401);
  assert.match(wrong.error ?? "", /^backup_status answered 401: /);
  const down = await callOperator(url, TOKEN, "backup_status", {
    fetch: async () => {
      throw new Error(`refused for ${TOKEN}`);
    },
  });
  assert.deepEqual(down, {
    ok: false,
    status: 0,
    data: null,
    error: "backup_status did not complete: refused for [token]",
  });
});
