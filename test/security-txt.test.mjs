import assert from "node:assert/strict";
import { test } from "node:test";

import { securityTxt } from "../security-txt.mjs";

test("the RFC 9116 fields, an address made a mailto: URI, and no Expires is refused", () => {
  assert.equal(
    securityTxt({ origin: "https://example.com/", contact: "security@example.com", expires: "2027-09-28T00:00:00.000Z", policy: "https://example.com/security" }),
    "Contact: mailto:security@example.com\nExpires: 2027-09-28T00:00:00Z\nPolicy: https://example.com/security\nPreferred-Languages: en\nCanonical: https://example.com/.well-known/security.txt\n",
  );
  assert.throws(() => securityTxt({ origin: "https://example.com", contact: "https://example.com/report", expires: "" }));
});
