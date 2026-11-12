/** A Google service account's access token (google-service-account.mjs). */

export const GOOGLE_TOKEN_URL: "https://oauth2.googleapis.com/token";
export interface ServiceAccountKey {
  clientEmail: string;
  privateKey: string;
  privateKeyId: string | null;
  tokenUri: string;
}
/** The pasted key file, or what is wrong with it; `name` is the secret's name, for the message. */
export function parseServiceAccountKey(
  raw: string | null | undefined,
  name: string,
):
  | { ok: true; key: ServiceAccountKey }
  | { ok: false; state: "not-connected" | "misconfigured"; detail: string };
/** Forget every cached token. */
export function clearServiceAccountTokens(): void;
/** An access token for `scopes`, cached per isolate until five minutes before it expires. */
export function serviceAccountToken(
  key: ServiceAccountKey,
  scopes: string[],
  options?: { fetcher?: typeof fetch; now?: number },
): Promise<string>;
