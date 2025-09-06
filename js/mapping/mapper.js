// mapping/mapper.js
import { clamp } from '../utils/canvas.js';
import { rgbToHex, rgbToLab, deltaE2Weighted } from '../color/space.js';

// Regions are stored at srcCanvas resolution; map to processing canvas
function getAllowedIndicesAt(x, y, procW, procH, srcW, srcH, regions) {
  if (!srcW || !srcH || !regions?.length) return null;
  const sx = Math.max(0, Math.min(srcW-1, Math.floor(x * srcW / procW)));
  const sy = Math.max(0, Math.min(srcH-1, Math.floor(y * srcH / procH)));
  const si = sy * srcW + sx;

  let allowed = null;
  for (const r of regions) {
    if (!r?.mask || !r?.allowed || r.mask.length !== srcW*srcH) continue;
    if (r.mask[si]) {
      if (!allowed) allowed = new Set();
      for (const i of r.allowed) allowed.add(i);
    }
  }
  return allowed;
}

export function buildPaletteLabWithTol(palette /* [[r,g,b,tol],...] */){
  return (palette||[]).map(([r,g,b,tol]) => ({ rgb:[r,g,b], lab:rgbToLab(r,g,b), tol }));
}

export function mapToPalette(imgData, palette, opts){
  const {
    wL=1.0, wC=1.0, dither=false, bgMode='keep',
    allowWhite=true,
    srcCanvasW=0, srcCanvasH=0, regions=[]
  } = (opts||{});

  const w = imgData.width, h = imgData.height, src = imgData.data;
  const out = new ImageData(w, h); out.data.set(src);
  const pal = buildPaletteLabWithTol(palette);

  let whiteIdx = -1;
  if (!allowWhite) {
    for (let i=0;i<pal.length;i++){
      const [r,g,b] = pal[i].rgb; if (r===255 && g===255 && b===255) { whiteIdx = i; break; }
    }
  }

  const errR = dither ? new Float32Array(w*h) : null;
  const errG = dither ? new Float32Array(w*h) : null;
  const errB = dither ? new Float32Array(w*h) : null;

  const bestIndexFor = (lab, allowedSet)=>{
    let best=-1, bestD=Infinity;
    const consider = (idx)=>{
      if (!allowWhite && idx===whiteIdx) return;
      const d2 = deltaE2Weighted(lab, pal[idx].lab, wL, wC);
      const inTol = Math.sqrt(d2) <= (pal[idx].tol||64) * 0.12;
      const score = inTol ? d2*0.2 : d2;
      if (score < bestD){ bestD=score; best=idx; }
    };

    if (allowedSet?.size){
      for(const p of allowedSet) consider(p);
      if (best>=0) return best;
      return [...allowedSet][0] ?? 0;
    } else {
      for(let p=0;p<pal.length;p++) consider(p);
      return best>=0 ? best : 0;
    }
  };

  for (let y=0;y<h;y++){
    for (let x=0;x<w;x++){
      const idx=y*w+x, i4=idx*4;
      const a=out.data[i4+3]; if(a===0) continue;

      let r=out.data[i4], g=out.data[i4+1], b=out.data[i4+2];
      if (dither){
        r=clamp(Math.round(r+(errR[idx]||0)),0,255);
        g=clamp(Math.round(g+(errG[idx]||0)),0,255);
        b=clamp(Math.round(b+(errB[idx]||0)),0,255);
      }
      const lab=rgbToLab(r,g,b);

      const allowed = getAllowedIndicesAt(x,y,w,h, srcCanvasW,srcCanvasH, regions);
      const best = bestIndexFor(lab, allowed);
      const nr=pal[best].rgb[0], ng=pal[best].rgb[1], nb=pal[best].rgb[2];
      out.data[i4  ]=nr; out.data[i4+1]=ng; out.data[i4+2]=nb;

      if (dither){
        const er=r-nr, eg=g-ng, eb=b-nb;
        const push=(xx,yy,fr,fg,fb)=>{
          if(xx<0||xx>=w||yy<0||yy>=h) return;
          const j=yy*w+xx;
          errR[j]=(errR[j]||0)+fr; errG[j]=(errG[j]||0)+fg; errB[j]=(errB[j]||0)+fb;
        };
        push(x+1,y,   er*7/16, eg*7/16, eb*7/16);
        push(x-1,y+1, er*3/16, eg*3/16, eb*3/16);
        push(x,  y+1, er*5/16, eg*5/16, eb*5/16);
        push(x+1,y+1, er*1/16, eg*1/16, eb*1/16);
      }
    }
  }

  if (bgMode==='white'){
    for(let i=0;i<out.data.length;i+=4) out.data[i+3]=255;
  }
  return out;
}
