// color/suggest.js
import { hexToRgb, rgbToLab, deltaE2Weighted } from './space.js';

export function smartMixSuggest(targetHex, palette, allowedIndices){
  const target = hexToRgb(targetHex);
  if(!target) return null;
  const tl = rgbToLab(target.r, target.g, target.b);

  const inks = allowedIndices.map(i => ({
    i,
    rgb: [palette[i][0], palette[i][1], palette[i][2]],
    lab: rgbToLab(palette[i][0],palette[i][1],palette[i][2])
  }));

  let best=null;
  for (let a=0; a<inks.length; a++){
    for (let b=a+1; b<inks.length; b++){   // ✅ fixed syntax
      for (let d=0; d<=10; d++){
        const w = d/10;
        const mix = [
          Math.round(inks[a].rgb[0]*w + inks[b].rgb[0]*(1-w)),
          Math.round(inks[a].rgb[1]*w + inks[b].rgb[1]*(1-w)),
          Math.round(inks[a].rgb[2]*w + inks[b].rgb[2]*(1-w)),
        ];
        const ml = rgbToLab(mix[0],mix[1],mix[2]);
        const err = deltaE2Weighted(ml, tl, 1,1);
        if(!best || err<best.err){ best = { err, pattern:'checker', inks:[inks[a].i, inks[b].i], density:w }; }
      }
    }
  }
  return best;
}
