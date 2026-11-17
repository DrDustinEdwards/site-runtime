import type { CloudflareOptions } from "@sentry/cloudflare";
import type { ScrubOptions } from "./log.d.mts";

/** The SDK options for one invocation: the DSN from `SENTRY_DSN` (none, no client), no traces, every report scrubbed. */
export function sentryOptions(
  env: { SENTRY_DSN?: string },
  scrub?: ScrubOptions,
): CloudflareOptions;

/** A Worker's handler (or a WorkerEntrypoint class) with Sentry around fetch, scheduled, queue and email. */
export function withSiteSentry<T>(handler: T, scrub?: ScrubOptions): T;

/** One request under its own Sentry client: a subclassable WorkerEntrypoint's fetch (the Renderer). */
export function withSentryRequest(
  request: Request,
  env: { SENTRY_DSN?: string },
  ctx: ExecutionContext,
  scrub: ScrubOptions,
  handler: () => Promise<Response>,
): Promise<Response>;
