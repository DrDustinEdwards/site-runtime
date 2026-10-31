// The live speed check: a site that does everything right has no errors, and each planted gap fails its own item.
import assert from "node:assert/strict";
import { test } from "node:test";

import { speedFindings } from "../speed.mjs";

const page = (url, headers = {}) => ({
  url,
  status: 200,
  ttfb: 50,
  body: "<p>",
  headers: {
    "content-type": "text/html; charset=utf-8",
    "cf-cache-status": "HIT",
    "cache-control": "public, max-age=0",
    "content-encoding": "zstd",
    "last-modified": "Fri, 30 Oct 2026 00:00:00 GMT",
    "server-timing": "render;dur=12.0",
    link: "</a.woff2>; rel=preload; as=font",
    "speculation-rules": '"/speculation-rules.json"',
    "alt-svc": 'h3=":443"',
    ...headers,
  },
});
const clean = () => ({
  origin: "https://example.com",
  base: "https://example.com",
  kind: "site",
  first: [page("https://example.com/")],
  second: [page("https://example.com/"), page("https://example.com/about")],
  conditional: [{ ...page("https://example.com/"), status: 304 }],
  files: [{ url: "https://example.com/assets/app-AbCdEf12.js", status: 200, ttfb: 10, body: "", headers: { "cache-control": "public, max-age=31536000, immutable", "content-encoding": "br" } }],
  misses: [{ ...page("https://example.com/?speedcheck=a"), ttfb: 300 }],
  hits: [page("https://example.com/")],
  withCookie: page("https://example.com/", { "cache-control": "private, no-store" }),
  missing: [{ url: "https://example.com/x", status: 404, ttfb: 10, body: "", headers: { "cf-cache-status": "MISS" } }],
  campaign: page("https://example.com/?utm_source=a"),
  redirects: { http: [{ url: "http://example.com/", status: 301 }, { url: "https://example.com/", status: 200 }] },
  earlyHints: [103],
  pagespeed: {},
});
const items = (findings) => findings.filter((f) => f.severity === "error").map((f) => f.item).sort();

test("a site that does everything right has no errors", () => {
  assert.deepEqual(items(speedFindings(clean())), []);
});

test("PLANT: each gap fails its own item", () => {
  const o = clean();
  o.second[1] = page("https://example.com/about", { "cf-cache-status": "MISS", "last-modified": "", "server-timing": "" });
  o.campaign = page("https://example.com/?utm_source=a", { "cf-cache-status": "MISS" });
  o.withCookie = page("https://example.com/");
  o.files[0].headers["cache-control"] = "public, max-age=0";
  o.redirects.http.splice(1, 0, { url: "https://www.example.com/", status: 301 });
  o.earlyHints = [];
  delete o.hits[0].headers["speculation-rules"];
  o.second[0].headers["speculation-rules"] = '"/cdn-cgi/speculation"';
  assert.deepEqual(items(speedFindings(o)), ["B1", "B4", "B5", "B7", "C1", "C5", "D1", "E1", "F3"]);
});

test("a 404 is judged by its cache-control: static assets' HIT without an Age passes, a storable 404 fails", () => {
  const missing = (headers) => ({ url: "https://example.com/x", status: 404, ttfb: 10, body: "", headers });
  const run = (headers) => {
    const o = clean();
    o.missing = [missing(headers), missing(headers)];
    return items(speedFindings(o));
  };
  assert.deepEqual(run({ "cf-cache-status": "HIT", "cache-control": "private, no-store" }), []);
  assert.deepEqual(run({ "cf-cache-status": "HIT", "cache-control": "private, no-store", age: "40" }), ["B4"]);
  assert.deepEqual(run({ "cf-cache-status": "MISS", "cache-control": "public, max-age=300" }), ["B4"]);
  assert.deepEqual(run({ "cf-cache-status": "HIT" }), ["B4"]);
});

test("only a hash-like token makes a file immutable: apple-touch-icon.png revalidates, a bundler hash does not", () => {
  const file = (name, cc) => ({ url: `https://example.com${name}`, status: 200, ttfb: 10, body: "", headers: { "cache-control": cc, "content-encoding": "br", "last-modified": "Fri, 30 Oct 2026 00:00:00 GMT" } });
  const run = (...files) => {
    const o = clean();
    o.files = files;
    return items(speedFindings(o));
  };
  const revalidate = "public, max-age=0, must-revalidate";
  assert.deepEqual(run(file("/apple-touch-icon.png", revalidate), file("/logo-mayo-clinic.svg", revalidate), file("/icon-1024x1024.png", revalidate)), []);
  assert.deepEqual(run(file("/root-DYYv4ssa.css", revalidate), file("/inter-latin-opsz-normal-BwkfbSeq.woff2", revalidate)), ["C1", "C1"]);
});
