export function getOrientedDims(o, w, h){ return [5,6,7,8].includes(o) ? {w:h,h:w} : {w,h}; }

export function drawImageWithOrientation(ctx, img, targetW, targetH, o=1){
  ctx.save();
  switch(o){
    case 2: ctx.translate(targetW,0); ctx.scale(-1,1); break;
    case 3: ctx.translate(targetW,targetH); ctx.rotate(Math.PI); break;
    case 4: ctx.translate(0,targetH); ctx.scale(1,-1); break;
    case 5: ctx.rotate(0.5*Math.PI); ctx.scale(1,-1); break;
    case 6: ctx.rotate(0.5*Math.PI); ctx.translate(0,-targetW); break;
    case 7: ctx.rotate(0.5*Math.PI); ctx.translate(targetH,-targetW); ctx.scale(-1,1); break;
    case 8: ctx.rotate(-0.5*Math.PI); ctx.translate(-targetH,0); break;
  }
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0, targetW, targetH);
  ctx.restore();
}

export function fitPreviewW(origW, origH, maxW){
  if(origW <= maxW) return {w:origW, h:origH};
  const s = maxW / origW; return {w: Math.round(origW*s), h: Math.round(origH*s)};
}

export function makeCanvas(w,h){
  const c=document.createElement('canvas'); c.width=w; c.height=h; return c;
}

