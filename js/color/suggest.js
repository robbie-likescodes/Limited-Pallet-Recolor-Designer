// js/color/suggest.js
// Suggestions for replacement rules

import { rgbToHex, hexToRgb, rgbToLab, deltaE2Weighted } from './space.js';

/**
 * Suggest a two-ink mix (checker) that approximates a target color.
 * Returns { err, pattern:'checker', inks:[iA,iB], density:0..1 } or null
 */
export function smartMixSuggest(targetHex, palette, allowedIndices){
  const target = hexToRgb(targetHex);
  if(!target) return null;
  const tl = rgbToLab(target.r, target.g, target.b);

  const inks = allowedIndices.map(i => ({
    i,
    rgb: [palette[i][0], palette[i][1], palette[i][2]],
    lab: rgbToLab(palette[i][0],palette[i][1],palette[i][2])
  }));

  let best = null;
  for (let a = 0; a < inks.length; a++){
    for (let b = a + 1; b < inks.length; b++){
      for (let d = 0; d <= 10; d++){
        const w = d/10;
        const mix = [
          Math.round(inks[a].rgb[0]*w + inks[b].rgb[0]*(1-w)),
          Math.round(inks[a].rgb[1]*w + inks[b].rgb[1]*(1-w)),
          Math.round(inks[a].rgb[2]*w + inks[b].rgb[2]*(1-w)),
        ];
        const ml  = rgbToLab(mix[0],mix[1],mix[2]);
        const err = deltaE2Weighted(ml, tl, 1, 1);
        if(!best || err < best.err){
          best = { err, pattern:'checker', inks:[inks[a].i, inks[b].i], density:w };
        }
      }
    }
  }
  return best;
}

/**
 * Analyze the source canvas and propose a handful of rules by hue/luma.
 * Returns an array of rules like:
 *   { enabled:true, targetHex:'#RRGGBB', pattern:'checker', inks:[iA,iB], density:0..1 }
 */
export function suggestByHueLuma(srcCanvas, palette, allowedIndices){
  if (!srcCanvas || !srcCanvas.width || !srcCanvas.height) return [];

  // Downsample for speed
  const maxW = 120;
  const scale = Math.min(1, maxW / srcCanvas.width);
  const w = Math.max(1, Math.round(srcCanvas.width * scale));
  const h = Math.max(1, Math.round(srcCanvas.height * scale));

  const off = document.createElement('canvas');
  off.width = w; off.height = h;
  const octx = off.getContext('2d', { willReadFrequently:true });
  octx.drawImage(srcCanvas, 0, 0, w, h);
  const { data } = octx.getImageData(0, 0, w, h);

  // Bucket by hue (6 bins) and luma (3 bins)
  const hueBins  = Array.from({length:6}, ()=>({sum:[0,0,0], n:0}));
  const lumaBins = Array.from({length:3}, ()=>({sum:[0,0,0], n:0}));

  const toHue = (r,g,b)=>{
    const rr=r/255, gg=g/255, bb=b/255;
    const mx=Math.max(rr,gg,bb), mn=Math.min(rr,gg,bb);
    const c=mx-mn;
    if(c===0) return 0;
    let h;
    if(mx===rr) h = ((gg-bb)/c)%6;
    else if(mx===gg) h = (bb-rr)/c + 2;
    else h = (rr-gg)/c + 4;
    h *= 60; if(h<0) h+=360;
    return h;
  };
  const luma = (r,g,b)=> 0.2126*r + 0.7152*g + 0.0722*b;

  for (let i=0;i<data.length;i+=4){
    const r=data[i], g=data[i+1], b=data[i+2], a=data[i+3];
    if (a < 8) continue;
    const hdeg = toHue(r,g,b);
    const hb = Math.min(5, Math.floor(hdeg/60));
    hueBins[hb].sum[0]+=r; hueBins[hb].sum[1]+=g; hueBins[hb].sum[2]+=b; hueBins[hb].n++;

    const L = luma(r,g,b);
    const lb = L < 85 ? 0 : (L < 170 ? 1 : 2);
    lumaBins[lb].sum[0]+=r; lumaBins[lb].sum[1]+=g; lumaBins[lb].sum[2]+=b; lumaBins[lb].n++;
  }

  const centers = [];
  const addCenter = (bin)=>{
    if (!bin.n) return;
    const r = Math.round(bin.sum[0]/bin.n);
    const g = Math.round(bin.sum[1]/bin.n);
    const b = Math.round(bin.sum[2]/bin.n);
    centers.push(rgbToHex(r,g,b));
  };
  hueBins.forEach(addCenter);
  lumaBins.forEach(addCenter);

  // De-dup & cap to ~6 targets
  const targets = Array.from(new Set(centers.map(h=>h.toUpperCase()))).slice(0,6);

  const rules = [];
  targets.forEach(hex=>{
    // Try a two-ink checker mix first
    const mix = smartMixSuggest(hex, palette, allowedIndices);
    if (mix && mix.inks && mix.inks.length === 2){
      rules.push({
        enabled: true,
        targetHex: hex.toUpperCase(),
        pattern: 'checker',
        inks: [mix.inks[0], mix.inks[1]],
        density: mix.density ?? 0.5
      });
    } else {
      // Fallback: single nearest ink rule
      let best = {i: allowedIndices[0] ?? 0, dE: 1e9};
      const tlab = (()=>{ const c=hexToRgb(hex); return rgbToLab(c.r,c.g,c.b); })();
      for (const i of allowedIndices){
        const p = palette[i]; if (!p) continue;
        const plab = rgbToLab(p[0],p[1],p[2]);
        const dE = deltaE2Weighted(tlab, plab, 1, 1);
        if (dE < best.dE) best = {i, dE};
      }
      rules.push({
        enabled: true,
        targetHex: hex.toUpperCase(),
        pattern: 'ordered',
        inks: [best.i],
        density: 1
      });
    }
  });

  return rules;
}
