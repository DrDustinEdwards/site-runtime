import { APIError, createAuthMiddleware, getOAuthState, getSessionFromCtx } from "better-auth/api";

import { base64url, fromBase64urlText } from "./encoding.mjs";
import { OWASP_EVENTS, logEvent } from "./log.mjs";
import {
  DEVICE_COOKIE,
  DEVICE_COOKIE_SECONDS,
  FRESH_SECONDS,
  authEvent,
  coarseLocation,
  deviceName,
  hadPasskey,
  isNewSignInDevice,
  logAuthEvent,
  noticeDetail,
  sendNoticeSafely,
  sessionIsFresh,
  signedInDeviceIds,
  signedInDevices,
} from "./sign-in-account.mjs";

/** @typedef {import("./sign-in-account.mjs").SendSecurityNotice} SendSecurityNotice */

/** Better Auth endpoints whose own check has no age limit in 1.7.25, held to FRESH_SECONDS here. */
const FRESH_PATHS = new Set(["/passkey/delete-passkey", "/change-email"]);

/**
 * The device id for a new session: the signed DEVICE_COOKIE's when the browser brought one, else a new random one; the
 * cookie is set again either way, so it lasts DEVICE_COOKIE_SECONDS from the latest sign-in.
 * @param {any} ctx the endpoint making the session
 * @returns {Promise<string | null>}
 */
async function deviceId(ctx) {
  if (!ctx?.context?.createAuthCookie || typeof ctx.setSignedCookie !== "function") return null;
  const cookie = ctx.context.createAuthCookie(DEVICE_COOKIE, { maxAge: DEVICE_COOKIE_SECONDS });
  const brought = await Promise.resolve(
    ctx.getSignedCookie?.(cookie.name, ctx.context.secret),
  ).catch(() => null);
  const id =
    typeof brought === "string" && /^[\w-]{16,64}$/.test(brought)
      ? brought
      : base64url(crypto.getRandomValues(new Uint8Array(16)));
  await ctx.setSignedCookie(cookie.name, id, ctx.context.secret, cookie.attributes);
  return id;
}

/**
 * The auth event log and the security notices (`./sign-in-account.mjs`) as one plugin: an after hook on every endpoint,
 * and database hooks for what only the rows show (a linked or unlinked account's provider, both addresses of an email
 * change, a deleted user's address). Every hook catches its own errors, logged as `auth_event_failed`: a throw from an
 * after hook would turn a change already made into an error answer. A notice goes through Better Auth's
 * `runInBackgroundOrAwait`, so a site with `advanced.backgroundTasks` (waitUntil) answers before the mail is sent.
 * Its before hook holds passkey delete and email change to FRESH_SECONDS. A sign-in from a device the person's
 * sessions and history have not shown is told as `new-device`; a sign-in by link or code with no passkey left, by
 * someone whose history shows one, is a recovery: told, and every other session ended, as after an email change.
 * With `details` (`sessionDetails`) a new session gets its place and device id (database hook), a sign-in's row its
 * device id, and the new-device check reads device ids where the person has any (`isNewSignInDevice`).
 * @param {string} siteName
 * @param {SendSecurityNotice | undefined} sendSecurityNotice
 * @param {import("./sign-in-account.mjs").D1Like | null} db
 * @param {boolean} details
 */
export function accountEvents(siteName, sendSecurityNotice, db, details) {
  /** @typedef {{ path?: string, query?: Record<string, unknown>, headers?: Headers, request?: Request, context?: any } | null | undefined} HookContext */
  /** @typedef {{ id: string, email: string, name?: string | null }} User */
  /** @type {WeakMap<object, string>} the address an update is about to replace, by the request it runs in */
  const replacedEmail = new WeakMap();

  /**
   * @param {HookContext} ctx
   * @param {import("./sign-in-account.mjs").SecurityNoticeKind} kind
   * @param {User | null | undefined} user
   * @param {Omit<Parameters<typeof noticeDetail>[1], "siteName">} [facts]
   */
  const notify = async (ctx, kind, user, facts = {}) => {
    if (!sendSecurityNotice || !user?.email) return;
    const request = ctx?.request;
    const detail = noticeDetail(kind, {
      siteName,
      request,
      userAgent: ctx?.headers?.get("user-agent"),
      ...facts,
    });
    const notice = {
      user: { id: user.id, email: user.email, name: user.name ?? null },
      ...(request ? { request } : {}),
      detail,
    };
    const sending = sendNoticeSafely(sendSecurityNotice, kind, notice);
    await (ctx?.context?.runInBackgroundOrAwait
      ? ctx.context.runInBackgroundOrAwait(sending)
      : sending);
  };
  /**
   * The event's line, and its row with `eventsDb`.
   * @param {Parameters<typeof logAuthEvent>[0]} event
   * @param {HookContext} ctx
   */
  const log = (event, ctx) =>
    logAuthEvent(event, {
      db,
      request: ctx?.request,
      userAgent: ctx?.headers?.get("user-agent"),
      ...(details
        ? {
            deviceId:
              ctx?.context?.newSession?.session?.deviceId ??
              ctx?.context?.session?.session?.deviceId ??
              null,
          }
        : {}),
    });
  /**
   * Ends every session of the user but `keep` (the one that made the change, when it is theirs).
   * @param {HookContext} ctx
   * @param {string} userId
   * @param {string | undefined} keep
   * @param {string} reason
   */
  const endOtherSessions = async (ctx, userId, keep, reason) => {
    const adapter = ctx?.context?.internalAdapter;
    if (!adapter) return;
    const tokens = (await adapter.listSessions(userId))
      .map((/** @type {{ token: string }} */ row) => row.token)
      .filter((/** @type {string} */ token) => token !== keep);
    if (tokens.length === 0) return;
    await adapter.deleteSessions(tokens);
    await log(
      { event: OWASP_EVENTS.sessionExpired, fields: { reason, scope: "others", user_id: userId } },
      ctx,
    );
  };
  /**
   * What a new session is besides a sign-in: a recovery (link or code, no passkey left, one in the history), a new
   * device, or neither. Read before this sign-in's own row is written.
   * @param {any} ctx
   * @param {User} user
   * @param {{ session: { token: string, userAgent?: string | null, deviceId?: string | null } }} newSession
   * @param {unknown} via
   * @returns {Promise<"recovery" | "new-device" | null>}
   */
  const signInKind = async (ctx, user, newSession, via) => {
    if (db && (via === "link" || via === "code")) {
      const passkeys = await ctx.context.adapter.count({
        model: "passkey",
        where: [{ field: "userId", value: user.id }],
      });
      if (passkeys === 0 && (await hadPasskey(db, user.id))) return "recovery";
    }
    /** @type {{ token: string, userAgent?: string | null, deviceId?: string | null }[]} */
    const others = (await ctx.context.internalAdapter.listSessions(user.id)).filter(
      (/** @type {{ token: string }} */ row) => row.token !== newSession.session.token,
    );
    const names = others.map((row) => deviceName(row.userAgent));
    const ids = details ? others.map((row) => row.deviceId ?? null) : [];
    if (db) names.push(...(await signedInDevices(db, user.id)));
    if (db && details) ids.push(...(await signedInDeviceIds(db, user.id)));
    const device = {
      id: details ? (newSession.session.deviceId ?? null) : null,
      name: deviceName(newSession.session.userAgent ?? ctx.headers?.get("user-agent")),
    };
    return isNewSignInDevice(device, { ids, names }) ? "new-device" : null;
  };
  /** Runs a hook's work, and logs instead of throwing. @param {() => Promise<void>} run */
  const safely = async (run) => {
    try {
      await run();
    } catch (error) {
      logEvent("auth_event_failed", { error }, { level: "error" });
    }
  };

  return {
    id: "sign-in-account-events",
    init: () => ({
      options: {
        databaseHooks: {
          ...(details
            ? {
                session: {
                  create: {
                    // The place and device of the sign-in (`sessionDetails`); a failure leaves them blank, never the sign-in.
                    before: async (/** @type {any} */ session, /** @type {any} */ ctx) => {
                      try {
                        return {
                          data: {
                            ...session,
                            location: coarseLocation(ctx?.request),
                            deviceId: await deviceId(ctx),
                          },
                        };
                      } catch (error) {
                        logEvent("auth_event_failed", { error }, { level: "error" });
                        return { data: session };
                      }
                    },
                  },
                },
              }
            : {}),
          account: {
            create: {
              // A link, not a sign-up: the account joins a user who was signed in (/link-social) or who began the
              // OAuth flow as a link (/callback/:id, whose state names the user).
              after: (/** @type {any} */ account, /** @type {HookContext} */ ctx) =>
                safely(async () => {
                  if (!account || !ctx) return;
                  /** @type {User | null | undefined} */
                  let user = null;
                  if (ctx.path === "/link-social") user = ctx.context?.session?.user;
                  else if (
                    ctx.path === "/callback/:id" &&
                    (await getOAuthState())?.link?.userId === account.userId
                  ) {
                    user = await ctx.context?.internalAdapter.findUserById(account.userId);
                  }
                  if (!user || user.id !== account.userId) return;
                  await log(
                    {
                      event: OWASP_EVENTS.userUpdated,
                      fields: {
                        change: "sign_in_linked",
                        via: account.providerId,
                        user_id: user.id,
                      },
                    },
                    ctx,
                  );
                  await notify(ctx, "sign-in-linked", user, { provider: account.providerId });
                }),
            },
            delete: {
              // Only an unlink; deleting a user deletes its accounts too, and that is told as the deletion.
              after: (/** @type {any} */ account, /** @type {HookContext} */ ctx) =>
                safely(async () => {
                  if (!account || ctx?.path !== "/unlink-account") return;
                  await log(
                    {
                      event: OWASP_EVENTS.userUpdated,
                      fields: {
                        change: "sign_in_unlinked",
                        via: account.providerId,
                        user_id: account.userId,
                      },
                    },
                    ctx,
                  );
                  await notify(ctx, "sign-in-unlinked", ctx.context?.session?.user, {
                    provider: account.providerId,
                  });
                }),
            },
          },
          user: {
            update: {
              // The address being replaced: the signed-in user's (/change-email, or /verify-email from a signed-in
              // browser), else the one in /verify-email's token, which Better Auth has verified before it updates.
              before: (/** @type {any} */ data, /** @type {HookContext} */ ctx) =>
                safely(async () => {
                  if (typeof data?.email !== "string" || !ctx) return;
                  const old =
                    ctx.context?.session?.user?.email ??
                    (ctx.path === "/verify-email" ? emailInToken(ctx.query?.token) : null);
                  if (typeof old === "string") replacedEmail.set(ctx, old);
                }),
              after: (/** @type {any} */ user, /** @type {HookContext} */ ctx) =>
                safely(async () => {
                  const old = ctx ? replacedEmail.get(ctx) : undefined;
                  if (
                    !old ||
                    !user?.email ||
                    old.toLowerCase() === String(user.email).toLowerCase()
                  )
                    return;
                  if (ctx) replacedEmail.delete(ctx);
                  await log(
                    {
                      event: OWASP_EVENTS.userUpdated,
                      fields: { change: "email_changed", user_id: user.id },
                    },
                    ctx,
                  );
                  const facts = { oldEmail: old, newEmail: user.email };
                  await notify(ctx, "email-changed", user, facts);
                  await notify(
                    ctx,
                    "email-changed",
                    { ...user, email: old },
                    { ...facts, toOldAddress: true },
                  );
                  const current = ctx?.context?.session;
                  await endOtherSessions(
                    ctx,
                    user.id,
                    current?.user?.id === user.id ? current.session?.token : undefined,
                    "email_changed",
                  );
                }),
            },
            delete: {
              after: (/** @type {any} */ user, /** @type {HookContext} */ ctx) =>
                safely(async () => {
                  if (!user) return;
                  await logAuthEvent({
                    event: OWASP_EVENTS.userDeleted,
                    fields: { user_id: user.id },
                  });
                  // Their history goes with them; the log line above stays.
                  if (db)
                    await db
                      .prepare("DELETE FROM auth_events WHERE user_id = ?1")
                      .bind(user.id)
                      .run();
                  await notify(ctx, "account-deleted", user);
                }),
            },
          },
        },
      },
    }),
    hooks: {
      before: [
        {
          /** @param {{ path?: string }} ctx */
          matcher: (ctx) => FRESH_PATHS.has(ctx.path ?? ""),
          handler: createAuthMiddleware(async (ctx) => {
            const found = await getSessionFromCtx(ctx);
            const freshAge = ctx.context.sessionConfig?.freshAge ?? FRESH_SECONDS;
            if (!found?.session || freshAge === 0 || sessionIsFresh(found.session, freshAge))
              return;
            await safely(() =>
              log(
                {
                  event: OWASP_EVENTS.authorizationFailure,
                  fields: {
                    reason: "SESSION_NOT_FRESH",
                    endpoint: ctx.path,
                    user_id: found.user.id,
                  },
                  level: "warn",
                },
                ctx,
              ),
            );
            throw new APIError("FORBIDDEN", {
              code: "SESSION_NOT_FRESH",
              message: "Session is not fresh",
            });
          }),
        },
      ],
      after: [
        {
          matcher: () => true,
          handler: createAuthMiddleware((ctx) =>
            safely(async () => {
              const newSession = ctx.context.newSession;
              /** @type {User | undefined} */
              const user = ctx.context.session?.user ?? newSession?.user;
              const event = authEvent({
                path: ctx.path,
                params: ctx.params,
                body: ctx.body,
                returned: ctx.context.returned,
                signedIn: Boolean(newSession),
                userId: user?.id,
                linking: ctx.path === "/callback/:id" && Boolean((await getOAuthState())?.link),
              });
              if (!event) return;
              // The passkey that signed in, by its row id, so the account page can say when each was last used.
              if (
                event.event === OWASP_EVENTS.signInSuccess &&
                event.fields.via === "passkey" &&
                db
              ) {
                const credentialID = ctx.body?.response?.id;
                const row =
                  typeof credentialID === "string"
                    ? await ctx.context.adapter.findOne({
                        model: "passkey",
                        where: [{ field: "credentialID", value: credentialID }],
                      })
                    : null;
                if (row?.id) event.fields.passkey_id = row.id;
              }
              const kind =
                event.event === OWASP_EVENTS.signInSuccess && user && newSession
                  ? await signInKind(ctx, user, newSession, event.fields.via)
                  : null;
              await log(event, ctx);
              if (event.notice) await notify(ctx, event.notice.kind, user, event.notice);
              if (kind === "recovery" && user && newSession) {
                await log(
                  {
                    event: OWASP_EVENTS.userUpdated,
                    fields: { change: "recovered", via: event.fields.via, user_id: user.id },
                  },
                  ctx,
                );
                await endOtherSessions(ctx, user.id, newSession.session.token, "recovered");
              }
              if (kind) await notify(ctx, kind, user);
            }),
          ),
        },
      ],
    },
  };
}

/**
 * The `email` claim of /verify-email's token, read without a check because Better Auth has checked it in this request.
 * @param {unknown} token
 */
function emailInToken(token) {
  try {
    return JSON.parse(fromBase64urlText(String(token).split(".")[1])).email;
  } catch {
    return null;
  }
}
