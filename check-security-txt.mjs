/** /.well-known/security.txt graded against RFC 9116. */

import { registryEntry, resultRecorder } from "./check-core.mjs";

/** @import { CheckedSiteEntry } from "./check-core.mjs" */
/** @import { CheckResult } from "./check.mjs" */

const DAY = 86_400_000;

/**
 * /.well-known/security.txt graded against RFC 9116: served 200 as `text/plain; charset=utf-8` (D1), one Contact and
 * exactly one Expires under a year out (D2), a warning 30 days before it (D4), and a Canonical naming the URL it is
 * served from or the site's own (D3). A signed file must carry its whole signature block; an unsigned one is the
 * family's deviation (FAMILY_DEVIATIONS.D3).
 * @param {{ url: string, origin?: string, status: number, headers: Headers, body: string, now?: number }} response
 *   `url` where it was fetched; `origin` the site's own, when it is served from elsewhere
 * @param {{ site?: string | CheckedSiteEntry }} [options]
 */
export function checkSecurityTxt(
  { url, origin, status, headers, body, now = Date.now() },
  { site } = {},
) {
  const entry = registryEntry(site);
  /** @type {CheckResult[]} */
  const results = [];
  const result = resultRecorder(results, entry, false);
  result("D1", "security.txt is served", status === 200, `answers ${status}`);
  if (status !== 200) return results;
  const type = headers.get("Content-Type") ?? "";
  result(
    "D1",
    "security.txt is text/plain; charset=utf-8",
    /^text\/plain\s*;\s*charset=utf-8$/i.test(type.trim()),
    `Content-Type is ${JSON.stringify(type)} (securityTxtResponse, ./security-txt)`,
  );
  const signed = /^-----BEGIN PGP SIGNED MESSAGE-----\r?\n/.test(body);
  if (signed) {
    result(
      "D3",
      "the OpenPGP signature is whole",
      /\n-----BEGIN PGP SIGNATURE-----\r?\n[\s\S]+\n-----END PGP SIGNATURE-----\s*$/.test(body),
      "the signed message has no complete signature block",
    );
  } else {
    result(
      "D3",
      "security.txt is OpenPGP-signed",
      false,
      "a cleartext signature lets a finder trust the contact without trusting the host",
      false,
      true,
    );
  }
  const text = signed
    ? (body
        .split(/\n-----BEGIN PGP SIGNATURE-----/)[0]
        ?.replace(/^[\s\S]*?\r?\n\r?\n/, "")
        .replace(/^- /gm, "") ?? "")
    : body;
  const fields = (/** @type {string} */ name) =>
    [...text.matchAll(new RegExp(`^${name}:\\s*(.+)$`, "gim"))].map((m) => (m[1] ?? "").trim());
  result(
    "D2",
    "security.txt has a Contact",
    fields("Contact").length > 0,
    "no Contact: a finder has nowhere to write",
  );
  const expires = fields("Expires");
  const left = (Date.parse(expires[0] ?? "") - now) / DAY;
  result(
    "D2",
    "security.txt has exactly one Expires",
    expires.length === 1,
    `has ${expires.length} Expires fields`,
  );
  if (expires.length === 1) {
    result(
      "D2",
      "Expires is within the next year",
      left > 0 && left < 365,
      `Expires ${expires[0]}`,
    );
    if (left > 0 && left < 365)
      result(
        "D4",
        "Expires is more than 30 days out",
        left >= 30,
        `Expires ${expires[0]}, in ${Math.floor(left)} days`,
        true,
      );
  }
  const canonical = fields("Canonical");
  const want = [url, ...(origin ? [new URL("/.well-known/security.txt", origin).href] : [])];
  if (canonical.length === 0)
    result(
      "D3",
      "security.txt has a Canonical",
      false,
      "no Canonical: a copy found elsewhere cannot be told from the real one",
      true,
    );
  else
    result(
      "D3",
      "Canonical names the URL it is served from",
      canonical.some((c) => want.includes(c)),
      `Canonical ${canonical.join(", ")}`,
    );
  return results;
}
