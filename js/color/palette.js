import { State, bus, setTolerance } from '../state.js';
import { rgb2lab, hexToRgb, rgbToHex, deltaE2Weighted } from './space.js';

export function paletteFromHexes(hexes){
  return hexes.map(h=>{ const c=hexToRgb(h)||{r:0,g:0,b:0}; return [c.r,c.g,c.b]; });
}
export function paletteToHexes(p){ return p.map(([r,g,b])=>rgbToHex(r,g,b)); }

export async function loadPMS(url='/assets/pms_solid_coated.json'){
  if(State.PMS.length) return;
  try{ const res = await fetch(url, {cache:'no-store'}); State.PMS = await res.json(); }
  catch(e){ console.warn('PMS JSON load failed',e); State.PMS=[]; }
}

export function nearestPMS(hex){
  const cache = State.PMSCache;
  if(cache.has(hex)) return cache.get(hex);
  if(!State.PMS.length) { const out={name:'—', hex, deltaE:0}; cache.set(hex,out); return out; }
  const {r,g,b} = hexToRgb(hex) || {r:0,g:0,b:0}; const lab = rgb2lab(r,g,b);
  let best=null, bestD=Infinity;
  for(const sw of State.PMS){
    const c=hexToRgb(sw.hex); if(!c) continue;
    const d = deltaE2Weighted(lab, rgb2lab(c.r,c.g,c.b), 1, 1);
    if(d<bestD){ bestD=d; best={ name:sw.name, hex:sw.hex, deltaE:Math.sqrt(d) }; }
  }
  cache.set(hex, best); return best;
}

export function ensureToleranceSlots(){
  const P = State.originalPalette.length;
  for(let i=0;i<P;i++){ if(!State.tolerances.has(i)) setTolerance(i,{ light:1.0, chroma:1.0 }); }
}

export function buildPaletteLab(pal){
  return pal.map(([r,g,b])=>({ rgb:[r,g,b], lab:rgb2lab(r,g,b) }));
}

