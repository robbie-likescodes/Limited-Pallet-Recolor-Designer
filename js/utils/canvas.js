// js/utils/canvas.js
// Canvas utilities: image loading, EXIF orientation, and robust draw pipeline (no optional chaining for older Safari)

import {
  isHeicFile,
  decodeHeicWithWebCodecs, // may throw if unsupported
  heicHelp                  // user guidance when HEIC can't be decoded
} from './image.js';

/** Clamp a number between min and max */
export function clamp(v, mi, ma) {
  return v < mi ? mi : (v > ma ? ma : v);
}

/** Quick check for JPEG by MIME or filename */
function isLikelyJpeg(file) {
  var type = (file && file.type ? String(file.type) : '').toLowerCase();
  var name = (file && file.name ? String(file.name) : '').toLowerCase();
  return type === 'image/jpeg' || type === 'image/jpg' || /(?:\.jpe?g)$/.test(name);
}

/**
 * Read EXIF orientation (1–8) from a JPEG File/Blob. Returns 1 if not found.
 * Minimal parser: scans SOI -> APP1(EXIF) and finds tag 0x0112.
 */
export async function readJpegOrientation(file) {
  try {
    if (!file) return 1;
    var head = file.slice(0, 64 * 1024);
    var buf = await head.arrayBuffer();
    var v = new DataView(buf);

    // JPEG SOI
    if (v.byteLength < 4 || v.getUint16(0, false) !== 0xFFD8) return 1;

    var offset = 2;
    while (offset + 4 <= v.byteLength) {
      var marker = v.getUint16(offset, false); offset += 2;
      var size   = v.getUint16(offset, false); offset += 2;

      // Stop at SOS
      if (marker === 0xFFDA) break;

      // APP1 (EXIF)?
      if (marker === 0xFFE1 && size >= 8) {
        var exifStart = offset;
        // "Exif\0\0"
        if (
          exifStart + 6 <= v.byteLength &&
          v.getUint8(exifStart)     === 0x45 && // E
          v.getUint8(exifStart + 1) === 0x78 && // x
          v.getUint8(exifStart + 2) === 0x69 && // i
          v.getUint8(exifStart + 3) === 0x66 && // f
          v.getUint8(exifStart + 4) === 0x00 &&
          v.getUint8(exifStart + 5) === 0x00
        ) {
          var tiff = exifStart + 6;
          var little =
            v.getUint8(tiff) === 0x49 && v.getUint8(tiff + 1) === 0x49;
          // 0x002A
          if (v.getUint16(tiff + 2, little) !== 0x002A) return 1;
          var ifdOffset = v.getUint32(tiff + 4, little);
          var ifd0 = tiff + ifdOffset;
          if (ifd0 + 2 > v.byteLength) return 1;
          var num = v.getUint16(ifd0, little);
          ifd0 += 2;
          for (var i = 0; i < num; i++) {
            var entry = ifd0 + 12 * i;
            if (entry + 12 > v.byteLength) break;
            var tag = v.getUint16(entry, little);
            if (tag === 0x0112) {
              var type = v.getUint16(entry + 2, little);
              var count = v.getUint32(entry + 4, little);
              if (type === 3 && count === 1) {
                var val = v.getUint16(entry + 8, little);
                return (val >= 1 && val <= 8) ? val : 1;
              }
            }
          }
        }
      }

      // skip segment payload
      offset += size - 2;
    }
    return 1;
  } catch (e) {
    // If anything goes wrong, default to 1
    return 1;
  }
}

/** Compute oriented target dimensions, capping by maxW if provided */
export function getOrientedDims(orientation, w, h, maxW) {
  var swap = orientation >= 5 && orientation <= 8;
  var ow = swap ? h : w;
  var oh = swap ? w : h;
  if (maxW && ow > maxW) {
    var scale = maxW / ow;
    ow = Math.max(1, Math.round(ow * scale));
    oh = Math.max(1, Math.round(oh * scale));
  }
  return { w: ow, h: oh };
}

/** Draw image onto ctx applying EXIF orientation transforms */
export function drawImageWithOrientation(ctx, img, orientation, targetW, targetH) {
  ctx.save();
  ctx.imageSmoothingEnabled = false;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, targetW, targetH);

  switch (orientation) {
    case 2: // flip H
      ctx.translate(targetW, 0); ctx.scale(-1, 1);
      ctx.drawImage(img, 0, 0, targetW, targetH); break;
    case 3: // 180
      ctx.translate(targetW, targetH); ctx.rotate(Math.PI);
      ctx.drawImage(img, 0, 0, targetW, targetH); break;
    case 4: // flip V
      ctx.translate(0, targetH); ctx.scale(1, -1);
      ctx.drawImage(img, 0, 0, targetW, targetH); break;
    case 5: // flip V + 90 CW
      ctx.rotate(0.5 * Math.PI); ctx.scale(1, -1);
      ctx.drawImage(img, 0, -targetH, targetW, targetH); break;
    case 6: // 90 CW
      ctx.rotate(0.5 * Math.PI); ctx.translate(0, -targetH);
      ctx.drawImage(img, 0, 0, targetW, targetH); break;
    case 7: // flip H + 90 CW
      ctx.rotate(0.5 * Math.PI); ctx.translate(targetW, -targetH); ctx.scale(-1, 1);
      ctx.drawImage(img, 0, 0, targetW, targetH); break;
    case 8: // 90 CCW
      ctx.rotate(-0.5 * Math.PI); ctx.translate(-targetW, 0);
      ctx.drawImage(img, 0, 0, targetW, targetH); break;
    case 1:
    default:
      ctx.drawImage(img, 0, 0, targetW, targetH); break;
  }

  ctx.restore();
}

/**
 * Core pipeline: draw a File/Blob to canvas with:
 * - HEIC attempt (WebCodecs) -> ImageBitmap
 * - createImageBitmap fast-path
 * - <img> fallback + EXIF orientation
 *
 * @param file-service: opts
 * @returns {Promise<{width:number,height:number,exifOrientation:number}>}
 */
export async function drawImageToCanvas(opts) {
  if (!opts) throw new Error('drawImageToCanvas: missing opts');
  var file   = opts.file;
  var canvas = opts.canvas;
  var maxW   = (typeof opts.maxW === 'number' ? opts.maxW : 1400);

  if (!file)   throw new Error('drawImageToCanvas: no file provided');
  if (!canvas) throw new Error('drawImageToCanvas: no canvas provided');

  var ctx = canvas.getContext('2d');
  var orientation = 1;

  // 1) HEIC/HEIF via WebCodecs (where supported)
  if (isHeicFile(file)) {
    try {
      var bmp = await decodeHeicWithWebCodecs(file);
      var dims1 = getOrientedDims(1, bmp.width, bmp.height, maxW);
      canvas.width = dims1.w; canvas.height = dims1.h;
      drawImageWithOrientation(ctx, bmp, 1, dims1.w, dims1.h);
      // close if supported
      try { if (bmp && typeof bmp.close === 'function') bmp.close(); } catch (_e) {}
      return { width: dims1.w, height: dims1.h, exifOrientation: 1 };
    } catch (err) {
      try { if (typeof heicHelp === 'function') heicHelp(); } catch (_e) {}
      // Continue to standard decode path; some Safari versions can display HEIC via <img>
    }
  }

  // 2) createImageBitmap path (fast; some browsers honor EXIF automatically)
  if (typeof createImageBitmap === 'function') {
    try {
      var bmp2 = await createImageBitmap(file, { imageOrientation: 'from-image' });
      var dims2 = getOrientedDims(1, bmp2.width, bmp2.height, maxW);
      canvas.width = dims2.w; canvas.height = dims2.h;
      drawImageWithOrientation(ctx, bmp2, 1, dims2.w, dims2.h);
      try { if (bmp2 && typeof bmp2.close === 'function') bmp2.close(); } catch (_e) {}
      return { width: dims2.w, height: dims2.h, exifOrientation: 1 };
    } catch (_e) {
      // fall through to <img> fallback
    }
  }

  // 3) <img> fallback with EXIF orientation for JPEGs
  try {
    if (isLikelyJpeg(file)) {
      try { orientation = await readJpegOrientation(file); } catch (_e) { orientation = 1; }
    }
    var url = URL.createObjectURL(file);
    try {
      var img = await loadImage(url);
      var dims3 = getOrientedDims(orientation, img.width, img.height, maxW);
      canvas.width = dims3.w; canvas.height = dims3.h;
      drawImageWithOrientation(ctx, img, orientation, dims3.w, dims3.h);
      return { width: dims3.w, height: dims3.h, exifOrientation: orientation };
    } finally {
      try { URL.revokeObjectURL(url); } catch (_e) {}
    }
  } catch (finalErr) {
    // bubble up to caller (which toasts an error)
    throw finalErr;
  }
}

/** Promise-wrapped HTMLImageElement loader (no optional chaining) */
function loadImage(src) {
  return new Promise(function(resolve, reject) {
    var img = new Image();
    // async decode if available; we still rely on onload as the real signal
    try {
      img.decoding = 'async';
    } catch (_e) {}
    img.onload = function() { resolve(img); };
    img.onerror = function(e) { reject(e); };
    img.src = src;
    // try decode() if supported, but don't rely on it
    try {
      if (typeof img.decode === 'function') {
        img.decode().then(function(){ resolve(img); })['catch'](function(){ /* onload fallback */ });
      }
    } catch (_e) {}
  });
}
