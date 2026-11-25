import { createAuthMiddleware, APIError } from "better-auth/api";

import { safeEqual } from "./compare.mjs";
import { base64url, sha256Hex } from "./encoding.mjs";
import { OWASP_EVENTS } from "./log.mjs";
import { logAuthEvent, outcome } from "./sign-in-account.mjs";
import { CODE_COOKIE, SIGN_IN_EXPIRES_IN_SECONDS } from "./sign-in-link.mjs";
import { APP_CODE_PATH, SIGN_IN_CODE_PATH } from "./sign-in-limits.mjs";

/**
 * Where the code's browser binding is stored, in Better Auth's verification table. Not under the email OTP plugin's
 * `<type>-otp-<address>`, which an address such as `browser-<address>` could reach.
 */
const codeBrowserId = (/** @type {string} */ email) => `code-browser:${email.toLowerCase()}`;

/**
 * The code works only in the browser that asked for it (see the top of this file). After a request that mailed a
 * sign-in code, the binding is made; before a typed code is read, it is checked; after a sign-in by code, it is spent.
 */
export function codeBrowser() {
  /** @param {any} ctx */
  const cookieOf = (ctx) =>
    ctx.context.createAuthCookie(CODE_COOKIE, { maxAge: SIGN_IN_EXPIRES_IN_SECONDS });
  return {
    id: "sign-in-code-browser",
    hooks: {
      before: [
        {
          /** @param {{ path?: string }} ctx */
          matcher: (ctx) => ctx.path === SIGN_IN_CODE_PATH,
          handler: createAuthMiddleware(async (ctx) => {
            const email = ctx.body?.email;
            const held = await Promise.resolve(
              ctx.getSignedCookie(cookieOf(ctx).name, ctx.context.secret),
            ).catch(() => null);
            const row =
              typeof email === "string" && email
                ? await ctx.context.internalAdapter.findVerificationValue(codeBrowserId(email))
                : null;
            const bound =
              typeof held === "string" &&
              held &&
              row &&
              new Date(row.expiresAt) > new Date() &&
              (await safeEqual(await sha256Hex(held), String(row.value)));
            if (bound) return;
            await logAuthEvent({
              event: OWASP_EVENTS.signInFailure,
              fields: { via: "code", code: "CODE_OTHER_BROWSER" },
              level: "warn",
              email,
            });
            throw new APIError("BAD_REQUEST", {
              code: "CODE_OTHER_BROWSER",
              message:
                "Type the code in the browser that asked for it, or use the link in the email.",
            });
          }),
        },
      ],
      after: [
        {
          /** @param {{ path?: string, body?: { type?: unknown } }} ctx */
          matcher: (ctx) =>
            ctx.path === "/sign-in/magic-link" ||
            (ctx.path === APP_CODE_PATH && ctx.body?.type === "sign-in") ||
            ctx.path === SIGN_IN_CODE_PATH,
          handler: createAuthMiddleware(async (ctx) => {
            const email = ctx.body?.email;
            if (typeof email !== "string" || !email || !outcome(ctx.context.returned).ok) return;
            const cookie = cookieOf(ctx);
            await ctx.context.internalAdapter.deleteVerificationByIdentifier(codeBrowserId(email));
            if (ctx.path === SIGN_IN_CODE_PATH) {
              ctx.setCookie(cookie.name, "", { ...cookie.attributes, maxAge: 0 });
              return;
            }
            const held = base64url(crypto.getRandomValues(new Uint8Array(32)));
            await ctx.context.internalAdapter.createVerificationValue({
              identifier: codeBrowserId(email),
              value: await sha256Hex(held),
              expiresAt: new Date(Date.now() + SIGN_IN_EXPIRES_IN_SECONDS * 1000),
            });
            await ctx.setSignedCookie(cookie.name, held, ctx.context.secret, cookie.attributes);
          }),
        },
      ],
    },
  };
}
