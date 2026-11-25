/**
 * A raster file's header read for the image audit (bin/images.mjs): its type, its pixel size and the private metadata
 * it carries.
 */

/** @typedef {{ type: string, width: number, height: number, private: string[] }} ImageFile */

/**
 * A raster file's type and pixel size from its first bytes, and the private metadata it carries (`private`: GPS, serial
 * numbers, owner, MakerNote, from EXIF in JPEG APP1, PNG eXIf, WebP EXIF or an AVIF Exif item, or from XMP); null for
 * anything else or too few bytes.
 * @param {Uint8Array} bytes
 */
export function readImage(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (/** @type {number} */ at, /** @type {number} */ length) =>
    String.fromCharCode(...bytes.subarray(at, at + length));
  /** @type {Set<string>} */
  const found = new Set();
  const exif = (/** @type {Uint8Array} */ tiff) => {
    for (const name of privateExif(tiff)) found.add(name);
  };
  const file = (
    /** @type {string} */ type,
    /** @type {number} */ width,
    /** @type {number} */ height,
  ) => {
    const text = new TextDecoder("latin1").decode(bytes);
    if (text.includes("<x:xmpmeta")) {
      if (/GPS(Latitude|Longitude)/.test(text)) found.add("GPS (XMP)");
      if (/SerialNumber/.test(text)) found.add("a serial number (XMP)");
      if (/OwnerName/.test(text)) found.add("an owner name (XMP)");
    }
    return { type, width, height, private: [...found] };
  };
  try {
    if (bytes[0] === 0x89 && ascii(1, 3) === "PNG") {
      for (let at = 8; at + 8 <= bytes.length;) {
        const length = view.getUint32(at);
        if (ascii(at + 4, 4) === "eXIf") exif(bytes.subarray(at + 8, at + 8 + length));
        if (ascii(at + 4, 4) === "IEND") break;
        at += 12 + length;
      }
      return file("image/png", view.getUint32(16), view.getUint32(20));
    }
    if (ascii(0, 4) === "GIF8")
      return file("image/gif", view.getUint16(6, true), view.getUint16(8, true));
    if (bytes[0] === 0xff && bytes[1] === 0xd8) {
      for (let at = 2; at + 9 < bytes.length;) {
        if (bytes[at] !== 0xff) return null;
        const marker = bytes[at + 1];
        if (marker === 0xff || (marker >= 0xd0 && marker <= 0xd9) || marker === 0x01) {
          at += marker === 0xff ? 1 : 2;
          continue;
        }
        const length = view.getUint16(at + 2);
        if (marker === 0xe1 && ascii(at + 4, 6) === "Exif\0\0")
          exif(bytes.subarray(at + 10, at + 2 + length));
        // Every start-of-frame marker but DHT (C4), JPG (C8) and DAC (CC) carries the frame's size.
        if (
          marker >= 0xc0 &&
          marker <= 0xcf &&
          marker !== 0xc4 &&
          marker !== 0xc8 &&
          marker !== 0xcc
        ) {
          return file("image/jpeg", view.getUint16(at + 7), view.getUint16(at + 5));
        }
        at += 2 + length;
      }
      return null;
    }
    if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
      /** @type {{ width: number, height: number } | null} */
      let size = null;
      for (let at = 12; at + 8 <= bytes.length;) {
        const fourcc = ascii(at, 4);
        const length = view.getUint32(at + 4, true);
        const data = at + 8;
        const uint24 = (/** @type {number} */ o) =>
          bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16);
        if (fourcc === "VP8X") size = { width: 1 + uint24(data + 4), height: 1 + uint24(data + 7) };
        else if (fourcc === "VP8 " && !size)
          size = {
            width: view.getUint16(data + 6, true) & 0x3fff,
            height: view.getUint16(data + 8, true) & 0x3fff,
          };
        else if (fourcc === "VP8L" && !size) {
          const bits = view.getUint32(data + 1, true);
          size = { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
        } else if (fourcc === "EXIF") {
          const block = bytes.subarray(data, data + length);
          exif(ascii(data, 6) === "Exif\0\0" ? block.subarray(6) : block);
        }
        at = data + length + (length % 2);
      }
      return size && file("image/webp", size.width, size.height);
    }
    if (ascii(4, 4) === "ftyp" && /avi[fs]/.test(ascii(8, Math.min(view.getUint32(0), 64) - 8))) {
      // The largest "ispe" (image spatial extents) box is the primary image's; smaller ones are thumbnails or tiles.
      let best = null;
      for (
        let at = bytes.indexOf(0x69);
        at !== -1 && at + 16 <= bytes.length;
        at = bytes.indexOf(0x69, at + 1)
      ) {
        if (ascii(at, 4) !== "ispe") continue;
        const width = view.getUint32(at + 8);
        const height = view.getUint32(at + 12);
        if (!best || width * height > best.width * best.height) best = { width, height };
      }
      // An Exif item is "Exif\0\0" and a TIFF block, wherever the file stores it.
      let blocks = 0;
      for (let at = bytes.indexOf(0x45); at !== -1 && blocks < 8; at = bytes.indexOf(0x45, at + 1))
        if (ascii(at, 6) === "Exif\0\0") {
          exif(bytes.subarray(at + 6));
          blocks += 1;
        }
      return best && file("image/avif", best.width, best.height);
    }
  } catch {
    // A truncated or malformed header reads as no image, never as a crash.
  }
  return null;
}

/** EXIF tags in the Exif sub-IFD that say who took a picture or with what. */
const PRIVATE_TAGS = /** @type {Record<number, string>} */ ({
  0x927c: "a MakerNote",
  0xa430: "an owner name",
  0xa431: "a body serial number",
  0xa435: "a lens serial number",
});

/**
 * What private metadata a TIFF block (EXIF) holds: a GPS IFD with entries, a camera serial number, and the Exif sub-IFD's
 * private tags.
 * @param {Uint8Array} tiff
 */
function privateExif(tiff) {
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  const little = tiff[0] === 0x49 && tiff[1] === 0x49;
  if (!little && !(tiff[0] === 0x4d && tiff[1] === 0x4d)) return [];
  // An IFD lists at most what fits in the block, and all the IFDs of one block share a budget of entries (nested 64,000-entry IFDs were 4 billion steps).
  let budget = 100_000;
  const entries = (/** @type {number} */ ifd) => {
    const length = Math.min(
      view.getUint16(ifd, little),
      Math.max(0, Math.floor((tiff.length - ifd - 2) / 12)),
      budget,
    );
    budget -= length;
    return Array.from({ length }, (_, i) => ifd + 2 + i * 12);
  };
  const found = [];
  try {
    if (view.getUint16(2, little) !== 42) return [];
    for (const entry of entries(view.getUint32(4, little))) {
      const tag = view.getUint16(entry, little);
      if (tag === 0x8825 && view.getUint16(view.getUint32(entry + 8, little), little) > 0)
        found.push("GPS coordinates");
      if (tag === 0xc62f) found.push("a camera serial number");
      if (tag === 0x8769)
        for (const sub of entries(view.getUint32(entry + 8, little)))
          if (PRIVATE_TAGS[view.getUint16(sub, little)])
            found.push(PRIVATE_TAGS[view.getUint16(sub, little)]);
    }
  } catch {
    // A block that runs past its end keeps what was read before it.
  }
  return found;
}
