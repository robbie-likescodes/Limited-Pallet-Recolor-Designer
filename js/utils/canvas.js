// js/utils/canvas.js
// Canvas utilities: image loading, EXIF orientation, and robust draw pipeline

// If you have utils/image.js providing HEIC helpers, we import them:
import {
  isHeicFile,
  decodeHeicWithWebCodecs, // may throw if unsupported
  heicHelp,                 // user guidance when HEIC can't be decoded
} from './image.js';

/** Clamp a number between min and max */
export function clamp(v, mi, ma) {
  return v < mi ? mi : v > ma ? ma : v;
}

/** Quick check for JPEG by MIME or filename */
function isLikelyJpeg(file) {
  const type = (file?.type || '').toLowerCase();
  const name = (file?.name || '').toLowerCase();
  return type === 'image/jpeg' || type === 'image/jpg' || name.endsWith('.jpg') || name.endsWith('.jpeg');
}

/**
 * Read EXIF orientation (1–8) from a JPEG File/Blob. Returns 1 if not found.
 * Minimal, fast parser: scans SOI -> APP1(EXIF) and looks for tag 0x0112.
 */
export async function readJpegOrientation(file) {
  if (!file) return 1;
  // Read the first 64KB — plenty for EXIF headers
  const head = file.slice(0, 64 * 1024);
  const buf = await head.arrayBuffer();
  const v = new DataView(buf);

  // JPEG SOI?
  if (v.byteLength < 4 || v.getUint16(0, false) !== 0xFFD8) return 1;

  let offset = 2;
  while (offset + 4 <= v.byteLength) {
    const marker = v.getUint16(offset, false); offset += 2;
    const size = v.getUint16(offset, false);   offset += 2;
    if ((marker & 0xFFF0) !== 0xFFE0) {
      // not an APPn; if SOS (0xFFDA) stop
      if (marker === 0xFFDA) break;
      // skip unknown segments
      offset += size - 2;
      continue;
    }
    // APP1 (EXIF) marker?
    if (marker === 0xFFE1 && size >= 8) {
      // EXIF header starts here
      const exifStart = offset;
      // "Exif\0\0"
      if (
        exifStart + 6 <= v.byteLength &&
        v.getUint8(exifStart) === 0x45 && v.getUint8(exifStart + 1) === 0x78 &&
        v.getUint8(exifStart + 2) === 0x69 && v.getUint8(exifStart + 3) === 0x66 &&
        v.getUint8(exifStart + 4) === 0x00 && v.getUint8(exifStart + 5) === 0x00
      ) {
        const tiff = exifStart + 6;
        // endianness
        const littleEndian =
          v.getUint8(tiff) === 0x49 && v.getUint8(tiff + 1) === 0x49;
        // 0x002A
        const magic = v.getUint16(tiff + 2, littleEndian);
        if (magic !== 0x002A) return 1;
        const ifdOffset = v.getUint32(tiff + 4, littleEndian);
        let ifd0 = tiff + ifdOffset;
        if (ifd0 + 2 > v.byteLength) return 1;
        const numEntries = v.getUint16(ifd0, littleEndian);
        ifd0 += 2;
        for (let i = 0; i < numEntries; i++) {
          const entry = ifd0 + 12 * i;
          if (entry + 12 > v.byteLength) break;
          const tag = v.getUint16(entry, littleEndian);
          if (tag === 0x0112) { // Orientation
            const type = v.getUint16(entry + 2, littleEndian);
            const count = v.getUint32(entry + 4, littleEndian);
            if (type === 3 && count === 1) {
              const val = v.getUint16(entry + 8, littleEndian);
              return (val >= 1 && val <= 8) ? val : 1;
            }
          }
        }
      }
    }
    // skip to next segment
    offset += size - 2;
  }
  return 1;
}

/**
 * Compute oriented target width/height, capped by maxW if provided.
 * Accounts for EXIF orientation rotations (5-8 swap width/height).
 */
export function getOrientedDims(orientation, w, h, maxW) {
  const swap = orientation >= 5 && orientation <= 8;
  let ow = swap ? h : w;
  let oh = swap ? w : h;
  if (maxW && ow > maxW) {
    const scale = maxW / ow;
    ow = Math.max(1, Math.round(ow * scale));
    oh = Math.max(1, Math.round(oh * scale));
  }
  return { w: ow, h: oh };
}

/**
 * Draw with orientation onto ctx, filling targetW x targetH.
 * Applies canvas transforms for EXIF orientations 2–8.
 */
export function drawImageWithOrientation(ctx, img, orientation, targetW, targetH) {
  ctx.save();
  ctx.imageSmoothingEnabled = false;

  // Reset transform & clear
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, targetW, targetH);

  switch (orientation) {
    case 2: // horizontal flip
      ctx.translate(targetW, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(img, 0, 0, targetW, targetH);
      break;
    case 3: // 180°
      ctx.translate(targetW, targetH);
      ctx.rotate(Math.PI);
      ctx.drawImage(img, 0, 0, targetW, targetH);
      break;
    case 4: // vertical flip
      ctx.translate(0, targetH);
      ctx.scale(1, -1);
      ctx.drawImage(img, 0, 0, targetW, targetH);
      break;
    case 5: // vertical flip + 90° CW
      ctx.rotate(0.5 * Math.PI);
      ctx.scale(1, -1);
      ctx.drawImage(img, 0, -targetH, targetW, targetH);
      break;
    case 6: // 90° CW
      ctx.rotate(0.5 * Math.PI);
      ctx.translate(0, -targetH);
      ctx.drawImage(img, 0, 0, targetW, targetH);
      break;
    case 7: // horizontal flip + 90° CW
      ctx.rotate(0.5 * Math.PI);
      ctx.translate(targetW, -targetH);
      ctx.scale(-1, 1);
      ctx.drawImage(img, 0, 0, targetW, targetH);
      break;
    case 8: // 90° CCW
      ctx.rotate(-0.5 * Math.PI);
      ctx.translate(-targetW, 0);
      ctx.drawImage(img, 0, 0, targetW, targetH);
      break;
    case 1:
    default:
      ctx.drawImage(img, 0, 0, targetW, targetH);
      break;
  }

  ctx.restore();
}

/**
 * Core pipeline: draw a File/Blob image to a canvas with:
 * - HEIC/HEIF attempt via WebCodecs (if available)
 * - createImageBitmap fast-path with EXIF-aware decode
 * - <img> fallback + EXIF orientation for JPEG
 *
 * @param {Object} opts
 * @param {File|Blob} opts.file
 * @param {HTMLCanvasElement} opts.canvas
 * @param {number} [opts.maxW=1400]
 * @returns {Promise<{width:number,height:number,exifOrientation:number}>}
 */
export async function drawImageToCanvas({ file, canvas, maxW = 1400 }) {
  if (!file) throw new Error('drawImageToCanvas: no file provided');
  if (!canvas) throw new Error('drawImageToCanvas: no canvas provided');

  const ctx = canvas.getContext('2d', { willReadFrequently: false });
  let orientation = 1;

  // 1) HEIC/HEIF fast-path using WebCodecs (where supported)
  if (isHeicFile(file)) {
    try {
      const bmp = await decodeHeicWithWebCodecs(file);
      // HEIC orientation in EXIF is uncommon, assume 1; adjust if you parse EXIF separately
      const { w, h } = getOrientedDims(1, bmp.width, bmp.height, maxW);
      canvas.width = w; canvas.height = h;
      drawImageWithOrientation(ctx, bmp, 1, w, h);
      // Close ImageBitmap in supporting browsers
      bmp.close?.();
      return { width: w, height: h, exifOrientation: 1 };
    } catch (err) {
      console.warn('[canvas] WebCodecs HEIC decode failed:', err);
      // Provide user guidance for HEIC if decoding is not possible in this browser
      try { heicHelp?.(); } catch {}
      // NOTE: We continue to attempt standard decode below. Some new Safari versions
      // can display HEIC via <img> src/objectURL even if WebCodecs path failed.
    }
  }

  // 2) Try createImageBitmap (often handles EXIF upright with imageOrientation option)
  if (typeof createImageBitmap === 'function') {
    try {
      // Some browsers ignore imageOrientation option; we still try it.
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      const { w, h } = getOrientedDims(1, bmp.width, bmp.height, maxW);
      canvas.width = w; canvas.height = h;
      drawImageWithOrientation(ctx, bmp, 1, w, h);
      bmp.close?.();
      return { width: w, height: h, exifOrientation: 1 };
    } catch (e) {
      // Fall through to <img> pipeline
      console.warn('[canvas] createImageBitmap failed, using <img> fallback:', e);
    }
  }

  // 3) <img> element fallback; read EXIF orientation for JPEGs
  try {
    if (isLikelyJpeg(file)) {
      try {
        orientation = await readJpegOrientation(file);
      } catch {
        orientation = 1;
      }
    } else {
      orientation = 1;
    }

    const url = URL.createObjectURL(file);
    try {
      const img = await loadImage(url);
      // Note: img.width/height reflect decoded dimensions (may be rotated already in some Safari cases)
      const { w, h } = getOrientedDims(orientation, img.width, img.height, maxW);
      canvas.width = w; canvas.height = h;
      drawImageWithOrientation(ctx, img, orientation, w, h);
      return { width: w, height: h, exifOrientation: orientation };
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch (finalErr) {
    console.error('[canvas] Final image decode failed:', finalErr);
    throw finalErr;
  }
}

/** Promise-wrapped HTMLImageElement loader */
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = src;
    // If the browser supports decode(), kick it off to speed first paint
    if ('decode' in img && typeof img.decode === 'function') {
      img.decode().then(() => resolve(img)).catch(() => {/* onload fallback */});
    }
  });
}
