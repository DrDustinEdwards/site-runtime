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
export function editImage(images: ImagesLike, input: ReadableStream | ArrayBuffer | ArrayBufferView, { rotate, flip, maxEdge, format, quality }: {
    rotate?: 90 | 180 | 270;
    flip?: "h" | "v" | "hv";
    maxEdge?: number;
    format: "image/jpeg" | "image/png" | "image/webp" | "image/avif";
    quality?: number;
}): Promise<Response>;
import type { ImagesLike } from "./image.mjs";
