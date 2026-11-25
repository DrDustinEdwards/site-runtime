/**
 * Answers one MCP request in the era that can. A request `isLegacyRequest` calls legacy goes to a `legacy: "stateless"`
 * handler; everything else, malformed envelopes included, to the `legacy: "reject"` handler, which owns those error
 * answers. The predicate reads the body, so it is given a clone.
 *
 * @template F
 * @template {object} O
 * @template E
 * @template C
 * @param {Request} request
 * @param {E} env
 * @param {C} ctx
 * @param {{ factory: F, options: O, createMcpHandler: (factory: F, options: O & { legacy: "stateless" | "reject" }) => (request: Request, env: E, ctx: C) => Promise<Response>, isLegacyRequest?: (request: Request) => Promise<boolean> | boolean }} sdk
 * @returns {Promise<Response>}
 */
export function routeMcpEra<F, O extends object, E, C>(request: Request, env: E, ctx: C, { factory, options, createMcpHandler, isLegacyRequest }: {
    factory: F;
    options: O;
    createMcpHandler: (factory: F, options: O & {
        legacy: "stateless" | "reject";
    }) => (request: Request, env: E, ctx: C) => Promise<Response>;
    isLegacyRequest?: (request: Request) => Promise<boolean> | boolean;
}): Promise<Response>;
/**
 * The door's fetch handler: `handler` with every response wearing the set. GET /.well-known/security.txt is answered
 * from `securityTxt` (RFC 9116) and `reportPath` (default /csp-report) by the CSP receiver, with `allowReport` as its
 * rate limiter. A WebSocket upgrade (101) passes as it is; every other response is rebuilt, since a library's headers
 * may be immutable.
 *
 * @template Env
 * @param {(request: Request, env: Env, ctx: unknown) => Response | Promise<Response>} handler
 * @param {{
 *   site: import("./sites.mjs").ServedSiteEntry,
 *   securityTxt: { contact: string, expires: Date | string, policy?: string },
 *   reportPath?: string,
 *   allowReport?: (request: Request, env: Env) => boolean | Promise<boolean>,
 * }} options `site`: the door's registry entry, whose declared deviations (a popup sign-in's COOP) the set keeps
 * @returns {(request: Request, env: Env, ctx: unknown) => Promise<Response>}
 */
export function withMcpHeaders<Env>(handler: (request: Request, env: Env, ctx: unknown) => Response | Promise<Response>, { site, securityTxt, reportPath, allowReport }: {
    site: import("./sites.mjs").ServedSiteEntry;
    securityTxt: {
        contact: string;
        expires: Date | string;
        policy?: string;
    };
    reportPath?: string;
    allowReport?: (request: Request, env: Env) => boolean | Promise<boolean>;
}): (request: Request, env: Env, ctx: unknown) => Promise<Response>;
