// utils/image.js
// Robust image loading helpers with HEIC/HEIF support.
// Exposes the functions expected by app.js.

const log = (...a) => console.log('[image]', ...a);

export function isHeicFile(file) {
  const name = (file?.name || '').toLowerCase();
  const type = (file?.type || '').toLowerCase();
  return (
    name.endsWith('.heic') || name.endsWith('.heif') ||
    /\bimage\/heic\b|\bimage\/heif\b/.test(type)
  );
}

export function isLikelyJpeg(file) {
  const type = (file?.type || '').toLowerCase();
  const name = (file?.name || '').toLowerCase();
  return type === 'image/jpeg' || name.endsWith('.jpg') || name.endsWith('.jpeg');
}

export function heicHelp() {
  alert(
`This photo is HEIC/HEIF and your browser couldn't decode it into a canvas.

Easiest options:
• On iPhone: Settings → Camera → Formats → Most Compatible (captures JPEG).
• Re-share as JPEG/PNG (Photos → Share → Options → Most Compatible).
• Or use a browser/device with HEIF → canvas support.`
  );
}

export function objectUrlFor(file) {
  return URL.createObjectURL(file);
}

export function revokeUrl(url) {
  if (url) URL.revokeObjectURL(url);
}

// <img> loader (works for PNG/JPEG everywhere; HEIC on Safari)
// Uses decode() when available to avoid zero-dimension races.
export function loadIMG(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = url;

    if ('decode' in img && typeof img.decode === 'function') {
      img.decode().then(() => resolve(img)).catch(() => {/* onload will handle */});
    }
  });
}

// Minimal EXIF orientation reader for JPEG (1–8). Returns 1 if not found.
export async function readJpegOrientation(file) {
  return new Promise((res) => {
    try {
      const r = new FileReader();
      r.onload = function () {
        try {
          const v = new DataView(r.result);
          if (v.getUint16(0, false) !== 0xFFD8) return res(1); // not a JPEG
          let off = 2;
          while (off < v.byteLength) {
            const marker = v.getUint16(off, false);
            off += 2;
            if (marker === 0xFFE1) { // APP1
              const exifLen = v.getUint16(off, false); off += 2;
              if (v.getUint32(off, false) !== 0x45786966) break; // "Exif"
              off += 6;
              const tiff = off;
              const little = v.getUint16(tiff, false) === 0x4949;
              const get16 = o => v.getUint16(o, little);
              const get32 = o => v.getUint32(o, little);
              const firstIFD = get32(tiff + 4);
              if (firstIFD < 8) return res(1);
              const dir = tiff + firstIFD;
              const entries = get16(dir);
              for (let i = 0; i < entries; i++) {
                const e = dir + 2 + i * 12;
                const tag = get16(e);
                if (tag === 0x0112) { // Orientation
                  return res(get16(e + 8) || 1);
                }
              }
              break;
            } else if ((marker & 0xFF00) !== 0xFF00) {
              break;
            } else {
              off += v.getUint16(off, false);
            }
          }
        } catch {
          /* ignore */
        }
        res(1);
      };
      r.onerror = () => res(1);
      r.readAsArrayBuffer(file.slice(0, 256 * 1024));
    } catch {
      res(1);
    }
  });
}

// HEIC/HEIF via WebCodecs → ImageBitmap.
// Throws if unsupported or decode fails (app.js catches and falls back).
export async function decodeHeicWithWebCodecs(file) {
  if (!('ImageDecoder' in window)) {
    throw new Error('WebCodecs not supported in this browser');
  }
  const type = file.type || 'image/heic';
  const data = await file.arrayBuffer();
  const blob = new Blob([data], { type });

  // Some HEIFs expose "image/heif"; pass the provided type through.
  const decoder = new ImageDecoder({ data: blob, type });
  await decoder.tracks.ready;

  // Decode first frame
  const { image } = await decoder.decode();
  const bmp = await createImageBitmap(image); // convert to ImageBitmap
  image.close?.();
  decoder.close?.();

  log('WebCodecs decoded HEIC', bmp.width, bmp.height);
  return bmp;
}
