/**
 * The route half of `defineImages`: one request answered from the closed sets, the original, or one transformed size.
 */

import { corpFor, UPLOAD_HEADERS } from "./headers.mjs";
import { mediaType } from "./http.mjs";
import {
  FOCUS_METADATA,
  IMAGE_FORMATS,
  cropHeight,
  focusOf,
  isRasterType,
  suffixed,
} from "./image-core.mjs";
import { errorMessage } from "./log.mjs";

/** @import { ImagesLike, R2ObjectLike } from "./image.mjs" */

const VERSION = /^[A-Za-z0-9_-]{1,40}$/;

/**
 * @param {R2ObjectLike} object
 * @param {string} cacheControl
 */
function objectHeaders(object, cacheControl) {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", cacheControl);
  for (const [name, value] of Object.entries(UPLOAD_HEADERS)) headers.set(name, value);
  headers.set("cross-origin-resource-policy", corpFor(headers.get("content-type")));
  // An inline SVG is script running as the site; keyed on the stored type, so a file renamed to .png is caught.
  if ((headers.get("content-type") ?? "").toLowerCase().startsWith("image/svg+xml"))
    headers.set("content-disposition", "attachment");
  return headers;
}

/**
 * @param {Request} request
 * @param {R2ObjectLike | null} object
 * @param {string} cacheControl
 */
function original(request, object, cacheControl) {
  if (!object) return new Response("Not found", { status: 404 });
  if (request.headers.get("if-none-match") === object.httpEtag)
    return new Response(null, { status: 304, headers: { etag: object.httpEtag } });
  return new Response(object.body, { headers: objectHeaders(object, cacheControl) });
}

/**
 * The route: the original for a bare request, or one transformed size for `?w=`. It never writes to the bucket.
 * @param {{ widths: Set<number>, ratios: Set<string>, formats: Set<string>, quality: number }} closed the site's closed sets
 * @param {Request} request
 * @param {{ object: R2ObjectLike | null, images?: ImagesLike, cache?: Cache, cacheControl?: string, reread?: () => Promise<R2ObjectLike | null> }} options
 */
export async function respondImage(
  { widths, ratios, formats, quality },
  request,
  { object, images, cache, cacheControl = "public, max-age=31536000, immutable", reread },
) {
  const query = new URL(request.url).searchParams;
  const requested = query.get("w");
  if (requested === null) return original(request, object, cacheControl);

  const width = Number(requested);
  const suffix = suffixed(new URL(request.url).pathname);
  const named = query.get("f");
  if (suffix && named !== null && named !== suffix.format)
    return new Response("Unsupported format", { status: 400 });
  const format = suffix?.format ?? named ?? "webp";
  const version = query.get("v");
  const ratio = query.get("r");
  const fp = query.get("fp");
  const still = query.get("still");
  if (!widths.has(width)) return new Response("Unsupported width", { status: 400 });
  if (!formats.has(format)) return new Response("Unsupported format", { status: 400 });
  if (version !== null && !VERSION.test(version))
    return new Response("Unsupported version", { status: 400 });
  if (ratio !== null && !ratios.has(ratio))
    return new Response("Unsupported crop", { status: 400 });
  if (fp !== null && (ratio === null || focusOf(fp) !== fp))
    return new Response("Unsupported focal point", { status: 400 });
  if (still !== null && still !== "1") return new Response("Unsupported still", { status: 400 });
  if (!object) return new Response("Not found", { status: 404 });
  // The focal point in the URL must be the file's own, or any caller could mint crops.
  const stored = focusOf(object.customMetadata?.[FOCUS_METADATA]);
  if (fp !== null && fp !== stored) return new Response("Stale focal point", { status: 400 });
  // A still is a second billed transform, so only a GIF has one.
  if (still !== null && mediaType(object.httpMetadata?.contentType) !== "image/gif")
    return new Response("Unsupported still", { status: 400 });
  if (!isRasterType(object.httpMetadata?.contentType))
    return original(request, object, cacheControl);

  // TRAP: the edge cache is keyed by URL alone and has no purge, so every input to the body goes into the key: the
  // encoder's quality and the original's etag (a file replaced under the same key is a new key for every size). The
  // page's `v` is left out, or any caller could mint a transform per value. The format goes in as `f`, so a URL from
  // before suffixes and its suffixed twin are one entry.
  const keyUrl = new URL(request.url);
  keyUrl.searchParams.delete("v");
  if (suffix) {
    keyUrl.pathname = suffix.stored;
    if (format !== "webp") keyUrl.searchParams.set("f", format);
  }
  keyUrl.searchParams.set("__q", String(quality));
  keyUrl.searchParams.set("__v", object.httpEtag);
  // The Cache-Control goes in too: a size stored under one policy must not answer under another.
  keyUrl.searchParams.set("__cc", cacheControl);
  const cacheKey = new Request(keyUrl.toString(), { method: "GET" });
  const hit = cache ? await cache.match(cacheKey) : undefined;
  // A cached Response has immutable headers.
  if (hit) return new Response(hit.body, hit);

  if (!images) {
    // The binding is in an untracked wrangler.jsonc, so a checkout can lack it; a header says so.
    const headers = objectHeaders(object, cacheControl);
    headers.set("x-image", "unavailable-no-images-binding");
    return new Response(object.body, { headers });
  }

  const transform = ratio
    ? { width, height: cropHeight(width, ratio), fit: "cover", gravity: fp ?? "auto" }
    : { width, fit: "scale-down" };
  let response;
  try {
    const output = { format: `image/${format}`, quality, ...(still ? { anim: false } : {}) };
    const result = await images.input(object.body).transform(transform).output(output);
    response = result.response();
  } catch (error) {
    console.error(
      JSON.stringify({
        alert: "image-transform-failed",
        url: request.url,
        detail: errorMessage(error),
      }),
    );
    // The body is spent, so the original is read again, short-lived.
    const again = reread ? await reread() : null;
    if (!again)
      return new Response("Image unavailable", { status: 503, headers: { "retry-after": "60" } });
    const headers = objectHeaders(again, "public, max-age=300");
    headers.set("x-image", "original-fallback");
    return new Response(again.body, { headers });
  }
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(UPLOAD_HEADERS)) headers.set(name, value);
  headers.set("cross-origin-resource-policy", "cross-origin");
  // Over the AVIF limit the binding writes WebP: answer with the WebP's own URL, permanent and cached.
  if (format === "avif" && mediaType(headers.get("content-type")) === IMAGE_FORMATS.webp) {
    await response.body?.cancel();
    const twin = new URL(request.url);
    if (suffix) twin.pathname = twin.pathname.replace(/\.avif$/i, ".webp");
    else twin.searchParams.delete("f");
    const moved = new Response(null, {
      status: 301,
      headers: {
        location: `${twin.pathname}${twin.search}`,
        "cache-control": cacheControl,
        "cross-origin-resource-policy": "cross-origin",
        "x-image": `w=${width} avif-over-limit webp`,
      },
    });
    if (cache) await cache.put(cacheKey, moved.clone());
    return moved;
  }
  headers.set("cache-control", cacheControl);
  headers.set(
    "x-image",
    `w=${width}${ratio ? ` r=${ratio}` : ""}${still ? " still" : ""} ${format}`,
  );
  const out = new Response(response.body, { headers });
  if (cache) await cache.put(cacheKey, out.clone());
  return out;
}
