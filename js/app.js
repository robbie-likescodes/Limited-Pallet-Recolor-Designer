// js/app.js — lean orchestrator + visible diagnostics

import { toast } from './ui/toasts.js';
import { clamp, getOrientedDims, drawImageWithOrientation } from './utils/canvas.js';
import {
  isHeicFile, isLikelyJpeg, heicHelp,
  objectUrlFor, revokeUrl, loadIMG,
  readJpegOrientation, decodeHeicWithWebCodecs
} from './utils/image.js';
import { hexToRgb, rgbToHex } from './color/space.js';
import { autoPaletteFromCanvasHybrid } from './color/palette.js';
import { mapToPalette } from './mapping/mapper.js';
import { unsharpMask } from './mapping/sharpen.js';
import { exportPNG } from './export/png.js';
import { exportSVG } from './export/svg.js';
import {
  loadSavedPalettes, saveSavedPalettes, loadPrefs, savePrefs,
  dbPutProject, dbGetAll, dbGet, dbDelete
} from './io/storage.js';

// ---------- tiny DOM helpers ----------
const $  = (s, r=document)=>r.querySelector(s);
const $$ = (s, r=document)=>[...r.querySelectorAll(s)];
const on = (el, ev, fn, opts)=> el && el.addEventListener(ev, fn, opts);

// ---------- elements ----------
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
  wLight:  $('#wLight'),
  wChromaOut: $('#wChromaOut'),
  wLightOut:  $('#wLightOut'),
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

// contexts
const sctx = els.srcCanvas?.getContext('2d', { willReadFrequently:true });
const octx = els.outCanvas?.getContext('2d', { willReadFrequently:true });
if (sctx) sctx.imageSmoothingEnabled = false;
if (octx) octx.imageSmoothingEnabled = false;

// ---------- simple status lamp (shows last step on screen) ----------
const statusLamp = (() => {
  const div = document.createElement('div');
  div.style.cssText = 'position:fixed;right:10px;bottom:10px;background:rgba(15,23,42,.9);color:#fff;border:1px solid #2a3656;border-radius:10px;padding:8px 10px;font:12px/1.2 ui-monospace,monospace;z-index:99999';
  div.textContent = 'ready';
  document.body.appendChild(div);
  return (msg)=>{ div.textContent = msg; };
})();

// also surface JS errors visibly
window.addEventListener('error', e => toast(`JS error: ${e.message}`));
window.addEventListener('unhandledrejection', e => toast(`Promise error: ${e.reason?.message||e.reason||'unknown'}`));

// ---------- state ----------
const state = {
  fullBitmap: null, fullW: 0, fullH: 0, exifOrientation: 1,
  palette: [],
  restricted: new Set(),
  regions: [],
  outFullImageData: null
};

function getRestrictedInkIndices(){
  const boxes = $$('input[type=checkbox]', els.restrictedList) || [];
  state.restricted = new Set(boxes.filter(b=>b.checked).map(b=>parseInt(b.dataset.idx||'0',10)));
  return [...state.restricted];
}
function getPaletteHex(){ return state.palette.map(p=>rgbToHex(p.r,p.g,p.b)); }
function setPaletteFromHexes(hexes=[]){
  state.palette = hexes.map(h=>{ const c=hexToRgb(h)||{r:255,g:255,b:255}; return {r:c.r,g:c.g,b:c.b,tol:64}; });
  document.dispatchEvent(new CustomEvent('palette:updated',{detail:{hexes}}));
}

// ---------- diagnostics helpers ----------
function fillDebugRect(c){
  if(!c) return;
  const ctx=c.getContext('2d');
  ctx.clearRect(0,0,c.width,c.height);
  ctx.fillStyle='#123'; ctx.fillRect(0,0,c.width,c.height);
  ctx.fillStyle='#3bf'; ctx.fillRect(10,10,Math.max(1,Math.floor(c.width*0.6)),Math.max(1,Math.floor(c.height*0.6)));
}

// ---------- image load pipeline ----------
async function handleFile(file){
  try{
    if(!file){ statusLamp('no file'); return; }
    statusLamp(`file: ${file.name}`);

    // quick proof: draw a debug rect so we know the event fired
    els.srcCanvas.width = 320; els.srcCanvas.height = 180; fillDebugRect(els.srcCanvas);

    // Path A: createImageBitmap (fast, handles EXIF with imageOrientation)
    if(typeof createImageBitmap === 'function'){
      try{
        statusLamp('createImageBitmap...');
        const bmp = await createImageBitmap(file, { imageOrientation:'from-image', colorSpaceConversion:'default' });
        statusLamp(`bitmap ${bmp.width}x${bmp.height}`);
        state.fullBitmap = bmp; state.fullW=bmp.width; state.fullH=bmp.height; state.exifOrientation=1;
        drawPreviewFromState('A');
        toggleImageActions(true);
        return;
      }catch(e){ console.warn('[load] createImageBitmap failed', e); }
    }

    // Path B: HEIC via WebCodecs
    if(isHeicFile(file) && 'ImageDecoder' in window){
      try{
        statusLamp('WebCodecs HEIC...');
        const bmp = await decodeHeicWithWebCodecs(file);
        statusLamp(`heic bmp ${bmp.width}x${bmp.height}`);
        state.fullBitmap=bmp; state.fullW=bmp.width; state.fullH=bmp.height; state.exifOrientation=1;
        drawPreviewFromState('B');
        toggleImageActions(true);
        return;
      }catch(e2){ console.warn('[load] WebCodecs failed', e2); }
    }

    // Path C: <img> fallback (Safari loads HEIC here; PNG/JPEG everywhere)
    const url = objectUrlFor(file);
    try{
      statusLamp('IMG fallback...');
      const img = await loadIMG(url);
      const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
      statusLamp(`img ${iw}x${ih}`);
      state.fullBitmap = img; state.fullW=iw; state.fullH=ih;
      state.exifOrientation = isLikelyJpeg(file) ? (await readJpegOrientation(file)) : 1;
      drawPreviewFromState('C');
      toggleImageActions(true);
      return;
    }catch(err){
      console.warn('[load] <img> failed', err);
      if(isHeicFile(file)) heicHelp(); else toast('Could not open that image. Try a JPG/PNG.');
    }finally{ revokeUrl(url); }

  }catch(err){
    console.error('[load] fatal', err);
    toast(`Load error: ${err.message||err}`);
  }
}

function drawPreviewFromState(tag=''){
  if(!state.fullBitmap){ statusLamp('no bitmap'); return; }
  const maxW = clamp(parseInt(els.maxW?.value || '1400',10), 200, 4000);
  // get oriented display size (accounts for 90° rotations)
  const { w, h } = getOrientedDims(state.fullW, state.fullH, state.exifOrientation, maxW);
  if(!w || !h){ statusLamp('bad dims'); return; }

  els.srcCanvas.width = w; els.srcCanvas.height = h;

  // fill background so "nothing drew" is obvious
  const ctx = sctx; ctx.save(); ctx.fillStyle='#0b172e'; ctx.fillRect(0,0,w,h); ctx.restore();

  // draw respecting EXIF
  drawImageWithOrientation(sctx, state.fullBitmap, state.exifOrientation, w, h);
  statusLamp(`drawn ${w}x${h}${tag?` [${tag}]`:''}`);
}

// ---------- mapping / export (unchanged logic; left minimal) ----------
function refreshOutput(){
  if(!els.srcCanvas?.width){ toast('Load an image first'); return; }
  const srcData = sctx.getImageData(0,0,els.srcCanvas.width,els.srcCanvas.height);
  const wL = Number(els.wLight?.value || 100)/100;
  const wC = Number(els.wChroma?.value || 100)/100;
  const dither = !!els.useDither?.checked;
  const bgMode = els.bgMode?.value || 'keep';
  const restricted = getRestrictedInkIndices();

  const mapped = mapToPalette(srcData, state.palette, {
    wL,wC,dither,bgMode,
    allowWhite: !!els.allowWhite?.checked,
    srcCanvasW: els.srcCanvas.width,
    srcCanvasH: els.srcCanvas.height,
    regions: state.regions,
    restricted
  });
  els.outCanvas.width = mapped.width;
  els.outCanvas.height = mapped.height;
  octx.putImageData(mapped,0,0);
  state.outFullImageData = mapped;
  statusLamp('mapped');
}

function doExportPNG(){ if(state.outFullImageData){ exportPNG(state.outFullImageData, parseInt(els.exportScale?.value||'1',10)); } }
function doExportSVG(){ if(state.outFullImageData){ const r=getRestrictedInkIndices(); exportSVG(state.outFullImageData, getPaletteHex(), r.length||state.palette.length); } }

function toggleImageActions(enable){
  [els.applyBtn, els.autoExtract, els.resetBtn, els.openEditor].forEach(b=>{ if(b) b.disabled=!enable; });
}

function updateWeightLabels(){
  if (els.wChromaOut) els.wChromaOut.textContent = (Number(els.wChroma?.value || 100) / 100).toFixed(2) + '×';
  if (els.wLightOut)  els.wLightOut.textContent  = (Number(els.wLight?.value  || 100) / 100).toFixed(2) + '×';
}

// ---------- event wiring ----------
document.addEventListener('DOMContentLoaded', ()=>{
  statusLamp('DOM ready');

  on(els.fileInput,  'change', e => { statusLamp('input:file change'); handleFile(e.target.files?.[0]); });
  on(els.cameraInput,'change', e => { statusLamp('input:camera change'); handleFile(e.target.files?.[0]); });
  on(els.pasteBtn, 'click', async ()=>{
    if(!navigator.clipboard?.read){ toast('Clipboard not available'); return; }
    try{
      statusLamp('paste reading...');
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
    }catch(err){ toast('Clipboard read failed'); }
  });
  on(els.resetBtn,'click', ()=>{
    statusLamp('reset');
    state.fullBitmap=null; state.fullW=state.fullH=0; state.exifOrientation=1;
    sctx.clearRect(0,0,els.srcCanvas.width,els.srcCanvas.height);
    toggleImageActions(false);
  });

  on(els.autoExtract,'click', ()=>{
    if(!els.srcCanvas?.width){ toast('Load an image first'); return; }
    const k = clamp(Number(els.kColors?.value||10),2,16);
    const hexes = autoPaletteFromCanvasHybrid(els.srcCanvas, k);
    setPaletteFromHexes(hexes);
    toast(`Palette auto: ${hexes.length} colors`);
  });

  on(els.wChroma,'input', updateWeightLabels);
  on(els.wLight, 'input', updateWeightLabels);
  on(els.applyBtn, 'click', refreshOutput);
  on(els.bigRegen, 'click', refreshOutput);
  on(els.downloadBtn, 'click', doExportPNG);
  on(els.vectorExport, 'click', doExportSVG);

  updateWeightLabels();
});
