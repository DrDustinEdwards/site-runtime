import type { Context } from "react";

/** The nonce ./react-entry renders the page with; undefined on a page rendered without one. */
export const NonceContext: Context<string | undefined>;
/** This render's nonce, for an inline script or style a component writes. */
export function useNonce(): string | undefined;
