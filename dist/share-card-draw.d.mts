/**
 * `html` drawn at `width` by `height` with `fonts` (`{ name, data, weight, style }`), as PNG bytes.
 * @param {string} html
 * @param {{ width: number, height: number, fonts: unknown[] }} options
 */
export function drawShareCard(html: string, { width, height, fonts }: {
    width: number;
    height: number;
    fonts: unknown[];
}): Promise<Uint8Array<ArrayBuffer> | Buffer<ArrayBuffer>>;
