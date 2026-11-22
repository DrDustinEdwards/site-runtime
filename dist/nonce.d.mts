/** This render's nonce, for an inline script or style a component writes. */
export function useNonce(): string | undefined;
/** The nonce ./react-entry renders the page with; undefined on a page rendered without one. */
export const NonceContext: import("react").Context<string | undefined>;
