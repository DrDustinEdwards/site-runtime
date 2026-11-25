/**
 * One request over the API leg, to `SITE_ORIGIN + path` through the `binding` named in `leg`, with the bearer from the
 * `token` var (refused under 32 characters) unless `anonymous`. Returns the status, whether it was 2xx, and the JSON body
 * (null when empty). Throws ApiLegError when unconfigured, unreachable or not JSON, and (`canceled`) when `signal`, the
 * tool call's, aborted: a client that closed the stream gets no further request sent for it.
 *
 * @param {object} env
 * @param {{ binding: string, token: string, api: string, userAgent: string, require?: string[] }} leg
 * @param {string} path
 * @param {{ method?: string, headers?: Record<string, string>, json?: unknown, anonymous?: boolean, signal?: AbortSignal }} [init]
 * @returns {Promise<{ status: number, ok: boolean, body: unknown }>}
 */
export function callApi(env: object, leg: {
    binding: string;
    token: string;
    api: string;
    userAgent: string;
    require?: string[];
}, path: string, init?: {
    method?: string;
    headers?: Record<string, string>;
    json?: unknown;
    anonymous?: boolean;
    signal?: AbortSignal;
}): Promise<{
    status: number;
    ok: boolean;
    body: unknown;
}>;
/** Why the API leg gave no answer: unconfigured, unreachable, canceled, or not JSON. Never an API refusal. */
export class ApiLegError extends Error {
    /**
     * @param {string} message
     * @param {"unconfigured" | "unreachable" | "canceled" | "malformed"} kind
     * @param {number} [status] the HTTP status, when an answer came back (malformed)
     */
    constructor(message: string, kind: "unconfigured" | "unreachable" | "canceled" | "malformed", status?: number);
    /** @type {"unconfigured" | "unreachable" | "canceled" | "malformed"} */
    kind: "unconfigured" | "unreachable" | "canceled" | "malformed";
    /** @type {number | undefined} */
    status: number | undefined;
}
