/**
 * One stored R2 object as an HTTP answer, the way a static file server answers: HEAD without the body, byte ranges
 * (206, a suffix range too, 416 for one past the end), If-None-Match (304), the ETag, Accept-Ranges and
 * Content-Length, and nosniff, so a stored file is never read as some other type. For a file a site keeps in R2 and
 * serves whole: a CV's PDF, a book's download, a game's assets, an EPUB's exploded parts. Pictures go through
 * `./image` (`serve`), which adds the sizes.
 *
 * `disposition` and `filename` write Content-Disposition by RFC 6266: an ASCII `filename` for every client and
 * `filename*` (RFC 8187, UTF-8) when the name holds anything else. `attachmentResponse` is the same header on a body
 * the Worker made (an export).
 */

/** @typedef {import("./r2-object.mjs").R2BucketLike} R2BucketLike */
/** @typedef {import("./r2-object.mjs").R2FileOptions} R2FileOptions */

/**
 * The Content-Disposition value for `disposition` ("inline" or "attachment") and a file name. Quotes, backslashes and
 * control characters are dropped; a name outside printable ASCII also gets `filename*` in UTF-8.
 * @param {"inline" | "attachment"} disposition
 * @param {string} [filename]
 * @returns {string}
 */
export function contentDisposition(disposition, filename) {
  if (!filename) return disposition;
  // oxlint-disable-next-line no-control-regex
  const clean = filename.replace(/[\u0000-\u001f\u007f"\\]/g, "").trim();
  if (!clean) return disposition;
  const ascii = clean.replace(/[^\x20-\x7e]/g, "_");
  return ascii === clean
    ? `${disposition}; filename="${ascii}"`
    : `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(clean).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;
}

/**
 * A body the Worker made, as a download: its type, Content-Disposition (attachment by default), nosniff, no-store.
 * @param {BodyInit} body
 * @param {{ filename: string, type: string, disposition?: "inline" | "attachment", cacheControl?: string }} options
 * @returns {Response}
 */
export function attachmentResponse(
  body,
  { filename, type, disposition = "attachment", cacheControl = "no-store" },
) {
  return new Response(body, {
    headers: {
      "content-type": type,
      "content-disposition": contentDisposition(disposition, filename),
      "x-content-type-options": "nosniff",
      "cache-control": cacheControl,
    },
  });
}

/**
 * The headers every answer for the object carries.
 * @param {{ writeHttpMetadata(headers: Headers): void, httpEtag: string }} object
 * @param {R2FileOptions} options
 */
function fileHeaders(object, { cacheControl, contentType, disposition, filename, noindex, tags }) {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  if (contentType) headers.set("content-type", contentType);
  if (!headers.has("content-type")) headers.set("content-type", "application/octet-stream");
  headers.set("etag", object.httpEtag);
  headers.set("accept-ranges", "bytes");
  headers.set("x-content-type-options", "nosniff");
  if (cacheControl) headers.set("cache-control", cacheControl);
  if (disposition) headers.set("content-disposition", contentDisposition(disposition, filename));
  if (noindex) headers.set("x-robots-tag", "noindex");
  if (tags?.length) headers.set("cache-tag", tags.join(","));
  return headers;
}

/**
 * Whether an If-None-Match value names this ETag (a list, weak or strong, or `*`).
 * @param {string | null} header
 * @param {string} etag
 */
function matches(header, etag) {
  if (!header) return false;
  if (header.trim() === "*") return true;
  const bare = etag.replace(/^W\//, "");
  return header.split(",").some((tag) => tag.trim().replace(/^W\//, "") === bare);
}

/**
 * The object at `key` as the answer to `request`: 405 for a method other than GET and HEAD, 404 when there is no such
 * object, 304 when If-None-Match names it, 206 for a byte range, 416 for a range past its end, else 200.
 * @param {Request} request
 * @param {R2BucketLike} bucket
 * @param {string} key
 * @param {R2FileOptions} [options]
 * @returns {Promise<Response>}
 */
export async function r2ObjectResponse(request, bucket, key, options = {}) {
  const notFound = () =>
    new Response(options.notFound ?? "Not found", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  if (request.method !== "GET" && request.method !== "HEAD")
    return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });

  if (request.method === "HEAD") {
    const head = await bucket.head(key);
    if (!head) return notFound();
    const headers = fileHeaders(head, options);
    headers.set("content-length", String(head.size));
    return new Response(null, { status: 200, headers });
  }

  const ranged = request.headers.has("range");
  let object;
  try {
    object = await bucket.get(key, ranged ? { range: request.headers } : undefined);
  } catch (error) {
    // R2 refuses a range it cannot satisfy; the answer says how long the object is.
    if (!ranged) throw error;
    const head = await bucket.head(key);
    if (!head) return notFound();
    return new Response(null, {
      status: 416,
      headers: { "content-range": `bytes */${head.size}`, "cache-control": "no-store" },
    });
  }
  if (!object) return notFound();
  const headers = fileHeaders(object, options);
  if (!ranged && matches(request.headers.get("if-none-match"), object.httpEtag)) {
    void object.body?.cancel().catch(() => {});
    const kept = new Headers({ etag: object.httpEtag });
    for (const name of ["cache-control", "cache-tag"]) {
      const value = headers.get(name);
      if (value) kept.set(name, value);
    }
    return new Response(null, { status: 304, headers: kept });
  }
  const size = object.size;
  const range = /** @type {{ offset?: number, length?: number, suffix?: number } | undefined} */ (
    object.range
  );
  if (ranged && range) {
    const start =
      range.suffix !== undefined ? Math.max(0, size - range.suffix) : (range.offset ?? 0);
    const length =
      range.suffix !== undefined ? Math.min(range.suffix, size) : (range.length ?? size - start);
    headers.set("content-range", `bytes ${start}-${start + length - 1}/${size}`);
    headers.set("content-length", String(length));
    return new Response(object.body, { status: 206, headers });
  }
  headers.set("content-length", String(size));
  return new Response(object.body, { status: 200, headers });
}
