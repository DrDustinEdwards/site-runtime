/** Where every network site's vulnerability reports go, unless a site names its own. */
export const SECURITY_CONTACT: string;
/** The date the network's contact is next confirmed by. */
export const SECURITY_TXT_EXPIRES: string;
/** The fields of /.well-known/security.txt. `contact` (an email address or a URL) and `expires` default to the network's. */
export interface SecurityTxt {
  origin: string;
  contact?: string;
  expires?: Date | string;
  policy?: string;
  languages?: string;
}
/** The RFC 9116 text. */
export function securityTxt(fields: SecurityTxt): string;
/** The file as a `text/plain; charset=utf-8` response, cached for an hour; `headers` adds to those (a Content-Type is refused). */
export function securityTxtResponse(fields: SecurityTxt, headers?: HeadersInit): Response;
