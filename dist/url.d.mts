/**
 * An outside address a page may put in an href, stored as typed: absolute, http or https, with a host. A `javascript:` or
 * `data:` URL survives HTML escaping, so a link a person entered is checked by this before it is stored or drawn.
 * @param {unknown} value
 * @returns {value is string}
 */
export function isHttpUrl(value: unknown): value is string;
/**
 * The status of every permanent redirect a site answers: 301 for GET and HEAD, 308 for any other method, since a 301
 * lets a browser turn a POST into a GET and drop the form's body.
 * @param {string} method
 * @returns {301 | 308}
 */
export function redirectStatus(method: string): 301 | 308;
/**
 * Whether a path may be put in a Location on this origin: one leading slash, no backslash, printable ASCII only.
 * `//host/x` and `/\\host/x` are protocol-relative to a browser and would leave the site; a browser strips a tab or
 * newline while parsing, so `/\t/host` becomes `//host`; and a header value cannot carry anything above 0x7e.
 * @param {string} path
 * @returns {boolean}
 */
export function isSameOriginPath(path: string): boolean;
/**
 * The redirect for a path that ends in a slash, or null when there is nothing to redirect.
 * @param {Request} request
 * @param {{ except?: readonly string[] }} [options]
 * @returns {Response | null}
 */
export function slashRedirect(request: Request, { except }?: {
    except?: readonly string[];
}): Response | null;
/**
 * The one redirect to the page's canonical address: https (unless `https` is false or the host is loopback), `host`
 * for `www.<host>` when `host` is given, and no trailing slash. Null when the request is already there.
 * @param {Request} request
 * @param {{ host?: string, except?: readonly string[], https?: boolean }} [options]
 * @returns {Response | null}
 */
export function canonicalRedirect(request: Request, { host, except, https }?: {
    host?: string;
    except?: readonly string[];
    https?: boolean;
}): Response | null;
/**
 * Whether a path is on a list: an exact path, a prefix written with a trailing `*`, or a RegExp. A trailing slash is
 * ignored on both sides, so `/old/` and `/old` are one entry.
 * @param {string} pathname
 * @param {readonly (string | RegExp)[]} list
 */
export function pathListed(pathname: string, list: readonly (string | RegExp)[]): boolean;
/**
 * 410 Gone for a page removed on purpose, so a crawler drops it sooner than a 404 and a reader is told it is not a typo.
 * `gone` is the site's list (`pathListed`). Null when the path is not on it. A site that renders its own 410 page tests
 * `pathListed` and throws its own 410 instead.
 * @param {Request} request
 * @param {readonly (string | RegExp)[]} gone
 * @param {{ body?: BodyInit | null, contentType?: string }} [options]
 * @returns {Response | null}
 */
export function goneResponse(request: Request, gone: readonly (string | RegExp)[], { body, contentType }?: {
    body?: BodyInit | null;
    contentType?: string;
}): Response | null;
/**
 * A 301 (308 for a method other than GET and HEAD) from a renamed slug to its new one under the same `prefix`, keeping
 * what follows the slug and the query: `/blog/old/comments?page=2` to `/blog/new/comments?page=2`. `renames` is the
 * site's table (old slug to new) or a lookup, which may be async and return null for a slug never renamed. A chain
 * (a to b, b to c) is followed to its end, so the reader takes one hop; a loop throws. Null when nothing matches.
 * Sent `private, no-store`, so a rename that is undone is not held in a browser. The Location is on the request's own
 * origin.
 * @param {Request} request
 * @param {{ prefix: string, renames: Readonly<Record<string, string>> | ((slug: string) => string | null | undefined | Promise<string | null | undefined>) }} options
 * @returns {Promise<Response | null>}
 */
export function renameRedirect(request: Request, { prefix, renames }: {
    prefix: string;
    renames: Readonly<Record<string, string>> | ((slug: string) => string | null | undefined | Promise<string | null | undefined>);
}): Promise<Response | null>;
