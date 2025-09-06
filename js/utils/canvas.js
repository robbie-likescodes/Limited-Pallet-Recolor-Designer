// js/utils/canvas.js
// Utility helpers for canvas operations (orientation ignored)

// Clamp a number between min and max
export function clamp(v, mi, ma) {
  return v < mi ? mi : v > ma ? ma : v;
}

/**
 * Get oriented dimensions, ignoring EXIF orientation.
 * Returns original width/height, capped by maxW if provided.
 *
 * @param {number} _orientation - ignored (always treated as 1)
 * @param {number} w - original width
 * @param {number} h - original height
 * @param {number} [maxW] - optional max width
 * @returns {{w:number,h:number}}
 */
export function getOrientedDims(_orientation, w, h, maxW) {
  let W = w, H = h;
  if (maxW && W > maxW) {
    const s = maxW / W;
    W = Math.round(W * s);
    H = Math.round(H * s);
  }
  return { w: W, h: H };
}

/**
 * Draw image as-is onto canvas, ignoring EXIF orientation.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {CanvasImageSource} img
 * @param {number} _orientation - ignored
 * @param {number} targetW
 * @param {number} targetH
 */
export function drawImageWithOrientation(ctx, img, _orientation, targetW, targetH) {
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, targetW, targetH);
  ctx.drawImage(img, 0, 0, targetW, targetH);
}
