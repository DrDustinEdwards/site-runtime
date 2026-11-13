import assert from "node:assert/strict";
import { test } from "node:test";
import { signInWithPasskey, signalPasskeys } from "../sign-in-passkey.mjs";

test("a kept user handle signals only for the account that signed in with it", async () => {
  /** @type {Map<string, string>} */
  const store = new Map();
  /** @type {unknown[]} */
  const signals = [];
  Object.assign(globalThis, {
    localStorage: {
      getItem: (/** @type {string} */ k) => store.get(k) ?? null,
      setItem: (/** @type {string} */ k, /** @type {string} */ v) => void store.set(k, v),
    },
    PublicKeyCredential: {
      signalAllAcceptedCredentials: async (/** @type {unknown} */ o) => void signals.push(o),
    },
  });
  const client = {
    signIn: {
      passkey: async () => ({
        data: { user: { id: "user-a" } },
        webauthn: { response: { id: "cred-a", response: { userHandle: "handle-a" } } },
      }),
    },
  };
  await signInWithPasskey(client, { rpId: "example.com" });
  // Account B signs in later on the same browser: A's handle must not carry B's credential list.
  await signalPasskeys({ rpId: "example.com", user: "user-b", credentialIds: ["cred-b"] });
  assert.deepEqual(signals, []);
  await signalPasskeys({ rpId: "example.com", user: "user-a", credentialIds: ["cred-a"] });
  assert.deepEqual(signals, [
    { rpId: "example.com", userId: "handle-a", allAcceptedCredentialIds: ["cred-a"] },
  ]);
});
