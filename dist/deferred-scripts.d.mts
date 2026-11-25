/**
 * True when a matched route hydrates on load: its `handle.hydrate` is true, or a function of its loader data that
 * returns true. Every other page can defer. Pass `useMatches()`.
 * @param {readonly { handle?: unknown, loaderData?: unknown }[]} matches
 */
export function routeHydrates(matches: readonly {
    handle?: unknown;
    loaderData?: unknown;
}[]): boolean;
/**
 * The boot JSON's text: what React Router's `<Scripts>` would have run, as data.
 * @param {{
 *   manifest: any,
 *   serverHandoffString?: string,
 *   lazy: boolean,
 *   router: any,
 *   matches: { route: { id: string } }[],
 * }} input
 */
export function bootJson({ manifest, serverHandoffString, lazy, router, matches }: {
    manifest: any;
    serverHandoffString?: string;
    lazy: boolean;
    router: any;
    matches: {
        route: {
            id: string;
        };
    }[];
}): string;
/**
 * React Router's scripts, or on a deferred page its boot as JSON. Marks the page hydrated once the app is live.
 * @param {{ deferred: boolean }} props
 */
export function HydrationScripts({ deferred }: {
    deferred: boolean;
}): import("react").FunctionComponentElement<import("react").FragmentProps>;
/**
 * The head's stand-in for React Router's stream on a deferred page (STREAM_BUFFER_SCRIPT); nothing on any other page.
 * @param {{ deferred: boolean }} props
 */
export function StreamBuffer({ deferred }: {
    deferred: boolean;
}): import("react").DetailedReactHTMLElement<{
    nonce: string | undefined;
    suppressHydrationWarning: true;
    dangerouslySetInnerHTML: {
        __html: string;
    };
}, HTMLElement> | null;
