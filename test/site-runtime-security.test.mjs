import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { buildContentSecurityPolicy } from "../csp.mjs";
import { STANDARD_SECURITY_HEADERS } from "../headers.mjs";

const BIN = fileURLToPath(new URL("../bin/site-runtime-security.mjs", import.meta.url));
const run = (/** @type {string[]} */ args) =>
  new Promise((resolve) => execFile(process.execPath, [BIN, ...args], (error, stdout, stderr) => resolve({ code: error ? Number(error.code) : 0, stdout, stderr })));

test("the live check prints each finding as an annotation under its item id, exits 1 on errors and 2 when it cannot run", async () => {
  // One nonce for every response: the replay the check exists to catch.
  const nonce = "AAAAAAAAAAAAAAAAAAAAAA==";
  const page = { ...STANDARD_SECURITY_HEADERS, "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": buildContentSecurityPolicy({ reportUri: "/r", nonce }).value };
  const server = createServer((req, res) => {
    if (req.url === "/") res.writeHead(200, page).end(`<script nonce="${nonce}"></script>`);
    else res.writeHead(404, { ...page, "X-Powered-By": "Express" }).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(undefined)));
  const address = server.address();
  const from = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  try {
    const { code, stdout } = /** @type {any} */ (await run(["--origin", "https://example.com", "--from", from]));
    assert.equal(code, 1, stdout);
    assert.match(stdout, /^::warning title=registry::https:\/\/example\.com is not in the site registry/m);
    assert.match(stdout, new RegExp(`^::error title=C6::${from}/ two fetches carried the same nonce`, "m"));
    assert.match(stdout, /^::error title=H6::\S+\/sitemap\.xml \(404\) no header names the software/m);
    assert.match(stdout, /^::error title=T1::http:\/\/127\.0\.0\.1:\d+\/ answers 200/m);
    assert.match(stdout, /^::error title=D1::\S+security\.txt answers 404/m);
  } finally {
    server.close();
  }
  const unreachable = /** @type {any} */ (await run(["--origin", from]));
  assert.equal(unreachable.code, 2);
  assert.equal((/** @type {any} */ (await run([]))).code, 2);
});
