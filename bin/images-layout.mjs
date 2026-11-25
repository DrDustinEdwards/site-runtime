/**
 * Where each element of a page sits on a screen, estimated from the HTML alone, and which file a browser picks for an
 * <img>: the tree, the layout and the srcset reading the audit judges images by.
 */

import { htmlAttributes } from "../html.mjs";

/** @import { El, ImageFile } from "./images-fetch.mjs" */

const VOID = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);

/**
 * The page as a tree of elements and text, tolerant as a browser is: a close tag closes the nearest open element of its
 * name and is ignored when there is none.
 * @param {string} html
 */
export function parseTree(html) {
  /** @type {El} */
  const root = { tag: "#root", attrs: {}, children: [], parent: null };
  let node = root;
  for (const m of html.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^<>]*)>|([^<]+)/g)) {
    if (m[4] !== undefined) {
      if (m[4].trim()) node.children.push(m[4]);
      continue;
    }
    const tag = m[2].toLowerCase();
    if (m[1]) {
      let open = /** @type {El | null} */ (node);
      while (open && open !== root && open.tag !== tag) open = open.parent;
      if (open && open !== root) node = /** @type {El} */ (open.parent);
      continue;
    }
    /** @type {El} */
    const el = { tag, attrs: htmlAttributes(m[3]), children: [], parent: node };
    node.children.push(el);
    if (!VOID.has(tag) && !m[3].trimEnd().endsWith("/")) node = el;
  }
  return root;
}

/** @param {El} el @returns {El[]} */
export function childElements(el) {
  return /** @type {El[]} */ (el.children.filter((c) => typeof c !== "string"));
}

/** Every element under `el`, in document order. @param {El} el @returns {El[]} */
export function descendants(el) {
  return childElements(el).flatMap((c) => [c, ...descendants(c)]);
}

/** @param {El} el @returns {string} */
export function layoutText(el) {
  return el.children.map((c) => (typeof c === "string" ? c : layoutText(c))).join(" ");
}

/** The nearest ancestor of `el` with one of these tags. @param {El} el @param {string[]} tags */
export function within(el, tags) {
  for (let p = el.parent; p; p = p.parent) if (tags.includes(p.tag)) return p;
  return null;
}

const BLOCK = new Set(
  "address article aside blockquote dd details div dl dt fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hr li main nav ol p pre section table tbody thead tr td th ul".split(
    " ",
  ),
);
const REPLACED = new Set(["img", "svg", "video", "iframe"]);
const HIDDEN = new Set([
  "head",
  "title",
  "dialog",
  "datalist",
  "select",
  "option",
  "map",
  "object",
]);
/** Font size by tag at [390, 1440]; everything else is body text. */
const FONT = /** @type {Record<string, number[]>} */ ({
  h1: [32, 44],
  h2: [26, 34],
  h3: [21, 26],
  h4: [18, 20],
  h5: [18, 20],
  h6: [18, 20],
});
/** The blocks whose text is one paint, the size an image must beat: a row of links or buttons is many small ones. */
const PROSE = new Set("blockquote dd dt figcaption h1 h2 h3 h4 h5 h6 li p pre td th".split(" "));
const MARGIN = new Set(
  "blockquote dl figure h1 h2 h3 h4 h5 h6 ol p pre section table ul".split(" "),
);
/** A line of prose stays this wide (CSS px) however wide its column, as sites set a measure. */
const MEASURE = 720;
/** A site header or nav bar: its height, whatever it holds (a phone collapses its links into a menu). */
const BAR = [64, 80];

/**
 * Where each replaced element (img, svg, video, iframe) sits on a screen, estimated from the HTML alone: a fixed bar
 * for a site header or nav, prose as lines of text at a measure, an image at its sizes, else its width attribute
 * capped by its column, at its height-to-width ratio, a narrow image beside others in a row, and a run of alike
 * siblings holding narrow images (cards) as a grid. `text` is the largest visible area of a paragraph, heading or list
 * item above the fold, which an image must beat to be the largest paint.
 * @param {El} root
 * @param {{ width: number, height: number, dpr: number }} vp
 * @param {(img: El) => ImageFile | undefined} fileOf
 */
export function placeImages(root, vp, fileOf) {
  const at = vp.width < 800 ? 0 : 1;
  /** @type {Map<El, { top: number, width: number, height: number }>} */
  const boxes = new Map();
  let text = 0;
  const hidden = (/** @type {El} */ el) =>
    HIDDEN.has(el.tag) ||
    el.attrs.hidden !== undefined ||
    /display\s*:\s*none/i.test(el.attrs.style ?? "") ||
    (el.parent?.tag === "details" && el.parent.attrs.open === undefined && el.tag !== "summary");
  /** @param {El} el @param {number} column */
  const boxOf = (el, column) => {
    const number = (/** @type {string | undefined} */ v) =>
      /^\d+(\.\d+)?$/.test(v ?? "") ? Number(v) : null;
    const file = el.tag === "img" ? fileOf(el) : undefined;
    const viewBox = (el.attrs.viewbox ?? "").split(/[\s,]+/).map(Number);
    const natural =
      number(el.attrs.width) ?? file?.width ?? (viewBox.length === 4 ? viewBox[2] : null);
    const ratio =
      (number(el.attrs.height) ?? file?.height ?? (viewBox.length === 4 ? viewBox[3] : null) ?? 0) /
      (number(el.attrs.width) ?? file?.width ?? viewBox[2] ?? 1);
    const slot = el.tag === "img" ? slotWidth(el.attrs.sizes, vp) : null;
    const width = Math.min(slot ?? natural ?? (el.tag === "img" ? 0 : column), column);
    return {
      width,
      height: width * (Number.isFinite(ratio) && ratio > 0 ? ratio : el.tag === "img" ? 0 : 9 / 16),
    };
  };
  /** The width of the widest replaced element in a card, when it is narrow enough to sit beside another. @param {El} el @param {number} column */
  const cardWidth = (el, column) => {
    const width = Math.max(
      0,
      ...descendants(el)
        .filter((d) => REPLACED.has(d.tag))
        .map((d) => boxOf(d, column).width),
    );
    return width > 0 && width <= column / 2 ? width : 0;
  };
  /** Lays out `el`'s children from `y` in a column; returns the height used. @param {El} el @param {number} y @param {number} column @param {number} font */
  const flow = (el, y, column, font) => {
    let height = 0;
    let chars = 0;
    let rowWidth = 0;
    let rowHeight = 0;
    const endText = () => {
      if (!chars) return;
      const line = Math.min(column, MEASURE);
      const lines = Math.ceil(chars / Math.max(1, Math.floor(line / (font * 0.5))));
      const tall = lines * font * 1.5;
      if (PROSE.has(el.tag) && y + height < vp.height)
        text = Math.max(
          text,
          Math.min(chars * font * 0.5, line) * Math.min(tall, vp.height - y - height),
        );
      height += tall;
      chars = 0;
    };
    const endRow = () => {
      height += rowHeight;
      rowWidth = rowHeight = 0;
    };
    /** @param {Array<El | string>} list */
    const children = (list) => {
      for (let i = 0; i < list.length; i++) {
        const child = list[i];
        if (typeof child === "string") {
          const length = child.replace(/\s+/g, " ").trim().length;
          if (length && rowWidth) endRow();
          chars += length;
          continue;
        }
        if (hidden(child)) continue;
        if (
          (child.tag === "header" || child.tag === "nav") &&
          !within(child, ["main", "article"])
        ) {
          endText();
          endRow();
          for (const d of descendants(child))
            if (REPLACED.has(d.tag)) boxes.set(d, { top: y + height + 8, ...boxOf(d, column) });
          height += BAR[at];
          continue;
        }
        if (REPLACED.has(child.tag)) {
          const box = boxOf(child, column);
          endText();
          if (box.width >= 0.6 * column) {
            endRow();
            boxes.set(child, { top: y + height, ...box });
            height += box.height + 16;
          } else {
            if (rowWidth && rowWidth + box.width > column) endRow();
            boxes.set(child, { top: y + height, ...box });
            rowWidth += box.width + 8;
            rowHeight = Math.max(rowHeight, box.height);
          }
          continue;
        }
        const block =
          BLOCK.has(child.tag) ||
          (child.tag === "a" &&
            descendants(child).some((d) => REPLACED.has(d.tag) || BLOCK.has(d.tag)));
        if (!block) {
          children(child.children);
          continue;
        }
        endText();
        endRow();
        const card = cardWidth(child, column);
        let last = i;
        const alike = (/** @type {El | string | undefined} */ next) =>
          typeof next !== "string" &&
          next?.tag === child.tag &&
          next.attrs.class === child.attrs.class;
        if (card) while (alike(list[last + 1])) last++;
        if (last > i) {
          const columns = Math.max(1, Math.floor((column * 1.05) / card));
          let tallest = 0;
          for (let k = i; k <= last; k++) {
            if (k > i && (k - i) % columns === 0) {
              height += tallest + 16;
              tallest = 0;
            }
            tallest = Math.max(tallest, flow(/** @type {El} */ (list[k]), y + height, card, font));
          }
          height += tallest + 16;
          i = last;
          continue;
        }
        height +=
          flow(child, y + height, column, FONT[child.tag]?.[at] ?? font) +
          (MARGIN.has(child.tag) ? 16 : 0);
      }
    };
    children(el.children);
    endText();
    endRow();
    return height;
  };
  const body = descendants(root).find((e) => e.tag === "body") ?? root;
  flow(body, 0, Math.min(vp.width - (at ? 64 : 32), 1200), at ? 18 : 17);
  return { boxes, text };
}

/**
 * The width a `sizes` attribute gives an image on a screen, in CSS px: its first entry whose media condition holds;
 * null when it has none, is `auto`, or cannot be read.
 * @param {string | undefined} sizes
 * @param {{ width: number }} vp
 */
export function slotWidth(sizes, vp) {
  for (const entry of splitTop(sizes ?? "")) {
    const m = /^(\(.*\)|not\s.*?\))\s+(\S.*)$/i.exec(entry) ?? /^()(\S.*)$/.exec(entry);
    if (!m || /^auto$/i.test(m[2])) return null;
    if (!m[1] || mediaMatches(m[1], vp)) return cssLength(m[2], vp);
  }
  return null;
}

/**
 * Whether a media condition holds on a screen: widths (min-, max- and the range forms) in px, em or rem, and a light,
 * motion-allowing screen; anything else does not hold. No condition always does.
 * @param {string | undefined} query
 * @param {{ width: number }} vp
 */
function mediaMatches(query, vp) {
  if (!query?.trim()) return true;
  return query.split(/\s*,\s*/).some((alternative) => {
    const negated = /^\s*not\s/i.test(alternative);
    const holds = [...alternative.matchAll(/\(([^()]*)\)/g)].every(([, feature]) => {
      const px = (/** @type {string} */ v) => Number.parseFloat(v) * (/r?em/.test(v) ? 16 : 1);
      const f = feature.trim().toLowerCase();
      let m;
      if ((m = /^min-width\s*:\s*([\d.]+\w*)$/.exec(f))) return vp.width >= px(m[1]);
      if ((m = /^max-width\s*:\s*([\d.]+\w*)$/.exec(f))) return vp.width <= px(m[1]);
      if ((m = /^width\s*(>=|>|<=|<)\s*([\d.]+\w*)$/.exec(f)))
        return {
          ">=": vp.width >= px(m[2]),
          ">": vp.width > px(m[2]),
          "<=": vp.width <= px(m[2]),
          "<": vp.width < px(m[2]),
        }[m[1]];
      return (
        /^prefers-color-scheme\s*:\s*light$|^prefers-reduced-motion\s*:\s*no-preference$|^orientation/.test(
          f,
        ) || f === ""
      );
    });
    return negated ? !holds : holds;
  });
}

/**
 * A CSS length in px on a screen: px, vw, em, rem, and calc(), min(), max() and clamp() of them; null otherwise.
 * @param {string} value
 * @param {{ width: number }} vp
 */
function cssLength(value, vp) {
  const v = value.trim().toLowerCase();
  let m;
  if ((m = /^(-?[\d.]+)(px|vw|r?em)?$/.exec(v)))
    return Number(m[1]) * ({ vw: vp.width / 100, em: 16, rem: 16 }[m[2] ?? "px"] ?? 1);
  if ((m = /^(calc|min|max|clamp)\((.*)\)$/.exec(v))) {
    if (m[1] !== "calc") {
      const args = splitTop(m[2]).map((a) => cssLength(a, vp));
      if (args.some((a) => a === null)) return null;
      const n = /** @type {number[]} */ (args);
      return m[1] === "min"
        ? Math.min(...n)
        : m[1] === "max"
          ? Math.max(...n)
          : Math.min(Math.max(n[0], n[1]), n[2]);
    }
    let total = 0;
    for (const term of m[2].match(/[+-]?\s*(?:[a-z]+\([^()]*\)|[\d.]+[a-z%]*)/g) ?? []) {
      const sign = term.trim().startsWith("-") ? -1 : 1;
      const length = cssLength(term.replace(/^[+-]\s*/, ""), vp);
      if (length === null) return null;
      total += sign * length;
    }
    return total;
  }
  return null;
}

/** A comma-separated list split only at its top level, so calc(), min() and media queries stay whole. @param {string} text */
function splitTop(text) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i <= text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")") depth--;
    else if ((text[i] === "," && depth === 0) || i === text.length) {
      if (text.slice(start, i).trim()) parts.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  return parts;
}

/**
 * The file a browser downloads for an <img> shown `shown` CSS px wide on a screen, as the HTML standard picks it: the
 * first <picture> source whose media holds, else the img's srcset, its candidate with the least density at or above
 * the DPR (else the densest), or the src. Its width comes from a w descriptor, a ?w= size URL or the file read; null
 * when none says.
 * @param {El} img
 * @param {number} shown
 * @param {{ width: number, dpr: number }} vp
 * @param {(href: string | undefined) => string | null} absolute
 * @param {Map<string, ImageFile>} files
 */
export function picked(img, shown, vp, absolute, files) {
  const source =
    img.parent?.tag === "picture"
      ? childElements(img.parent).find(
          (s) => s.tag === "source" && s.attrs.srcset && mediaMatches(s.attrs.media, vp),
        )
      : undefined;
  const candidates = candidatesOf(source?.attrs.srcset ?? img.attrs.srcset);
  if (
    candidates.length &&
    candidates.every((c) => !c.w) &&
    !candidates.some((c) => (c.x ?? 1) === 1) &&
    img.attrs.src
  )
    candidates.push({ url: img.attrs.src, x: 1 });
  const ranked = candidates
    .map((c) => ({ url: c.url, density: c.w ? c.w / shown : (c.x ?? 1), w: c.w }))
    .sort((a, b) => a.density - b.density);
  const pick = ranked.find((c) => c.density >= vp.dpr) ??
    ranked.at(-1) ?? { url: img.attrs.src ?? "", w: undefined };
  const url = absolute(pick.url);
  if (!url) return null;
  const width = pick.w ?? (Number(new URL(url).searchParams.get("w")) || files.get(url)?.width);
  return width ? { url, width } : null;
}

/**
 * The candidates a srcset names, read as the HTML standard does: a URL runs to whitespace (a comma inside it, as in
 * /cdn-cgi/image/w=640,f=auto/, is part of it), a trailing comma ends a candidate, and descriptors run to a comma.
 * @param {string | undefined} srcset
 * @returns {Array<{ url: string, w?: number, x?: number }>}
 */
export function candidatesOf(srcset) {
  /** @type {Array<{ url: string, w?: number, x?: number }>} */
  const candidates = [];
  const text = srcset ?? "";
  let at = 0;
  while (at < text.length) {
    while (at < text.length && /[\s,]/.test(text[at])) at++;
    const start = at;
    while (at < text.length && !/\s/.test(text[at])) at++;
    let url = text.slice(start, at);
    let descriptor = "";
    if (url.endsWith(",")) url = url.replace(/,+$/, "");
    else {
      const from = at;
      while (at < text.length && text[at] !== ",") at++;
      descriptor = text.slice(from, at).trim().toLowerCase();
    }
    const m = /^([\d.]+)([wx])$/.exec(descriptor);
    if (url) candidates.push({ url, ...(m ? { [m[2]]: Number(m[1]) } : {}) });
  }
  return candidates;
}
