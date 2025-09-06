// Central event bus + global state
export const bus = (() => {
  const listeners = new Map();
  return {
    on(type, fn) { (listeners.get(type) ?? listeners.set(type, new Set()).get(type)).add(fn); return () => listeners.get(type)?.delete(fn); },
    emit(type, payload) { listeners.get(type)?.forEach(fn => { try { fn(payload); } catch(e){ console.error(e);} }); },
  };
})();

export const State = {
  // image
  original: { bitmap: null, width: 0, height: 0, exif: 1 },
  preview:  { canvas: null, ctx: null },   // srcCanvas
  mapped:   { canvas: null, ctx: null, fullImageData: null }, // outCanvas (preview + retained full res)

  // palettes
  originalPalette: [],   // [[r,g,b],...]
  restrictedPalette: [], // subset user selects (indexes into originalPalette or free colors)
  savedPalettes: [],

  // per-color tolerance (by index of current palette view)
  tolerances: new Map(), // idx -> {light: number, chroma: number} (multipliers)

  // replacements: targetIndex -> [{inkIndex, density[0..1], pattern:'checker'|'bayer2'|'bayer4'|'stripes'|'stipple', params:{}}...]
  replacements: new Map(),

  // regions (lasso): array of {type:'polygon', points:[[x,y],...], mask:Uint8Array, allowed:Set(inkIndex)}
  regions: [],

  // options
  opts: {
    wLight: 1.0,
    wChroma: 1.0,
    useDither: false,
    bgMode: 'keep', // keep|white|transparent
    sharpenEdges: false,
    keepFullRes: true,
    maxPreviewW: 1400,
  },

  // report/codes
  codeMode: 'pms', // 'pms'|'hex'

  // UI cache
  els: {},

  // PMS library
  PMS: [], PMSCache: new Map(),
};

export function setEls(hash){ State.els = hash; }
export function setOption(k,v){ State.opts[k]=v; bus.emit('opts:changed', {k,v}); }
export function setOriginalPalette(p){ State.originalPalette = p; bus.emit('palette:original', p); }
export function setRestrictedPalette(p){ State.restrictedPalette = p; bus.emit('palette:restricted', p); }
export function setTolerance(idx, tol){ State.tolerances.set(idx, tol); bus.emit('tolerance:changed', {idx,tol}); }
export function setReplacement(targetIdx, mix){ State.replacements.set(targetIdx, mix); bus.emit('replacements:changed'); }
export function deleteReplacement(targetIdx){ State.replacements.delete(targetIdx); bus.emit('replacements:changed'); }
export function clearReplacements(){ State.replacements.clear(); bus.emit('replacements:changed'); }
export function setRegions(arr){ State.regions = arr; bus.emit('regions:changed', arr); }
export function addRegion(r){ State.regions.push(r); bus.emit('regions:changed', State.regions); }

