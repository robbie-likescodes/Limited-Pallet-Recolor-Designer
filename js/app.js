// js/app.js — orchestrator (orientation = no-op, works with canvas.js helpers)

import { toast } from './ui/toasts.js';
import { clamp, getOrientedDims, drawImageWithOrientation } from './utils/canvas.js';
import {
  isHeicFile, isLikelyJpeg, heicHelp,
  objectUrlFor, revokeUrl, loadIMG,
  decodeHeicWithWebCodecs
} from './utils/image.js';

// Color + palette
import { hexToRgb, rgbToHex } from './color/space.js';
import { autoPaletteFromCanvasHybrid } from './color/palette.js';
import * as Patterns from './color/patterns.js';
import { smartMixSuggest, suggestByHueLuma } from './color/suggest.js';

// Mapping
import { mapToPalette } from './mapping/mapper.js';
import { unsharpMask } from './mapping/sharpen.js';

// Exports
import { exportPNG } from './export/png.js';
import { exportSVG } from './export/svg.js';
import { buildPrinterReport, nearestPms, loadPmsJson } from './export/report.js';

// IO / storage / files
import {
  loadSavedPalettes, saveSavedPalettes,
  loadPrefs, savePrefs,
  dbPutProject, dbGetAll, dbGet, dbDelete
} from './io/storage.js';
import * as Files from './io/files.js';

// UI
import { renderRestrictedFromPalette, getRestrictedInkIndices as _getRP } from './ui/controls.js';

// Editor (optional)
import * as EditorFull from './editor/fullscreen.js';

// ----- tiny DOM helpers -----
const $  = (s, r=document)=>r.querySelector(s);
const $$ = (s, r=document)=>[...r.querySelectorAll(s)];
const on = (el, ev, fn, opts)=> el && el.addEventListener(ev, fn, opts);

// ----- elements -----
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
  restrictedList: $('#restrictedList'),
  restrictedSelectAll: $('#restrictedSelectAll'),
  restrictedSelectNone: $('#restrictedSelectNone'),
  allowWhite: $('#allowWhite'),
  wChroma: $('#wChroma'),
  wLight:  $('#wLight'),
  wChromaOut: $('#wChromaOut'),
  wLightOut:  $('#wLightOut'),
  useDither: $('#useDither'),
  bgMode: $('#bgMode'),
  applyBtn: $('#applyBtn'),
  bigRegen: $('#bigRegen'),
  btnSuggestHueLuma: $('#btnSuggestHueLuma'),
  btnSmartMix: $('#btnSmartMix'),
  addRule: $('#addRule'),
  btnRefreshOutput: $('#btnRefreshOutput'),
  rulesTable: $('#rulesTable'),
  exportScale: $('#exportScale'),
  downloadBtn: $('#downloadBtn'),
  vectorExport: $('#vectorExport'),
  colorCodeMode: $('#colorCodeMode'),
  mailtoLink: $('#mailtoLink'),
  exportReport: $('#exportReport'),
  codeList: $('#codeList'),
  openProjects: $('#openProjects'),
  closeProjects: $('#closeProjects'),
  projectsPane: $('#projectsPane'),
  saveProject: $('#saveProject'),
  refreshProjects: $('#refreshProjects'),
  exportProject: $('#exportProject'),
  importProject: $('#importProject'),
  deleteProject: $('#deleteProject'),
  projectsList: $('#projectsList'),
  openEditor: $('#openEditor'),
  editorOverlay: $('#editorOverlay'),
  editCanvas: $('#editCanvas'),
  editOverlay: $('#editOverlay'),
  editorDone: $('#editorDone'),
};

const sctx = els.srcCanvas?.getContext('2d', { willReadFrequently:true });
const octx = els.outCanvas?.getContext('2d', { willReadFrequently:true });
if (sctx) sctx.imageSmoothingEnabled = false;
if (octx) octx.imageSmoothingEnabled = false;

// ----- app state -----
const state = {
  fullBitmap: null, fullW: 0, fullH: 0,
  exifOrientation: 1, // always 1 (ignored)
  palette: [],
  restricted: new Set(),
  rules: [],
  regions: [],
  codeMode: 'pms',
  selectedProjectId: null,
  outFullImageData: null,
};

// ----- helpers -----
function getRestrictedInkIndices(){ return _getRP(els); }
function getPaletteHex(){ return state.palette.map(p => rgbToHex(p.r,p.g,p.b)); }
function setPaletteFromHexes(hexes = [], tol=64){
  state.palette = hexes.map(h=>{
    const c=hexToRgb(h)||{r:255,g:255,b:255};
    return {r:c.r,g:c.g,b:c.b,tol};
  });
  renderRestrictedFromPalette(els, hexes, new Set(hexes.map((_,i)=>i)));
  renderCodeList();
  updateMailto();
  persistPrefs();
}
function updateWeightLabels(){
  if (els.wChromaOut) els.wChromaOut.textContent = (Number(els.wChroma?.value || 100) / 100).toFixed(2) + '×';
  if (els.wLightOut)  els.wLightOut.textContent  = (Number(els.wLight?.value  || 100) / 100).toFixed(2) + '×';
}
function toggleImageActions(enable){
  [els.applyBtn, els.autoExtract, els.resetBtn, els.openEditor].forEach(b => { if (b) b.disabled = !enable; });
}

// ----- image load -----
async function handleFile(file){
  try{
    if(!file) return;

    // A) createImageBitmap fast path
    if (typeof createImageBitmap === 'function') {
      try{
        const bmp = await createImageBitmap(file, { imageOrientation:'none', colorSpaceConversion:'default' });
        state.fullBitmap=bmp; state.fullW=bmp.width; state.fullH=bmp.height; state.exifOrientation=1;
        drawPreviewFromState(); toggleImageActions(true); return;
      }catch{}
    }
    // B) HEIC via WebCodecs
    if (isHeicFile(file) && 'ImageDecoder' in window) {
      try{
        const bmp = await decodeHeicWithWebCodecs(file);
        state.fullBitmap=bmp; state.fullW=bmp.width; state.fullH=bmp.height; state.exifOrientation=1;
        drawPreviewFromState(); toggleImageActions(true); return;
      }catch{}
    }
    // C) <img> fallback
    const url = objectUrlFor(file);
    try{
      const img = await loadIMG(url);
      state.fullBitmap=img;
      state.fullW = img.naturalWidth || img.width;
      state.fullH = img.naturalHeight || img.height;
      state.exifOrientation = 1;
      drawPreviewFromState(); toggleImageActions(true);
    }catch(err){
      if (isHeicFile(file)) heicHelp(); else toast('Could not open that image. Try a JPG/PNG.');
    }finally{ revokeUrl(url); }
  }catch(err){
    toast(`Load error: ${err?.message || err}`);
  }
}

function drawPreviewFromState(){
  if(!state.fullBitmap || !els.srcCanvas) return;
  const maxW = clamp(parseInt(els.maxW?.value || '1400', 10), 200, 4000);
  const { w, h } = getOrientedDims(1, state.fullW, state.fullH, maxW);

  els.srcCanvas.width = w; els.srcCanvas.height = h;
  sctx.fillStyle = '#0b172e'; sctx.fillRect(0,0,w,h);
  drawImageWithOrientation(sctx, state.fullBitmap, 1, w, h);

  els.outCanvas.width=w; els.outCanvas.height=h; octx.clearRect(0,0,w,h);
  state.outFullImageData=null;
  if (els.downloadBtn) els.downloadBtn.disabled = true;
  if (els.vectorExport) els.vectorExport.disabled = true;
}

// ----- palette -----
function autoExtractPalette(){
  if(!els.srcCanvas?.width){ toast('Load an image first.'); return; }
  const k = clamp(Number(els.kColors?.value || 10), 2, 16);
  const hexes = autoPaletteFromCanvasHybrid(els.srcCanvas, k);
  setPaletteFromHexes(hexes);
  toast(`Auto palette: ${hexes.length} colors`);
}

// ----- mapping -----
function refreshOutput(){
  if (!els.srcCanvas?.width){ toast("Load an image first."); return; }
  if (!state.palette.length){ toast("Build a palette first."); return; }

  const wL = Number(els.wLight?.value || 100)/100;
  const wC = Number(els.wChroma?.value || 100)/100;
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

  if (els.sharpenEdges?.checked) mapped = unsharpMask(mapped, 0.35);

  els.outCanvas.width = mapped.width;
  els.outCanvas.height = mapped.height;
  octx.putImageData(mapped, 0, 0);
  state.outFullImageData = mapped;

  if (els.downloadBtn) els.downloadBtn.disabled = false;
  if (els.vectorExport) els.vectorExport.disabled = !(window.ImageTracer);
}

// ----- report / codes -----
function renderCodeList(){
  if (!els.codeList) return;
  const indices = getRestrictedInkIndices();
  const hexes = indices.map(i => rgbToHex(state.palette[i]?.r||0, state.palette[i]?.g||0, state.palette[i]?.b||0));
  if (!hexes.length) { els.codeList.innerHTML = '<em>No final inks selected</em>'; return; }

  els.codeList.innerHTML = hexes.map((hex,i)=>`
    <div class="row">
      <span class="sw" style="width:14px;height:14px;border:1px solid #334155;border-radius:3px;background:${hex}"></span>
      ${i+1}. ${hex}
    </div>`).join('');
}

function updateMailto(){
  if (!els.mailtoLink) return;
  const subject = encodeURIComponent('Print job: artwork + palette');
  const body = encodeURIComponent(getPaletteHex().join(', '));
  els.mailtoLink.href = `mailto:?subject=${subject}&body=${body}`;
}

// ----- prefs -----
function persistPrefs(){
  const p = {
    lastPalette: getPaletteHex(),
    keepFullRes: !!els.keepFullRes?.checked,
    sharpenEdges: !!els.sharpenEdges?.checked,
    maxW: parseInt(els.maxW?.value||'1400',10),
    wChroma: parseInt(els.wChroma?.value||'100',10),
    wLight: parseInt(els.wLight?.value||'100',10),
    bgMode: els.bgMode?.value||'keep',
    useDither: !!els.useDither?.checked,
    codeMode: state.codeMode,
  };
  savePrefs(p);
}

function loadPrefsAndInitUI(){
  const prefs = loadPrefs() || {};
  if (prefs.lastPalette?.length) setPaletteFromHexes(prefs.lastPalette);
  if ('keepFullRes' in prefs) els.keepFullRes.checked = !!prefs.keepFullRes;
  if ('sharpenEdges' in prefs) els.sharpenEdges.checked = !!prefs.sharpenEdges;
  if (prefs.maxW) els.maxW.value = prefs.maxW;
  if (prefs.wChroma) els.wChroma.value = prefs.wChroma;
  if (prefs.wLight) els.wLight.value = prefs.wLight;
  if (prefs.bgMode) els.bgMode.value = prefs.bgMode;
  if ('useDither' in prefs) els.useDither.checked = !!prefs.useDither;
  state.codeMode = (prefs.codeMode === 'hex' ? 'hex' : 'pms');
  if (els.colorCodeMode) els.colorCodeMode.value = state.codeMode;
  updateWeightLabels();
  renderCodeList();
  updateMailto();
}

// ----- init -----
document.addEventListener('DOMContentLoaded', async () => {
  try{ await loadPmsJson('assets/pms_solid_coated.json'); }catch{}

  loadPrefsAndInitUI();

  // file inputs
  on(els.fileInput,'change',e=>handleFile(e.target.files?.[0]));
  on(els.cameraInput,'change',e=>handleFile(e.target.files?.[0]));

  // paste
  on(els.pasteBtn,'click', async ()=>{
    if(!navigator.clipboard?.read){ toast('Clipboard not available'); return; }
    try{
      const items = await navigator.clipboard.read();
      for (const it of items) {
        for (const type of it.types) {
          if (type.startsWith('image/')) {
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
    const f = e.dataTransfer?.files?.[0]; if (f) handleFile(f);
  }, { passive:false });

  // reset
  on(els.resetBtn,'click', ()=>{ if(state.fullBitmap) drawPreviewFromState(); });

  // auto-palette
  on(els.autoExtract,'click', autoExtractPalette);

  // restricted all/none
  on(els.restrictedSelectAll,'click', ()=>{ $$('input[type=checkbox]', els.restrictedList).forEach(c=>c.checked=true); renderCodeList(); updateMailto(); });
  on(els.restrictedSelectNone,'click', ()=>{ $$('input[type=checkbox]', els.restrictedList).forEach(c=>c.checked=false); renderCodeList(); updateMailto(); });
  on(els.restrictedList,'change', ()=>{ state.restricted = new Set(getRestrictedInkIndices()); renderCodeList(); updateMailto(); });

  // weights
  on(els.wChroma,'input', ()=>{ updateWeightLabels(); persistPrefs(); });
  on(els.wLight, 'input', ()=>{ updateWeightLabels(); persistPrefs(); });

  // mapping
  on(els.applyBtn,'click', refreshOutput);
  on(els.bigRegen,'click', refreshOutput);

  // export
  on(els.downloadBtn,'click', ()=>{
    if(!state.outFullImageData) return toast('Apply mapping first');
    const scale = clamp(parseInt(els.exportScale?.value||'1',10),1,4);
    exportPNG(state.outFullImageData, scale);
  });
  on(els.vectorExport,'click', ()=>{
    if(!state.outFullImageData) return toast('Apply mapping first');
    const r=getRestrictedInkIndices();
    exportSVG(state.outFullImageData, getPaletteHex(), r.length||state.palette.length);
  });

  // codes
  on(els.colorCodeMode,'change', ()=>{
    state.codeMode = els.colorCodeMode.value === 'hex' ? 'hex' : 'pms';
    renderCodeList(); updateMailto(); persistPrefs();
  });
  on(els.exportReport,'click', ()=>{
    if (typeof buildPrinterReport !== 'function') return toast('Report module not available');
    const txt = buildPrinterReport(state, getRestrictedInkIndices());
    const blob = new Blob([txt],{type:'text/plain'});
    const a=document.createElement('a'); a.download='report.txt'; a.href=URL.createObjectURL(blob); a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href),1500);
  });

  // friendly hints
  setTimeout(()=>toast('Tip: Auto-extract a palette, then select inks in “Restricted Palette”.'), 600);
  setTimeout(()=>toast('Use “Suggest by Hue & Luma” or Smart Mix, then Apply mapping.'), 2200);
});
