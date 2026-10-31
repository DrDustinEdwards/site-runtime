// @ts-check
/**
 * The players a post may embed, as the security side sees them: the origins a page's Content-Security-Policy lets it
 * frame (`frame-src`) and the features its Permissions-Policy hands those frames. The services are Dustin's list
 * (2026-10-31): YouTube, TikTok, Spotify, SoundCloud, Apple Podcasts, Amazon Music, Google Maps, X, Bluesky and
 * Instagram. Prelum's `::embed` (@drdustinedwards/site-helpers/render/embeds) turns an author's link into one of these
 * players and its test holds that every player it can build is on this list, so a service is added here first.
 *
 * A registry entry turns them on with its `embeds` opt-in (./sites): buildSecurityHeaders then delegates EMBED_FEATURES
 * to these origins, a static site's page policy (staticHeaders, ./static-site) adds them to frame-src, and the check
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
 * protected audio (Spotify, Apple Podcasts, Amazon Music), full screen and picture-in-picture. A frame gets a feature
 * only when the page's Permissions-Policy allows it for the frame's origin.
 */
export const EMBED_FEATURES = /* @__PURE__ */ Object.freeze(["autoplay", "encrypted-media", "fullscreen", "picture-in-picture"]);

/**
 * `permissions` with each of EMBED_FEATURES allowed for the site's own pages and the players, whatever the policy said
 * of it before (OSHP denies all four). Other features are kept as they were.
 * @param {string} permissions a Permissions-Policy value
 * @returns {string}
 */
export function permissionsAllowingEmbeds(permissions) {
  const allowList = `(self ${EMBED_FRAME_SOURCES.map((o) => JSON.stringify(o)).join(" ")})`;
  const kept = permissions.split(",").map((d) => d.trim()).filter((d) => d && !EMBED_FEATURES.includes(d.split("=")[0] ?? ""));
  return [...kept, ...EMBED_FEATURES.map((f) => `${f}=${allowList}`)].join(", ");
}
