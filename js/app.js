// js/app.js — full-orchestrator that touches all modules in your tree
// Keeps the HEIC-safe loader baseline, and wires: palette, restricted inks,
// mapping (+patterns/rules), suggestions, editor, exports, projects, prefs.

import { toast } from './ui/toasts.js';
import { clamp, getOrientedDims, drawImageWithOrientation } from './utils/canvas.js';
import {
  isHeicFile, isLikelyJpeg, heicHelp,
  objectUrlFor, revokeUrl, loadIMG,
  readJpegOrientation, decodeHeicWithWebCodecs
} from './utils/image.js';

// Color + palette
import { hexToRgb, rgbToHex, rgbToLab, deltaE2Weighted } from './color/space.js';
import { autoPaletteFromCanvasHybrid } from './color/palette.js';
import * as Patterns from './color/patterns.js';       // apply rule patterns (checker/stripe/dots/ordered/stipple)
import { smartMixSuggest, suggestByHueLuma } from './color/suggest.js';

// Mapping
import { mapToPalette } from './mapping/mapper.js';
import { unsharpMask } from './mapping/sharpen.js';

// Exports
import { exportPNG } from './export/png.js';
import { exportSVG } from './export/svg.js';
import { buildPrinterReport, nearestPms, loadPmsJson } from './export/report.js'; // if your report module exposes these

// IO / storage / files
import {
  loadSavedPalettes, saveSavedPalettes,
  loadPrefs, savePrefs,
  dbPutProject, dbGetAll, dbGet, dbDelete
} from './io/storage.js';
import * as Files from './io/files.js'; // optional helpers (blob<->base64, etc.)

// UI controls (restricted palette rendering)
import { renderRestrictedFromPalette, getRestrictedInkIndices as _getRP } from './ui/controls.js';

// Editor hooks (feature-detected; keep optional)
import * as EditorFull from './editor/fullscreen.js';
import * as EditorDrop from './editor/eyedropper.js';
import * as EditorLasso from './editor/lasso.js';

// ----- tiny DOM helpers -----
const $  = (s, r=document)=>r.querySelector(s);
const $$ = (s, r=document)=>[...r.querySelectorAll(s)];
const on = (el, ev, fn, opts)=> el && el.addEventListener(ev, fn, opts);

// ----- elements (match your index.html) -----
const els = {
  // image I/O + canvases
  fileInput: $('#fileInput'),
  cameraInput: $('#cameraInput'),
  pasteBtn: $('#pasteBtn'),
  resetBtn: $('#resetBtn'),
  srcCanvas: $('#srcCanvas'),
  outCanvas: $('#outCanvas'),

  // preview/processing
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

  // mapping
  wChroma: $('#wChroma'),
  wLight:  $('#wLight'),
  wChromaOut: $('#wChromaOut'),
  wLightOut:  $('#wLightOut'),
  useDither: $('#useDither'),
  bgMode: $('#bgMode'),
  applyBtn: $('#applyBtn'),
  bigRegen: $('#bigRegen'),

  // suggestions / rules UI
  btnSuggestHueLuma: $('#btnSuggestHueLuma'),
  btnSmartMix: $('#btnSmartMix'),
  addRule: $('#addRule'),
  btnRefreshOutput: $('#btnRefreshOutput'),
  rulesTable: $('#rulesTable'),

  // halftone preview (optional)
  useHalftone: $('#useHalftone'),
  dotCell: $('#dotCell'),
  dotBg: $('#dotBg'),
  dotJitter: $('#dotJitter'),

  // export
  exportScale: $('#exportScale'),
  downloadBtn: $('#downloadBtn'),
  vectorExport: $('#vectorExport'),

  // report / codes
  colorCodeMode: $('#colorCodeMode'),
  mailtoLink: $('#mailtoLink'),
  exportReport: $('#exportReport'),
  codeList: $('#codeList'),

  // projects drawer
  openProjects: $('#openProjects'),
  closeProjects: $('#closeProjects'),
  projectsPane: $('#projectsPane'),
  saveProject: $('#saveProject'),
  refreshProjects: $('#refreshProjects'),
  exportProject: $('#exportProject'),
  importProject: $('#importProject'),
  deleteProject: $('#deleteProject'),
  projectsList: $('#projectsList'),

  // editor overlay (optional modules)
  openEditor: $('#openEditor'),
  editorOverlay: $('#editorOverlay'),
  editCanvas: $('#editCanvas'),
  editOverlay: $('#editOverlay'),
  editorDone: $('#editorDone'),
};

// contexts
const sctx = els.srcCanvas?.getContext('2d', { willReadFrequently:true });
const octx = els.outCanvas?.getContext('2d', { willReadFrequently:true });
if (sctx) sctx.imageSmoothingEnabled = false;
if (octx) octx.imageSmoothingEnabled = false;

// ----- app state -----
const state = {
  // image
  fullBitmap: null, fullW: 0, fullH: 0, exifOrientation: 1,

  // colors/palette
  palette: [],              // [{r,g,b,tol}]
  restricted: new Set(),    // indices

  // rules (replacement patterns)
  rules: [],                // [{enabled,targetHex,pattern,inks,density}]

  // lasso regions, etc.
  regions: [],              // [{ type:'polygon', mask:Uint8Array, allowed:Set(idx) }]

  // code/report mode
  codeMode: 'pms',          // 'pms'|'hex'

  // selection
  selectedProjectId: null,

  // last mapped
  outFullImageData: null,
};

// ----- helpers -----
function getRestrictedInkIndices(){ return _getRP(els); }
function getPaletteHex(){ return state.palette.map(p => rgbToHex(p.r,p.g,p.b)); }
function setPaletteFromHexes(hexes = [], tol=64){
  state.palette = hexes.map(h=>{ const c=hexToRgb(h)||{r:255,g:255,b:255}; return {r:c.r,g:c.g,b:c.b,tol}; });
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

// ----- image load (HEIC-capable) -----
async function handleFile(file){
  try{
    if(!file) return;

    // A) createImageBitmap fast path
    if (typeof createImageBitmap === 'function') {
      try{
        const bmp = await createImageBitmap(file, { imageOrientation:'from-image', colorSpaceConversion:'default' });
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
    // C) <img> fallback (Safari HEIC + all PNG/JPEG)
    const url = objectUrlFor(file);
    try{
      const img = await loadIMG(url);
      state.fullBitmap=img;
      state.fullW = img.naturalWidth || img.width;
      state.fullH = img.naturalHeight || img.height;
      state.exifOrientation = isLikelyJpeg(file) ? (await readJpegOrientation(file)) : 1;
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
  const { w, h } = getOrientedDims(state.fullW, state.fullH, state.exifOrientation, maxW);
  if (!w || !h) return;

  els.srcCanvas.width = w; els.srcCanvas.height = h;
  sctx.save(); sctx.fillStyle = '#0b172e'; sctx.fillRect(0,0,w,h); sctx.restore();
  drawImageWithOrientation(sctx, state.fullBitmap, state.exifOrientation, w, h);

  // reset mapped preview
  els.outCanvas.width=w; els.outCanvas.height=h; octx.clearRect(0,0,w,h);
  state.outFullImageData=null;
  if (els.downloadBtn) els.downloadBtn.disabled = true;
  if (els.vectorExport) els.vectorExport.disabled = true;
}

// ----- rules/patterns UI -----
function renderRulesTable(){
  if (!els.rulesTable) return;
  const tbody = els.rulesTable.tBodies?.[0] || els.rulesTable;
  tbody.innerHTML = '';

  const palHex = getPaletteHex();

  state.rules.forEach((r, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="checkbox" class="r-on" ${r.enabled?'checked':''}></td>
      <td><input type="text" class="r-target mono" value="${(r.targetHex||'#000000').toUpperCase()}" size="8"></td>
      <td>
        <select class="r-pattern">
          ${['checker','stripe','dots','ordered','stipple'].map(p=>`<option value="${p}" ${p===r.pattern?'selected':''}>${p}</option>`).join('')}
        </select>
      </td>
      <td>
        <div class="r-inks">
          ${r.inks.map(i=>`
            <label class="inkchip"><input type="checkbox" class="r-ink" data-i="${i}" checked>
              <span class="chip" title="${palHex[i]||''}" style="background:${palHex[i]||'#000'}"></span>
            </label>
          `).join('')}
        </div>
        <button class="btn btn-ghost r-edit-inks" type="button">Edit</button>
      </td>
      <td>
        <input type="range" class="r-density" min="0" max="100" value="${Math.round((r.density??0.5)*100)}">
        <span class="mono r-dv">${Math.round((r.density??0.5)*100)}%</span>
      </td>
      <td><button class="btn btn-ghost r-del danger" type="button">Delete</button></td>
    `;
    const onChk=tr.querySelector('.r-on');
    const tHex=tr.querySelector('.r-target');
    const pat =tr.querySelector('.r-pattern');
    const dens=tr.querySelector('.r-density');
    const dval=tr.querySelector('.r-dv');
    const del =tr.querySelector('.r-del');
    const edit=tr.querySelector('.r-edit-inks');

    on(onChk,'change',()=>{ r.enabled=onChk.checked; });
    on(tHex,'change',()=>{ let v=tHex.value.trim(); if(!v.startsWith('#')) v='#'+v; r.targetHex=v.toUpperCase(); });
    on(pat,'change',()=>{ r.pattern=pat.value; });
    on(dens,'input',()=>{ r.density = clamp(dens.value/100,0,1); dval.textContent = `${Math.round(r.density*100)}%`; });
    on(del,'click',()=>{ state.rules.splice(idx,1); renderRulesTable(); });
    on(edit,'click',()=>{
      const allow = getRestrictedInkIndices();
      if(allow.length<2){ toast("Select at least 2 inks in Restricted Palette."); return; }
      const pick = prompt(`Enter comma separated indices of inks to use (Restricted only):\nAllowed: ${allow.join(', ')}`, r.inks.join(','));
      if(!pick) return;
      const arr=pick.split(',').map(s=>parseInt(s.trim(),10)).filter(n=>Number.isFinite(n) && allow.includes(n));
      if(arr.length>=2){ r.inks=arr; renderRulesTable(); } else { toast("Need 2+ inks."); }
    });

    tbody.appendChild(tr);
  });
}

// ----- mapping pipeline -----
function applyTextureRulesIfAny(mapped, wL=1, wC=1) {
  // If your color/patterns.js exports an applyRules(data, rules, paletteHex, options) use it;
  // otherwise we’ll skip patterns and just return mapped.
  if (!Patterns || typeof Patterns.applyRules !== 'function') return mapped;

  const paletteHex = getPaletteHex();
  const enabled = state.rules.filter(r => r.enabled && r.inks?.length >= 2);
  if (!enabled.length) return mapped;

  try{
    return Patterns.applyRules(mapped, enabled, paletteHex, { wL, wC, palette: state.palette });
  }catch(e){
    console.warn('applyRules failed', e);
    return mapped;
  }
}

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

  // optional texture/pattern replacement rules
  mapped = applyTextureRulesIfAny(mapped, wL, wC);

  // optional sharpen
  if (els.sharpenEdges?.checked) mapped = unsharpMask(mapped, 0.35);

  // draw preview
  els.outCanvas.width = mapped.width;
  els.outCanvas.height = mapped.height;
  octx.putImageData(mapped, 0, 0);
  state.outFullImageData = mapped;

  if (els.downloadBtn) els.downloadBtn.disabled = false;
  if (els.vectorExport) els.vectorExport.disabled = !(window.ImageTracer);
}

// ----- suggestions -----
function doSuggestHueLuma(){
  // If your color/suggest.js provides a direct function, use it; else fallback to simple auto rules.
  if (typeof suggestByHueLuma === 'function') {
    const allowed = getRestrictedInkIndices();
    if (allowed.length < 2) return toast('Select at least 2 inks in Restricted Palette.');
    if (!els.srcCanvas?.width) return toast('Load an image first.');

    const proposals = suggestByHueLuma(els.srcCanvas, state.palette, allowed);
    // Merge into state.rules, replacing same targetHex
    const keep = state.rules.filter(r => !proposals.find(p => (p.targetHex||'').toUpperCase() === (r.targetHex||'').toUpperCase()));
    state.rules = keep.concat(proposals);
    renderRulesTable();
    toast('Suggestions added. Refresh Output to apply.');
    return;
  }

  // Fallback: simple no-op
  toast('Suggestion module not available.');
}

function doSmartMix(){
  const allowed = getRestrictedInkIndices();
  if (allowed.length < 2) return toast('Select at least 2 inks in Restricted Palette.');
  const target = prompt("Enter target HEX to approximate (e.g. #2A8F3C):", "#2A8F3C");
  if (!target || !/^#([0-9a-f]{6})$/i.test(target)) return toast("Enter a valid hex like #22AA66");

  const best = typeof smartMixSuggest === 'function'
    ? smartMixSuggest(target.toUpperCase(), allowed, state.palette)
    : null;

  if (!best) return toast('No mix found.');

  state.rules.push({ enabled:true, targetHex:target.toUpperCase(), pattern:best.pattern||'checker', inks:best.inks, density:best.density ?? 0.5 });
  renderRulesTable();
  toast('Smart mix suggestion added. Refresh Output to apply.');
}

// ----- report & codes -----
function renderCodeList(){
  if (!els.codeList) return;
  const indices = getRestrictedInkIndices();
  const hexes = indices.map(i => rgbToHex(state.palette[i]?.r||0, state.palette[i]?.g||0, state.palette[i]?.b||0));
  if (!hexes.length) { els.codeList.innerHTML = '<em>No final inks selected</em>'; return; }

  const mode = state.codeMode;
  const items = hexes.map((hex,i)=>{
    if (mode === 'hex' || !nearestPms) return { label:`${hex}`, swatchHex: hex };
    const p = nearestPms(hex); // from export/report.js
    return { label: `${p.name} (${p.hex}) ΔE≈${(p.deltaE||0).toFixed(1)}`, swatchHex: p.hex || hex };
  });

  els.codeList.innerHTML = items.map((c,i)=>`
    <div class="row">
      <span class="sw" style="width:14px;height:14px;border:1px solid #334155;border-radius:3px;background:${c.swatchHex}"></span>
      ${i+1}. ${c.label}
    </div>`).join('');
}

function updateMailto(){
  if (!els.mailtoLink) return;
  const subject = encodeURIComponent(state.codeMode==='pms' ? 'Print job: artwork + PMS palette' : 'Print job: artwork + HEX palette');
  const preview = (typeof buildPrinterReport === 'function') ? buildPrinterReport(state, getRestrictedInkIndices()) : getPaletteHex().join(', ');
  const body = encodeURIComponent(
`Hi,

Please find attached the artwork PNG (full resolution) and the ${state.codeMode.toUpperCase()} palette list.

${ state.codeMode==='pms' ? 'PMS matches are nearest by Lab distance; please confirm on press.' : 'HEX listed for reference; switch code mode to PMS if needed.' }

Report (preview):
${preview}

Thanks!`
  );
  els.mailtoLink.href = `mailto:?subject=${subject}&body=${body}`;
}

// ----- saved palettes / prefs -----
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
    useHalftone: !!els.useHalftone?.checked,
    dotCell: parseInt(els.dotCell?.value||'6',10),
    dotBg: els.dotBg?.value||'#FFFFFF',
    dotJitter: !!els.dotJitter?.checked,
    codeMode: state.codeMode,
  };
  savePrefs(p);
}

function loadPrefsAndInitUI(){
  const prefs = loadPrefs() || {};
  if (prefs.lastPalette?.length) setPaletteFromHexes(prefs.lastPalette);
  if ('keepFullRes' in prefs && els.keepFullRes) els.keepFullRes.checked = !!prefs.keepFullRes;
  if ('sharpenEdges' in prefs && els.sharpenEdges) els.sharpenEdges.checked = !!prefs.sharpenEdges;
  if (prefs.maxW && els.maxW) els.maxW.value = prefs.maxW;
  if (prefs.wChroma && els.wChroma) els.wChroma.value = prefs.wChroma;
  if (prefs.wLight  && els.wLight)  els.wLight.value  = prefs.wLight;
  if (prefs.bgMode && els.bgMode) els.bgMode.value = prefs.bgMode;
  if ('useDither' in prefs && els.useDither) els.useDither.checked = !!prefs.useDither;
  if ('useHalftone' in prefs && els.useHalftone) els.useHalftone.checked = !!prefs.useHalftone;
  if (prefs.dotCell && els.dotCell) els.dotCell.value = prefs.dotCell;
  if (prefs.dotBg   && els.dotBg)   els.dotBg.value   = prefs.dotBg;
  if ('dotJitter' in prefs && els.dotJitter) els.dotJitter.checked = !!prefs.dotJitter;
  state.codeMode = (prefs.codeMode === 'hex' ? 'hex' : 'pms');
  if (els.colorCodeMode) els.colorCodeMode.value = state.codeMode;
  updateWeightLabels();
  renderCodeList();
  updateMailto();
}

// ----- projects -----
async function refreshProjectsList(){
  if (!els.projectsList) return;
  const arr = await dbGetAll();
  arr.sort((a,b)=>(b.updatedAt||b.createdAt)-(a.updatedAt||a.createdAt));
  els.projectsList.innerHTML='';
  arr.forEach(rec=>{
    const d=new Date(rec.updatedAt||rec.createdAt);
    const div=document.createElement('div'); div.className='item';
    div.innerHTML = `<div><strong>${rec.name||('Project '+rec.id)}</strong><br><small>${d.toLocaleString()}</small></div><div><button class="btn btn-ghost" data-id="${rec.id}" type="button">Load</button></div>`;
    on(div,'click',()=>{ state.selectedProjectId=rec.id; [...els.projectsList.children].forEach(ch=>ch.classList.remove('selected')); div.classList.add('selected'); });
    on(div.querySelector('button'),'click', async (e)=>{ e.stopPropagation(); await loadProject(rec.id); setPane(false); });
    els.projectsList.appendChild(div);
  });
}
function setPane(open){ if(!els.projectsPane) return; els.projectsPane.classList.toggle('open',open); els.projectsPane.setAttribute('aria-hidden',String(!open)); }

async function saveCurrentProject(){
  if(!state.fullBitmap){ alert('Load an image first.'); return; }
  const name=prompt('Project name?')||`Project ${Date.now()}`;

  // bake oriented full-res image
  const o=state.exifOrientation||1;
  const {w:ow,h:oh}=getOrientedDims(state.fullW,state.fullH,o, Math.max(state.fullW, state.fullH));
  const tmp=document.createElement('canvas'); tmp.width=ow; tmp.height=oh;
  const tc=tmp.getContext('2d'); tc.imageSmoothingEnabled=false;
  drawImageWithOrientation(tc, state.fullBitmap, o, ow, oh);

  const blob=await new Promise(res=>tmp.toBlob(res,'image/png',0.92));
  const rec={ id: state.selectedProjectId||undefined, name, createdAt:Date.now(), updatedAt:Date.now(), settings:getCurrentSettings(), imageBlob:blob };
  const id=await dbPutProject(rec); state.selectedProjectId=id; await refreshProjectsList(); toast('Saved.');
}
function getCurrentSettings(){
  return {
    palette: getPaletteHex(),
    restricted: [...state.restricted],
    rules: state.rules.map(r=>({enabled:r.enabled,targetHex:r.targetHex,pattern:r.pattern,inks:[...r.inks],density:r.density})),
    maxW: parseInt(els.maxW?.value||'1400',10),
    keepFullRes: !!els.keepFullRes?.checked,
    sharpenEdges: !!els.sharpenEdges?.checked,
    wChroma: parseInt(els.wChroma?.value||'100',10),
    wLight: parseInt(els.wLight?.value||'100',10),
    useDither: !!els.useDither?.checked,
    bgMode: els.bgMode?.value||'keep',
    useHalftone: !!els.useHalftone?.checked,
    dotCell: parseInt(els.dotCell?.value||'6',10),
    dotBg: els.dotBg?.value||'#FFFFFF',
    dotJitter: !!els.dotJitter?.checked,
    codeMode: state.codeMode,
    regions: state.regions.map(r=> r.type==='polygon' ? { type:'polygon', points:r.points, allowed:[...r.allowed] } : r)
  };
}
async function loadProject(id){
  const rec=await dbGet(id); if(!rec){ alert('Project not found.'); return; }
  const url=URL.createObjectURL(rec.imageBlob);
  const img=await loadIMG(url); URL.revokeObjectURL(url);
  state.fullBitmap=img; state.fullW=img.naturalWidth||img.width; state.fullH=img.naturalHeight||img.height; state.exifOrientation=1;
  drawPreviewFromState(); toggleImageActions(true); applySettings(rec.settings); state.selectedProjectId=id;
}
function applySettings(s){
  if(!s) return;
  if(s.palette) setPaletteFromHexes(s.palette);
  if(Array.isArray(s.restricted)){ state.restricted=new Set(s.restricted); renderRestrictedFromPalette(els, s.palette||getPaletteHex(), state.restricted); }
  if(Array.isArray(s.rules)){ state.rules = s.rules.map(r=>({enabled:!!r.enabled,targetHex:r.targetHex,pattern:r.pattern||'checker',inks:[...r.inks],density: clamp(r.density??0.5,0,1)})); renderRulesTable(); }
  if(s.maxW) els.maxW.value=s.maxW;
  if('keepFullRes' in s) els.keepFullRes.checked=!!s.keepFullRes;
  if('sharpenEdges' in s && els.sharpenEdges) els.sharpenEdges.checked=!!s.sharpenEdges;
  if(s.wChroma) els.wChroma.value=s.wChroma;
  if(s.wLight) els.wLight.value=s.wLight;
  if('useDither' in s) els.useDither.checked=!!s.useDither;
  if(s.bgMode) els.bgMode.value=s.bgMode;
  if('useHalftone' in s && els.useHalftone) els.useHalftone.checked=!!s.useHalftone;
  if(s.dotCell && els.dotCell) els.dotCell.value=s.dotCell;
  if(s.dotBg && els.dotBg) els.dotBg.value=s.dotBg;
  if('dotJitter' in s && els.dotJitter) els.dotJitter.checked=!!s.dotJitter;
  state.codeMode = (s.codeMode==='hex'?'hex':'pms');
  if(els.colorCodeMode) els.colorCodeMode.value=state.codeMode;

  // regions are optional (lasso)
  state.regions.length=0;
  // (If your EditorLasso can rebuild masks, call into it here.)

  updateWeightLabels();
  renderCodeList();
  updateMailto();
}

// ----- init / events -----
document.addEventListener('DOMContentLoaded', async () => {
  // load PMS db for codes (if module present)
  if (typeof loadPmsJson === 'function') {
    try{ await loadPmsJson('assets/pms_solid_coated.json'); }catch{}
  }

  loadPrefsAndInitUI();

  // wire file inputs
  on(els.fileInput,  'change', e => handleFile(e.target.files?.[0]));
  on(els.cameraInput,'change', e => handleFile(e.target.files?.[0]));

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
  on(els.autoExtract,'click', ()=>{
    if(!els.srcCanvas?.width){ toast('Load an image first.'); return; }
    const k = clamp(Number(els.kColors?.value || 10), 2, 16);
    const hexes = autoPaletteFromCanvasHybrid(els.srcCanvas, k);
    setPaletteFromHexes(hexes);
    toast(`Auto palette: ${hexes.length} colors`);
  });

  // restricted all/none
  on(els.restrictedSelectAll,'click', ()=>{ $$('input[type=checkbox]', els.restrictedList).forEach(c=>c.checked=true); renderCodeList(); updateMailto(); });
  on(els.restrictedSelectNone,'click', ()=>{ $$('input[type=checkbox]', els.restrictedList).forEach(c=>c.checked=false); renderCodeList(); updateMailto(); });
  on(els.restrictedList,'change', ()=>{ state.restricted = new Set(getRestrictedInkIndices()); renderCodeList(); updateMailto(); });

  // mapping weights
  on(els.wChroma,'input', ()=>{ updateWeightLabels(); persistPrefs(); });
  on(els.wLight, 'input', ()=>{ updateWeightLabels(); persistPrefs(); });

  // mapping
  on(els.applyBtn,'click', refreshOutput);
  on(els.bigRegen,'click', refreshOutput);

  // suggestions / rules
  on(els.btnSuggestHueLuma,'click', doSuggestHueLuma);
  on(els.btnSmartMix,'click', doSmartMix);
  on(els.addRule,'click', ()=>{
    const allow=getRestrictedInkIndices();
    if(allow.length<2){ toast("Select at least 2 inks."); return; }
    state.rules.push({enabled:true,targetHex:'#808080',pattern:'checker',inks:allow.slice(0,2),density:0.5});
    renderRulesTable();
  });
  on(els.btnRefreshOutput,'click', refreshOutput);

  // halftone preview is handled inside mapping UI in your earlier code;
  // if you have a halftone module, wire it similarly here.

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

  // report / codes
  on(els.colorCodeMode,'change', ()=>{
    state.codeMode = els.colorCodeMode.value === 'hex' ? 'hex' : 'pms';
    renderCodeList(); updateMailto(); persistPrefs();
  });
  on(els.exportReport,'click', ()=>{
    if (typeof buildPrinterReport !== 'function') return toast('Report module not available');
    const txt = buildPrinterReport(state, getRestrictedInkIndices());
    const blob = new Blob([txt],{type:'text/plain'});
    const a=document.createElement('a');
    a.download = state.codeMode==='pms'?'pms_report.txt':'hex_report.txt';
    a.href=URL.createObjectURL(blob); a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href),1500);
  });

  // projects drawer
  on(els.openProjects,'click', ()=>setPane(true));
  on(els.closeProjects,'click', ()=>setPane(false));
  on(els.refreshProjects,'click', refreshProjectsList);
  on(els.saveProject,'click', saveCurrentProject);
  on(els.exportProject,'click', async ()=>{
    const id=state.selectedProjectId; if(!id){ alert('Select a project first.'); return; }
    const rec=await dbGet(id); if(!rec){ alert('Project not found.'); return; }
    const b64 = (Files && typeof Files.blobToBase64 === 'function')
      ? await Files.blobToBase64(rec.imageBlob)
      : await new Promise(res=>{ const r=new FileReader(); r.onload=()=>res(r.result.split(',')[1]); r.readAsDataURL(rec.imageBlob); });
    const out={ name:rec.name, createdAt:rec.createdAt, updatedAt:rec.updatedAt, settings:rec.settings, imageBase64:b64 };
    const blob=new Blob([JSON.stringify(out)],{type:'application/json'});
    const a=document.createElement('a'); a.download=(rec.name||'project')+'.json'; a.href=URL.createObjectURL(blob); a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href),2000);
  });
  on(els.importProject,'change', async (e)=>{
    const f=e.target.files?.[0]; if(!f) return; const text=await f.text();
    try{
      const obj=JSON.parse(text);
      if(!obj.imageBase64 || !obj.settings){ alert('Invalid project file.'); return; }
      const blob = (Files && typeof Files.base64ToBlob === 'function')
        ? Files.base64ToBlob(obj.imageBase64)
        : new Blob([Uint8Array.from(atob(obj.imageBase64), c=>c.charCodeAt(0))], {type:'image/png'});
      const rec={ name:obj.name||`Imported ${Date.now()}`, createdAt:obj.createdAt||Date.now(), updatedAt:Date.now(), settings:obj.settings, imageBlob:blob };
      const id=await dbPutProject(rec); await refreshProjectsList(); await loadProject(id); setPane(false); toast('Imported.');
    }catch{ alert('Invalid JSON.'); } finally { e.target.value=''; }
  });
  on(els.deleteProject,'click', async ()=>{
    const id=state.selectedProjectId; if(!id){ alert('Select a project then Delete.'); return; }
    if(!confirm('Delete selected project?')) return; await dbDelete(id); state.selectedProjectId=null; await refreshProjectsList();
  });

  // editor overlay (feature-detected; requires modules)
  if (EditorFull && typeof EditorFull.openEditor === 'function') {
    on(els.openEditor,'click', ()=>{
      EditorFull.openEditor({
        els,
        getPaletteHex,
        onPickHex: (hex)=>{ const c=hexToRgb(hex); state.palette.push({r:c.r,g:c.g,b:c.b,tol:64}); renderRestrictedFromPalette(els, getPaletteHex(), new Set(getPaletteHex().map((_,i)=>i))); renderCodeList(); updateMailto(); },
        onSaveRegion: (region)=>{ state.regions.push(region); toast('Region saved.'); },
        onClose: ()=>{/* noop */}
      });
    });
    on(els.editorDone,'click', ()=> EditorFull.closeEditor?.());
  } else {
    // If editor module not present, keep the button disabled until an image is loaded (toggleImageActions handles this)
  }

  // initial projects list
  refreshProjectsList();

  // friendly hints
  setTimeout(()=>toast('Tip: Auto-extract a palette, then select inks in “Restricted Palette”.'), 600);
  setTimeout(()=>toast('Use “Suggest by Hue & Luma” or Smart Mix, then Apply mapping.'), 2200);
});
