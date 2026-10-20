import assert from "node:assert/strict";
import { test } from "node:test";

import { escapeHtml } from "../html.mjs";

test("escapes the five characters, each to the entity the copies it replaces used", () => {
  assert.equal(escapeHtml(`&<>"'`), "&amp;&lt;&gt;&quot;&#39;");
});

test("PLANT: a single quote cannot end a single-quoted attribute", () => {
  assert.equal(escapeHtml("x' onmouseover='alert(1)"), "x&#39; onmouseover=&#39;alert(1)");
});

test("an ampersand is escaped once, so an entity in the text shows as typed", () => {
  assert.equal(escapeHtml("&amp; &lt;"), "&amp;amp; &amp;lt;");
});

test("everything else is unchanged, non-ASCII and the empty string included", () => {
  assert.equal(escapeHtml(""), "");
  assert.equal(escapeHtml("Café — naïve 🦊 `code` = / \\"), "Café — naïve 🦊 `code` = / \\");
});

test("a value that is not a string is made one, as a template literal would", () => {
  assert.equal(escapeHtml(42), "42");
  assert.equal(escapeHtml(null), "null");
  assert.equal(escapeHtml({ toString: () => "<b>" }), "&lt;b&gt;");
});
