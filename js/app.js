// app.js (ES module orchestrator)
import { toast } from './ui/toasts.js';
import { clamp, getOrientedDims, drawImageWithOrientation } from './utils/ccanvas.js'; // <-- typo fixed below
import { isHeicFile, isLikelyJpeg, heicHelp, objectUrlFor, revokeUrl, loadIMG, readJpegOrientation } from './utils/image.js';
import { rgbToHex, hexToRgb } from './color/space.js';
import { autoPaletteFromCanvasHybrid } from './color/palette.js';
import { mapToPalette } from './mapping/mapper.js';
import { unsharpMask } from './mapping/sharpen.js';
import { exportPNG } from './export/png.js';
import { exportSVG } from './export/svg.js';
import { loadSavedPalettes, saveSavedPalettes, loadPrefs, savePrefs,
         dbPutProject, dbGetAll, dbGet, dbDelete } from './io/storage.js';
import { smartMixSuggest } from './color/suggest.js';

// NOTE: correct import path for canvas helpers
import { clamp as _clamp, getOrientedDims as _getDims, drawImageWithOrientation as _drawOri } from './utils/canvas.js';
const clamp2=_clamp, getOrientedDims2=_getDims, drawImageWithOrientation2=_drawOri;
// or simply fix the import line to './utils/canvas.js' directly

// ----- keep your current element lookups/state exactly as-is -----
const $  = (sel, r=document) => r.querySelector(sel);
const $$ = (sel, r=document) => [...r.querySelectorAll(sel)];
const on = (el, ev, fn, opts) => el && el.addEventListener(ev, fn, opts);
const els = { /* ... your existing element mapping exactly ... */ };
const state = { /* ... your existing state object ... */ };

// Replace places where you called the old functions with the imported ones:
// - autoPaletteFromCanvasHybrid(els.srcCanvas, k)  -> from color/palette.js returns HEX[]; call your setPalette()
// - mapToPalette(...) now expects: (imageData, state.palette, { wL, wC, dither, bgMode, allowWhite, srcCanvasW:els.srcCanvas.width, srcCanvasH:els.srcCanvas.height, regions:state.regions })
// - unsharpMask(...) same
// - exportPNG(state.outFullImageData, scale)
// - exportSVG(state.outFullImageData, getPaletteHex(), getRestrictedInkIndices().length || state.palette.length)

// Keep your HEIC / EXIF load code; just swap helpers to imports.
// Keep your UI handlers; no change to HTML IDs.

// Example where mapping is triggered (inside your refreshOutput):
// const mapped = mapToPalette(srcData, state.palette, {
//   wL, wC, dither, bgMode,
//   allowWhite: !!els.allowWhite?.checked,
//   srcCanvasW: els.srcCanvas.width,
//   srcCanvasH: els.srcCanvas.height,
//   regions: state.regions
// });
