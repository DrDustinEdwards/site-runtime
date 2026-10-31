/**
 * Responsive images (image.mjs): the attributes a page writes for an image and the route that serves each size from
 * the original in R2 through the Images binding, sharing one closed set of widths and crops. Widths, sizes and layouts
 * are Astro's (MIT, Copyright (c) 2021 Fred K. Schott). A GIF's sizes stay animated (WebP, no AVIF) and offer their first
 * frame under prefers-reduced-motion.
 */

export type ImageLayout = "constrained" | "fixed" | "full-width";
export type ImageFormat = "avif" | "webp";

/** Astro's limited screen widths. */
export const SCREEN_WIDTHS: number[];
export const IMAGE_FORMATS: { readonly avif: "image/avif"; readonly webp: "image/webp" };
export const IMAGE_QUALITY: 85;
/** The R2 custom-metadata field holding a file's focal point ("XxY", 0 to 1). */
export const FOCUS_METADATA: "focus";

/** A focal point as written in a URL, or null. */
export function focusOf(value: unknown): string | null;

/** Astro's widths for a layout, never wider than the original. */
export function imageWidths(options: { layout: ImageLayout; width?: number; originalWidth?: number; breakpoints?: number[] }): number[];

/** Astro's `sizes` for a layout. */
export function imageSizes(options: { layout: ImageLayout; width?: number }): string | undefined;

export interface ImageUse {
  layout: ImageLayout;
  /** The CSS width it shows at; required unless full-width. */
  width?: number;
  /** Overrides the computed `sizes`. */
  sizes?: string;
  /** A crop, such as "16x9", cut around the file's focal point. */
  ratio?: string;
}

export interface StoredImage {
  src: string;
  width: number | null;
  height: number | null;
  focus?: string | null;
}

export interface ImageAttributes {
  src: string;
  srcset: string | undefined;
  sizes: string | undefined;
  /**
   * AVIF then WebP, for a `<picture>`; empty when the image gets no srcset. A GIF's are its still first frame (AVIF then
   * WebP, each with `media` "(prefers-reduced-motion: reduce)"), then the animated WebP.
   */
  sources: Array<{ type: string; srcset: string; media?: string }>;
  width: number | undefined;
  height: number | undefined;
}

export interface R2ObjectLike {
  body: ReadableStream;
  httpEtag: string;
  httpMetadata?: { contentType?: string };
  customMetadata?: Record<string, string>;
  writeHttpMetadata(headers: Headers): void;
}

export interface ImagesOutput {
  output(options: { format: string; quality?: number; anim?: boolean }): Promise<{ response(): Response }>;
}

export interface ImagesLike {
  input(stream: ReadableStream): ImagesOutput & { transform(options: object): ImagesOutput };
}

export function defineImages<U extends string>(config: {
  uses: Record<U, ImageUse>;
  breakpoints?: number[];
  quality?: number;
}): {
  /** The closed width set, ascending. */
  widths: number[];
  ratios: string[];
  url(src: string, options: { width: number; format?: ImageFormat; ratio?: string; focus?: string | null; still?: boolean }): string;
  attributes(image: StoredImage, use: U): ImageAttributes;
  /**
   * The original for a bare request, one transformed size for `?w=` (a GIF's first frame for `still=1`); 400 for
   * anything outside the closed sets, and for a still of anything but a GIF.
   */
  respond(
    request: Request,
    options: { object: R2ObjectLike | null; images?: ImagesLike; cache?: Cache; cacheControl?: string; reread?: () => Promise<R2ObjectLike | null> },
  ): Promise<Response>;
};

export interface PictureProps {
  /** One `<source>` each; empty when the page writes the `<img>` alone. */
  sources: Array<{ type: string; srcSet: string; sizes: string | undefined; media: string | undefined }>;
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
  };
}

/** What a `<picture>` for `attributes()` holds, with JSX's prop names (undefined where unset). No React needed. */
export function pictureProps(attrs: ImageAttributes, options: { alt: string; priority?: boolean; className?: string }): PictureProps;

/** `<picture>` markup for `attributes()`: `pictureProps` written out, escaped with the site's attribute escape. */
export function pictureHtml(
  attrs: ImageAttributes,
  options: { alt: string; priority?: boolean; className?: string },
  escape: (value: string) => string,
): string;

export type EditFormat = "image/jpeg" | "image/png" | "image/webp" | "image/avif";

/**
 * One picture turned, mirrored, shrunk or only re-encoded through the Images binding, encoded as `format` (quality 85
 * unless said). Flip is applied before rotate; rotate is clockwise; `maxEdge` fits inside that square and never
 * enlarges. Throws on options outside these before the binding is called.
 */
export function editImage(
  images: ImagesLike,
  input: ReadableStream | ArrayBuffer | ArrayBufferView,
  options: { rotate?: 90 | 180 | 270; flip?: "h" | "v" | "hv"; maxEdge?: number; format: EditFormat; quality?: number },
): Promise<Response>;
