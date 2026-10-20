/** The Cloudflare Access request-token check (access.mjs). */
import type { JwtRefusal, JwtVerdict, KeySource } from "./access-login.d.mts";

export const ACCESS_JWT_HEADER: "cf-access-jwt-assertion";
export const ACCESS_COOKIE: "CF_Authorization";
/** How long an unknown kid waits before it may refetch the keys again. */
export const REFETCH_COOLDOWN_MS: number;

/** https://<team domain>, from the team domain with or without scheme and trailing slash; null when missing or not a host. */
export function accessIssuer(teamDomain: string | undefined): string | null;
/** The team's signing keys, cached per isolate. A fetch that fails, answers an error or carries no key list throws. */
export function accessKeys(teamDomain: string): KeySource;
/** The header token, else (with `cookie`) the CF_Authorization cookie, else null. */
export function accessToken(request: Request, options?: { cookie?: boolean }): string | null;
/** The claims of a token for this application, or why it is refused. `now` in epoch milliseconds. */
export function verifyAccessToken(token: string, keys: KeySource, expect: { issuer: string; audience: string; now?: number }): Promise<JwtVerdict>;

export type AccessRefusal = "not-configured" | "no-token" | JwtRefusal;
export type AccessVerdict = { ok: true; claims: Record<string, unknown> } | { ok: false; reason: AccessRefusal };
/** One Access application's verdict on a request. Throws when the keys cannot be fetched. */
export function verifyAccessRequest(
  request: Request,
  options: { teamDomain: string | undefined; audience: string | undefined; cookie?: boolean; keys?: KeySource; now?: number },
): Promise<AccessVerdict>;
