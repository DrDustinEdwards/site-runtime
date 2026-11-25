/** The page half's markup: a `<picture>`'s props, the same as HTML, and the LCP image's preload. */

import { focalPosition } from "./image-core.mjs";

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
export function pictureProps(attrs, { alt, priority = false, className, focus }) {
  const objectPosition = focalPosition(focus);
  const style =
    attrs.background || objectPosition
      ? {
          ...(attrs.background ? { background: attrs.background } : {}),
          ...(objectPosition ? { objectPosition } : {}),
        }
      : undefined;
  return {
    sources: attrs.sources.map((s) => ({
      type: s.type,
      srcSet: s.srcset,
      sizes: attrs.sizes,
      media: s.media,
    })),
    img: {
      src: attrs.src,
      srcSet: attrs.srcset,
      sizes: attrs.sizes,
      width: attrs.width,
      height: attrs.height,
      alt,
      className,
      loading: priority ? /** @type {const} */ ("eager") : /** @type {const} */ ("lazy"),
      fetchPriority: priority ? /** @type {const} */ ("high") : undefined,
      decoding: /** @type {const} */ ("async"),
      style,
    },
  };
}

/**
 * The preload for a page's LCP image (`./preload`): the first unconditional `<source>` (typed), else the `<img>`'s.
 * @param {ImageAttributes} attrs
 */
export function imagePreload(attrs) {
  const source = attrs.sources.find((s) => !s.media);
  const srcset = source?.srcset ?? attrs.srcset;
  return {
    href: attrs.src,
    as: /** @type {const} */ ("image"),
    ...(source ? { type: source.type } : {}),
    ...(srcset ? { imageSrcSet: srcset, ...(attrs.sizes ? { imageSizes: attrs.sizes } : {}) } : {}),
    fetchPriority: /** @type {const} */ ("high"),
  };
}

/** The HTML attribute for each JSX prop `pictureProps` names differently. */
const HTML_NAMES = /** @type {Record<string, string>} */ ({
  srcSet: "srcset",
  className: "class",
  fetchPriority: "fetchpriority",
});

/**
 * `<picture>` markup for `attributes()`: `pictureProps` written out as a string.
 * @param {ImageAttributes} attrs
 * @param {{ alt: string, priority?: boolean, className?: string }} options
 * @param {(value: string) => string} escape the site's HTML attribute escape (`escapeHtml` from ./html)
 */
export function pictureHtml(attrs, options, escape) {
  const { sources, img } = pictureProps(attrs, options);
  const tag = (/** @type {string} */ name, /** @type {Record<string, unknown>} */ props) =>
    `<${name}${Object.entries(props)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(
        ([prop, value]) =>
          ` ${HTML_NAMES[prop] ?? prop}="${escape(prop === "style" ? styleText(/** @type {{ background?: string, objectPosition?: string }} */ (value)) : String(value))}"`,
      )
      .join("")}>`;
  if (sources.length === 0) return tag("img", img);
  return `<picture>${sources.map((s) => tag("source", s)).join("")}${tag("img", img)}</picture>`;
}

/** @param {{ background?: string, objectPosition?: string }} style */
function styleText({ background, objectPosition }) {
  return [
    ...(background ? [`background:${background}`] : []),
    ...(objectPosition ? [`object-position:${objectPosition}`] : []),
  ].join(";");
}
