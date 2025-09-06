// js/app.js — orchestrator for Limited Palette Recolor Designer
// Handles DOM wiring, state, and delegates to feature modules

// ---------- Imports ----------
import { toast } from './ui/toasts.js';
import { clamp, getOrientedDims, drawImageWithOrientation } from './utils/canvas.js';
import {
  isHeicFile,
  isLikelyJpeg,
  heicHelp,
  objectUrlFor,
  revokeUrl,
  loadIMG,
  readJpegOrientation,
  decodeHeicWithWebCodecs
} from './utils/image.js';
import { hexToRgb, rgbToHex } from './color/space.js';
import { autoPaletteFromCanvasHybrid } from './color/palette.js';
import { smartMixSuggest } from './color/suggest.js';
import { mapToPalette } from './mapping/mapper.js';
import { unsharpMask } from './mapping/sharpen.js';
import { exportPNG } from './export/png.js';
import { exportSVG } from './export/svg.js';
import {
  loadSavedPalettes,
  saveSavedPalettes,
  loadPrefs,
  savePrefs,
  dbPutProject,
  dbGetAll,
  dbGet,
  dbDelete
} from './io/storage.js';

// ---------- DOM helpers ----------
const $  = (sel, r = document) => r.querySelector(sel);
const $$ = (sel, r = document) => [...r.querySelectorAll(sel)];
const on = (el, ev, fn, opts) => el && el.addEventListener(ev, fn, opts);

// ---------- Elements ----------
const els = {
  fileInput: $('#fileInput'),
  cameraInput: $('#cameraInput'),
  pasteBtn: $('#pasteBtn'),
  resetBtn: $('#resetBtn'),
  srcCanvas: $('#srcCanvas'),
  outCanvas: $('#outCanvas'),
  maxW: $('#maxW'),
  keepFullRes: $('#keepFullRes'),
  sharpenEdges: $('#sharpenEdges'),
  kColors: $('#kColors'),
  autoExtract: $('#autoExtract'),
  wChroma: $('#wChroma'),
  wLight: $('#wLight'),
  wChromaOut: $('#wChromaOut'),
  wLightOut: $('#wLightOut'),
  useDither: $('#useDither'),
  bgMode: $('#bgMode'),
  allowWhite: $('#allowWhite'),
  applyBtn: $('#applyBtn'),
  bigRegen: $('#bigRegen'),
  exportScale: $('#exportScale'),
  downloadBtn: $('#downloadBtn'),
  vectorExport: $('#vectorExport'),
  restrictedList: $('#restrictedList'),
  openEditor: $('#openEditor')
};

const sctx = els.srcCanvas?.getContext('2d', { willReadFrequently: true });
const octx = els.outCanvas?.getContext('2d', { willReadFrequently: true });
if (sctx) sctx.imageSmoothingEnabled = false;
if (octx) octx.imageSmoothingEnabled = false;

// ---------- State ----------
const state = {
  fullBitmap: null,
  fullW: 0,
  fullH: 0,
  exifOrientation: 1,
  palette: [],
  restricted: new Set(),
  regions: [],
  outFullImageData: null
};

// ---------- Palette helpers ----------
function getPaletteHex() {
  return state.palette.map(p => rgbToHex(p.r, p.g, p.b));
}
function setPaletteFromHexes(hexes = []) {
  state.palette = hexes.map(h => {
    const rgb = hexToRgb(h) || { r: 255, g: 255, b: 255 };
    return { r: rgb.r, g: rgb.g, b: rgb.b, tol: 64 };
  });
  document.dispatchEvent(new CustomEvent('palette:updated', { detail: { hexes } }));
}
function getRestrictedInkIndices() {
  const boxes = $$('input[type=checkbox]', els.restrictedList) || [];
  state.restricted = new Set(
    boxes.filter(b => b.checked).map(b => parseInt(b.dataset.idx || '0', 10))
  );
  return [...state.restricted];
}

// ---------- UI wiring ----------
function updateWeightLabels() {
  if (els.wChromaOut) els.wChromaOut.textContent = (Number(els.wChroma?.value || 100) / 100).toFixed(2) + '×';
  if (els.wLightOut) els.wLightOut.textContent  = (Number(els.wLight?.value  || 100) / 100).toFixed(2) + '×';
}
function toggleImageActions(enable) {
  [els.applyBtn, els.autoExtract, els.resetBtn, els.openEditor].forEach(b => {
    if (b) b.disabled = !enable;
  });
}

// ---------- Image load ----------
async function handleFile(file) {
  try {
    if (!file) return;
    console.log('[load] file name=%s type=%s size=%d', file.name, file.type || '(unknown)', file.size);

    // createImageBitmap path
    if (typeof createImageBitmap === 'function') {
      try {
        const bmp = await createImageBitmap(file, { imageOrientation:"from-image", colorSpaceConversion:"default" });
        state.fullBitmap = bmp;
        state.fullW = bmp.width;
        state.fullH = bmp.height;
        state.exifOrientation = 1;
        drawPreviewFromState();
        toggleImageActions(true);
        return;
      } catch (e) {
        console.warn('[load] createImageBitmap failed', e);
      }
    }

    // WebCodecs path
    if (isHeicFile(file) && 'ImageDecoder' in window) {
      try {
        const bmp = await decodeHeicWithWebCodecs(file);
        state.fullBitmap = bmp;
        state.fullW = bmp.width;
        state.fullH = bmp.height;
        state.exifOrientation = 1;
        drawPreviewFromState();
        toggleImageActions(true);
        return;
      } catch (e2) {
        console.warn('[load] WebCodecs failed', e2);
      }
    }

    // <img> fallback
    const url = objectUrlFor(file);
    try {
      const img = await loadIMG(url);
      state.fullBitmap = img;
      state.fullW = img.naturalWidth || img.width;
      state.fullH = img.naturalHeight || img.height;
      if (isLikelyJpeg(file)) {
        try { state.exifOrientation = await readJpegOrientation(file); } catch {}
      } else {
        state.exifOrientation = 1;
      }
      drawPreviewFromState();
      toggleImageActions(true);
      return;
    } catch (imgErr) {
      console.warn('[load] <img> failed', imgErr);
      if (isHeicFile(file)) heicHelp(); else toast('Could not open that image. Try a JPG/PNG.');
    } finally {
      revokeUrl(url);
    }

  } catch (err) {
    console.error('[load] fatal error', err);
    if (isHeicFile(file)) heicHelp(); else toast('Could not open that image. Try a JPG/PNG.');
  }
}

function drawPreviewFromState() {
  if (!state.fullBitmap) return;
  const maxW = clamp(Number(els.maxW?.value || 1400), 200, 4000);
  const dims = getOrientedDims(state.fullW, state.fullH, state.exifOrientation, maxW);
  els.srcCanvas.width = dims.w;
  els.srcCanvas.height = dims.h;
  drawImageWithOrientation(sctx, state.fullBitmap, state.exifOrientation, dims.w, dims.h);
  console.log('[draw] srcCanvas %dx%d', dims.w, dims.h);
}

// ---------- Mapping ----------
function refreshOutput() {
  if (!state.fullBitmap) return;
  const srcData = sctx.getImageData(0, 0, els.srcCanvas.width, els.srcCanvas.height);
  const wL = Number(els.wLight?.value || 100) / 100;
  const wC = Number(els.wChroma?.value || 100) / 100;
  const dither = !!els.useDither?.checked;
  const bgMode = els.bgMode?.value || 'keep';
  const restricted = getRestrictedInkIndices();

  const mapped = mapToPalette(srcData, state.palette, {
    wL, wC, dither, bgMode,
    allowWhite: !!els.allowWhite?.checked,
    srcCanvasW: els.srcCanvas.width,
    srcCanvasH: els.srcCanvas.height,
    regions: state.regions,
    restricted
  });
  els.outCanvas.width = mapped.width;
  els.outCanvas.height = mapped.height;
  octx.putImageData(mapped, 0, 0);
  state.outFullImageData = mapped;
  console.log('[map] done');
}

// ---------- Exports ----------
function doExportPNG() {
  if (!state.outFullImageData) return;
  const scale = parseInt(els.exportScale?.value || '1', 10);
  exportPNG(state.outFullImageData, scale);
}
function doExportSVG() {
  if (!state.outFullImageData) return;
  const restricted = getRestrictedInkIndices();
  exportSVG(state.outFullImageData, getPaletteHex(), restricted.length || state.palette.length);
}

// ---------- Event wiring ----------
document.addEventListener('DOMContentLoaded', () => {
  console.log('[app] DOM ready');
  updateWeightLabels();

  on(els.fileInput, 'change', e => handleFile(e.target.files[0]));
  on(els.cameraInput, 'change', e => handleFile(e.target.files[0]));
  on(els.pasteBtn, 'click', async () => {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      for (const type of item.types) {
        if (type.startsWith('image/')) {
          const blob = await item.getType(type);
          handleFile(new File([blob], 'pasted.' + type.split('/')[1], { type }));
          return;
        }
      }
    }
  });
  on(els.resetBtn, 'click', () => { state.fullBitmap = null; sctx.clearRect(0,0,els.srcCanvas.width,els.srcCanvas.height); toggleImageActions(false); });

  on(els.autoExtract, 'click', () => {
    const k = clamp(Number(els.kColors?.value || 8), 2, 16);
    const hexes = autoPaletteFromCanvasHybrid(els.srcCanvas, k);
    setPaletteFromHexes(hexes);
  });

  on(els.wChroma, 'input', updateWeightLabels);
  on(els.wLight, 'input', updateWeightLabels);
  on(els.applyBtn, 'click', refreshOutput);
  on(els.bigRegen, 'click', refreshOutput);

  on(els.downloadBtn, 'click', doExportPNG);
  on(els.vectorExport, 'click', doExportSVG);
});
