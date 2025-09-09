// js/utils/canvas.js
// Canvas helpers aligned with the rest of the repo.
// - fitPreviewW(origW, origH, maxPreviewW)
// - getOrientedDims(width, height, orientation)
// - drawImageWithOrientation(ctx, img, orientation, dx, dy, dw, dh, sx?, sy?, sw?, sh?)

// -----------------------------------------------------------------------------
// Preview sizing
// -----------------------------------------------------------------------------

/**
 * Compute preview dimensions for a given original size and max preview width.
 * Returns integers suitable for canvas width/height and a scale factor.
 * @param {number} origW
 * @param {number} origH
 * @param {number} [maxPreviewW=1400]
 * @returns {{ dw:number, dh:number, scale:number }}
 */
export function fitPreviewW(origW, origH, maxPreviewW = 1400) {
  const W = Math.max(1, Number(origW)  || 1);
  const H = Math.max(1, Number(origH)  || 1);
  const M = Math.max(1, Number(maxPreviewW) || 1);
  const scale = Math.min(1, M / W);
  const dw = Math.max(1, Math.round(W * scale));
  const dh = Math.max(1, Math.round(H * scale));
  return { dw, dh, scale };
}

// -----------------------------------------------------------------------------
// EXIF orientation helpers
// -----------------------------------------------------------------------------

/**
 * Given the intrinsic width/height and EXIF orientation (1..8),
 * return the drawing width/height. For orientations 5–8, width/height swap.
 * @param {number} width
 * @param {number} height
 * @param {number} orientation EXIF orientation 1..8 (1 = normal)
 * @returns {{ width:number, height:number }}
 */
export function getOrientedDims(width, height, orientation = 1) {
  const o = Number(orientation) || 1;
  // In EXIF: 5,6,7,8 imply a 90°/270° rotation (w/h swap)
  if (o >= 5 && o <= 8) {
    return { width: height, height: width };
  }
  return { width, height };
}

/**
 * Draw an image on a 2D context taking EXIF orientation into account.
 * Usage:
 *   const { width, height } = getOrientedDims(img.naturalWidth, img.naturalHeight, orientation);
 *   canvas.width = width; canvas.height = height;
 *   drawImageWithOrientation(ctx, img, orientation, 0, 0, width, height);
 *
 * You can also pass a source rect (sx,sy,sw,sh) like the 9-arg drawImage().
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {HTMLImageElement|CanvasImageSource} img
 * @param {number} orientation 1..8
 * @param {number} dx
 * @param {number} dy
 * @param {number} dw
 * @param {number} dh
 * @param {number} [sx]
 * @param {number} [sy]
 * @param {number} [sw]
 * @param {number} [sh]
 */
export function drawImageWithOrientation(
  ctx,
  img,
  orientation = 1,
  dx = 0, dy = 0, dw,
  dh,
  sx, sy, sw, sh
) {
  const o = Number(orientation) || 1;
  const hasSrcRect = [sx, sy, sw, sh].every(v => typeof v === 'number');

  ctx.save();
  applyOrientationTransform(ctx, o, dw, dh);

  if (hasSrcRect) {
    // drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh)
    ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
  } else {
    // drawImage(image, dx, dy, dw, dh)
    ctx.drawImage(img, dx, dy, dw, dh);
  }

  ctx.restore();
}

/**
 * Internal: apply the 2D context transform for an EXIF orientation.
 * Model based on the standard 1..8 orientation mapping.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} o
 * @param {number} w
 * @param {number} h
 */
function applyOrientationTransform(ctx, o, w, h) {
  switch (o) {
    // 1: default (no transform)
    default:
    case 1:
      // identity
      break;
    // 2: horizontal flip
    case 2:
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
      break;
    // 3: 180°
    case 3:
      ctx.translate(w, h);
      ctx.rotate(Math.PI);
      break;
    // 4: vertical flip
    case 4:
      ctx.translate(0, h);
      ctx.scale(1, -1);
      break;
    // 5: vertical flip + 90° CW (or 270° CCW); note w/h swapped
    case 5:
      ctx.rotate(0.5 * Math.PI);
      ctx.scale(1, -1);
      break;
    // 6: 90° CW
    case 6:
      ctx.rotate(0.5 * Math.PI);
      ctx.translate(0, -h);
      break;
    // 7: horizontal flip + 90° CW
    case 7:
      ctx.rotate(0.5 * Math.PI);
      ctx.translate(w, -h);
      ctx.scale(-1, 1);
      break;
    // 8: 90° CCW
    case 8:
      ctx.rotate(-0.5 * Math.PI);
      ctx.translate(-w, 0);
      break;
  }
}
