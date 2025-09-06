// utils/image.js
// Helpers for loading images (JPEG/PNG baseline; HEIC stubbed)

export function isHeicFile(file) {
  const name = (file?.name || '').toLowerCase();
  const type = (file?.type || '').toLowerCase();
  return (
    name.endsWith('.heic') ||
    name.endsWith('.heif') ||
    /\bimage\/heic\b|\bimage\/heif\b/.test(type)
  );
}

export function isLikelyJpeg(file) {
  const type = (file?.type || '').toLowerCase();
  return (
    type === 'image/jpeg' ||
    file?.name?.toLowerCase().endsWith('.jpg') ||
    file?.name?.toLowerCase().endsWith('.jpeg')
  );
}

export function heicHelp() {
  alert(
    'This browser cannot open HEIC/HEIF images directly. ' +
    'Please convert the photo to JPEG or PNG.'
  );
}

export function objectUrlFor(file) {
  return URL.createObjectURL(file);
}

export function revokeUrl(url) {
  if (url) URL.revokeObjectURL(url);
}

export function loadIMG(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

export async function readJpegOrientation(file) {
  // Minimal stub: always return 1 (normal orientation).
  // Replace with real EXIF parser if you want rotation support.
  return 1;
}

export async function decodeHeicWithWebCodecs(file) {
  // Stub: throws until you wire up WebCodecs/wasm decoder.
  throw new Error('WebCodecs HEIC decode not implemented in this build');
}
