// writeIntegrity: the tags a build wrote for its own scripts get the file's sha384, under the served base; others are kept.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { integrityHash } from "../csp.mjs";
import { writeIntegrity } from "../sri.mjs";

test("writeIntegrity marks the build's own scripts and modulepreloads, under the base", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sri-"));
  mkdirSync(join(dir, "assets"));
  mkdirSync(join(dir, "make"));
  writeFileSync(join(dir, "assets", "a.js"), "export const a = 1;");
  writeFileSync(join(dir, "theme.js"), "1;");
  const page = [
    '<script src="/portal/theme.js"></script>',
    '<script type="module" crossorigin src="/portal/assets/a.js"></script>',
    '<link rel="modulepreload" crossorigin href="../assets/a.js">',
    '<link rel="stylesheet" href="/portal/assets/a.js">',
    '<script src="https://static.example/x.js"></script>',
    '<script src="/portal/missing.js"></script>',
    '<script src="/other/theme.js"></script>',
    '<script type="application/ld+json">{}</script>',
  ].join("\n");
  writeFileSync(join(dir, "make", "index.html"), page);
  assert.equal(await writeIntegrity(dir, { base: "/portal/" }), 3);
  const a = await integrityHash("export const a = 1;");
  const lines = readFileSync(join(dir, "make", "index.html"), "utf8").split("\n");
  assert.deepEqual(lines.slice(0, 3), [
    `<script src="/portal/theme.js" integrity="${await integrityHash("1;")}" crossorigin="anonymous"></script>`,
    `<script type="module" crossorigin src="/portal/assets/a.js" integrity="${a}"></script>`,
    `<link rel="modulepreload" crossorigin href="../assets/a.js" integrity="${a}">`,
  ]);
  assert.deepEqual(lines.slice(3), page.split("\n").slice(3));
  assert.equal(await writeIntegrity(dir, { base: "/portal/" }), 0, "a tag with integrity is left alone");
});
