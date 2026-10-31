/** The fields of /.well-known/security.txt (security-txt.mjs). `contact` is an email address or a URL. */
export interface SecurityTxt {
  origin: string;
  contact: string;
  expires: Date | string;
  policy?: string;
  languages?: string;
}
/** The RFC 9116 text. */
export function securityTxt(fields: SecurityTxt): string;
/** The file as a `text/plain; charset=utf-8` response, cached for an hour; `headers` adds to those (a Content-Type is refused). */
export function securityTxtResponse(fields: SecurityTxt, headers?: HeadersInit): Response;
