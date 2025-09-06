import { State } from '../state.js';
import { rgb2lab, deltaE2Weighted } from '../color/space.js';
import { patternFn } from '../color/suggest.js';

// Build Lab palette once
function buildLab(pal){ return pal.map(([r,g,b])=>({rgb:[r,g,b], lab:rgb2lab(r,g,b)})); }

// Map with per-color tolerance, dither, replacements, and region constraints
export function mapImage(srcData, palette, opts){
  const { wLight=1.0, wChroma=1.0, useDither=false, bgMode='keep' } = opts;
  const w=srcData.width, h=srcData.height, src=srcData.data;
  const out=new ImageData(w,h); out.data.set(src);

  const palLab = buildLab(palette);

  const errR=useDither?new Float32Array(w*h):null;
  const errG=useDither?new Float32Array(w*h):null;
  const errB=useDither?new Float32Array(w*h):null;

  // Prebuild replacement functions per target index
  const repl = State.replacements;
  const replFns = new Map(); // idx -> fn(x,y, baseRgb) returns rgb
  repl.forEach((mix, targetIdx)=>{
    // mix: [{inkIndex, density, pattern, params}]
    const inks = mix.map(m=>({ idx:m.inkIndex, rgb: palLab[m.inkIndex].rgb, fn: patternFn(m.pattern||'bayer4', m.params||{}) , density:m.density }));
    const sum = inks.reduce((a,i)=>a+i.density,0)||1;
    inks.forEach(i=> i.density = Math.max(0,Math.min(1, i.density/sum)));
    replFns.set(targetIdx, (x,y)=>{
      // Composite with simple coverage blending
      let r=0,g=0,b=0;
      for(const m of inks){
        const thr = m.density; // threshold “coverage”
        const covered = (m.fn.length>=3) ? (m.fn(x,y,thr)>0?1:0) : (m.fn(x,y)>0?1:0);
        r += m.rgb[0]*covered; g += m.rgb[1]*covered; b += m.rgb[2]*covered;
      }
      // Clamp and average by number of covered cells if desired; we keep additive look
      return [Math.max(0,Math.min(255,r)), Math.max(0,Math.min(255,g)), Math.max(0,Math.min(255,b))];
    });
  });

  const allowedAt=(x,y)=>{
    let allowed=null;
    for(let i=State.regions.length-1;i>=0;i--){
      const R=State.regions[i];
      if(R.type==='polygon'){
        const idx=y*w+x; if(R.mask[idx]){ allowed=R.allowed; break; }
      }
    }
    return allowed;
  };

  for(let y=0;y<h;y++){
    for(let x=0;x<w;x++){
      const idx=y*w+x, i4=idx*4;
      if(out.data[i4+3]===0) continue;

      let r=out.data[i4], g=out.data[i4+1], b=out.data[i4+2];
      if(useDither){ r=Math.max(0,Math.min(255,Math.round(r+(errR[idx]||0)))); g=Math.max(0,Math.min(255,Math.round(g+(errG[idx]||0)))); b=Math.max(0,Math.min(255,Math.round(b+(errB[idx]||0)))); }

      // find nearest with per-color tolerance multipliers
      const lab=rgb2lab(r,g,b);
      const allow=allowedAt(x,y);

      let best=0, bestD=Infinity;
      for(let p=0;p<palLab.length;p++){
        if(allow && !allow.has(p)) continue;
        // Apply per-color tolerance by scaling weights when this target equals a specific palette color index
        const tol = State.tolerances.get(p) || {light:1.0, chroma:1.0};
        const d2 = deltaE2Weighted(lab, palLab[p].lab, wLight*tol.light, wChroma*tol.chroma);
        if(d2<bestD){ bestD=d2; best=p; }
      }

      // replacement?
      const replFn = replFns.get(best);
      if(replFn){
        const [nr,ng,nb] = replFn(x,y);
        out.data[i4]=nr|0; out.data[i4+1]=ng|0; out.data[i4+2]=nb|0;
      }else{
        const [nr,ng,nb] = palLab[best].rgb;
        out.data[i4]=nr; out.data[i4+1]=ng; out.data[i4+2]=nb;
      }

      if(useDither){
        const er=r-out.data[i4], eg=g-out.data[i4+1], eb=b-out.data[i4+2];
        const push=(xx,yy,fr,fg,fb)=>{ if(xx<0||xx>=w||yy<0||yy>=h) return; const j=yy*w+xx; errR[j]+=fr; errG[j]+=fg; errB[j]+=fb; };
        push(x+1,y,   er*7/16, eg*7/16, eb*7/16);
        push(x-1,y+1, er*3/16, eg*3/16, eb*3/16);
        push(x,  y+1, er*5/16, eg*5/16, eb*5/16);
        push(x+1,y+1, er*1/16, eg*1/16, eb*1/16);
      }
    }
  }
  return out;
}

