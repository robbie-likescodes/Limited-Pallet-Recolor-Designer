// utils/canvas.js
export const clamp = (v, mi, ma) => v < mi ? mi : v > ma ? ma : v;

// Orientation helper: EXIF 5–8 swap W/H
export const getOrientedDims = (o, w, h) => ([5,6,7,8].includes(o) ? { w:h, h:w } : { w, h });

export function drawImageWithOrientation(ctx, img, targetW, targetH, orientation) {
  ctx.save();
  switch (orientation) {
    case 2: ctx.translate(targetW,0); ctx.scale(-1,1); break;
    case 3: ctx.translate(targetW,targetH); ctx.rotate(Math.PI); break;
    case 4: ctx.translate(0,targetH); ctx.scale(1,-1); break;
    case 5: ctx.rotate(0.5*Math.PI); ctx.scale(1,-1); break;
    case 6: ctx.rotate(0.5*Math.PI); ctx.translate(0,-targetW); break;
    case 7: ctx.rotate(0.5*Math.PI); ctx.translate(targetH,-targetW); ctx.scale(-1,1); break;
    case 8: ctx.rotate(-0.5*Math.PI); ctx.translate(-targetH,0); break;
    default: break;
  }
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0, targetW, targetH);
  ctx.restore();
}
