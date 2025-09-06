// js/app.js — flow-first orchestrator (ES module)
// 1) Load photo → 2) Working Palette (auto) → 3) Restricted Palette (final inks)
// 4) Mixing & Replacements (then Advanced mapping settings + Apply) → 5) Mapped Preview → 6) Export

/* --------------------- Imports --------------------- */
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
import { loadPmsJson, nearestPms, buildPrinterReport } from './export/report.js';

import {
  loadSavedPalettes, saveSavedPalettes,
  loadPrefs, savePrefs,
  dbPutProject, dbGetAll, dbGet, dbDelete
} from './io/storage.js';
import * as Files from './io/files.js';

import { renderRestrictedFromPalette, getRestrictedInkIndices } from './ui/controls.js';

import * as Patterns from './color/patterns.js';
import { smartMixSuggest, suggestByHueLuma } from './color/suggest.js';

// (optional) editor modules are feature-detected later
import * as EditorFull from './editor/fullscreen.js';

/* --------------------- DOM helpers --------------------- */
const $  = (s, r=document)=>r.querySelector(s);
const $$ = (s, r=document)=>[...r.querySelectorAll(s)];
const on = (el, ev, fn, opts)=> el && el.addEventListener(ev, fn, opts);

/* --------------------- Elements --------------------- */
const els = {
  // load
  fileInput: $('#fileInput'),
  cameraInput: $('#cameraInput'),
  pasteBtn: $('#pasteBtn'),
  resetBtn: $('#resetBtn'),
  maxW: $('#maxW'),
  keepFullRes: $('#keepFullRes'),
  sharpenEdges: $('#sharpenEdges'),
  srcCanvas: $('#srcCanvas'),
  outCanvas: $('#outCanvas'),

  // working palette
  kColors: $('#kColors'),
  autoExtract: $('#autoExtract'),
  workingList: $('#workingList'),

  // restricted palette
  restrictedList: $('#restrictedList'),
  restrictedSelectAll: $('#restrictedSelectAll'),
  restrictedSelectNone: $('#restrictedSelectNone'),
  restrictedSaveSet: $('#restrictedSaveSet'),
  restrictedLoadSet: $('#restrictedLoadSet'),
  missingMixes: $('#missingMixes'),
  allowWhite: $('#allowWhite'), // present in some builds; optional

  // mixing / rules
  btnSuggestHueLuma: $('#btnSuggestHueLuma'),
  btnSmartMix: $('#btnSmartMix'),
  addRule: $('#addRule'),
  rulesTable: $('#rulesTable'),
  // advanced mapping (inside details)
  wChroma: $('#wChroma'),
  wLight: $('#wLight'),
  wChromaOut: $('#wChromaOut'),
  wLightOut: $('#wLightOut'),
  useDither: $('#useDither'),
  bgMode: $('#bgMode'),

  applyBtn: $('#applyBtn'),
  btnRefreshOutput: $('#btnRefreshOutput'),

  // export
  exportScale: $('#exportScale'),
  downloadBtn: $('#downloadBtn'),
  vectorExport: $('#vectorExport'),
  colorCodeMode: $('#colorCodeMode'),
  mailtoLink: $('#mailtoLink'),
  exportReport: $('#exportReport'),
  codeList: $('#codeList'),

  // projects
  openProjects: $('#openProjects'),
  closeProjects: $('#closeProjects'),
  projectsPane: $('#projectsPane'),
  saveProject: $('#saveProject'),
  refreshProjects: $('#refreshProjects'),
  exportProject: $('#exportProject'),
  importProject: $('#importProject'),
  deleteProject: $('#deleteProject'),
  projectsList: $('#projectsList'),

  // editor overlay
  openEditor: $('#openEditor'),
  editorOverlay: $('#editorOverlay'),
  editCanvas: $('#editCanvas'),
  editOverlay: $('#editOverlay'),
  editorDone: $('#editorDone'),
};

/* --------------------- Canvas contexts --------------------- */
const sctx = els.srcCanvas?.getContext('2d', { willReadFrequently:true });
const octx = els.outCanvas?.getContext('2d', { willReadFrequently:true });
if (sctx) sctx.imageSmoothingEnabled = false;
if (octx) octx.imageSmoothingEnabled = false;

/* --------------------- State --------------------- */
const state = {
  // image
  fullBitmap: null, fullW: 0, fullH: 0, exifOrientation: 1,

  // palettes
  palette: [],           // [{r,g,b,tol}]
  restricted: new Set(), // indices

  // rules
  rules: [],             // [{enabled,targetHex,pattern,inks,density}]

  // lasso regions (optional editor)
  regions: [],

  // code/report
  codeMode: 'pms',

  // selection
  selectedProjectId: null,

  // result cache
  outFullImageData: null,
};

/* --------------------- LocalStorage keys --------------------- */
const LS_KEYS = { RPSETS: 'pm_restricted_sets_v1' };

/* --------------------- Utilities --------------------- */
function getPaletteHex(){ return state.palette.map(p => rgbToHex(p.r,p.g,p.b)); }
function setPaletteFromHexes(hexes=[], tol=64){
  state.palette = hexes.map(h=>{ const c=hexToRgb(h)||{r:255,g:255,b:255}; return { r:c.r, g:c.g, b:c.b, tol }; });
  // Render Restricted chips (default all selected on first set; keep previous selection on re-extract)
  if (state.restricted.size === 0) { state.restricted = new Set(hexes.map((_,i)=>i)); }
  renderRestrictedFromPalette(els, hexes, state.restricted);
  renderWorkingPalette(hexes);
  renderCodeList();
  updateMailto();
  gateApplyButton();
  persistPrefs();
}
function updateWeightLabels(){
  if (els.wChromaOut) els.wChromaOut.textContent = (Number(els.wChroma?.value||100)/100).toFixed(2)+'×';
  if (els.wLightOut)  els.wLightOut.textContent  = (Number(els.wLight?.value ||100)/100).toFixed(2)+'×';
}
function toggleImageActions(enable){
  [els.autoExtract, els.resetBtn, els.openEditor].forEach(b => { if (b) b.disabled = !enable; });
}
function scrollInto(el){ el?.scrollIntoView({ behavior:'smooth', block:'start' }); }

/* --------------------- HEIC-safe image load --------------------- */
async function handleFile(file){
  try{
    if(!file) return;

    // A) Fast path
    if (typeof createImageBitmap === 'function') {
      try{
        const bmp = await createImageBitmap(file, { imageOrientation:'from-image', colorSpaceConversion:'default' });
        state.fullBitmap=bmp; state.fullW=bmp.width; state.fullH=bmp.height; state.exifOrientation=1;
        drawPreviewFromState();
        toggleImageActions(true);
        return;
      }catch{}
    }
    // B) WebCodecs for HEIC
    if (isHeicFile(file) && 'ImageDecoder' in window) {
      try{
        const bmp = await decodeHeicWithWebCodecs(file);
        state.fullBitmap=bmp; state.fullW=bmp.width; state.fullH=bmp.height; state.exifOrientation=1;
        drawPreviewFromState();
        toggleImageActions(true);
        return;
      }catch{}
    }
    // C) <img> fallback (Safari HEIC + all JPEG/PNG)
    const url = objectUrlFor(file);
    try{
      const img = await loadIMG(url);
      state.fullBitmap=img;
      state.fullW = img.naturalWidth || img.width;
      state.fullH = img.naturalHeight || img.height;
      state.exifOrientation = isLikelyJpeg(file) ? (await readJpegOrientation(file)) : 1;
      drawPreviewFromState();
      toggleImageActions(true);
    }catch(err){
      if (isHeicFile(file)) heicHelp(); else toast('Could not open that image. Try a JPG/PNG.');
    }finally{ revokeUrl(url); }
  }catch(err){
    toast(`Load error: ${err?.message||err}`);
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

  // reset output canvas
  els.outCanvas.width = w; els.outCanvas.height = h;
  octx.clearRect(0,0,w,h);
  state.outFullImageData = null;
  if (els.downloadBtn) els.downloadBtn.disabled = true;
  if (els.vectorExport) els.vectorExport.disabled = true;

  // Auto-extract working palette
  const k = clamp(Number(els.kColors?.value || 10), 2, 16);
  const hexes = autoPaletteFromCanvasHybrid(els.srcCanvas, k);
  setPaletteFromHexes(hexes);
  updateMissingMixesBadge();
  gateApplyButton();

  // Scroll to step 2 on mobile
  scrollInto(document.querySelector('[data-step="working"]'));
}

/* --------------------- Working palette UI --------------------- */
function renderWorkingPalette(hexes){
  if (!els.workingList) return;
  if (!hexes?.length) { els.workingList.innerHTML = '<em>No colors</em>'; return; }
  els.workingList.innerHTML = `
    <div class="inline-swatches" style="display:flex;flex-wrap:wrap;gap:8px">
      ${hexes.map(h=>`<span class="sw" title="${h}" style="width:22px;height:22px;border-radius:5px;border:1px solid var(--sw-outline);background:${h}"></span>`).join('')}
    </div>
    <div class="help" style="margin-top:8px">${hexes.length} colors detected</div>
  `;
}

/* --------------------- Missing mixes badge --------------------- */
function computeMissingMixes(){
  const allowed = new Set(getRestrictedInkIndices(els));
  const missing = [];
  getPaletteHex().forEach((hx, idx)=>{
    if (!allowed.has(idx)) missing.push({ hex:hx, idx });
  });
  return missing;
}
function updateMissingMixesBadge(){
  if (!els.missingMixes) return;
  const n = computeMissingMixes().length;
  els.missingMixes.textContent = n ? `Missing mixes: ${n}` : 'All colors covered ✓';
}

/* --------------------- Rules table --------------------- */
function renderRulesTable(){
  const table = els.rulesTable;
  if (!table) return;
  const tbody = table.tBodies?.[0] || table;
  tbody.innerHTML='';

  const palHex = getPaletteHex();
  state.rules.forEach((r, idx)=>{
    const tr=document.createElement('tr');
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

    const onChk = tr.querySelector('.r-on');
    const tHex  = tr.querySelector('.r-target');
    const pat   = tr.querySelector('.r-pattern');
    const dens  = tr.querySelector('.r-density');
    const dval  = tr.querySelector('.r-dv');
    const del   = tr.querySelector('.r-del');
    const edit  = tr.querySelector('.r-edit-inks');

    on(onChk,'change',()=>{ r.enabled=onChk.checked; });
    on(tHex,'change',()=>{ let v=tHex.value.trim(); if(!v.startsWith('#')) v='#'+v; r.targetHex=v.toUpperCase(); });
    on(pat,'change',()=>{ r.pattern=pat.value; });
    on(dens,'input',()=>{ r.density=clamp(dens.value/100,0,1); dval.textContent=`${Math.round(r.density*100)}%`; });
    on(del,'click',()=>{ state.rules.splice(idx,1); renderRulesTable(); });
    on(edit,'click',()=>{
      const allow = new Set(getRestrictedInkIndices(els));
      if(allow.size<2) return toast('Select at least 2 inks in Restricted Palette.');
      const pick = prompt(`Enter comma separated indices of inks to use (Restricted only):\nAllowed: ${[...allow].join(', ')}`, r.inks.join(','));
      if(!pick) return;
      const arr=pick.split(',').map(s=>parseInt(s.trim(),10)).filter(n=>Number.isFinite(n)&&allow.has(n));
      if(arr.length>=2){ r.inks=arr; renderRulesTable(); } else { toast('Need 2+ inks.'); }
    });

    tbody.appendChild(tr);
  });
}

/* --------------------- Mapping --------------------- */
function applyTextureRulesIfAny(mapped, wL=1, wC=1){
  if (!Patterns || typeof Patterns.applyRules !== 'function') return mapped;
  const enabled = state.rules.filter(r=>r.enabled && (r.inks?.length>=2));
  if (!enabled.length) return mapped;
  try{
    return Patterns.applyRules(mapped, enabled, getPaletteHex(), { wL, wC, palette: state.palette });
  }catch(e){
    console.warn('applyRules failed', e); return mapped;
  }
}

function refreshOutput(){
  if (!els.srcCanvas?.width) return toast('Load an image first.');
  if (!state.palette.length)  return toast('Build a palette first.');

  const wL = Number(els.wLight?.value || 100)/100;
  const wC = Number(els.wChroma?.value || 100)/100;
  const dither = !!els.useDither?.checked;
  const bgMode = els.bgMode?.value || 'keep';
  const restricted = getRestrictedInkIndices(els);

  const srcData = sctx.getImageData(0,0,els.srcCanvas.width, els.srcCanvas.height);
  let mapped = mapToPalette(srcData, state.palette, {
    wL, wC, dither, bgMode,
    allowWhite: !!els.allowWhite?.checked,
    srcCanvasW: els.srcCanvas.width,
    srcCanvasH: els.srcCanvas.height,
    regions: state.regions,
    restricted
  });

  mapped = applyTextureRulesIfAny(mapped, wL, wC);
  if (els.sharpenEdges?.checked) mapped = unsharpMask(mapped, 0.35);

  els.outCanvas.width = mapped.width;
  els.outCanvas.height = mapped.height;
  octx.putImageData(mapped, 0, 0);
  state.outFullImageData = mapped;

  if (els.downloadBtn) els.downloadBtn.disabled = false;
  if (els.vectorExport) els.vectorExport.disabled = !(window.ImageTracer);

  // Smooth scroll to Mapped preview for quick iteration
  scrollInto(document.querySelector('[data-step="mapped"]'));
}

/* --------------------- Suggestions --------------------- */
function doSuggestHueLuma(){
  const allowed = getRestrictedInkIndices(els);
  if (allowed.length < 2) return toast('Select at least 2 inks in Restricted Palette.');
  if (!els.srcCanvas?.width) return toast('Load an image first.');

  if (typeof suggestByHueLuma !== 'function') return toast('Suggestion module not available.');
  const proposals = suggestByHueLuma(els.srcCanvas, state.palette, allowed);
  const keep = state.rules.filter(r => !proposals.find(p => (p.targetHex||'').toUpperCase()=== (r.targetHex||'').toUpperCase()));
  state.rules = keep.concat(proposals);
  renderRulesTable();
  toast('Suggestions added. Apply mapping to see changes.');
  scrollInto(document.querySelector('[data-step="mixing"]'));
}
function doSmartMix(){
  const allowed = getRestrictedInkIndices(els);
  if (allowed.length < 2) return toast('Select at least 2 inks in Restricted Palette.');
  const target = prompt("Enter target HEX to approximate (e.g. #2A8F3C):", "#2A8F3C");
  if (!target || !/^#([0-9a-f]{6})$/i.test(target)) return toast("Enter a valid hex like #22AA66");

  const best = (typeof smartMixSuggest === 'function')
    ? smartMixSuggest(target.toUpperCase(), allowed, state.palette)
    : null;
  if (!best) return toast('No mix found.');

  state.rules.push({ enabled:true, targetHex:target.toUpperCase(), pattern:best.pattern||'checker', inks:best.inks, density:best.density ?? 0.5 });
  renderRulesTable();
  toast('Smart mix suggestion added. Apply mapping to see changes.');
}

/* --------------------- Codes & Report --------------------- */
function renderCodeList(){
  if (!els.codeList) return;
  const indices = getRestrictedInkIndices(els);
  const hexes = indices.map(i => rgbToHex(state.palette[i]?.r||0, state.palette[i]?.g||0, state.palette[i]?.b||0));
  if (!hexes.length) { els.codeList.innerHTML = '<em>No final inks selected</em>'; return; }

  const mode = state.codeMode;
  const items = hexes.map((hex,i)=>{
    if (mode === 'hex' || !nearestPms) return { label:`${hex}`, swatchHex: hex };
    const p = nearestPms(hex);
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
  const preview = (typeof buildPrinterReport === 'function') ? buildPrinterReport(state, getRestrictedInkIndices(els)) : getPaletteHex().join(', ');
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

/* --------------------- Restricted sets (save/load) --------------------- */
function loadRestrictedSets(){ try { return JSON.parse(localStorage.getItem(LS_KEYS.RPSETS) || '[]'); } catch { return []; } }
function saveRestrictedSets(arr){ localStorage.setItem(LS_KEYS.RPSETS, JSON.stringify(arr.slice(0,100))); }

/* --------------------- Prefs / init UI --------------------- */
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
  if ('keepFullRes' in prefs && els.keepFullRes) els.keepFullRes.checked = !!prefs.keepFullRes;
  if ('sharpenEdges' in prefs && els.sharpenEdges) els.sharpenEdges.checked = !!prefs.sharpenEdges;
  if (prefs.maxW && els.maxW) els.maxW.value = prefs.maxW;
  if (prefs.wChroma && els.wChroma) els.wChroma.value = prefs.wChroma;
  if (prefs.wLight  && els.wLight)  els.wLight.value  = prefs.wLight;
  if (prefs.bgMode && els.bgMode) els.bgMode.value = prefs.bgMode;
  state.codeMode = (prefs.codeMode === 'hex' ? 'hex' : 'pms');
  if (els.colorCodeMode) els.colorCodeMode.value = state.codeMode;
  updateWeightLabels();
  renderCodeList();
  updateMailto();
}

/* --------------------- Project storage --------------------- */
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
  if(Array.isArray(s.restricted)){ state.restricted=new Set(s.restricted); renderRestrictedFromPalette(els, getPaletteHex(), state.restricted); }
  if(Array.isArray(s.rules)){ state.rules = s.rules.map(r=>({enabled:!!r.enabled,targetHex:r.targetHex,pattern:r.pattern||'checker',inks:[...r.inks],density: clamp(r.density??0.5,0,1)})); renderRulesTable(); }
  if(s.maxW) els.maxW.value=s.maxW;
  if('keepFullRes' in s) els.keepFullRes.checked=!!s.keepFullRes;
  if('sharpenEdges' in s && els.sharpenEdges) els.sharpenEdges.checked=!!s.sharpenEdges;
  if(s.wChroma) els.wChroma.value=s.wChroma;
  if(s.wLight) els.wLight.value=s.wLight;
  if('useDither' in s) els.useDither.checked=!!s.useDither;
  if(s.bgMode) els.bgMode.value=s.bgMode;
  state.codeMode = (s.codeMode==='hex'?'hex':'pms');
  if(els.colorCodeMode) els.colorCodeMode.value=state.codeMode;
  updateWeightLabels(); renderCodeList(); updateMailto();
}

/* --------------------- Gate primary CTA --------------------- */
function gateApplyButton(){
  const ok = !!els.srcCanvas?.width && getRestrictedInkIndices(els).length > 0;
  if (els.applyBtn) els.applyBtn.disabled = !ok;
}

/* --------------------- Init --------------------- */
document.addEventListener('DOMContentLoaded', async () => {
  // Load PMS db (for codes)
  try { await loadPmsJson('assets/pms_solid_coated.json'); } catch {}

  loadPrefsAndInitUI();

  // File inputs
  on(els.fileInput,  'change', e => handleFile(e.target.files?.[0]));
  on(els.cameraInput,'change', e => handleFile(e.target.files?.[0]));

  // Paste
  on(els.pasteBtn,'click', async ()=>{
    if(!navigator.clipboard?.read) return toast('Clipboard not available');
    try{
      const items = await navigator.clipboard.read();
      for (const it of items) for (const type of it.types) if (type.startsWith('image/')) {
        const blob = await it.getType(type);
        const file = new File([blob], `pasted.${type.split('/')[1]}`, { type });
        return handleFile(file);
      }
      toast('No image in clipboard');
    }catch{ toast('Clipboard read failed'); }
  });

  // Drag & drop
  const prevent = e => { e.preventDefault(); e.stopPropagation(); };
  ['dragenter','dragover','dragleave','drop'].forEach(ev => window.addEventListener(ev, prevent, { passive:false }));
  window.addEventListener('drop', e => { const f = e.dataTransfer?.files?.[0]; if (f) handleFile(f); }, { passive:false });

  // Reset
  on(els.resetBtn,'click', ()=> state.fullBitmap && drawPreviewFromState());

  // Auto-extract (re-extract)
  on(els.autoExtract,'click', ()=>{
    if(!els.srcCanvas?.width) return toast('Load an image first.');
    const k = clamp(Number(els.kColors?.value || 10), 2, 16);
    const hexes = autoPaletteFromCanvasHybrid(els.srcCanvas, k);
    setPaletteFromHexes(hexes);
    updateMissingMixesBadge();
    gateApplyButton();
    toast(`Working palette updated: ${hexes.length} colors`);
    scrollInto(document.querySelector('[data-step="restricted"]'));
  });

  // Restricted palette interactions
  on(els.restrictedSelectAll,'click', ()=>{
    $$('input[type=checkbox]', els.restrictedList).forEach(c=>c.checked=true);
    state.restricted = new Set(getRestrictedInkIndices(els));
    renderCodeList(); updateMailto(); updateMissingMixesBadge(); gateApplyButton();
  });
  on(els.restrictedSelectNone,'click', ()=>{
    $$('input[type=checkbox]', els.restrictedList).forEach(c=>c.checked=false);
    state.restricted = new Set(getRestrictedInkIndices(els));
    renderCodeList(); updateMailto(); updateMissingMixesBadge(); gateApplyButton();
  });
  on(els.restrictedList,'change', ()=>{
    state.restricted = new Set(getRestrictedInkIndices(els));
    renderCodeList(); updateMailto(); updateMissingMixesBadge(); gateApplyButton();
  });

  // Save/Load restricted sets
  on(els.restrictedSaveSet,'click', ()=>{
    const name = prompt('Save Restricted set as…') || `Inks ${new Date().toLocaleString()}`;
    const set = [...getRestrictedInkIndices(els)];
    if (!set.length) return toast('Select at least 1 ink');
    const all = loadRestrictedSets(); all.unshift({ name, set, palette:getPaletteHex() });
    saveRestrictedSets(all); toast('Restricted set saved');
  });
  on(els.restrictedLoadSet,'click', ()=>{
    const all = loadRestrictedSets();
    if (!all.length) return toast('No saved sets yet');
    const pick = prompt(`Enter index to load:\n${all.map((s,i)=>`${i+1}. ${s.name}`).join('\n')}`);
    const idx = (parseInt(pick,10)-1)|0;
    const rec = all[idx]; if (!rec) return;
    const max = state.palette.length;
    state.restricted = new Set(rec.set.filter(n => n>=0 && n<max));
    renderRestrictedFromPalette(els, getPaletteHex(), state.restricted);
    renderCodeList(); updateMailto(); updateMissingMixesBadge(); gateApplyButton();
    toast(`Loaded: ${rec.name}`);
  });

  // Advanced mapping sliders
  on(els.wChroma,'input', ()=>{ updateWeightLabels(); persistPrefs(); });
  on(els.wLight, 'input', ()=>{ updateWeightLabels(); persistPrefs(); });

  // Mixing helpers
  on(els.btnSuggestHueLuma,'click', doSuggestHueLuma);
  on(els.btnSmartMix,    'click', doSmartMix);
  on(els.addRule,'click', ()=>{
    const allow = getRestrictedInkIndices(els);
    if (allow.length < 2) return toast('Select at least 2 inks.');
    state.rules.push({ enabled:true, targetHex:'#808080', pattern:'checker', inks:allow.slice(0,2), density:0.5 });
    renderRulesTable();
  });

  // Apply / Remap
  on(els.applyBtn,       'click', refreshOutput);
  on(els.btnRefreshOutput,'click', refreshOutput);

  // Export
  on(els.downloadBtn,'click', ()=>{
    if(!state.outFullImageData) return toast('Apply mapping first');
    const scale = clamp(parseInt(els.exportScale?.value||'1',10),1,4);
    exportPNG(state.outFullImageData, scale);
  });
  on(els.vectorExport,'click', ()=>{
    if(!state.outFullImageData) return toast('Apply mapping first');
    const r=getRestrictedInkIndices(els);
    exportSVG(state.outFullImageData, getPaletteHex(), r.length || state.palette.length);
  });
  on(els.colorCodeMode,'change', ()=>{
    state.codeMode = els.colorCodeMode.value === 'hex' ? 'hex' : 'pms';
    renderCodeList(); updateMailto(); persistPrefs();
  });
  on(els.exportReport,'click', ()=>{
    if (typeof buildPrinterReport !== 'function') return toast('Report module not available');
    const txt = buildPrinterReport(state, getRestrictedInkIndices(els));
    const blob = new Blob([txt],{type:'text/plain'});
    const a=document.createElement('a');
    a.download = state.codeMode==='pms'?'pms_report.txt':'hex_report.txt';
    a.href=URL.createObjectURL(blob); a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href),1500);
  });

  // Projects
  on(els.openProjects,'click', ()=>setPane(true));
  on(els.closeProjects,'click', ()=>setPane(false));
  on(els.refreshProjects,'click', refreshProjectsList);
  on(els.saveProject,'click', saveCurrentProject);
  on(els.exportProject,'click', async ()=>{
    const id=state.selectedProjectId; if(!id) return alert('Select a project first.');
    const rec=await dbGet(id); if(!rec) return alert('Project not found.');
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
      if(!obj.imageBase64 || !obj.settings) return alert('Invalid project file.');
      const blob = (Files && typeof Files.base64ToBlob === 'function')
        ? Files.base64ToBlob(obj.imageBase64)
        : new Blob([Uint8Array.from(atob(obj.imageBase64), c=>c.charCodeAt(0))], {type:'image/png'});
      const rec={ name:obj.name||`Imported ${Date.now()}`, createdAt:obj.createdAt||Date.now(), updatedAt:Date.now(), settings:obj.settings, imageBlob:blob };
      const id=await dbPutProject(rec); await refreshProjectsList(); await loadProject(id); setPane(false); toast('Imported.');
    }catch{ alert('Invalid JSON.'); } finally { e.target.value=''; }
  });
  on(els.deleteProject,'click', async ()=>{
    const id=state.selectedProjectId; if(!id) return alert('Select a project then Delete.');
    if(!confirm('Delete selected project?')) return;
    await dbDelete(id); state.selectedProjectId=null; await refreshProjectsList();
  });

  // Editor (optional)
  if (EditorFull && typeof EditorFull.openEditor === 'function') {
    on(els.openEditor,'click', ()=>{
      EditorFull.openEditor({
        els,
        getPaletteHex,
        onPickHex: (hex)=>{
          const c=hexToRgb(hex); state.palette.push({r:c.r,g:c.g,b:c.b,tol:64});
          renderRestrictedFromPalette(els, getPaletteHex(), new Set(getPaletteHex().map((_,i)=>i)));
          renderWorkingPalette(getPaletteHex());
          renderCodeList(); updateMailto(); gateApplyButton();
        },
        onSaveRegion: (region)=>{ state.regions.push(region); toast('Region saved.'); },
        onClose: ()=>{}
      });
    });
    on(els.editorDone,'click', ()=> EditorFull.closeEditor?.());
  }

  // Initial
  refreshProjectsList();
  updateWeightLabels();
  toast('Tip: Load a photo — we auto-detect a working palette.');
  setTimeout(()=>toast('Pick your FINAL inks, add mixes (or Suggest), then Apply mapping.'), 1200);
});
