/**
 * /.well-known/security.txt (RFC 9116), once, for every site: where to report a vulnerability, before a finder decides
 * a public post is the only channel.
 *
 * `expires` is required, as the RFC requires the field. A fixed date is the safer choice: a file that renews itself on
 * every request keeps vouching for a contact nobody has checked. A site that does pass a computed date should keep it
 * under a year out, as the RFC recommends.
 */

/**
 * @typedef {{ origin: string, contact: string, expires: Date | string, policy?: string, languages?: string }} SecurityTxt
 */

/**
 * The file's text: Contact, Expires, Policy when given, Preferred-Languages and Canonical (the site's own URL for it,
 * so a copy found elsewhere is known to be one). `contact` is an email address or a URL.
 * @param {SecurityTxt} fields
 * @returns {string}
 */
export function securityTxt({ origin, contact, expires, policy, languages = "en" }) {
  const when = new Date(expires);
  if (Number.isNaN(when.getTime())) throw new TypeError("security.txt needs an Expires date");
  return [
    `Contact: ${contact.includes(":") ? contact : `mailto:${contact}`}`,
    `Expires: ${when.toISOString().replace(/\.\d{3}Z$/, "Z")}`,
    ...(policy ? [`Policy: ${policy}`] : []),
    `Preferred-Languages: ${languages}`,
    `Canonical: ${origin.replace(/\/$/, "")}/.well-known/security.txt`,
    "",
  ].join("\n");
}

/**
 * The file as a response: text/plain, cached for an hour. `headers` adds to or replaces those.
 * @param {SecurityTxt} fields
 * @param {HeadersInit} [headers]
 * @returns {Response}
 */
export function securityTxtResponse(fields, headers) {
  const merged = new Headers({ "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" });
  for (const [name, value] of new Headers(headers)) merged.set(name, value);
  return new Response(securityTxt(fields), { headers: merged });
}
