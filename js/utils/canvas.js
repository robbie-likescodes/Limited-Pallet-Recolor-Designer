// utils/canvas.js
// Basic canvas helpers for drawing with optional orientation

export function clamp(x, lo, hi) {
  return Math.min(Math.max(x, lo), hi);
}

export function getOrientedDims(w, h, orientation, maxW) {
  // Simplified: ignore EXIF orientation, just scale by width
  const scale = maxW / w;
  return {
    w: Math.round(w * scale),
    h: Math.round(h * scale)
  };
}

export function drawImageWithOrientation(ctx, bmp, orientation, w, h) {
  ctx.clearRect(0, 0, w, h);

  // Orientation support can be added later; for now draw as-is
  ctx.drawImage(bmp, 0, 0, w, h);
}
