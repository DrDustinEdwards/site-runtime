import assert from "node:assert/strict";
import { test } from "node:test";

import { installationToken, parsePrUrl, readAllPages } from "../github.mjs";

test("readAllPages follows Link rel=next, not page length, and reports a list it could not finish", async () => {
  const asked = [];
  const pages = { 1: [[1, 2], true], 2: [[3], true], 3: [[], false] };
  const call = async (path) => {
    asked.push(path);
    const [rows, next] = pages[Number(new URL(path, "https://x").searchParams.get("page"))];
    return Response.json(rows, { headers: next ? { Link: '<x>; rel="next"' } : {} });
  };
  assert.deepEqual(
    await readAllPages(call, "/repos/o/r/pulls?state=open", { maxPages: 5, perPage: 2 }),
    {
      items: [1, 2, 3],
      problem: null,
      truncated: false,
    },
  );
  assert.equal(asked[0], "/repos/o/r/pulls?state=open&per_page=2&page=1");
  const capped = await readAllPages(call, "/repos/o/r/pulls", { maxPages: 2, perPage: 2 });
  assert.deepEqual(capped.items, [1, 2, 3]);
  assert.match(capped.problem ?? "", /more than 2 pages/);
  assert.equal(capped.truncated, true);
  const refused = await readAllPages(async () => new Response("no", { status: 403 }), "/x", {
    maxPages: 2,
  });
  assert.deepEqual(refused, { items: [], problem: "page 1 of /x returned 403", truncated: false });
});

test("installationToken narrows the token to what was asked for", async () => {
  const { privateKey } = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign"],
  );
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url: String(url), body: init?.body });
    if (String(url).endsWith("/installation")) return Response.json({ id: 7 });
    return Response.json({ token: "t", expires_at: "2030-01-01T00:00:00Z" });
  };
  const got = await installationToken({
    appId: "1",
    privateKey,
    userAgent: "test",
    owner: "o",
    repo: "r",
    repositories: ["r"],
    permissions: { contents: "write" },
    fetcher,
  });
  assert.deepEqual(got, {
    token: "t",
    expiresAt: Date.parse("2030-01-01T00:00:00Z"),
    installationId: "7",
  });
  assert.equal(calls[1].url, "https://api.github.com/app/installations/7/access_tokens");
  assert.deepEqual(JSON.parse(calls[1].body), {
    repositories: ["r"],
    permissions: { contents: "write" },
  });
  const missing = installationToken({
    appId: "1",
    privateKey,
    userAgent: "test",
    owner: "o",
    repo: "r",
    fetcher: async () => new Response("Not Found", { status: 404 }),
  });
  await assert.rejects(missing, /not installed on this repo/);
});

test("parsePrUrl takes a pull request URL and nothing that merely mentions one", () => {
  assert.deepEqual(parsePrUrl(" https://github.com/o/r.js/pull/12/files "), {
    owner: "o",
    repo: "r.js",
    number: 12,
  });
  assert.equal(parsePrUrl("see https://github.com/o/r/pull/12"), null);
  assert.equal(parsePrUrl("https://github.com/o/r/issues/12"), null);
});
