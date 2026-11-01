/**
 * The players a post may embed: the origins a page's frame-src lets in and the features its Permissions-Policy hands
 * them. A registry entry turns them on with its `embeds` opt-in (./sites).
 */

/** The players' origins, for a page's frame-src. */
export declare const EMBED_FRAME_SOURCES: readonly string[];

/** The features a player's iframe asks for: autoplay, encrypted-media, fullscreen, picture-in-picture. */
export declare const EMBED_FEATURES: readonly string[];

/** `permissions` with each of EMBED_FEATURES allowed for the page and the players' origins (each frame's own `allow` picks from it); other features kept. */
export declare function permissionsAllowingEmbeds(permissions: string): string;
