/**
 * Preloads declared once (preload.mjs): the React Router `links` entries and the `Link` header Cloudflare Early Hints
 * reads, from the same list. A font gets crossorigin=anonymous unless it names use-credentials; an image may name its srcset.
 */

export type CrossOrigin = "anonymous" | "use-credentials";

export interface Preload {
  rel?: "preload";
  /** A path such as /fonts/x.woff2, or an https URL, ASCII only. */
  href: string;
  as: "font" | "image" | "style" | "script" | "fetch";
  /** A media type such as font/woff2. */
  type?: string;
  crossOrigin?: CrossOrigin;
  /** An image's srcset and sizes, so the browser preloads the size it will show. Images only. */
  imageSrcSet?: string;
  imageSizes?: string;
  fetchPriority?: "high" | "low" | "auto";
}

export interface Preconnect {
  rel: "preconnect";
  /** An https origin. */
  href: string;
  crossOrigin?: CrossOrigin;
}

export interface PreloadLink {
  rel: "preload" | "preconnect";
  href: string;
  as?: Preload["as"];
  type?: string;
  crossOrigin?: CrossOrigin;
  imageSrcSet?: string;
  imageSizes?: string;
  fetchPriority?: "high" | "low" | "auto";
}

/** `links` for root.tsx's `links` export; `header` for `Link` on HTML responses (append it, empty for no entries). */
export function preloads(entries: (Preload | Preconnect)[]): { links: PreloadLink[]; header: string };

/** The root route's stylesheets in a React Router server build, as `{ href, as: "style" }` preloads. */
export function rootStylesheets(build: { assets: { routes: Record<string, { css?: string[] } | undefined> } }): Preload[];

/** `response` with each non-empty `Link` value appended when it is HTML (rebuilt if its headers are immutable). */
export function withPreloadHeader(response: Response, ...values: string[]): Response;
