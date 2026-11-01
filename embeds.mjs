// @ts-check
/**
 * The players a post may embed, as the security side sees them: the origins a page's Content-Security-Policy lets it
 * frame (`frame-src`) and the features its Permissions-Policy hands those frames. The services are Dustin's list
 * (2026-10-31): YouTube, TikTok, Spotify, SoundCloud, Apple Podcasts, Amazon Music, Google Maps, X, Bluesky and
 * Instagram. Prelum's `::embed` (@drdustinedwards/site-helpers/render/embeds) turns an author's link into one of these
 * players and its test holds that every player it can build is on this list, so a service is added here first.
 *
 * A registry entry turns them on with its `embeds` opt-in (./sites): buildSecurityHeaders then sets EMBED_FEATURES
 * to `*`, a static site's page policy (staticHeaders, ./static-site) adds them to frame-src, and the check
 * holds a rendered site's own policy to them. A player sends no Cross-Origin-Embedder-Policy, so an enforced COEP
 * refuses it: an entry with embeds keeps its coep Report-Only. Dependency-free.
 */

const AMAZON_MUSIC_TLDS = ["com", "ca", "com.mx", "com.br", "co.uk", "de", "fr", "es", "it", "in", "co.jp", "com.au"];

/** The players' origins, for a page's frame-src. */
export const EMBED_FRAME_SOURCES = /* @__PURE__ */ Object.freeze([
  "https://www.youtube-nocookie.com",
  "https://www.tiktok.com",
  "https://open.spotify.com",
  "https://w.soundcloud.com",
  "https://embed.podcasts.apple.com",
  ...AMAZON_MUSIC_TLDS.map((tld) => `https://music.amazon.${tld}`),
  "https://www.google.com",
  "https://platform.twitter.com",
  "https://embed.bsky.app",
  "https://www.instagram.com",
]);

/**
 * The features a player asks for in its iframe's `allow` (Prelum's render/enhance): play on the click that loaded it,
 * protected audio (Spotify, Apple Podcasts, Amazon Music), full screen and picture-in-picture.
 */
export const EMBED_FEATURES = /* @__PURE__ */ Object.freeze(["autoplay", "encrypted-media", "fullscreen", "picture-in-picture"]);

/**
 * `permissions` with each of EMBED_FEATURES set to `*`, whatever the policy said of it before (OSHP denies all four).
 * Other features are kept as they were.
 *
 * Why `*` and not a list of the players. A header allowlist is the superset of origins a frame may be given a feature
 * for, and the frame's own `allow` attribute picks from it (MDN, "Permissions Policy": "specify the widest acceptable
 * support for a feature in the HTTP header, and then specify the subset of support you need in each `<iframe>`"; W3C
 * Permissions Policy: the header and the attribute combine with AND). All four features default to `'self'`, or `*` for
 * picture-in-picture, so a frame whose `allow` does not name the feature is not given it cross-origin whatever the
 * header says, and only Prelum's click-to-load script writes an `allow`, on a player from its own list. Which origins
 * may be framed at all is the Content-Security-Policy's `frame-src` (EMBED_FRAME_SOURCES), one list that grows with
 * each player, rather than the same list four times here, which put the line over Cloudflare's 2,000-character
 * `_headers` limit. The trade: the header no longer stops a frame that CSP lets in from being handed these four
 * low-risk media features by an `allow` attribute. The powerful ones (camera, microphone, geolocation, payment, USB)
 * stay `()`.
 * @param {string} permissions a Permissions-Policy value
 * @returns {string}
 */
export function permissionsAllowingEmbeds(permissions) {
  const kept = permissions.split(",").map((d) => d.trim()).filter((d) => d && !EMBED_FEATURES.includes(d.split("=")[0] ?? ""));
  return [...kept, ...EMBED_FEATURES.map((f) => `${f}=*`)].join(", ");
}
