// js/utils/image.js
// Lightweight image utilities used by the loader (files.js)

/**
 * Heuristic: is the Blob likely a HEIC/HEIF file?
 * Checks MIME, filename extension, and MP4 'ftyp' major_brand in the header.
 * @param {File|Blob} file
 * @returns {Promise<boolean>}
 */
export async function isHeic(file) {
  if (!file) return false;

  // MIME
  const type = String(file.type || '').toLowerCase();
  if (type.includes('heic') || type.includes('heif')) return true;

  // Name/extension
  const name = String(file.name || '').toLowerCase();
  if (name.endsWith('.heic') || name.endsWith('.heif')) return true;

  // Sniff 'ftyp' brand (ISO BMFF/MP4 container brands used by HEIF)
  try {
    const buf = await file.slice(0, 32).arrayBuffer();
    const u8 = new Uint8Array(buf);
    // bytes 4..7 should be 'ftyp'
    if (u8.length >= 12 &&
        u8[4] === 0x66 && u8[5] === 0x74 && u8[6] === 0x79 && u8[7] === 0x70) {
      const brand = String.fromCharCode(u8[8], u8[9], u8[10], u8[11]).toLowerCase();
      if (brand === 'heic' || brand === 'heix' || brand === 'hevc' || brand === 'hevs' ||
          brand === 'mif1' || brand === 'msf1' || brand === 'heif' || brand === 'heis') {
        return true;
      }
    }
  } catch { /* ignore sniff errors */ }

  return false;
}

/**
 * Heuristic: is the Blob likely a JPEG?
 * Checks MIME and the SOI marker 0xFF 0xD8.
 * @param {File|Blob} file
 * @returns {Promise<boolean>}
 */
export async function isLikelyJpeg(file) {
  if (!file) return false;

  const type = String(file.type || '').toLowerCase();
  if (type === 'image/jpeg' || type === 'image/jpg') return true;

  try {
    const buf = await file.slice(0, 4).arrayBuffer();
    const u8 = new Uint8Array(buf);
    // SOI 0xFFD8
    if (u8.length >= 2 && u8[0] === 0xFF && u8[1] === 0xD8) return true;
  } catch { /* ignore sniff errors */ }

  return false;
}

/**
 * Read EXIF Orientation (tag 274) from a JPEG file.
 * Returns 1..8 (1 = normal). If not found/can't parse, returns 1.
 * @param {File|Blob} file
 * @returns {Promise<number>}
 */
export async function readJpegOrientation(file) {
  // Read enough for APP1/EXIF (64KB is plenty in practice)
  let buf;
  try {
    buf = await file.slice(0, 65536).arrayBuffer();
  } catch {
    return 1;
  }
  const view = new DataView(buf);
  const len  = view.byteLength;

  // Must start with SOI 0xFFD8
  if (len < 2 || view.getUint8(0) !== 0xFF || view.getUint8(1) !== 0xD8) return 1;

  let offset = 2;
  while (offset + 4 <= len) {
    if (view.getUint8(offset) !== 0xFF) break; // corrupt
    const marker = view.getUint8(offset + 1);
    offset += 2;

    // SOS (0xDA) or EOI (0xD9) end the metadata area
    if (marker === 0xDA || marker === 0xD9) break;

    if (offset + 2 > len) break;
    const size = view.getUint16(offset, false); // big-endian
    if (size < 2 || offset + size > len) break;

    if (marker === 0xE1 /* APP1 */) {
      const start = offset + 2;
      // "Exif\0\0"
      if (start + 6 <= len &&
          view.getUint8(start)     === 0x45 && // E
          view.getUint8(start + 1) === 0x78 && // x
          view.getUint8(start + 2) === 0x69 && // i
          view.getUint8(start + 3) === 0x66 && // f
          view.getUint8(start + 4) === 0x00 &&
          view.getUint8(start + 5) === 0x00) {

        const tiff = start + 6;
        const o = parseExifOrientation(view, tiff, len);
        if (o >= 1 && o <= 8) return o;
      }
    }

    offset += size; // next segment
  }

  return 1;
}

// ----------------------- internal helpers -----------------------

function parseExifOrientation(view, tiffOffset, totalLen) {
  if (tiffOffset + 8 > totalLen) return 1;

  // Endianness
  const endian = String.fromCharCode(view.getUint8(tiffOffset), view.getUint8(tiffOffset + 1));
  const little = endian === 'II';
  // TIFF magic 0x002A
  if (getU16(view, tiffOffset + 2, little) !== 0x2A) return 1;

  const ifd0Offset = getU32(view, tiffOffset + 4, little);
  const ifd0 = tiffOffset + ifd0Offset;
  if (ifd0 + 2 > totalLen) return 1;

  const count = getU16(view, ifd0, little);
  let entry = ifd0 + 2;
  for (let i = 0; i < count; i++, entry += 12) {
    if (entry + 12 > totalLen) break;
    const tag = getU16(view, entry, little);
    if (tag === 0x0112) { // Orientation
      // value is a SHORT at entry+8
      const val = getU16(view, entry + 8, little);
      return (val >= 1 && val <= 8) ? val : 1;
    }
  }
  return 1;
}

function getU16(view, off, little) { return view.getUint16(off, little); }
function getU32(view, off, little) { return view.getUint32(off, little); }
