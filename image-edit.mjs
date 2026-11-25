/** A site's own picture edits through the Images binding (turn, mirror, shrink, re-encode). */

import { IMAGE_QUALITY } from "./image-core.mjs";

/** @import { ImagesLike } from "./image-core.mjs" */

const EDIT_FORMATS = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);

/**
 * One picture edited through the Images binding: turned, mirrored or shrunk, and encoded as `format`. For a site's own
 * writes, not for serving sizes (`respond` does that, from a closed set). Each call is a billed transform.
 * Cloudflare applies `flip` before `rotate`, and turns clockwise. `maxEdge` fits the picture inside a square of that
 * side and never enlarges it. A format alone re-encodes. Options outside these throw before the binding is called.
 * @param {ImagesLike} images the Images binding
 * @param {ReadableStream | ArrayBuffer | ArrayBufferView} input the picture's bytes
 * @param {{ rotate?: 90 | 180 | 270, flip?: "h" | "v" | "hv", maxEdge?: number, format: "image/jpeg" | "image/png" | "image/webp" | "image/avif", quality?: number }} options
 * @returns {Promise<Response>} the binding's response: the new bytes, with their content type
 */
export async function editImage(
  images,
  input,
  { rotate, flip, maxEdge, format, quality = IMAGE_QUALITY },
) {
  if (rotate !== undefined && rotate !== 90 && rotate !== 180 && rotate !== 270)
    throw new Error(`editImage: rotate is 90, 180 or 270, not ${rotate}.`);
  if (flip !== undefined && flip !== "h" && flip !== "v" && flip !== "hv")
    throw new Error(`editImage: flip is "h", "v" or "hv", not ${flip}.`);
  if (maxEdge !== undefined && !(Number.isInteger(maxEdge) && maxEdge > 0))
    throw new Error(`editImage: maxEdge is a whole-pixel length, not ${maxEdge}.`);
  if (!EDIT_FORMATS.has(format))
    throw new Error(`editImage: format is one of ${[...EDIT_FORMATS].join(", ")}, not ${format}.`);
  if (!(Number.isInteger(quality) && quality >= 1 && quality <= 100))
    throw new Error(`editImage: quality is 1 to 100, not ${quality}.`);
  /** @type {Record<string, unknown>} */
  const transform = {};
  if (flip) transform.flip = flip;
  if (rotate) transform.rotate = rotate;
  if (maxEdge) Object.assign(transform, { width: maxEdge, height: maxEdge, fit: "scale-down" });
  // A Response reads a view as exactly its own bytes, not the larger allocation it sits in.
  const stream =
    input instanceof ReadableStream
      ? input
      : /** @type {ReadableStream} */ (new Response(/** @type {BodyInit} */ (input)).body);
  const source = images.input(stream);
  const result = await (
    Object.keys(transform).length ? source.transform(transform) : source
  ).output({ format, quality });
  return result.response();
}
