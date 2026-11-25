/** C1 to C3 and C11 of the image audit: a page's share card and its tags. */

import { mediaType } from "../http.mjs";
import { readImage } from "./image-file.mjs";
import { BROWSER_ACCEPT, READ_LIMIT, collect } from "./images-fetch.mjs";

/** @import { Fetched, Finding, Load } from "./images-fetch.mjs" */

/**
 * @param {{ url: string, meta: Map<string, string>, absolute: (href: string | undefined) => string | null, load: Load }} input
 */
export async function auditShareCard({ url, meta, absolute, load }) {
  const { findings, add } = collect();
  const card = meta.get("twitter:card");
  if (card !== "summary_large_image")
    add(
      "error",
      "C3",
      url,
      card
        ? `twitter:card is "${card}", not summary_large_image`
        : "no twitter:card; summary_large_image shows the card full width",
    );
  const alt = meta.get("twitter:image:alt");
  if (!alt) add("error", "C3", url, "no twitter:image:alt");
  else if (alt.length > 420)
    add("error", "C3", url, `twitter:image:alt is ${alt.length} characters; X cuts it at 420`);

  const image = meta.get("og:image");
  if (!image) {
    add("error", "C1", url, "no og:image, so a shared link has no card");
    return findings;
  }
  if (!/^https:\/\//i.test(image))
    add("error", "C1", url, `og:image is "${image}"; previews need an absolute https URL`);
  const src = absolute(image);
  if (!src) return findings;
  const got = await load(src, READ_LIMIT);
  if (got.status !== 200) {
    add(
      got.status ? "error" : "unmeasured",
      "C1",
      src,
      `the og:image of ${url} answers ${got.status || got.error}`,
    );
    return findings;
  }
  if (!got.type.toLowerCase().startsWith("image/"))
    add("error", "C1", src, `the og:image of ${url} is ${got.type || "untyped"}, not an image`);
  const corp = got.headers.get("cross-origin-resource-policy")?.toLowerCase();
  if (corp !== "cross-origin")
    add(
      "error",
      "C11",
      src,
      `the share card's Cross-Origin-Resource-Policy is "${corp ?? "unset"}", not cross-origin, so a preview on another site may not load it`,
    );
  const file = readImage(got.bytes);
  if (!file) add("error", "C2", src, `the size of the og:image of ${url} cannot be read`);
  else if (file.width !== 1200 || file.height !== 630) {
    add(
      file.width >= 1200 ? "warning" : "error",
      "C2",
      src,
      `the og:image is ${file.width} by ${file.height}, not 1200 by 630`,
    );
  }
  const missing = ["og:image:width", "og:image:height", "og:image:type", "og:image:alt"].filter(
    (key) => !meta.get(key),
  );
  if (missing.length) add("error", "C3", url, `no ${missing.join(", ")}`);
  const wrong = [];
  if (file && meta.get("og:image:width") && Number(meta.get("og:image:width")) !== file.width)
    wrong.push(`og:image:width ${meta.get("og:image:width")} (the file is ${file.width})`);
  if (file && meta.get("og:image:height") && Number(meta.get("og:image:height")) !== file.height)
    wrong.push(`og:image:height ${meta.get("og:image:height")} (the file is ${file.height})`);
  // The type a crawler (Accept */*) and a browser (Accept with AVIF and WebP) are each served, and what the bytes are.
  const said = meta.get("og:image:type")?.toLowerCase();
  const typeOf = (/** @type {Fetched} */ f) => mediaType(f.type);
  const browser = await load(src, 0, BROWSER_ACCEPT);
  const served = [
    ...new Set([typeOf(got), browser.status === 200 ? typeOf(browser) : ""].filter(Boolean)),
  ];
  if (said && served.some((t) => t !== said))
    wrong.push(`og:image:type ${said} (it is served as ${served.join(" or ")})`);
  if (wrong.length) add("error", "C3", url, `${wrong.join(", ")} does not match the file`);
  if (file && typeOf(got) !== file.type)
    add(
      "error",
      "C3",
      src,
      `Content-Type is ${typeOf(got) || "unset"}, but the bytes are ${file.type}`,
    );
  return findings;
}
