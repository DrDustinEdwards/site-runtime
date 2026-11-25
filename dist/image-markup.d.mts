/** @import { ImageAttributes } from "./image.mjs" */
/**
 * @typedef {object} PictureProps
 * @property {Array<{ type: string; srcSet: string; sizes: string | undefined; media: string | undefined; }>} sources One `<source>` each; empty when the page writes the `<img>` alone.
 * @property {{ src: string; srcSet: string | undefined; sizes: string | undefined; width: number | undefined; height: number | undefined; alt: string; className: string | undefined; loading: "eager" | "lazy"; fetchPriority: "high" | undefined; decoding: "async"; style: { background?: string; objectPosition?: string } | undefined; }} img
 */
/**
 * What a `<picture>` for `attributes()` holds, as plain objects with JSX's prop names: `sources` for the `<source>`
 * elements and `img` for the `<img>` (alone when there are no sources). `alt` is required ("" for none). Lazy by
 * default; the page's first large image passes `priority`. `focus` sets the `<img>`'s `objectPosition`.
 * @param {ImageAttributes} attrs
 * @param {{ alt: string, priority?: boolean, className?: string, focus?: unknown }} options
 */
export function pictureProps(attrs: ImageAttributes, { alt, priority, className, focus }: {
    alt: string;
    priority?: boolean;
    className?: string;
    focus?: unknown;
}): {
    sources: {
        type: string;
        srcSet: string;
        sizes: string | undefined;
        media: string | undefined;
    }[];
    img: {
        src: string;
        srcSet: string | undefined;
        sizes: string | undefined;
        width: number | undefined;
        height: number | undefined;
        alt: string;
        className: string | undefined;
        loading: "eager" | "lazy";
        fetchPriority: "high" | undefined;
        decoding: "async";
        style: {
            objectPosition?: string | undefined;
            background?: string | undefined;
        } | undefined;
    };
};
/**
 * The preload for a page's LCP image (`./preload`): the first unconditional `<source>` (typed), else the `<img>`'s.
 * @param {ImageAttributes} attrs
 */
export function imagePreload(attrs: ImageAttributes): {
    fetchPriority: "high";
    imageSizes?: string | undefined;
    imageSrcSet?: string | undefined;
    type?: string | undefined;
    href: string;
    as: "image";
};
/**
 * `<picture>` markup for `attributes()`: `pictureProps` written out as a string.
 * @param {ImageAttributes} attrs
 * @param {{ alt: string, priority?: boolean, className?: string }} options
 * @param {(value: string) => string} escape the site's HTML attribute escape (`escapeHtml` from ./html)
 */
export function pictureHtml(attrs: ImageAttributes, options: {
    alt: string;
    priority?: boolean;
    className?: string;
}, escape: (value: string) => string): string;
export type PictureProps = {
    /**
     * One `<source>` each; empty when the page writes the `<img>` alone.
     */
    sources: Array<{
        type: string;
        srcSet: string;
        sizes: string | undefined;
        media: string | undefined;
    }>;
    img: {
        src: string;
        srcSet: string | undefined;
        sizes: string | undefined;
        width: number | undefined;
        height: number | undefined;
        alt: string;
        className: string | undefined;
        loading: "eager" | "lazy";
        fetchPriority: "high" | undefined;
        decoding: "async";
        style: {
            background?: string;
            objectPosition?: string;
        } | undefined;
    };
};
import type { ImageAttributes } from "./image.mjs";
