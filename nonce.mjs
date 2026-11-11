/**
 * The render's Content-Security-Policy nonce as a React context, for components that render their own inline
 * `<script>` or `<style>` (the root Layout's theme script, a JSON-LD block). ./react-entry provides it around every
 * page it renders, so a site never declares its own. Undefined in the browser: the nonce matters only in the server
 * HTML, and browsers hide it from the DOM anyway. Browser-safe: it imports only `react`.
 */
import { createContext, useContext } from "react";

/** The nonce ./react-entry renders the page with; undefined on a page rendered without one. */
export const NonceContext = createContext(/** @type {string | undefined} */ (undefined));

/** This render's nonce, for an inline script or style a component writes. */
export function useNonce() {
  return useContext(NonceContext);
}
