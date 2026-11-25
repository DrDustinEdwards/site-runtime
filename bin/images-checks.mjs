/** Parts of one page's audit that stand alone: the size URLs (A3, A12), the page's CSP (C11), video and audio (E1 to E3). */

import { parsePolicy } from "../check.mjs";
import { AVIF_MAX_EDGE } from "../image.mjs";
import { MAX_SIZE_URLS, corpOf, shorten } from "./images-fetch.mjs";
import { descendants, textOf } from "./images-layout.mjs";

/** @import { El, Add, Fetched, Load } from "./images-fetch.mjs" */

/**
 * A3 and A12 on the page's size URLs: immutable, an edge HIT when asked again, cross-origin, and an AVIF twin.
 * @param {{ sizeUrls: Set<string>, load: Load, probe: (url: string, headers: Record<string, string>) => Promise<Fetched>, add: Add }} input
 */
export async function auditSizeUrls({ sizeUrls, load, probe, add }) {
  for (const size of [...sizeUrls].slice(0, MAX_SIZE_URLS)) {
    const got = await load(size);
    if (got.status !== 200)
      add(got.status ? "error" : "unmeasured", "A12", size, `answers ${got.status || got.error}`);
    else {
      const cacheControl = got.headers.get("cache-control") ?? "";
      if (!/\bimmutable\b/i.test(cacheControl))
        add("error", "A12", size, `Cache-Control is "${cacheControl}", not immutable`);
      const again = await probe(size, {});
      const status = again.headers.get("cf-cache-status");
      if (status?.toUpperCase() !== "HIT")
        add(
          "error",
          "A12",
          size,
          `asked a second time it is ${status ? `cf-cache-status ${status}` : "not marked by the edge cache (no cf-cache-status)"}, not a HIT`,
        );
      if (corpOf(got) !== "cross-origin")
        add(
          "error",
          "C11",
          size,
          `Cross-Origin-Resource-Policy is "${corpOf(got) || "unset"}", not cross-origin`,
        );
    }
    // A3: the AVIF of the same size, by its .avif name (/media/photo.jpg.webp?w=640) or, on an older site, by f=avif.
    const parsed = new URL(size);
    if (
      !parsed.pathname.startsWith("/media/") ||
      /\.gif(\.\w+)?$/i.test(parsed.pathname) ||
      /\.avif$/i.test(parsed.pathname)
    )
      continue;
    if (/\.\w+\.webp$/i.test(parsed.pathname))
      parsed.pathname = parsed.pathname.replace(/\.webp$/i, ".avif");
    else parsed.searchParams.set("f", "avif");
    // Over Cloudflare's AVIF limit (AVIF_MAX_EDGE) the page offers the WebP, and the route sends an AVIF request there.
    if (Number(parsed.searchParams.get("w")) > AVIF_MAX_EDGE) continue;
    const avif = await load(parsed.href);
    const overLimit =
      avif.status === 200 &&
      /\.webp$/i.test(new URL(avif.url || parsed.href).pathname) &&
      avif.type.toLowerCase().startsWith("image/webp");
    if (!overLimit && (avif.status !== 200 || !avif.type.toLowerCase().startsWith("image/avif")))
      add(
        avif.status ? "error" : "unmeasured",
        "A3",
        parsed.href,
        `answers ${avif.status || avif.error} ${avif.type || "with no type"}, not image/avif`,
      );
  }
}

/**
 * @param {{ headers: Headers, all: El[], imgs: El[], urlsOf: (img: El) => string[], origin: string, url: string, add: Add }} input
 */
export function auditCsp({ headers, all, imgs, urlsOf, origin, url, add }) {
  const policies = [
    headers.get("content-security-policy"),
    ...all
      .filter((e) => /^content-security-policy$/i.test(e.attrs["http-equiv"] ?? ""))
      .map((e) => e.attrs.content),
  ];
  for (const policy of policies) {
    if (!policy) continue;
    const directives = parsePolicy(policy);
    const sources = directives.get("img-src") ?? directives.get("default-src");
    if (!sources) continue;
    for (const img of imgs) {
      const shown = /^data:/i.test(img.attrs.src ?? "") ? ["data:"] : urlsOf(img);
      const refused = shown.find((u) => !imageAllowed(sources, u, origin));
      if (refused)
        add(
          "error",
          "C11",
          url,
          `the page's CSP img-src (${sources.join(" ")}) refuses ${shorten(refused)}`,
        );
    }
  }
}

/**
 * @param {{ all: El[], url: string, absolute: (href: string | undefined) => string | null, add: Add }} input
 */
export function auditMedia({ all, url, absolute, add }) {
  for (const { attrs } of all.filter((e) => e.tag === "iframe")) {
    const src = absolute(attrs.src);
    const label = attrs.src ? shorten(attrs.src) : "an iframe with no src";
    const host = src ? new URL(src).hostname : "";
    if (/(^|\.)youtube\.com$/.test(host) || /(^|\.)vimeo\.com$/.test(host)) {
      add(
        "error",
        "E1",
        url,
        `${label} loads the player with the page; show a poster that loads it on click (a facade)${/youtube/.test(host) ? ", from youtube-nocookie.com" : ""}`,
      );
    }
    if (!attrs.title?.trim())
      add("error", "E1", url, `${label} has no title, so a screen reader cannot say what it is`);
  }
  for (const video of all.filter((e) => e.tag === "video")) {
    const { attrs } = video;
    const problems = [];
    if (attrs.poster === undefined) problems.push("no poster");
    if (attrs.controls === undefined) problems.push("no controls");
    if (
      !descendants(video).some(
        (t) => t.tag === "track" && /^(captions|subtitles)$/i.test(t.attrs.kind ?? ""),
      )
    )
      problems.push("no captions <track>");
    if (attrs.preload?.toLowerCase() === "auto") problems.push('preload="auto"');
    if (problems.length)
      add(
        "error",
        "E2",
        url,
        `${attrs.src ? shorten(attrs.src) : "a <video>"} has ${problems.join(", ")}`,
      );
  }
  const transcript = all.some(
    (e) => e.tag === "a" && /transcript/i.test(`${e.attrs.href ?? ""} ${textOf(e)}`),
  );
  for (const audio of all.filter((e) => e.tag === "audio")) {
    const { attrs } = audio;
    const problems = [];
    // A player of its own counts as controls: buttons beside the <audio> in the element that holds it.
    const player =
      audio.parent &&
      descendants(audio.parent.parent ?? audio.parent).some((e) => e.tag === "button");
    if (attrs.controls === undefined && !player) problems.push("no controls");
    if (attrs.preload?.toLowerCase() !== "none")
      problems.push(
        attrs.preload === undefined ? 'no preload="none"' : `preload="${attrs.preload}"`,
      );
    // A sourceless <audio> is a player's one element (germomics' dock): its transcript belongs with the episode it is given.
    const sourced = attrs.src !== undefined || descendants(audio).some((e) => e.tag === "source");
    if (!transcript && sourced) problems.push("no transcript link on the page");
    if (problems.length)
      add(
        "error",
        "E3",
        url,
        `${attrs.src ? shorten(attrs.src) : "an <audio>"} has ${problems.join(", ")}`,
      );
  }
}

/**
 * @param {string} value
 */
export function linkHeader(value) {
  return value.split(/,(?=\s*<)/).flatMap((part) => {
    const m = /^\s*<([^>]*)>(.*)$/.exec(part);
    if (!m) return [];
    /** @type {Record<string, string | undefined>} */
    const entry = { href: m[1] };
    for (const p of m[2].matchAll(/;\s*([\w-]+)\s*(?:=\s*(?:"([^"]*)"|([^;\s]*)))?/g))
      entry[p[1].toLowerCase()] = p[2] ?? p[3] ?? "";
    return [entry];
  });
}

/**
 * Whether a CSP source list lets an image load: *, 'self', a scheme (data:, https:) or a host source with an optional
 * *. prefix, port and path.
 * @param {string[]} sources
 * @param {string} href the image, or "data:" for a data: URL
 * @param {string} self the page's origin
 */
function imageAllowed(sources, href, self) {
  if (href === "data:") return sources.some((s) => s.toLowerCase() === "data:");
  const u = new URL(href);
  return sources.some((raw) => {
    const s = raw.toLowerCase();
    if (s === "*") return u.protocol === "https:" || u.protocol === "http:";
    if (s === "'self'") return u.origin === self;
    if (/^[a-z][a-z0-9+.-]*:$/.test(s))
      return u.protocol === s || (s === "http:" && u.protocol === "https:");
    const m = /^(?:([a-z][a-z0-9+.-]*):\/\/)?(\*\.)?([^/:']+)(?::(\d+|\*))?(\/.*)?$/.exec(s);
    if (!m) return false;
    if (
      m[1]
        ? m[1] + ":" !== u.protocol && !(m[1] === "http" && u.protocol === "https:")
        : !/^https?:$/.test(u.protocol)
    )
      return false;
    if (m[2] ? !u.hostname.endsWith(`.${m[3]}`) : u.hostname !== m[3]) return false;
    return !m[5] || (m[5].endsWith("/") ? u.pathname.startsWith(m[5]) : u.pathname === m[5]);
  });
}
