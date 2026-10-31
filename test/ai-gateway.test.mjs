// The one routing decision for the sites' Anthropic calls. PLANT tests fail if the guard they name is removed.
import assert from "node:assert/strict";
import { test } from "node:test";

import { AI_GATEWAY_HEADERS, ANTHROPIC_ORIGIN, anthropicRoute } from "../ai-gateway.mjs";

const GATEWAY = "https://gateway.ai.cloudflare.com/v1/acct_test/sample/anthropic";

test("unset: Anthropic directly, with no gateway header", () => {
  assert.deepEqual(anthropicRoute({}, "sample"), { baseURL: ANTHROPIC_ORIGIN, headers: {}, gateway: false, gatewayId: null });
  assert.deepEqual(anthropicRoute({ AI_GATEWAY_BASE_URL: "  ", AI_GATEWAY_TOKEN: "t" }, "sample").headers, {});
});

test("set: the gateway, bodies not logged, the site named, the token sent", () => {
  const route = anthropicRoute({ AI_GATEWAY_BASE_URL: `${GATEWAY}/`, AI_GATEWAY_TOKEN: "tok" }, "sample");
  assert.equal(route.baseURL, GATEWAY);
  assert.equal(route.gateway, true);
  assert.equal(route.gatewayId, "sample");
  assert.deepEqual(route.headers, {
    "cf-aig-collect-log-payload": "false",
    "cf-aig-metadata": '{"app":"sample"}',
    "cf-aig-authorization": "Bearer tok",
  });
});

test("a feature joins the site in the log metadata; a custom domain takes its id from AI_GATEWAY_ID", () => {
  assert.equal(anthropicRoute({ AI_GATEWAY_BASE_URL: GATEWAY }, "sample", "drafts").headers["cf-aig-metadata"], '{"app":"sample","feature":"drafts"}');
  const custom = { AI_GATEWAY_BASE_URL: "https://ai.example.com/anthropic" };
  assert.equal(anthropicRoute(custom, "sample").gatewayId, null);
  assert.equal(anthropicRoute({ ...custom, AI_GATEWAY_ID: "sample" }, "sample").gatewayId, "sample");
});

test("PLANT: the header names are the ones Cloudflare documents, spelled exactly", () => {
  // A near miss is silently ignored by the gateway: bodies stored, or every call refused as unauthenticated.
  assert.deepEqual({ ...AI_GATEWAY_HEADERS }, {
    auth: "cf-aig-authorization",
    bodyLog: "cf-aig-collect-log-payload",
    metadata: "cf-aig-metadata",
  });
});

test("PLANT: a set but wrong URL throws instead of sending calls elsewhere", () => {
  for (const bad of ["http://gateway.ai.cloudflare.com/v1/a/g/anthropic", "https://gateway.ai.cloudflare.com/v1/a/g", "https://ai.example.com/notanthropic", "gateway"]) {
    assert.throws(() => anthropicRoute({ AI_GATEWAY_BASE_URL: bad }, "sample"), /AI_GATEWAY_BASE_URL/);
  }
});
