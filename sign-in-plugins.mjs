import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { deleteSessionCookie } from "better-auth/cookies";

import { LOGOUT_HEADERS } from "./headers.mjs";
import { logEvent } from "./log.mjs";
import { coarseLocation, sessionTouch } from "./sign-in-account.mjs";
import { refuseDisposable } from "./sign-in-disposable.mjs";
import { SESSION_IDLE_SECONDS } from "./sign-in-limits.mjs";

// Refuses a disposable address (`./sign-in-form`, refuseDisposable) on a new account and on /change-email. `@__PURE__`
// on module-level createAuthMiddleware calls: without it a bundler keeps these objects, and NO_DISPOSABLE's 168 KB
// list, in every client chunk that imports a constant from here.
export const NO_DISPOSABLE = {
  id: "no-disposable-email",
  init: () => ({ options: { databaseHooks: { user: { create: { before: refuseDisposable } } } } }),
  hooks: {
    before: [
      {
        /** @param {{ path?: string }} ctx */
        matcher: (ctx) => ctx.path === "/change-email",
        handler: /* @__PURE__ */ createAuthMiddleware(async (ctx) => {
          const newEmail = /** @type {{ newEmail?: unknown } | undefined} */ (ctx.body)?.newEmail;
          if (typeof newEmail === "string") await refuseDisposable({ email: newEmail });
        }),
      },
    ],
  },
};

/**
 * Better Auth's /sign-out answers with Clear-Site-Data. A plugin's after hook rather than the options' `hooks.after`,
 * which a site with a hook of its own would replace without a word.
 */
export const SIGN_OUT_CLEARS = {
  id: "sign-out-clears-site-data",
  hooks: {
    after: [
      {
        /** @param {{ path?: string }} ctx */
        matcher: (ctx) => ctx.path === "/sign-out",
        handler: /* @__PURE__ */ createAuthMiddleware(async (ctx) => {
          for (const [name, value] of Object.entries(LOGOUT_HEADERS)) ctx.setHeader(name, value);
        }),
      },
    ],
  },
};

/**
 * The session columns `sessionDetails` writes (SESSION_DETAILS_SQL). Neither is taken from a client; the device id is
 * never sent to one, since it is the cookie's value.
 */
export const SESSION_FIELDS = Object.freeze({
  location: Object.freeze({ type: "string", required: false, input: false }),
  deviceId: Object.freeze({ type: "string", required: false, input: false, returned: false }),
});

/**
 * A session read through /get-session (the browser's useSession, or the site's `auth.api.getSession`) moves its
 * `updatedAt` at most every SESSION_TOUCH_SECONDS (`sessionTouch`), after the answer through Better Auth's
 * `runInBackgroundOrAwait`; that is what the idle limit counts from. With `sessionDetails` it also fills the session's
 * place from the request's `cf`, so a site's own `auth.api.getSession` passes the request as well, through
 * `sessionLookup(request)`: `getSession(sessionLookup(request))`. A failed write is logged (`session_touch_failed`) and
 * never fails the read.
 * @param {boolean} details
 */
export function sessionTouchPlugin(details) {
  return {
    id: "sign-in-session-touch",
    hooks: {
      after: [
        {
          /** @param {{ path?: string }} ctx */
          matcher: (ctx) => ctx.path === "/get-session",
          handler: createAuthMiddleware(async (ctx) => {
            const session =
              /** @type {{ session?: { token?: string, updatedAt?: Date, createdAt?: Date, location?: unknown } } | null} */ (
                ctx.context.returned
              )?.session;
            if (!session?.token) return;
            const update = sessionTouch(
              session,
              details ? coarseLocation(/** @type {any} */ (ctx.request)) : null,
            );
            if (!update) return;
            const writing = ctx.context.internalAdapter.updateSession(session.token, update).then(
              () => undefined,
              (/** @type {unknown} */ error) =>
                logEvent("session_touch_failed", { error }, { level: "error" }),
            );
            await ctx.context.runInBackgroundOrAwait(writing);
          }),
        },
      ],
    },
  };
}

/**
 * Ends a session unused for SESSION_IDLE_SECONDS (ASVS 5 v7.3.1): any request carrying its cookie (but a sign-out, which
 * is the end it wants) finds it by Better Auth's own session read, deletes it and clears the cookie; /get-session then
 * answers null, and any other route 401s with SESSION_IDLE. Runs before the route, so every route is covered, not only
 * the page's session read.
 * A function, not a top-level constant: a module-level `createAuthMiddleware(...)` call is kept by the bundler, which
 * pulled better-auth's server API (+52 KB gzip) into every auth page that imports `signInMethods`.
 */
export function sessionIdlePlugin() {
  return {
    id: "sign-in-session-idle",
    hooks: {
      before: [
        {
          /** @param {{ path?: string, headers?: Headers }} ctx */
          matcher: (ctx) =>
            ctx.path !== "/sign-out" && /session_token=/.test(ctx.headers?.get("cookie") ?? ""),
          handler: createAuthMiddleware(async (ctx) => {
            const found = await getSessionFromCtx(ctx);
            if (!found?.session) return;
            const last = new Date(found.session.updatedAt ?? found.session.createdAt).getTime();
            if (!(Date.now() - last > SESSION_IDLE_SECONDS * 1000)) return;
            await ctx.context.internalAdapter.deleteSession(found.session.token);
            ctx.context.session = null;
            deleteSessionCookie(ctx);
            logEvent("session_idle_ended", {
              session_age_days: Math.floor((Date.now() - last) / 86_400_000),
            });
            if (ctx.path === "/get-session") return ctx.json(null);
            throw APIError.from("UNAUTHORIZED", { message: "Session idle", code: "SESSION_IDLE" });
          }),
        },
      ],
    },
  };
}

/**
 * The link request without Turnstile keys: refused (503 TURNSTILE_NOT_SET), unless the site set
 * `turnstile: "off-until-keys"`, which lets it through with a warning line each time.
 * @param {boolean} offUntilKeys
 */
export function noTurnstile(offUntilKeys) {
  return {
    id: "sign-in-turnstile-missing",
    hooks: {
      before: [
        {
          /** @param {{ path?: string }} ctx */
          matcher: (ctx) => ctx.path === "/sign-in/magic-link",
          handler: createAuthMiddleware(async () => {
            if (offUntilKeys) {
              logEvent(
                "turnstile_off_until_keys",
                { endpoint: "/sign-in/magic-link" },
                { level: "warn" },
              );
              return;
            }
            logEvent("turnstile_not_set", { endpoint: "/sign-in/magic-link" }, { level: "error" });
            throw new APIError("SERVICE_UNAVAILABLE", {
              code: "TURNSTILE_NOT_SET",
              message: "Sign-in by email is not available right now.",
            });
          }),
        },
      ],
    },
  };
}
