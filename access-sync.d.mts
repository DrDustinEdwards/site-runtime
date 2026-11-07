/**
 * Access sync (access-sync.mjs): an app posts its whole allow list to Capsid's `POST /ops/access-sync`, and Capsid makes
 * the Access group it pinned for the namespace hold exactly those people. The call and the reading of the answer only.
 */

export const CAPSID_ORIGIN: string;

export type AccessSyncResult =
  | { ok: true; added: number; dropped: number }
  | { ok: false; refusal: string };

/** Posts the list; never throws. `removed` frees the seats of people this change took out (anyone still in `members` is dropped from it). */
export function postAccessSync(options: {
  key: string;
  namespace: string;
  members: string[];
  removed?: string[];
  origin?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): Promise<AccessSyncResult>;
