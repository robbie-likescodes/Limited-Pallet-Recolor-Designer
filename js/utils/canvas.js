// utils/canvas.js
// Safe sizing & orientation-aware drawing helpers used by app.js.

const log = (...a) => console.log('[canvas]', ...a);

export function clamp(x, lo, hi) {
  return Math.min(Math.max(x, lo), hi);
}

// getOrientedDims(sourceW, sourceH, exifOrientation, maxPreviewW)
export function getOrientedDims(w, h, orientation = 1, maxW = 1400) {
  // If orientation swaps axes (5–8), the displayed width/height are swapped
  const swaps = (orientation >= 5 && orientation <= 8);
  const dispW = swaps ? h : w;
  const dispH = swaps ? w : h;

  if (!dispW || !dispH) {
    log('bad source dims', w, h, 'ori=', orientation);
    return { w: 0, h: 0 };
  }

  const scale = dispW > maxW ? (maxW / dispW) : 1;
  return {
    w: Math.max(1, Math.round(dispW * scale)),
    h: Math.max(1, Math.round(dispH * scale))
  };
}

// Draw img/bitmap into (w x h) canvas area applying EXIF orientation.
// Assumes the canvas element has already been sized to (w x h).
export function drawImageWithOrientation(ctx, src, orientation = 1, w, h) {
  if (!ctx || !src || !w || !h) {
    log('skip draw: ctx/src/w/h', !!ctx, !!src, w, h);
    return;
  }
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, w, h);

  // Helpful backdrop to see bounds during debugging
  ctx.fillStyle = '#0b172e';
  ctx.fillRect(0, 0, w, h);

  // Apply transforms for EXIF orientation.
  // We’re already drawing into a canvas sized to the *displayed* (oriented) dims.
  switch (orientation) {
    case 2: // mirror X
      ctx.translate(w, 0); ctx.scale(-1, 1); break;
    case 3: // 180°
      ctx.translate(w, h); ctx.rotate(Math.PI); break;
    case 4: // mirror Y
      ctx.translate(0, h); ctx.scale(1, -1); break;

    case 5: // transpose (flip across TL-BR): rotate 90° CW + mirror X
      ctx.rotate(0.5 * Math.PI);
      ctx.scale(1, -1);
      ctx.translate(0, -w);
      break;

    case 6: // rotate 90° CW
      ctx.rotate(0.5 * Math.PI);
      ctx.translate(0, -h);
      break;

    case 7: // transverse (flip across TR-BL): rotate 90° CW + mirror Y
      ctx.rotate(0.5 * Math.PI);
      ctx.translate(w, -h);
      ctx.scale(-1, 1);
      break;

    case 8: // rotate 90° CCW
      ctx.rotate(-0.5 * Math.PI);
      ctx.translate(-w, 0);
      break;

    default: // 1: normal
      break;
  }

  // Draw scaled to the display rect
  try {
    ctx.drawImage(src, 0, 0, w, h);
  } catch (e) {
    log('drawImage error', e);
  } finally {
    ctx.restore();
  }
}
