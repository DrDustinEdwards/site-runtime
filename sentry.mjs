/**
 * Error reports to Sentry, one project per site. A site turns them on by setting the `SENTRY_DSN`
 * secret on its Worker; with none, the SDK starts no client and nothing leaves the Worker. siteWorker and siteRenderer
 * (./worker) wrap themselves with `withSiteSentry`; a Worker built without them wraps its default export the same way.
 * Inside a wrapped handler, a throw that leaves it and every `logEvent` line at level "error" (./log) is one report.
 *
 * Errors only. Traces stay off (a trace carries every request's address, a preview link's token among them, to a third
 * party), and nothing runs in the browser.
 *
 * What a report carries is cut the way a log line is: emails, a URL's query, keys and a failed Drizzle query's bound
 * parameters (./log scrubText and scrubUrl, with the site's token routes); the request's headers, cookies, query string
 * and body, the user, and any breadcrumb or trace field that holds a query, headers, cookies or raw console arguments
 * are dropped. A scrubber that throws drops the report.
 */

import {
  captureException,
  captureMessage,
  withSentry,
  wrapRequestHandler,
} from "@sentry/cloudflare";
import { reportErrorLines, scrubFields, scrubText, scrubUrl } from "./log.mjs";

// An error line's report: the thrown Error with its stack, else the event's name, tagged with the event and carrying
// the line's scrubbed fields. Outside a wrapped handler, or with no SENTRY_DSN, there is no client and nothing is sent.
reportErrorLines((event, error, extra) => {
  const context = { tags: { event }, extra };
  if (error instanceof Error) captureException(error, context);
  else captureMessage(event, { level: "error", ...context });
});

/**
 * @param {import("./log.mjs").ScrubOptions} scrub
 * @param {Record<string, unknown> | undefined} data
 */
const scrubbed = (scrub, data) => (data ? scrubFields(data, scrub) : data);

/**
 * @template {import("@sentry/cloudflare").Event} T
 * @param {import("./log.mjs").ScrubOptions} scrub
 * @param {T} event
 * @returns {T}
 */
function scrubEvent(scrub, event) {
  if (event.message) event.message = scrubText(event.message, scrub);
  if (event.transaction) event.transaction = scrubUrl(event.transaction, scrub);
  for (const ex of event.exception?.values ?? []) {
    if (ex.value) ex.value = scrubText(ex.value, scrub);
  }
  for (const crumb of event.breadcrumbs ?? []) {
    if (crumb.message) crumb.message = scrubText(crumb.message, scrub);
    crumb.data = scrubbed(scrub, crumb.data);
  }
  event.extra = scrubbed(scrub, event.extra);
  if (event.request) {
    if (event.request.url) event.request.url = scrubUrl(event.request.url, scrub);
    delete event.request.query_string;
    delete event.request.cookies;
    delete event.request.headers;
    delete event.request.data;
  }
  // The http.server span writes url.full, url.path, url.query and every request header into the trace context.
  const trace = event.contexts?.trace;
  if (trace) trace.data = /** @type {any} */ (scrubbed(scrub, trace.data));
  delete event.user;
  return event;
}

/**
 * The SDK options for one invocation. Always an object, never undefined: with undefined the SDK reads `SENTRY_DSN`
 * from the env itself and would send with none of the scrubbing below.
 * @param {{ SENTRY_DSN?: string }} env
 * @param {import("./log.mjs").ScrubOptions} [scrub]
 * @returns {import("@sentry/cloudflare").CloudflareOptions}
 */
export function sentryOptions(env, scrub = {}) {
  /** @type {<T extends import("@sentry/cloudflare").Event>(event: T) => T | null} */
  const scrubOrDrop = (event) => {
    try {
      return scrubEvent(scrub, event);
    } catch {
      return null;
    }
  };
  return {
    dsn: env.SENTRY_DSN || undefined,
    // Written out so a changed SDK default cannot turn on IP addresses, cookies or user data unnoticed.
    sendDefaultPii: false,
    // 0, not absent: absent, the SDK reads SENTRY_TRACES_SAMPLE_RATE from the env.
    tracesSampleRate: 0,
    beforeSend: scrubOrDrop,
    beforeSendTransaction: scrubOrDrop,
  };
}

/**
 * A Worker's handler (or a WorkerEntrypoint class) with Sentry's per-invocation client around fetch, scheduled, queue
 * and email, reporting with `sentryOptions`.
 * @template T
 * @param {T} handler
 * @param {import("./log.mjs").ScrubOptions} [scrub]
 * @returns {T}
 */
export function withSiteSentry(handler, scrub = {}) {
  return /** @type {T} */ (
    withSentry((/** @type {any} */ env) => sentryOptions(env, scrub), /** @type {any} */ (handler))
  );
}

/**
 * One request under its own Sentry client, for a WorkerEntrypoint's fetch that a site may subclass (the Renderer):
 * withSiteSentry on the class would construct the base and drop the subclass's overrides.
 * @param {Request} request
 * @param {{ SENTRY_DSN?: string }} env
 * @param {ExecutionContext} ctx
 * @param {import("./log.mjs").ScrubOptions} scrub
 * @param {() => Promise<Response>} handler
 * @returns {Promise<Response>}
 */
export function withSentryRequest(request, env, ctx, scrub, handler) {
  return wrapRequestHandler({ options: sentryOptions(env, scrub), request, context: ctx }, handler);
}
