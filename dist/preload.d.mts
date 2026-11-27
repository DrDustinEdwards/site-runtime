/**
 * @typedef {{ rel?: "preload", href: string, as: "font" | "image" | "style" | "script" | "fetch", type?: string, crossOrigin?: "anonymous" | "use-credentials", imageSrcSet?: string, imageSizes?: string, fetchPriority?: "high" | "low" | "auto" }} Preload
 * @typedef {{ rel: "preconnect", href: string, crossOrigin?: "anonymous" | "use-credentials" }} Preconnect
 */
/**
 * The `links` entries and the `Link` header value for `entries`, in their order. Refuses an href that is not a path
 * or an https URL, or holds a character the header cannot carry unencoded (`<`, `>`, `"`, whitespace, non-ASCII), and a
 * `type` that is not a bare media type, and image set fields on anything but an image or holding a character a quoted
 * header value cannot carry. `header` is empty for an empty list; a site sets nothing then.
 * @param {(Preload | Preconnect)[]} entries
 */
export function preloads(entries: (Preload | Preconnect)[]): {
    links: ({
        crossOrigin?: "anonymous" | "use-credentials" | undefined;
        rel: "preconnect";
        href: string;
    } | {
        fetchPriority?: "low" | "high" | "auto" | undefined;
        imageSizes?: string | undefined;
        imageSrcSet?: string | undefined;
        crossOrigin?: "anonymous" | "use-credentials" | undefined;
        type?: string | undefined;
        rel: "preload";
        href: string;
        as: "fetch" | "image" | "font" | "script" | "style";
    })[];
    header: string;
};
/**
 * The root route's stylesheets in a React Router server build (`build.assets.routes.root.css`), as preload entries:
 * the CSS every page blocks on, named by its hashed URL.
 * @param {{ assets: { routes: Record<string, { css?: string[] } | undefined> } }} build
 * @returns {Preload[]}
 */
export function rootStylesheets(build: {
    assets: {
        routes: Record<string, {
            css?: string[];
        } | undefined>;
    };
}): Preload[];
/**
 * The stylesheets of the root route and then of each route named in `routes` (a layout every page renders inside), in that
 * order and each href once, as `{ href, as: "style" }` preloads.
 * @param {{ assets: { routes: Record<string, { css?: string[] } | undefined> } }} build
 * @param {readonly string[]} [routes] route ids beyond the root, such as "routes/_site"
 * @returns {Preload[]}
 */
export function pageStylesheets(build: {
    assets: {
        routes: Record<string, {
            css?: string[];
        } | undefined>;
    };
}, routes?: readonly string[]): Preload[];
/**
 * `response` with each non-empty `Link` header value appended, when it is HTML. Appended, so a route's own Link (a
 * markdown alternate, a webmention endpoint) stays; rebuilt when its headers are immutable.
 * @param {Response} response
 * @param {...string} values `preloads(...).header` values
 */
export function withPreloadHeader(response: Response, ...values: string[]): Response;
export type Preload = {
    rel?: "preload";
    href: string;
    as: "font" | "image" | "style" | "script" | "fetch";
    type?: string;
    crossOrigin?: "anonymous" | "use-credentials";
    imageSrcSet?: string;
    imageSizes?: string;
    fetchPriority?: "high" | "low" | "auto";
};
export type Preconnect = {
    rel: "preconnect";
    href: string;
    crossOrigin?: "anonymous" | "use-credentials";
};
/**
 * Preloads declared once (preload.mjs): the React Router `links` entries and the `Link` header Cloudflare Early Hints
 * reads, from the same list. A font gets crossorigin=anonymous unless it names use-credentials; an image may name its srcset.
 */
export type CrossOrigin = "anonymous" | "use-credentials";
export type PreloadLink = {
    rel: "preload" | "preconnect";
    href: string;
    as?: "fetch" | "image" | "font" | "script" | "style" | undefined;
    type?: string | undefined;
    crossOrigin?: CrossOrigin | undefined;
    imageSrcSet?: string | undefined;
    imageSizes?: string | undefined;
    fetchPriority?: "low" | "high" | "auto" | undefined;
};
