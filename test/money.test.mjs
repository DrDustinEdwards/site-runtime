// The minor unit is not always a hundredth: the cases that got it wrong before (Recova's 5,000 yen read as 50), the
// currencies Stripe sends oddly, a code Intl refuses, and what a typed figure may be.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  formatMoney,
  formatMoneyShort,
  moneyInputValue,
  parseMoneyInput,
  toMajorUnits,
} from "../money.mjs";

test("formatMoney: the stored unit follows the currency, and a site's own scale overrides it", () => {
  assert.equal(formatMoney(4500, "usd"), "$45.00");
  assert.equal(formatMoney(5000, "JPY"), "¥5,000");
  assert.equal(formatMoney(5000, "kwd"), "KWD 5.000");
  assert.equal(formatMoney(50000, "isk"), "ISK 500"); // sent as hundredths, shown whole
  assert.equal(formatMoney(12_340, "usd", { scale: 3 }), "$12.34"); // mills
  assert.equal(formatMoney(2_500_000, "usd", { scale: 6 }), "$2.50"); // micros
  assert.equal(formatMoneyShort(1060, "usd"), "$11");
});

test("formatMoney: a code Intl refuses still prints, never throws", () => {
  assert.equal(formatMoney(5000, "not-a-code"), "50.00 NOT-A-CODE");
});

test("moneyInputValue and parseMoneyInput round-trip, and refuse what is not a plain figure", () => {
  assert.equal(moneyInputValue(4500, "usd"), "45.00");
  assert.equal(moneyInputValue(5000, "jpy"), "5000");
  assert.equal(moneyInputValue(null, "usd"), "");
  assert.equal(parseMoneyInput("1,250.50", "usd"), 125_050);
  assert.equal(parseMoneyInput(" 45 ", "usd"), 4500);
  assert.equal(parseMoneyInput("5000", "jpy"), 5000);
  assert.equal(parseMoneyInput("0.1", "usd"), 10);
  assert.equal(parseMoneyInput("12.5", "usd", { scale: 6 }), 12_500_000);
  for (const bad of ["", "  ", "-5", "$45", "abc", "1e3", "4.5.0", null]) {
    assert.equal(parseMoneyInput(bad, "usd"), null, String(bad));
  }
  assert.equal(toMajorUnits(5000, "kwd"), 5);
});
