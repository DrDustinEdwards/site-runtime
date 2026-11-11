// CSV: the formula guard, RFC 4180 quoting and the reader. Each case is one a spreadsheet or a careless copy got wrong.
import assert from "node:assert/strict";
import { test } from "node:test";
import { csvCell, csvResponse, parseCsv, recordsCsv, toCsv } from "../csv.mjs";

test("a text that a spreadsheet would run as a formula opens as text; a number stays a number", () => {
  for (const s of [
    "=1+1",
    "+1+1",
    "-2+3",
    "@SUM(A1)",
    "\tx",
    "\rx",
    "\nx",
    "＝1",
    "＋1",
    "－1",
    "＠x",
  ]) {
    assert.ok(parseCsv(csvCell(s))[0]?.[0]?.startsWith("'"), JSON.stringify(s));
  }
  assert.equal(csvCell("-5.00"), "-5.00");
  assert.equal(csvCell(-5), "-5");
  assert.equal(csvCell("plain"), "plain");
});

test("quotes, commas, line breaks and lists are written and read back the same", () => {
  const row = [
    "a,b",
    'say "hi"',
    "two\r\nlines",
    null,
    ["x", "y"],
    true,
    new Date(Date.UTC(2026, 0, 2)),
  ];
  const csv = toCsv(["1", "2", "3", "4", "5", "6", "7"], [row]);
  assert.ok(csv.endsWith("\r\n"));
  assert.deepEqual(parseCsv(csv)[1], [
    "a,b",
    'say "hi"',
    "two\r\nlines",
    "",
    "x; y",
    "true",
    "2026-01-02T00:00:00.000Z",
  ]);
  assert.equal(recordsCsv([{ id: 1, title: "A" }, { id: 2 }]), "id,title\r\n1,A\r\n2,\r\n");
  assert.deepEqual(parseCsv('\uFEFFa,b\nc,d\re,"f"\n'), [
    ["a", "b"],
    ["c", "d"],
    ["e", "f"],
  ]);
});

test("a download keeps a file name with any character", () => {
  const r = csvResponse("a\r\n", 'Résumé "x".csv');
  assert.equal(r.headers.get("content-type"), "text/csv; charset=utf-8");
  assert.equal(
    r.headers.get("content-disposition"),
    `attachment; filename="R_sum_ _x_.csv"; filename*=UTF-8''R%C3%A9sum%C3%A9%20%22x%22.csv`,
  );
});
