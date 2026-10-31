import assert from "node:assert/strict";
import { test } from "node:test";
import { isolationVerdict, refuseCrossSite } from "../origin.mjs";

const URL_ = "https://app.example.com/api/x";
const post = (/** @type {Record<string, string>} */ headers) => new Request(URL_, { method: "POST", headers });

test("refuseCrossSite: Fetch Metadata decides when sent, the Origin check when not", () => {
  assert.equal(refuseCrossSite(new Request(URL_, { headers: { "Sec-Fetch-Site": "cross-site" } })), null, "a GET goes on");
  for (const site of ["same-origin", "none"]) assert.equal(refuseCrossSite(post({ "Sec-Fetch-Site": site })), null, site);
  assert.equal(refuseCrossSite(post({ "Sec-Fetch-Site": "cross-site", Origin: "https://app.example.com" }))?.status, 403, "Fetch Metadata wins over a matching Origin");
  assert.equal(refuseCrossSite(post({ "Sec-Fetch-Site": "same-site" }))?.status, 403);
  assert.equal(refuseCrossSite(post({ "Sec-Fetch-Site": "same-site" }), {}, { sameSite: true }), null);
  assert.equal(refuseCrossSite(post({ Origin: "https://evil.example.com" }))?.status, 403);
  assert.equal(refuseCrossSite(post({})), null);
});

test("isolationVerdict: a cross-site subresource or post is refused; a top-level GET navigation is not", () => {
  const req = (/** @type {Record<string, string>} */ headers, method = "GET") => new Request(URL_, { method, headers });
  assert.equal(isolationVerdict(req({})).ok, true);
  assert.equal(isolationVerdict(req({ "Sec-Fetch-Site": "same-site" })).ok, true);
  const cross = { "Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "document" };
  assert.equal(isolationVerdict(req(cross)).reason, "navigation");
  assert.equal(isolationVerdict(req(cross, "POST")).ok, false);
  assert.equal(isolationVerdict(req({ ...cross, "Sec-Fetch-Dest": "object" })).ok, false);
  assert.equal(isolationVerdict(req({ "Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "no-cors", "Sec-Fetch-Dest": "image" })).ok, false);
});
