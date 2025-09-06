// js/app.js — lean orchestrator

// ---- Imports (all heavy lifting lives in modules) ----
import { toast } from './ui/toasts.js';
import { clamp, getOrientedDims, drawImageWithOrientation } from './utils/canvas.js';
import {
  isHeicFile, isLikelyJpeg, heicHelp,
  objectUrlFor, revokeUrl, loadIMG,
  readJpegOrientation, decodeHeicWithWebCodecs
} from './utils/image.js';

import { hexToRgb, rgbToHex } from './color/space.js';
import { autoPaletteFromCanvasHybrid } from './color/palette.js';
import { renderRestrictedFromPalette, getRestrictedInkIndices as _getRP } from './ui/controls.js';

import { mapToPalette } from './mapping/mapper.js';
import { unsharpMask } from './mapping/sharpen.js'; // optional
import { exportPNG } from './export/png.js';
import { exportSVG } from './export/svg.js';

// ---- Tiny DOM helpers ----
const $  = (s, r=document)=>r.querySelector(s);
const $$ = (s, r=document)=>[...r.querySelectorAll(s)];
const on = (el, ev, fn, opts)=> el && el.addEventListener(ev, fn, opts);

// ---- Elements (match your index.html IDs) ----
const els = {
  // image io
  fileInput: $('#fileInput'),
  cameraInput: $('#cameraInput'),
  pasteBtn: $('#pasteBtn'),
  resetBtn: $('#resetBtn'),
  // canvases
  srcCanvas: $('#srcCanvas'),
  outCanvas: $('#outCanvas'),
  // preview / processing
  maxW: $('#maxW'),
  keepFullRes: $('#keepFullRes'),
  sharpenEdges: $('#sharpenEdges'),
  // palette / auto
  kColors: $('#kColors'),
  autoExtract: $('#autoExtract'),
  // restricted palette
  restrictedList: $('#restrictedList'),
  restrictedSelectAll: $('#restrictedSelectAll'),
  restrictedSelectNone: $('#restrictedSelectNone'),
  allowWhite: $('#allowWhite'),
  // mapping controls
  wChroma: $('#wChroma'),
  wLight:  $('#wLight'),
  wChromaOut: $('#wChromaOut'),
  wLightOut:  $('#wLightOut'),
  useDither: $('#useDither'),
  bgMode: $('#bgMode'),
  applyBtn: $('#applyBtn'),
  bigRegen: $('#bigRegen'),
  // export
  exportScale: $('#exportScale'),
  downloadBtn: $('#downloadBtn'),
  vectorExport: $('#vectorExport'),
};

const sctx = els.srcCanvas?.getContext('2d', { willReadFrequently:true });
const octx = els.outCanvas?.getContext('2d', { willReadFrequently:true });
if (sctx) sctx.imageSmoothingEnabled = false;
if (octx) octx.imageSmoothingEnabled = false;

// ---- App state (lightweight) ----
const state = {
  // source image
  fullBitmap: null,
  fullW: 0,
  fullH: 0,
  exifOrientation: 1,

  // palette [{r,g,b,tol}]
  palette: [],
  restricted: new Set(),

  // regions (optional; kept for future lasso integration)
  regions: [],

  // last mapped result
  outFullImageData: null,
};

// ---- Helpers ----
function getRestrictedInkIndices(){ return _getRP(els); }

function getPaletteHex() {
  return state.palette.map(p => rgbToHex(p.r, p.g, p.b));
}

function setPaletteFromHexes(hexes = []) {
  // internal palette keeps tolerance; default 64
  state.palette = hexes.map(h => {
    const c = hexToRgb(h) || { r:255, g:255, b:255 };
    return { r:c.r, g:c.g, b:c.b, tol:64 };
  });

  // render Restricted Palette chips (default: all selected)
  const selected = new Set(hexes.map((_, i) => i));
  renderRestrictedFromPalette(els, hexes, selected);
}

function updateWeightLabels(){
  if (els.wChromaOut) els.wChromaOut.textContent = (Number(els.wChroma?.value || 100) / 100).toFixed(2) + '×';
  if (els.wLightOut)  els.wLightOut.textContent  = (Number(els.wLight?.value  || 100) / 100).toFixed(2) + '×';
}

function toggleImageActions(enable){
  [els.applyBtn, els.autoExtract, els.resetBtn].forEach(b => { if (b) b.disabled = !enable; });
}

// ---- Image load pipeline (HEIC-capable) ----
async function handleFile(file){
  try{
    if(!file) return;

    // Fast path: createImageBitmap (respects EXIF w/ imageOrientation)
    if (typeof createImageBitmap === 'function') {
      try {
        const bmp = await createImageBitmap(file, { imageOrientation:'from-image', colorSpaceConversion:'default' });
        state.fullBitmap = bmp;
        state.fullW = bmp.width;
        state.fullH = bmp.height;
        state.exifOrientation = 1;
        drawPreviewFromState();
        toggleImageActions(true);
        return;
      } catch(_e) {/* fall through */}
    }

    // Try WebCodecs for HEIC/HEIF
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
      } catch(_e2) {/* fall through */}
    }

    // <img> fallback (Safari loads HEIC here; PNG/JPEG everywhere)
    const url = objectUrlFor(file);
    try{
      const img = await loadIMG(url);
      state.fullBitmap = img;
      state.fullW = img.naturalWidth || img.width;
      state.fullH = img.naturalHeight || img.height;
      state.exifOrientation = isLikelyJpeg(file) ? (await readJpegOrientation(file)) : 1;
      drawPreviewFromState();
      toggleImageActions(true);
    } catch (err){
      if (isHeicFile(file)) heicHelp(); else toast('Could not open that image. Try a JPG/PNG.');
    } finally {
      revokeUrl(url);
    }
  }catch(err){
    toast(`Load error: ${err?.message || err}`);
  }
}

function drawPreviewFromState(){
  if(!state.fullBitmap || !els.srcCanvas) return;
  const maxW = clamp(parseInt(els.maxW?.value || '1400', 10), 200, 4000);
  const { w, h } = getOrientedDims(state.fullW, state.fullH, state.exifOrientation, maxW);
  if (!w || !h) return;

  els.srcCanvas.width = w;
  els.srcCanvas.height = h;

  // visible backdrop to avoid “invisible nothing”
  sctx.save(); sctx.fillStyle = '#0b172e'; sctx.fillRect(0,0,w,h); sctx.restore();

  drawImageWithOrientation(sctx, state.fullBitmap, state.exifOrientation, w, h);

  // clear mapped preview until user applies mapping again
  els.outCanvas.width = w;
  els.outCanvas.height = h;
  octx.clearRect(0,0,w,h);
  state.outFullImageData = null;
  if (els.downloadBtn) els.downloadBtn.disabled = true;
  if (els.vectorExport) els.vectorExport.disabled = true;
}

// ---- Mapping & Export ----
function refreshOutput(){
  if (!els.srcCanvas?.width) { toast('Load an image first'); return; }
  if (!state.palette.length)  { toast('Build or auto-extract a palette'); return; }

  const wL = Number(els.wLight?.value || 100) / 100;
  const wC = Number(els.wChroma?.value || 100) / 100;
  const dither = !!els.useDither?.checked;
  const bgMode = els.bgMode?.value || 'keep';
  const restricted = getRestrictedInkIndices();

  const srcData = sctx.getImageData(0,0,els.srcCanvas.width, els.srcCanvas.height);
  let mapped = mapToPalette(srcData, state.palette, {
    wL, wC, dither, bgMode,
    allowWhite: !!els.allowWhite?.checked,
    srcCanvasW: els.srcCanvas.width,
    srcCanvasH: els.srcCanvas.height,
    regions: state.regions,
    restricted
  });

  if (els.sharpenEdges?.checked) {
    mapped = unsharpMask(mapped, 0.35);
  }

  els.outCanvas.width = mapped.width;
  els.outCanvas.height = mapped.height;
  octx.putImageData(mapped, 0, 0);
  state.outFullImageData = mapped;

  if (els.downloadBtn) els.downloadBtn.disabled = false;
  if (els.vectorExport) els.vectorExport.disabled = false;
}

function doExportPNG(){
  if (!state.outFullImageData) { toast('Apply mapping first'); return; }
  const scale = parseInt(els.exportScale?.value || '1', 10);
  exportPNG(state.outFullImageData, clamp(scale, 1, 4));
}

function doExportSVG(){
  if (!state.outFullImageData) { toast('Apply mapping first'); return; }
  const restricted = getRestrictedInkIndices();
  const maxColors = restricted.length || state.palette.length;
  exportSVG(state.outFullImageData, getPaletteHex(), maxColors);
}

// ---- Event wiring ----
document.addEventListener('DOMContentLoaded', () => {
  updateWeightLabels();

  // file/camera
  on(els.fileInput,  'change', e => handleFile(e.target.files?.[0]));
  on(els.cameraInput,'change', e => handleFile(e.target.files?.[0]));

  // paste
  on(els.pasteBtn, 'click', async ()=>{
    if(!navigator.clipboard?.read){ toast('Clipboard read not available'); return; }
    try{
      const items = await navigator.clipboard.read();
      for(const it of items){
        for(const type of it.types){
          if(type.startsWith('image/')){
            const blob = await it.getType(type);
            const file = new File([blob], `pasted.${type.split('/')[1]}`, { type });
            return handleFile(file);
          }
        }
      }
      toast('No image in clipboard');
    }catch{ toast('Clipboard read failed'); }
  });

  // drag & drop
  const prevent = e => { e.preventDefault(); e.stopPropagation(); };
  ['dragenter','dragover','dragleave','drop'].forEach(ev => window.addEventListener(ev, prevent, { passive:false }));
  window.addEventListener('drop', e => {
    const f = e.dataTransfer?.files?.[0];
    if (f) handleFile(f);
  }, { passive:false });

  // reset
  on(els.resetBtn, 'click', ()=>{
    if (!state.fullBitmap) return;
    drawPreviewFromState();
    toast('Reset to original preview');
  });

  // auto-palette
  on(els.autoExtract, 'click', ()=>{
    if(!els.srcCanvas?.width){ toast('Load an image first'); return; }
    const k = clamp(Number(els.kColors?.value || 10), 2, 16);
    const hexes = autoPaletteFromCanvasHybrid(els.srcCanvas, k);
    setPaletteFromHexes(hexes);
    toast(`Auto palette: ${hexes.length} colors`);
  });

  // restricted palette select all/none
  on(els.restrictedSelectAll, 'click', ()=>{
    $$('input[type=checkbox]', els.restrictedList).forEach(c => c.checked = true);
  });
  on(els.restrictedSelectNone, 'click', ()=>{
    $$('input[type=checkbox]', els.restrictedList).forEach(c => c.checked = false);
  });

  // mapping controls
  on(els.wChroma, 'input', updateWeightLabels);
  on(els.wLight,  'input', updateWeightLabels);
  on(els.applyBtn, 'click', refreshOutput);
  on(els.bigRegen, 'click', refreshOutput);

  // exports
  on(els.downloadBtn, 'click', doExportPNG);
  on(els.vectorExport, 'click', doExportSVG);
});
