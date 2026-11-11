import assert from "node:assert/strict";
import { test } from "node:test";
import { csvCell, toCsv } from "../csv.mjs";

test("csvCell neutralizes formulas but keeps plain numbers, and quotes per RFC 4180", () => {
  assert.equal(
    csvCell('=HYPERLINK("http://x.example","y")'),
    `"'=HYPERLINK(""http://x.example"",""y"")"`,
  );
  assert.equal(csvCell("@SUM(A1)"), "'@SUM(A1)");
  assert.equal(csvCell("+1+cmd|' /C calc'!A0"), "'+1+cmd|' /C calc'!A0");
  assert.equal(csvCell("\t=1"), "'\t=1");
  assert.equal(csvCell("-5.00"), "-5.00");
  assert.equal(csvCell(-5), "-5");
  assert.equal(csvCell("a,b"), '"a,b"');
  assert.equal(csvCell(null), "");
  assert.equal(toCsv(["a", "b"], [[1, "x\ny"]]), 'a,b\r\n1,"x\ny"\r\n');
});
