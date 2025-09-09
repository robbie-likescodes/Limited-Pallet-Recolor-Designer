// js/utils/canvas.js
// Canvas helpers for orientation-aware drawing and preview sizing.

/**
 * Compute preview dimensions for a given original size and max preview width.
 * Returns integers suitable for canvas width/height and a scale factor.
 * @param {number} origW
 * @param {number} origH
 * @param {number} [maxPreviewW=1400]
 * @returns {{ dw:number, dh:number, scale:number }}
 */
export function fitPreviewW(origW, origH, maxPreviewW = 1400) {
  const W = Math.max(1, Number(origW) || 1);
  const H = Math.max(1, Number(origH) || 1);
  const M = Math.max(1, Number(maxPreviewW) || 1);
  const scale = Math.min(1, M / W);
  const dw = Math.max(1, Math.round(W * scale));
  const dh = Math.max(1, Math.round(H * scale));
  return { dw, dh, scale };
}

/**
 * Given the intrinsic width/height and EXIF orientation (1..8),
 * return the drawing width/height. For orientations 5–8, width/height swap.
 * @param {number} width
 * @param {number} height
 * @param {number} orientation
 * @returns {{ width:number, height:number }}
 */
export function getOrientedDims(width, height, orientation = 1) {
  const o = Number(orientation) || 1;
  if (o >= 5 && o <= 8) return { width: height, height: width };
  return { width, height };
}

/**
 * Draw an image on a 2D context taking EXIF orientation into account.
 * You can pass either 5 args (ctx,img,orientation,dx,dy,dw,dh)
 * or 9 args (ctx,img,orientation,dx,dy,dw,dh,sx,sy,sw,sh).
 * @param {CanvasRenderingContext2D} ctx
 * @param {CanvasImageSource} img
 * @param {number} orientation
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
    ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
  } else {
    ctx.drawImage(img, dx, dy, dw, dh);
  }
  ctx.restore();
}

/** Internal helper: apply transform for a given EXIF orientation. */
function applyOrientationTransform(ctx, o, w, h) {
  switch (o) {
    case 2: ctx.translate(w, 0); ctx.scale(-1, 1); break;                // horizontal flip
    case 3: ctx.translate(w, h); ctx.rotate(Math.PI); break;              // 180°
    case 4: ctx.translate(0, h); ctx.scale(1, -1); break;                 // vertical flip
    case 5: ctx.rotate(0.5 * Math.PI); ctx.scale(1, -1); break;           // vertical flip + 90° CW
    case 6: ctx.rotate(0.5 * Math.PI); ctx.translate(0, -h); break;       // 90° CW
    case 7: ctx.rotate(0.5 * Math.PI); ctx.translate(w, -h); ctx.scale(-1, 1); break; // h-flip + 90° CW
    case 8: ctx.rotate(-0.5 * Math.PI); ctx.translate(-w, 0); break;      // 90° CCW
    case 1:
    default: break; // normal
  }
}
