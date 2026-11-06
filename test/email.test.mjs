// The guards every site's mail now relies on: no header injection through an address, no sign-in link in a logged
// error, and a refusal that comes back named instead of thrown.
import assert from "node:assert/strict";
import { test } from "node:test";

import { sendEmail } from "../email.mjs";

/** A binding that records what it was handed, or throws `error`. */
function binding(/** @type {unknown} */ error) {
  /** @type {unknown[]} */
  const sent = [];
  return {
    sent,
    async send(/** @type {unknown} */ message) {
      if (error) throw error;
      sent.push(message);
      return { messageId: "msg-1" };
    },
  };
}

const mail = {
  from: { email: "hello@example.com", name: 'Example "Co"' },
  to: "alex@example.com",
  subject: "Spring\r\nupdate",
  text: "Hi",
};

test("a send hands the binding a cleaned message and returns its id", async () => {
  const b = binding(null);
  assert.deepEqual(await sendEmail(b, mail), { sent: true, messageId: "msg-1" });
  assert.deepEqual(b.sent[0], {
    ...mail,
    from: { email: "hello@example.com", name: "Example Co" },
    subject: "Spring update",
  });
});

test("an address with a line break is refused before the binding is called", async () => {
  const b = binding(null);
  for (const bad of [
    { to: "alex@example.com\r\nBcc: sam@example.com" },
    { replyTo: "a@example.com\nBcc: x@example.com" },
  ]) {
    const outcome = await sendEmail(b, { ...mail, ...bad });
    assert.equal(outcome.sent ? "" : outcome.code, "header_line_break");
  }
  assert.equal(b.sent.length, 0);
});

test("a missing binding, sender or recipient is not_configured", async () => {
  for (const [b, m] of [
    [undefined, mail],
    [binding(null), { ...mail, from: " " }],
    [binding(null), { ...mail, to: [] }],
  ]) {
    const outcome = await sendEmail(/** @type {any} */ (b), /** @type {any} */ (m));
    assert.equal(outcome.sent ? "" : outcome.code, "not_configured");
  }
});

test("a refusal keeps the binding's code and cuts each secret and the recipient out of its message", async () => {
  const link = "https://example.com/sign-in?token=abc123";
  const err = Object.assign(
    new Error(`rejected mail to alex@example.com with ${link} and code 482913`),
    { code: "E_DELIVERY_FAILED" },
  );
  const outcome = await sendEmail(binding(err), mail, { secrets: [link, "482913"] });
  assert.deepEqual(outcome, {
    sent: false,
    code: "E_DELIVERY_FAILED",
    error: "rejected mail to [redacted] with [redacted] and code [redacted]",
  });
  const odd = await sendEmail(
    binding(Object.assign(new Error("x"), { code: "not a code\n" })),
    mail,
  );
  assert.equal(odd.sent ? "" : odd.code, "unknown");
});
