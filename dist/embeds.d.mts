/**
 * `permissions` with each of EMBED_FEATURES allowed for the page and the players' origins (EMBED_FRAME_SOURCES),
 * whatever the policy said of it before (OSHP denies all four). Other features are kept as they were.
 *
 * The header is the second lock behind `frame-src`: a frame's own `allow` attribute can only pick from it, so no
 * origin outside the players can be handed these features. Amazon Music is `music.amazon.com` only (Dustin will not
 * embed from another country), which keeps this to ten origins and under Cloudflare's
 * 2,000-character `_headers` limit per line.
 * @param {string} permissions a Permissions-Policy value
 */
export function permissionsAllowingEmbeds(permissions: string): string;
/**
 * The players a post may embed, as the security side sees them: the origins a page's Content-Security-Policy lets it
 * frame (`frame-src`) and the features its Permissions-Policy hands those frames. The services are Dustin's list:
 * YouTube, TikTok, Spotify, SoundCloud, Apple Podcasts, Amazon Music, Google Maps, X, Bluesky and
 * Instagram. Prelum's `::embed` (@drdustinedwards/site-helpers/render/embeds) turns an author's link into one of these
 * players and its test holds that every player it can build is on this list, so a service is added here first.
 *
 * A registry entry turns them on with its `embeds` opt-in (./sites): buildSecurityHeaders then allows EMBED_FEATURES
 * for the players, a static site's page policy (staticHeaders, ./static-site) adds them to frame-src, and the check
 * holds a rendered site's own policy to them. A player sends no Cross-Origin-Embedder-Policy, so an enforced COEP
 * refuses it: an entry with embeds keeps its coep Report-Only. Dependency-free.
 */
/** The players' origins, for a page's frame-src. */
export const EMBED_FRAME_SOURCES: readonly string[];
/**
 * The features a player asks for in its iframe's `allow` (Prelum's render/enhance): play on the click that loaded it,
 * protected audio (Spotify, Apple Podcasts, Amazon Music), full screen and picture-in-picture.
 */
export const EMBED_FEATURES: readonly string[];
