/**
 * The route: the original for a bare request, or one transformed size for `?w=`. It never writes to the bucket.
 * @param {{ widths: Set<number>, ratios: Set<string>, formats: Set<string>, quality: number }} closed the site's closed sets
 * @param {Request} request
 * @param {{ object: R2ObjectLike | null, images?: ImagesLike, cache?: Cache, cacheControl?: string, reread?: () => Promise<R2ObjectLike | null> }} options
 */
export function respondImage({ widths, ratios, formats, quality }: {
    widths: Set<number>;
    ratios: Set<string>;
    formats: Set<string>;
    quality: number;
}, request: Request, { object, images, cache, cacheControl, reread }: {
    object: R2ObjectLike | null;
    images?: ImagesLike;
    cache?: Cache;
    cacheControl?: string;
    reread?: () => Promise<R2ObjectLike | null>;
}): Promise<Response>;
import type { R2ObjectLike } from "./image-core.mjs";
import type { ImagesLike } from "./image-core.mjs";
