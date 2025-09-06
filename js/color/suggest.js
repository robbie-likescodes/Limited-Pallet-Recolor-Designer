import { State } from '../state.js';
import { rgb2lab, deltaE2Weighted, luminance, hueSector } from './space.js';
import { makePattern } from './patterns.js';

// Least-squares mix: choose N inks from restricted to approximate target rgb
function solveMix(targetRGB, inksRGB, maxInks=3){
  // Try greedy combos up to maxInks; simple projection approach
  const inks = inksRGB.map((rgb,i)=>({rgb,i}));
  let best={err:Infinity, weights:null, picks:null};

  // generate combinations
  function combos(arr,k,start=0,prefix=[]){
    if(prefix.length===k){ arr.push(prefix.slice()); return; }
    for(let i=start;i<inks.length;i++) combos(arr,k,i+1,prefix.concat(i));
  }
  for(let k=1;k<=Math.min(maxInks, inks.length);k++){
    const arr=[]; combos(arr,k);
    for(const idxs of arr){
      const M = idxs.map(i=>inks[i].rgb); // k x 3
      // Solve min || M^T w - target || subject to w>=0, sum w <= 1 (leave white gap)
      // Use non-negative least squares with simple projected gradient (few steps)
      const w = new Array(k).fill(1/k);
      const t = targetRGB;
      const step=0.2;
      for(let iter=0;iter<80;iter++){
        // grad = 2 M (M^T w - t)
        const Mt_w = [0,0,0];
        for(let j=0;j<k;j++){ Mt_w[0]+=M[j][0]*w[j]; Mt_w[1]+=M[j][1]*w[j]; Mt_w[2]+=M[j][2]*w[j]; }
        const diff=[Mt_w[0]-t[0], Mt_w[1]-t[1], Mt_w[2]-t[2]];
        const g=new Array(k).fill(0);
        for(let j=0;j<k;j++){ g[j]=2*( M[j][0]*diff[0]+M[j][1]*diff[1]+M[j][2]*diff[2] ); }
        for(let j=0;j<k;j++){ w[j]=Math.max(0, w[j]-step*g[j]); }
        // normalize to <=1
        let s=w.reduce((a,b)=>a+b,0); if(s>1){ for(let j=0;j<k;j++) w[j]/=s; }
      }
      // error
      const Mt_w=[0,0,0]; for(let j=0;j<k;j++){ Mt_w[0]+=M[j][0]*w[j]; Mt_w[1]+=M[j][1]*w[j]; Mt_w[2]+=M[j][2]*w[j]; }
      const labT=rgb2lab(...t), labR=rgb2lab(...Mt_w);
      const err=deltaE2Weighted(labT,labR,1,1);
      if(err<best.err) best={err,weights:w,picks:idxs};
    }
  }
  if(!best.picks) return null;
  const entries = best.picks.map((pi,ii)=>({ inkIndex: inks[pi].i, density: best.weights[ii], pattern:'bayer4', params:{} }));
  // If sum<1, assume leftover is "paper/white" – keep as is.
  return entries;
}

export function suggestByHueAndLuma(srcImageData, originalPalette, restrictedPalette){
  // For each color in the original that is NOT in restricted set,
  // propose a mix from restricted inks (2-3 inks) + default pattern/density from luma
  const restrictedSet = new Set(restrictedPalette.map(h=>h.join(',')));

  const suggestions = new Map(); // targetIndex -> mix
  originalPalette.forEach((rgb, idx)=>{
    const key=rgb.join(',');
    if(restrictedSet.has(key)) return; // already in restricted
    const mix = solveMix(rgb, restrictedPalette, 3);
    if(mix && mix.length){
      // set initial pattern threshold by luminance: darker -> more dark ink
      const L = luminance(rgb[0],rgb[1],rgb[2]);
      // adjust densities roughly toward L (0..100)
      const s = mix.reduce((a,m)=>a+m.density,0) || 1;
      mix.forEach(m=> m.density = Math.max(0, Math.min(1, m.density/s)));
      suggestions.set(idx, mix);
    }
  });
  return suggestions;
}

// Smart mix for specific target color using only selected inks from restricted
export function suggestForTargetColor(targetRGB, allowedInksRGB, maxInks=4){
  return solveMix(targetRGB, allowedInksRGB, maxInks);
}

// Pattern function helper (exposed for UI preview)
export function patternFn(type, params){ return makePattern(type, params); }

