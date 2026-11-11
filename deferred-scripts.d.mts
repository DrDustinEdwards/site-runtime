/** Hydrate on intent, the React half: React Router's scripts, or on a deferred page its boot as JSON. */
import type { ReactElement } from "react";

/** True when a matched route hydrates on load (`handle.hydrate`, or a function of its loader data). */
export function routeHydrates(
  matches: readonly { handle?: unknown; loaderData?: unknown }[],
): boolean;
/** JSON that is safe inside a <script> element (no "<", ">" or "&"). */
export function scriptJson(value: unknown): string;
/** The boot JSON's text; exported for the test. */
export function bootJson(input: {
  manifest: import("react-router").UNSAFE_AssetsManifest;
  serverHandoffString?: string;
  lazy: boolean;
  router: unknown;
  matches: { route: { id: string } }[];
}): string;
/** In the root Layout's body, in place of <ScrollRestoration /> and <Scripts />. */
export function HydrationScripts(props: { deferred: boolean }): ReactElement;
/** In the root Layout's head: the stream stand-in on a deferred page, nothing elsewhere. */
export function StreamBuffer(props: { deferred: boolean }): ReactElement | null;
