/**
 * The list-only test key's request, checked: `{ request }` to serve (its body already read), or `{ refusal }`: a 403
 * JSON-RPC error for a body over 64 KiB, and for a method `PROBE_METHODS` does not list a 404 with -32601. A refused
 * notification is a 403, as it has no id to answer. Each refused message is a `refused` row in the log, under
 * `probe:live-check`. A body that is not JSON goes on, for the SDK's parse error.
 * @param {Partial<import("./audit-log.mjs").AuditEnv>} env
 * @param {McpServerInfo} server
 * @param {Request} request
 * @returns {Promise<{ request: Request, refusal?: undefined } | { refusal: Response, request?: undefined }>}
 */
export function probeRefusal(env: Partial<import("./audit-log.mjs").AuditEnv>, server: McpServerInfo, request: Request): Promise<{
    request: Request;
    refusal?: undefined;
} | {
    refusal: Response;
    request?: undefined;
}>;
/**
 * The list-only test key's whole door, for a server's `/mcp` before its OAuth provider: null when the request does not
 * carry the key. Otherwise the limiter (fails closed; a limited request is a `rate-limited` row), then `probeRefusal`,
 * then `serve(request, probeCaller())`.
 * @template {Partial<import("./audit-log.mjs").AuditEnv>} E
 * @param {Request} request
 * @param {E} env
 * @param {{ server: McpServerInfo, limiter: Parameters<typeof checkRateLimit>[0], serve: (request: Request, caller: { kind: "probe", principal: string, scopes: string[] }) => Promise<Response> }} options
 * @returns {Promise<Response | null>}
 */
export function probeDoor<E extends Partial<import("./audit-log.mjs").AuditEnv>>(request: Request, env: E, { server, limiter, serve }: {
    server: McpServerInfo;
    limiter: Parameters<typeof checkRateLimit>[0];
    serve: (request: Request, caller: {
        kind: "probe";
        principal: string;
        scopes: string[];
    }) => Promise<Response>;
}): Promise<Response | null>;
/** The methods the list-only test key may send on to the server (tools/call is refused by `invokeTool`, see above). */
export const PROBE_METHODS: Set<string>;
export type McpServerInfo = import("./mcp-server.mjs").McpServerInfo;
import { checkRateLimit } from "./mcp-server.mjs";
