/** The share-card renderer (share-card-draw.mjs): the card's HTML drawn to PNG bytes by Satori and resvg, both WASM. */
export function drawShareCard(
  html: string,
  options: { width: number; height: number; fonts: unknown[] },
): Promise<Uint8Array>;
