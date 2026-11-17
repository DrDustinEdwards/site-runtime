/**
 * The share-card renderer: a card's HTML drawn to a PNG by Takumi (takumi-js), its WebAssembly build, which the bundler
 * compiles from the `.wasm` import (Workers forbid compiling WASM from bytes at run time). Takumi reads HTML and CSS
 * itself and has no Satori in it: Satori's standalone build needs harfbuzz WASM compiled from bytes, which Workers
 * refuse, and workers-og's pinned Satori carries GHSA-wx4j-mvgx-mqwp (fixed in 0.33.5).
 * This file imports `.wasm`, which Node cannot, so only a Worker bundle loads it; `./share-card` takes it as `draw` and
 * is tested without it.
 */
import { render } from "takumi-js";
// @ts-expect-error TypeScript has no types for a .wasm module; the bundler compiles it.
import wasm from "@takumi-rs/wasm/takumi_wasm_bg.wasm";

/**
 * `html` drawn at `width` by `height` with `fonts` (`{ name, data, weight, style }`), as PNG bytes.
 * @param {string} html
 * @param {{ width: number, height: number, fonts: unknown[] }} options
 * @returns {Promise<Uint8Array>}
 */
export async function drawShareCard(html, { width, height, fonts }) {
  return render(html, { width, height, fonts: /** @type {any} */ (fonts), module: wasm });
}
