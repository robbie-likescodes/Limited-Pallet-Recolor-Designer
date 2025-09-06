// js/app.js (ESM orchestrator)
// -------------------------------------------------------------
// Wires the UI to modular logic. Keep this file lean.
// -------------------------------------------------------------

/* -------------------- Imports (modules you added) -------------------- */
import { toast } from './ui/toasts.js';

import { clamp, getOrientedDims, drawImageWithOrientation } from './utils/canvas.js';
import {
  isHeicFile, isLikelyJpeg, heicHelp,
  objectUrlFor, revokeUrl, loadIMG, readJpegOrientation
} from './utils/image.js';

import { hexToRgb, rgbToHex, rgbToLab, deltaE2Weighted } from './color/space.js';
import { autoPaletteFromCanvasHybrid } from './color/palette.js';
import { smartMixSuggest } from './color/suggest.js';

import { mapToPalette } from './mapping/mapper.js';
import { unsharpMask } from './mapping/sharpen.js';

import { exportPNG } from './export/png.js';
import { exportSVG } from './export/svg.js';

import {
  loadSavedPalettes, saveSavedPalettes, loadPrefs, savePrefs,
  dbPutProject, dbGetAll, dbGet, dbDelete
} from './io/storage.js';

/* -------------------- DOM mini-helpers -------------------- */
const $  = (sel, r=document) => r.querySelector(sel);
const $$ = (sel, r=document) => [...r.querySelectorAll(sel)];
const on = (el, ev, fn, opts) => el && el.addEventListener(ev, fn, opts);
const need = (el, id) => { if(!el) { toast(`Missing #${id} in HTML`); } return el; };

/* -------------------- Element refs -------------------- */
const els = {
  // canvases
  srcCanvas: need($("#srcCanvas"), "srcCanvas"),
  outCanvas: need($("#outCanvas"), "outCanvas"),
  // inputs
  fileInput: $("#fileInput"),
  cameraInput: $("#cameraInput"),
  pasteBtn: $("#pasteBtn"),
  resetBtn: $("#resetBtn"),
  maxW: $("#maxW"),
  keepFullRes: $("#keepFullRes"),
  sharpenEdges: $("#sharpenEdges"),
  // palette
  paletteList: $("#paletteList"),
  addColor: $("#addColor"),
  clearColors: $("#clearColors"),
  loadExample: $("#loadExample"),
  savePalette: $("#savePalette"),
  clearSavedPalettes: $("#clearSavedPalettes"),
  savedPalettes: $("#savedPalettes"),
  kColors: $("#kColors"),
  autoExtract: $("#autoExtract"),
  // mapping
  wChroma: $("#wChroma"),
  wLight: $("#wLight"),
  wChromaOut: $("#wChromaOut"),
  wLightOut: $("#wLightOut"),
  useDither: $("#useDither"),
  bgMode: $("#bgMode"),
  allowWhite: $("#allowWhite"),
  applyBtn: $("#applyBtn"),
  bigRegenBtn: $("#bigRegen"),
  // export
  exportScale: $("#exportScale"),
  downloadBtn: $("#downloadBtn"),
  vectorExportBtn: $("#vectorExport"),
  // restricted palette
  restrictedList: $("#restrictedList"),
  restrictedSelectAll: $("#restrictedSelectAll"),
  restrictedSelectNone: $("#restrictedSelectNone"),
  // suggestions + rules
  suggestHueLumaBtn: $("#btnSuggestHueLuma"),
  smartMixOpen: $("#btnSmartMix"),
  addRuleBtn: $("#addRule"),
  refreshOutputBtn: $("#btnRefreshOutput"),
  rulesTable: $("#rulesTable"),
  // halftone
  useHalftone: $("#useHalftone"),
  dotCell: $("#dotCell"),
  dotBg: $("#dotBg"),
  dotJitter: $("#dotJitter"),
  // codes/report
  colorCodeMode: $("#colorCodeMode"),
  codeList: $("#codeList"),
  exportReport: $("#exportReport"),
  mailtoLink: $("#mailtoLink"),
  // projects
  openProjects: $("#openProjects"),
  closeProjects: $("#closeProjects"),
  projectsPane: $("#projectsPane"),
  saveProject: $("#saveProject"),
  refreshProjects: $("#refreshProjects"),
  exportProject: $("#exportProject"),
  importProject: $("#importProject"),
  deleteProject: $("#deleteProject"),
  projectsList: $("#projectsList"),
  // editor
  openEditor: $("#openEditor"),
  editorOverlay: $("#editorOverlay"),
  editCanvas: $("#editCanvas"),
  editOverlay: $("#editOverlay"),
  editorDone: $("#editorDone"),
  toolEyedrop: $("#toolEyedrop"),
  toolLasso: $("#toolLasso"),
  toolPan: $("#toolPan"),
  editorPalette: $("#editorPalette"),
  lassoChecks: $("#lassoChecks"),
  lassoSave: $("#lassoSave"),
  lassoClear: $("#lassoClear"),
  eyeSwatch: $("#eyeSwatch"),
  eyeHex: $("#eyeHex"),
  eyeAdd: $("#eyeAdd"),
  eyeCancel: $("#eyeCancel"),
};

const sctx = els.srcCanvas?.getContext('2d', { willReadFrequently:true });
const octx = els.outCanvas?.getContext('2d', { willReadFrequently:true });
if (sctx) sctx.imageSmoothingEnabled = false;
if (octx) octx.imageSmoothingEnabled = false;

/* -------------------- App state -------------------- */
const state = {
  // image
  fullBitmap: null,
  fullW: 0, fullH: 0,
  exifOrientation: 1,

  // palette & restrictions
  palette: [],              // [[r,g,b,tol], ...]
  restricted: new Set(),    // indices selected

  // rules
  rules: [],                // {enabled, targetHex, pattern, inks[], density}

  // lasso regions
  regions: [],              // {type:'polygon', points, mask:Uint8Array, allowed:Set}

  // cached outputs
  outFullImageData: null,

  // prefs
  codeMode: 'pms',

  // projects
  selectedProjectId: null,
};

// PMS lib
let PMS_LIB = [];
const PMS_CACHE = new Map();

/* -------------------- Small utils -------------------- */
const fmtMult = n => (Number(n)/100).toFixed(2)+'×';
const buildPaletteLabWithTol = () => state.palette.map(([r,g,b,tol]) => ({ rgb:[r,g,b], lab:rgbToLab(r,g,b), tol }));

/* -------------------- HEIF robust decoder (WebCodecs path) -------------------- */
const hasWebCodecs = typeof window.ImageDecoder === 'function';

function heifTypeCandidates(file){
  const t = (file?.type || '').toLowerCase();
  const base = t && t.startsWith('image/') ? t : null;
  const list = [];
  if (base) list.push(base);
  list.push('image/heic','image/heif','image/heif-sequence','image/heif; codecs=hevc','image/heic-sequence');
  return [...new Set(list)];
}
async function decodeHeicWithWebCodecs(file){
  if (!hasWebCodecs) throw new Error('WebCodecs not available');
  const data = await file.arrayBuffer();
  const blob = new Blob([data], { type: file.type || 'image/heif' });
  let lastErr = null;
  for (const type of heifTypeCandidates(file)){
    try{
      if (typeof ImageDecoder.isTypeSupported === 'function'){
        const ok = await ImageDecoder.isTypeSupported(type);
        if (!ok) continue;
      }
      const decoder = new ImageDecoder({ data: blob, type });
      await decoder.tracks.ready;
      const { image } = await decoder.decode();
      const bmp = await createImageBitmap(image);
      image.close?.(); decoder.close?.();
      return bmp;
    }catch(e){ lastErr = e; }
  }
  throw lastErr || new Error('No supported HEIF/HEIC decoder types');
}

/* -------------------- Palette UI -------------------- */
function addPaletteRow(hex='#FFFFFF', tol=64){
  if(!els.paletteList) return;
  const row=document.createElement('div');
  row.className='palette-item';
  row.innerHTML = `
    <input class="col" type="color" value="${hex}">
    <input class="hex mono" type="text" value="${hex.toUpperCase()}">
    <label class="mono">Tol <input class="tol" type="range" min="0" max="255" value="${tol}"></label>
    <span class="tolv mono">${tol}</span>
    <button class="ghost remove btn btn-ghost" type="button">Remove</button>
  `;
  const col=row.querySelector('.col');
  const hexIn=row.querySelector('.hex');
  const tolIn=row.querySelector('.tol');
  const tolv=row.querySelector('.tolv');
  const del=row.querySelector('.remove');

  const syncHex=()=>{
    let v=hexIn.value.trim(); if(!v.startsWith('#')) v='#'+v;
    if(/^#([0-9a-f]{6})$/i.test(v)){ col.value=v; hexIn.value=v.toUpperCase(); rebuildPaletteFromDOM(); }
  };
  const syncTol=()=>{ tolv.textContent=String(tolIn.value); rebuildPaletteFromDOM(); };

  on(col,'input',()=>{ hexIn.value=col.value.toUpperCase(); rebuildPaletteFromDOM(); });
  on(hexIn,'change',syncHex);
  on(tolIn,'input',syncTol);
  on(del,'click',()=>{ row.remove(); rebuildPaletteFromDOM(); });

  els.paletteList.appendChild(row);
}
function rebuildPaletteFromDOM(){
  const rows=[...els.paletteList.querySelectorAll('.palette-item')];
  state.palette = rows.map(r=>{
    const hex=r.querySelector('.hex').value.trim();
    const rgb=hexToRgb(hex)||{r:255,g:255,b:255};
    const tol=parseInt(r.querySelector('.tol').value,10)||64;
    return [rgb.r,rgb.g,rgb.b, tol];
  });
  renderRestrictedFromPalette();
  renderCodeList();
  updateMailto();
  persistPrefs();
}
function setPalette(hexes){
  if(!els.paletteList) return;
  els.paletteList.innerHTML='';
  hexes.forEach(h=>addPaletteRow(h, 64));
  rebuildPaletteFromDOM();
}
const getPaletteRGB = () => state.palette.map(p=>[p[0],p[1],p[2]]);
const getPaletteHex = () => state.palette.map(p=>rgbToHex(p[0],p[1],p[2]));

/* -------------------- Restricted Palette UI -------------------- */
function renderRestrictedFromPalette(){
  if(!els.restrictedList) return;
  const hexes=getPaletteHex();
  els.restrictedList.innerHTML='';
  hexes.forEach((hx,i)=>{
    const li=document.createElement('label');
    li.className='rp-item';
    li.innerHTML = `
      <input type="checkbox" data-idx="${i}" ${state.restricted.has(i)?'checked':''}>
      <span class="chip" style="background:${hx}"></span>
      <span class="mono">${hx}</span>
    `;
    els.restrictedList.appendChild(li);
  });
}
function getRestrictedInkIndices(){
  const checks=[...els.restrictedList?.querySelectorAll('input[type=checkbox]')||[]];
  state.restricted = new Set(checks.filter(c=>c.checked).map(c=>parseInt(c.dataset.idx,10)));
  return [...state.restricted];
}

/* -------------------- Image load (file/camera/paste/drag) -------------------- */
async function handleFile(file){
  try{
    if(!file) return;
    state.exifOrientation=1;

    // 1) Try createImageBitmap fast path
    if(typeof createImageBitmap === 'function'){
      try{
        const bmp = await createImageBitmap(file, { imageOrientation: "from-image", colorSpaceConversion: "default" });
        state.fullBitmap=bmp; state.fullW=bmp.width; state.fullH=bmp.height; state.exifOrientation=1;
        drawPreviewFromState(); toggleImageActions(true); return;
      }catch(e){
        if(isHeicFile(file)){
          // 2) HEIF via WebCodecs multi-probe
          try{
            const bmp = await decodeHeicWithWebCodecs(file);
            state.fullBitmap=bmp; state.fullW=bmp.width; state.fullH=bmp.height; state.exifOrientation=1;
            drawPreviewFromState(); toggleImageActions(true); return;
          }catch(e2){
            console.warn('WebCodecs HEIC/HEIF decode failed:', e2);
          }
        } else {
          console.warn('createImageBitmap failed; will try <img>', e);
        }
      }
    }

    // 3) Fallback <img> (Safari handles HEIC here)
    const url=objectUrlFor(file);
    try{
      const img=await loadIMG(url);
      state.fullBitmap=img;
      state.fullW=img.naturalWidth||img.width; state.fullH=img.naturalHeight||img.height;
      if(isLikelyJpeg(file)){
        try{ state.exifOrientation=await readJpegOrientation(file); }catch{}
      } else {
        state.exifOrientation=1;
      }
      drawPreviewFromState(); toggleImageActions(true); return;
    }catch(imgErr){
      console.warn('IMG decode failed:', imgErr);
      if(isHeicFile(file)) heicHelp(); else alert('Could not open that image. Try a JPG/PNG.');
    }finally{ revokeUrl(url); }

  }catch(err){
    console.error(err);
    if(isHeicFile(file)) heicHelp(); else alert('Could not open that image. Try a JPG/PNG.');
  }
}

function drawPreviewFromState(){
  if(!els.srcCanvas || !state.fullBitmap) return;
  let w=state.fullW, h=state.fullH;
  ({w,h}=getOrientedDims(state.exifOrientation,w,h));
  const MAX=2000;
  if(w>MAX){ const s=MAX/w; w=Math.round(w*s); h=Math.round(h*s); }
  els.srcCanvas.width=w; els.srcCanvas.height=h;
  sctx.clearRect(0,0,w,h); sctx.imageSmoothingEnabled=false;

  if(state.exifOrientation===1 && state.fullBitmap instanceof ImageBitmap){
    sctx.drawImage(state.fullBitmap,0,0,w,h);
  } else {
    drawImageWithOrientation(sctx, state.fullBitmap, w, h, state.exifOrientation);
  }

  // allocate out canvas
  els.outCanvas.width=w; els.outCanvas.height=h;
  octx.clearRect(0,0,w,h); octx.imageSmoothingEnabled=false;

  // default auto-extract
  const k = parseInt(els.kColors?.value || '10', 10);
  setTimeout(()=>{
    try{
      const hexes = autoPaletteFromCanvasHybrid(els.srcCanvas, k);
      if(hexes?.length) setPalette(hexes);
    }catch(e){ console.warn('autoPalette failed', e); }
  }, 0);

  els.openEditor && (els.openEditor.disabled = false);
}

/* -------------------- Texture/Replacement rules application -------------------- */
function applyTextureRules(baseData, wL=1, wC=1){
  const w=baseData.width, h=baseData.height;
  const src=baseData.data;
  const out=new ImageData(w,h);
  out.data.set(src);

  const rules = state.rules.filter(r=>r.enabled && r.inks && r.inks.length>=2);
  if(rules.length===0) return out;

  const palHex = getPaletteHex();
  const ruleByHex = new Map();
  for(const r of rules){ ruleByHex.set((r.targetHex||'').toUpperCase(), r); }

  const rnd = (x,y)=> ((Math.sin(x*12.9898+y*78.233)*43758.5453)%1+1)%1;

  for(let y=0;y<h;y++){
    for(let x=0;x<w;x++){
      const i=(y*w+x)*4;
      if(out.data[i+3]===0) continue;

      const hx = rgbToHex(out.data[i],out.data[i+1],out.data[i+2]).toUpperCase();
      const rule = ruleByHex.get(hx);
      if(!rule) continue;

      const inks = rule.inks;
      const density = clamp(rule.density??0.5,0,1);
      const ptype = rule.pattern || 'checker';

      let pick = 0;
      if(inks.length===2){
        if(ptype==='checker'){
          pick = ((x^y)&1) < (density*1) ? 0 : 1;
        }else if(ptype==='stripe'){
          pick = (Math.floor(x/2)%2) < (density*1) ? 0 : 1;
        }else if(ptype==='dots'){
          const cx=(x%4)-2, cy=(y%4)-2; const r2=cx*cx+cy*cy;
          pick = (r2 < (density*4))?0:1;
        }else if(ptype==='ordered'){
          const bayer=[[0,2],[3,1]]; const t=bayer[y&1][x&1]/3;
          pick=(t<density)?0:1;
        }else if(ptype==='stipple'){
          pick = (rnd(x,y)<density)?0:1;
        }
      }else{
        const t = (ptype==='stipple') ? rnd(x,y) : ((x&3)*0.125 + (y&3)*0.125);
        const idx=Math.min(inks.length-1, Math.floor(t * inks.length));
        pick=idx;
      }
      const chosen = inks[pick] ?? inks[0];
      const c = state.palette[chosen];
      out.data[i]=c[0]; out.data[i+1]=c[1]; out.data[i+2]=c[2];
    }
  }
  return out;
}

/* -------------------- Halftone preview (lightweight) -------------------- */
function renderHalftone(ctx, imgData, palette, bgHex, cell=6, jitter=false, wL=1,wC=1){
  const w=imgData.width, h=imgData.height, data=imgData.data;
  const pal=palette.map(([r,g,b])=>({rgb:[r,g,b], lab:rgbToLab(r,g,b)}));
  const bg=hexToRgb(bgHex)||{r:255,g:255,b:255}; const bgLab=rgbToLab(bg.r,bg.g,b.b);

  ctx.save();
  ctx.fillStyle=rgbToHex(bg.r,bg.g,b.b);
  ctx.fillRect(0,0,w,h);

  function avgCell(x0,y0){
    let r=0,g=0,b=0,a=0,c=0;
    const x1=Math.min(w,x0+cell), y1=Math.min(h,y0+cell);
    for(let y=y0;y<y1;y++){
      let i=(y*w+x0)*4;
      for(let x=x0;x<x1;x++,i+=4){
        if(data[i+3]<8) continue;
        r+=data[i]; g+=data[i+1]; b+=data[i+2]; a+=data[i+3]; c++;
      }
    }
    if(!c) return {r:255,g:255,b:255,a:0};
    return { r:Math.round(r/c), g:Math.round(g/c), b:Math.round(b/c), a:Math.round(a/c) };
  }
  function coverageBetween(cellRGB, fgLab){
    const lab=rgbToLab(cellRGB.r,cellRGB.g,cellRGB.b);
    const dFg=Math.sqrt(deltaE2Weighted(lab, fgLab, wL, wC));
    const dBg=Math.sqrt(deltaE2Weighted(lab, bgLab, wL, wC));
    const eps=1e-6, wFg=1/Math.max(eps,dFg), wBg=1/Math.max(eps,dBg);
    return wFg/(wFg+wBg);
  }

  for(let y=0;y<h;y+=cell){
    for(let x=0;x<w;x+=cell){
      const cellRGB=avgCell(x,y); if(cellRGB.a===0) continue;
      const lab=rgbToLab(cellRGB.r,cellRGB.g,cellRGB.b);
      let best=0, bestD=Infinity;
      for(let p=0;p<pal.length;p++){
        const d=deltaE2Weighted(lab, pal[p].lab, wL,wC);
        if(d<bestD){bestD=d; best=p;}
      }
      const fg=pal[best];
      const cov=coverageBetween(cellRGB, fg.lab);
      const rmax=(cell*0.5);
      const rr=Math.max(0.4, Math.sqrt(cov)*rmax);
      let cx=x+cell*0.5, cy=y+cell*0.5;
      if(jitter){ const j=cell*0.15; cx+=(Math.random()*2-1)*j; cy+=(Math.random()*2-1)*j; }

      ctx.fillStyle=rgbToHex(fg.rgb[0],fg.rgb[1],fg.rgb[2]);
      ctx.beginPath(); ctx.arc(cx,cy,rr,0,Math.PI*2); ctx.fill();
    }
  }
  ctx.restore();
}

/* -------------------- Suggest by Hue & Luma -------------------- */
function suggestByHueLuma(){
  const allowed=getRestrictedInkIndices();
  if(allowed.length<2){ toast("Select at least 2 inks in Restricted Palette."); return; }
  if(!els.srcCanvas?.width){ toast("Load an image first."); return; }

  // scan current src for color hits
  const src = sctx.getImageData(0,0,els.srcCanvas.width,els.srcCanvas.height).data;
  const pal = state.palette;
  const palHex = getPaletteHex();
  const mapUsage=new Map(palHex.map(h=>[h,0]));
  for(let i=0;i<src.length;i+=4){
    const hx=rgbToHex(src[i],src[i+1],src[i+2]);
    if(mapUsage.has(hx)) mapUsage.set(hx, mapUsage.get(hx)+1);
  }

  const restrictedSet=new Set(allowed);
  const dropTargets=[];
  palHex.forEach((hx,idx)=>{
    if(!restrictedSet.has(idx)){
      const count=mapUsage.get(hx)||0;
      if(count>0) dropTargets.push({idx, hx, count});
    }
  });
  dropTargets.sort((a,b)=>b.count-a.count);

  const proposals = [];
  for(const t of dropTargets.slice(0, Math.min(10, dropTargets.length))){
    const rgb=hexToRgb(t.hx);
    const luma = 0.2126*rgb.r + 0.7152*rgb.g + 0.0722*rgb.b;
    const allowedRGB = allowed.map(i=>({i, rgb: {r:pal[i][0],g:pal[i][1],b:pal[i][2]}}));
    allowedRGB.sort((A,B)=>{
      const lA=0.2126*A.rgb.r+0.7152*A.rgb.g+0.0722*A.rgb.b;
      const lB=0.2126*B.rgb.r+0.7152*B.rgb.g+0.0722*B.rgb.b;
      return Math.abs(lA-luma) - Math.abs(lB-luma);
    });
    const near = allowedRGB[0]?.i;
    const far  = allowedRGB[allowedRGB.length-1]?.i;
    let inks = [];
    if(near!=null && far!=null && near!==far) inks=[near,far];
    else if(near!=null) { inks=[near, near]; }
    else inks = allowed.slice(0,2);

    proposals.push({
      enabled:true,
      targetHex:t.hx,
      pattern:'checker',
      inks: inks,
      density: 0.5
    });
  }

  const keep = state.rules.filter(r=> !proposals.find(p=>p.targetHex.toUpperCase()===r.targetHex.toUpperCase()));
  state.rules = keep.concat(proposals);
  renderRulesTable();
  toast("Suggestions added. Adjust density/pattern, then Refresh Output.");
}

/* -------------------- Rules table UI -------------------- */
function renderRulesTable(){
  if(!els.rulesTable) return;
  const tbody = els.rulesTable.tBodies?.[0] || els.rulesTable;
  tbody.innerHTML='';
  const palHex=getPaletteHex();
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
        <button class="btn btn-ghost r-edit-inks">Edit</button>
      </td>
      <td>
        <input type="range" class="r-density" min="0" max="100" value="${Math.round((r.density??0.5)*100)}">
        <span class="mono r-dv">${Math.round((r.density??0.5)*100)}%</span>
      </td>
      <td><button class="btn btn-danger r-del">Delete</button></td>
    `;
    const onChk=tr.querySelector('.r-on');
    const tHex=tr.querySelector('.r-target');
    const pat =tr.querySelector('.r-pattern');
    const dens=tr.querySelector('.r-density');
    const dval=tr.querySelector('.r-dv');
    const del =tr.querySelector('.r-del');
    const edit=tr.querySelector('.r-edit-inks');

    on(onChk,'change',()=>{ r.enabled=onChk.checked; });
    on(tHex,'change',()=>{ let v=tHex.value.trim(); if(!v.startsWith('#')) v='#'+v; tHex.value=v.toUpperCase(); r.targetHex=tHex.value; });
    on(pat,'change',()=>{ r.pattern=pat.value; });
    on(dens,'input',()=>{ r.density = clamp(dens.value/100,0,1); dval.textContent = `${Math.round(r.density*100)}%`; });
    on(del,'click',()=>{ state.rules.splice(idx,1); renderRulesTable(); });
    on(edit,'click',()=>{
      const allow = getRestrictedInkIndices();
      if(allow.length<2){ toast("Select at least 2 inks in Restricted Palette."); return; }
      const pick = prompt(`Enter comma separated indices of inks to use (Restricted indices only):\nAllowed: ${allow.join(', ')}`, r.inks.join(','));
      if(!pick) return;
      const arr=pick.split(',').map(s=>parseInt(s.trim(),10)).filter(n=>Number.isFinite(n) && allow.includes(n));
      if(arr.length>=2){ r.inks=arr; renderRulesTable(); } else { toast("Need 2+ inks."); }
    });

    tbody.appendChild(tr);
  });
}

/* -------------------- Mapping / refresh -------------------- */
function refreshOutput(){
  if(!els.srcCanvas?.width){ toast("Load an image first."); return; }
  if(!state.palette.length){ toast("Add colors to the palette."); return; }

  const wL=(parseInt(els.wLight?.value||'100',10))/100;
  const wC=(parseInt(els.wChroma?.value||'100',10))/100;
  const dither=!!els.useDither?.checked;
  const bg=els.bgMode?.value || 'keep';
  const allowWhite = !!els.allowWhite?.checked;

  // choose processing canvas: full-res or preview canvas
  let procCanvas, pctx;
  if(els.keepFullRes?.checked && state.fullBitmap){
    const baseW=state.fullW, baseH=state.fullH, o=state.exifOrientation||1;
    const dims=getOrientedDims(o, baseW, baseH);
    procCanvas=document.createElement('canvas'); procCanvas.width=dims.w; procCanvas.height=dims.h;
    pctx=procCanvas.getContext('2d',{willReadFrequently:true}); pctx.imageSmoothingEnabled=false;
    if(o===1 && state.fullBitmap instanceof ImageBitmap) pctx.drawImage(state.fullBitmap,0,0);
    else drawImageWithOrientation(pctx, state.fullBitmap, dims.w, dims.h, o);
  }else{
    procCanvas=els.srcCanvas;
    pctx=procCanvas.getContext('2d',{willReadFrequently:true}); pctx.imageSmoothingEnabled=false;
  }

  const srcData=pctx.getImageData(0,0,procCanvas.width,procCanvas.height);
  // 1) core mapping (respects lasso regions inside mapper via srcCanvas size)
  const mapped = mapToPalette(srcData, state.palette, {
    wL, wC, dither, bgMode: bg, allowWhite,
    srcCanvasW: els.srcCanvas.width, srcCanvasH: els.srcCanvas.height, regions: state.regions
  });

  // 2) texture replacement rules (optional)
  let final = state.rules.some(r=>r.enabled) ? applyTextureRules(mapped, wL,wC) : mapped;

  // 3) optional sharpen
  if(els.sharpenEdges?.checked) final = unsharpMask(final, 0.35);

  // cache
  state.outFullImageData = final;

  // draw preview at max width
  const previewW = Math.min(procCanvas.width, parseInt(els.maxW?.value||'1400',10));
  const s = previewW/procCanvas.width;
  els.outCanvas.width = Math.round(procCanvas.width*s);
  els.outCanvas.height= Math.round(procCanvas.height*s);
  octx.imageSmoothingEnabled=false;

  const tmp = document.createElement('canvas');
  tmp.width=final.width; tmp.height=final.height;
  tmp.getContext('2d',{willReadFrequently:true}).putImageData(final,0,0);

  if(els.useHalftone?.checked){
    octx.clearRect(0,0,els.outCanvas.width,els.outCanvas.height);
    const vis=document.createElement('canvas');
    vis.width=final.width; vis.height=final.height;
    const vctx=vis.getContext('2d',{willReadFrequently:true});
    // restrict halftone inks to the selected restricted palette, else use all
    const inks = getRestrictedInkIndices();
    const palUse = (inks.length>=2) ? inks.map(i=>[state.palette[i][0],state.palette[i][1],state.palette[i][2]]) : getPaletteRGB();
    const cell=clamp(parseInt(els.dotCell?.value||'6',10),3,64);
    const bgHex=(els.dotBg?.value||'#FFFFFF').toUpperCase();
    const jit=!!els.dotJitter?.checked;
    renderHalftone(vctx, tmp.getContext('2d').getImageData(0,0,final.width,final.height), palUse, bgHex, cell, jit, wL,wC);
    octx.drawImage(vis, 0,0, els.outCanvas.width, els.outCanvas.height);
  }else{
    octx.drawImage(tmp, 0,0, els.outCanvas.width, els.outCanvas.height);
  }

  // enable exports
  els.downloadBtn && (els.downloadBtn.disabled=false);
  els.vectorExportBtn && (els.vectorExportBtn.disabled = !window.ImageTracer);
}

/* -------------------- Codes & PMS report -------------------- */
async function loadPmsJson(url='assets/pms_solid_coated.json'){
  try{ PMS_LIB=await (await fetch(url,{cache:'no-store'})).json(); }
  catch(e){ PMS_LIB=[]; console.warn('PMS library load failed',e); }
}
function nearestPms(hex){
  if(PMS_CACHE.has(hex)) return PMS_CACHE.get(hex);
  if(!PMS_LIB.length){ const out={name:'—',hex,deltaE:0}; PMS_CACHE.set(hex,out); return out; }
  const rgb=hexToRgb(hex); const lab=rgbToLab(rgb.r,rgb.g,rgb.b);
  let best=null, bestD=Infinity;
  for(const sw of PMS_LIB){
    const r2=hexToRgb(sw.hex); if(!r2) continue;
    const lab2=rgbToLab(r2.r,r2.g,r2.b);
    const d=deltaE2Weighted(lab, lab2, 1,1);
    if(d<bestD){bestD=d; best={name:sw.name, hex:sw.hex, deltaE:Math.sqrt(d)};}
  }
  const out=best||{name:'—',hex,deltaE:0};
  PMS_CACHE.set(hex,out); return out;
}
function currentFinalPaletteCodes(){
  const indices = getRestrictedInkIndices();
  const hexes = indices.map(i=>rgbToHex(state.palette[i][0],state.palette[i][1],state.palette[i][2]));
  return hexes.map((hex,i)=>{
    if(state.codeMode==='hex') return {hex, label:hex, swatchHex:hex};
    const p=nearestPms(hex);
    return { hex, label:`${p.name} (${p.hex}) ΔE≈${p.deltaE.toFixed(1)}`, swatchHex:p.hex };
  });
}
function renderCodeList(){
  if(!els.codeList) return;
  const items=currentFinalPaletteCodes();
  els.codeList.innerHTML = items.length
    ? items.map((c,i)=>`<div class="row"><span class="sw" style="width:14px;height:14px;border:1px solid #334155;border-radius:3px;display:inline-block;background:${c.swatchHex}"></span> ${i+1}. ${c.label}</div>`).join('')
    : '<em>No final inks selected</em>';
}
function buildPrinterReport(){
  const items=currentFinalPaletteCodes();
  const lines=[
    'Project: Palette Mapper output',
    `Final inks used: ${items.length}`,
    `Code mode: ${state.codeMode.toUpperCase()}`,
    '',
    ...items.map((c,i)=>`${i+1}. ${c.label}`),
    '',
    'Notes:',
    '- Replacements were applied as textures/patterns using only the restricted inks.',
    '- PMS matches are nearest by Lab distance (approximate).'
  ];
  return lines.join('\n');
}
function updateMailto(){
  if(!els.mailtoLink) return;
  const subject=encodeURIComponent(
    state.codeMode==='pms' ? 'Print job: artwork + PMS palette' : 'Print job: artwork + HEX palette'
  );
  const preview = buildPrinterReport().split('\n').slice(0,24).join('\n');
  const body=encodeURIComponent(
`Hi,

Please find attached the artwork PNG (full resolution) and the ${state.codeMode.toUpperCase()} palette list.

${ state.codeMode==='pms' ? 'PMS matches are nearest by Lab distance; please confirm on press.' : 'HEX listed for reference; switch code mode to PMS if needed.' }

Report (preview):
${preview}

Thanks!`
  );
  els.mailtoLink.href=`mailto:?subject=${subject}&body=${body}`;
}

/* -------------------- Projects (IndexedDB) -------------------- */
function setPane(open){ if(!els.projectsPane) return; els.projectsPane.classList.toggle('open',open); els.projectsPane.setAttribute('aria-hidden',String(!open)); }
async function refreshProjectsList(){
  if(!els.projectsList) return;
  const arr=await dbGetAll();
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
async function saveCurrentProject(){
  if(!state.fullBitmap){ alert('Load an image first.'); return; }
  const name=prompt('Project name?')||`Project ${Date.now()}`;

  const o=state.exifOrientation||1;
  const {w:ow,h:oh}=getOrientedDims(o,state.fullW,state.fullH);
  const tmp=document.createElement('canvas'); tmp.width=ow; tmp.height=oh; const tc=tmp.getContext('2d'); tc.imageSmoothingEnabled=false;
  if(o===1 && state.fullBitmap instanceof ImageBitmap) tc.drawImage(state.fullBitmap,0,0,ow,oh);
  else drawImageWithOrientation(tc, state.fullBitmap, ow, oh, o);

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

/* -------------------- Full-screen editor (eyedrop + lasso) -------------------- */
const editor = { active:false, tool:'eyedrop', ectx:null, octx:null, lassoPts:[], lassoActive:false, eyedropTimer:null, currentHex:'#000000' };

function openEditor(){
  if(!state.fullBitmap){ toast('Load an image first.'); return; }
  els.editorOverlay?.classList.remove('hidden'); els.editorOverlay?.setAttribute('aria-hidden','false'); editor.active=true;

  const vw=window.innerWidth, vh=window.innerHeight; const rightW=(vw>900)?320:0, toolbarH=48;
  els.editCanvas.width=vw-rightW; els.editCanvas.height=vh-toolbarH;
  els.editOverlay.width=els.editCanvas.width; els.editOverlay.height=els.editCanvas.height;
  editor.ectx=els.editCanvas.getContext('2d',{willReadFrequently:true});
  editor.octx=els.editOverlay.getContext('2d',{willReadFrequently:true});
  editor.ectx.imageSmoothingEnabled=false; editor.octx.imageSmoothingEnabled=false;

  editor.ectx.clearRect(0,0,els.editCanvas.width,els.editCanvas.height);
  editor.ectx.drawImage(els.srcCanvas,0,0,els.editCanvas.width,els.editCanvas.height);

  renderEditorPalette();
  buildLassoChecks();

  setToolActive('toolEyedrop');
  enableEyedrop();

  toast("Tip: Long-press to eyedrop. Switch to Lasso to capture a region & limit to certain inks.");
}
function closeEditor(){
  if(!editor.active) return;
  disableEyedrop(); disableLasso();
  editor.active=false; els.editorOverlay?.classList.add('hidden'); els.editorOverlay?.setAttribute('aria-hidden','true');
}
function setToolActive(id){
  ['toolEyedrop','toolLasso','toolPan'].forEach(x=>{
    const b=$(`#${x}`); if(!b) return;
    if(x===id) b.classList.add('active'); else b.classList.remove('active');
  });
}

function pickAtEditor(evt){
  const rect=els.editCanvas.getBoundingClientRect();
  const x=Math.floor((evt.clientX-rect.left)*els.editCanvas.width/rect.width);
  const y=Math.floor((evt.clientY-rect.top )*els.editCanvas.height/rect.height);
  const d=editor.ectx.getImageData(x,y,1,1).data;
  return rgbToHex(d[0],d[1],d[2]);
}
function showEye(hex){ if(els.eyeSwatch) els.eyeSwatch.style.background=hex; if(els.eyeHex) els.eyeHex.textContent=hex; }

/* Eyedrop */
function enableEyedrop(){
  const start=(e)=>{ e.preventDefault(); clearTimeout(editor.eyedropTimer);
    editor.eyedropTimer=setTimeout(()=>{ editor.currentHex=pickAtEditor(e); showEye(editor.currentHex);
      const rect=els.editCanvas.getBoundingClientRect();
      const cx=(e.clientX-rect.left)*els.editCanvas.width/rect.width;
      const cy=(e.clientY-rect.top )*els.editCanvas.height/rect.height;
      editor.octx.clearRect(0,0,els.editOverlay.width,els.editOverlay.height);
      editor.octx.strokeStyle='#93c5fd'; editor.octx.lineWidth=2; editor.octx.beginPath(); editor.octx.arc(cx,cy,14,0,Math.PI*2); editor.octx.stroke();
    },250);
  };
  const move=(e)=>{ if(editor.eyedropTimer===null) return; e.preventDefault(); editor.currentHex=pickAtEditor(e); showEye(editor.currentHex); };
  const end =(e)=>{ e.preventDefault(); clearTimeout(editor.eyedropTimer); editor.eyedropTimer=null; };

  on(els.editCanvas,'pointerdown',start,{passive:false});
  on(els.editCanvas,'pointermove',move,{passive:false});
  ['pointerup','pointerleave','pointercancel'].forEach(ev=> on(els.editCanvas,ev,end,{passive:false}));
}
function disableEyedrop(){
  if(!els.editCanvas) return;
  els.editCanvas.replaceWith(els.editCanvas.cloneNode(true));
  els.editCanvas = $("#editCanvas"); els.editOverlay=$("#editOverlay");
  editor.ectx=els.editCanvas.getContext('2d'); editor.octx=els.editOverlay.getContext('2d');
}
on(els.eyeAdd,'click',()=>{
  const hx = editor.currentHex && /^#([0-9A-F]{6})$/i.test(editor.currentHex) ? editor.currentHex : (()=>{
    const cx=Math.floor(els.editCanvas.width/2), cy=Math.floor(els.editCanvas.height/2);
    const d=editor.ectx.getImageData(cx,cy,1,1).data; return rgbToHex(d[0],d[1],d[2]);
  })();
  addPaletteRow(hx, 64); rebuildPaletteFromDOM();
});
on(els.eyeCancel,'click',()=> editor.octx?.clearRect(0,0,els.editOverlay.width,els.editOverlay.height));

/* Lasso */
function renderEditorPalette(){
  if(!els.editorPalette) return;
  els.editorPalette.innerHTML = getPaletteHex().map(h=>`<span class="sw" title="${h}" style="display:inline-block;width:20px;height:20px;border-radius:4px;border:1px solid var(--sw-outline);background:${h}"></span>`).join('');
}
function buildLassoChecks(){
  if(!els.lassoChecks) return; els.lassoChecks.innerHTML='';
  getPaletteHex().forEach((hx,i)=>{
    const lab=document.createElement('label');
    lab.className='lasso-ink';
    lab.innerHTML=`<input type="checkbox" data-i="${i}" checked> <span class="chip" style="background:${hx}"></span> <span class="mono">${hx}</span>`;
    els.lassoChecks.appendChild(lab);
  });
}
function enableLasso(){
  els.lassoSave.disabled=true; els.lassoClear.disabled=false;
  const pts=[];
  const begin=e=>{ e.preventDefault(); pts.length=0; add(e); draw(false); editor.lassoActive=true; };
  const add  =e=>{
    const r=els.editCanvas.getBoundingClientRect();
    const x=Math.max(0,Math.min(els.editCanvas.width,  Math.round((e.clientX-r.left)*els.editCanvas.width /r.width)));
    const y=Math.max(0,Math.min(els.editCanvas.height, Math.round((e.clientY-r.top )*els.editCanvas.height/r.height)));
    pts.push([x,y]);
  };
  const move =e=>{ if(!editor.lassoActive) return; e.preventDefault(); add(e); draw(false); };
  const end  =e=>{ if(!editor.lassoActive) return; e.preventDefault(); editor.lassoActive=false; draw(true); els.lassoSave.disabled=false; };

  const draw = (close=false)=>{
    const ctx=editor.octx; ctx.clearRect(0,0,els.editOverlay.width,els.editOverlay.height);
    if(pts.length<2) return;
    ctx.lineWidth=2; ctx.strokeStyle='#93c5fd'; ctx.fillStyle='rgba(147,197,253,.15)';
    ctx.beginPath(); ctx.moveTo(pts[0][0],pts[0][1]); for(let i=1;i<pts.length;i++) ctx.lineTo(pts[i][0],pts[i][1]);
    if(close) ctx.closePath(); ctx.stroke(); if(close) ctx.fill();
  };
  const saveMask=()=>{
    if(!pts.length) return;
    const tw=els.srcCanvas.width, th=els.srcCanvas.height;
    const tmp=document.createElement('canvas'); tmp.width=tw; tmp.height=th; const tctx=tmp.getContext('2d');
    tctx.clearRect(0,0,tw,th); tctx.fillStyle='#fff'; tctx.beginPath();
    const rx=tw/els.editCanvas.width, ry=th/els.editCanvas.height;
    tctx.moveTo(Math.round(pts[0][0]*rx),Math.round(pts[0][1]*ry));
    for(let i=1;i<pts.length;i++) tctx.lineTo(Math.round(pts[i][0]*rx),Math.round(pts[i][1]*ry));
    tctx.closePath(); tctx.fill();
    const id=tctx.getImageData(0,0,tw,th).data; const mask=new Uint8Array(tw*th);
    for(let i=0;i<mask.length;i++) mask[i]=id[i*4+3]>0?1:0;

    const allowed=new Set();
    [...els.lassoChecks.querySelectorAll('input[type=checkbox]')].forEach(cb=>{
      if(cb.checked) allowed.add(parseInt(cb.dataset.i,10));
    });
    state.regions.push({ type:'polygon', points:pts.map(p=>[p[0],p[1]]), mask, allowed });
    pts.length=0; draw(false); els.lassoSave.disabled=true; els.lassoClear.disabled=true;
    toast("Region saved. Apply mapping to see effect.");
  };

  on(els.editCanvas,'pointerdown',begin,{passive:false});
  on(els.editCanvas,'pointermove',move,{passive:false});
  ['pointerup','pointerleave','pointercancel'].forEach(ev=> on(els.editCanvas,ev,end,{passive:false}));
  on(els.lassoSave,'click',saveMask);
  on(els.lassoClear,'click',()=>{ editor.octx.clearRect(0,0,els.editOverlay.width,els.editOverlay.height); els.lassoSave.disabled=true; els.lassoClear.disabled=true; });
}
function disableLasso(){ /* tear-down handled by overlay close */ }

/* -------------------- Apply settings (from project) -------------------- */
function applySettings(s){
  if(!s) return;
  if(s.palette) setPalette(s.palette);
  if(Array.isArray(s.restricted)){ state.restricted=new Set(s.restricted); renderRestrictedFromPalette(); }
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

  // rebuild regions from points at srcCanvas size
  state.regions.length=0;
  if(s.regions && Array.isArray(s.regions) && els.srcCanvas?.width){
    s.regions.forEach(r=>{
      if(r.type==='polygon'){
        const tw=els.srcCanvas.width, th=els.srcCanvas.height;
        const tmp=document.createElement('canvas'); tmp.width=tw; tmp.height=th; const tctx=tmp.getContext('2d');
        tctx.clearRect(0,0,tw,th); tctx.fillStyle='#fff'; tctx.beginPath();
        tctx.moveTo(r.points[0][0]*(tw/(els.editCanvas?.width||tw)), r.points[0][1]*(th/(els.editCanvas?.height||th)));
        for(let i=1;i<r.points.length;i++){
          tctx.lineTo(r.points[i][0]*(tw/(els.editCanvas?.width||tw)), r.points[i][1]*(th/(els.editCanvas?.height||th)));
        }
        tctx.closePath(); tctx.fill();
        const id=tctx.getImageData(0,0,tw,th).data; const mask=new Uint8Array(tw*th);
        for(let i=0;i<mask.length;i++) mask[i]=id[i*4+3]>0?1:0;
        state.regions.push({type:'polygon',points:r.points,mask,allowed:new Set(r.allowed||[])});
      }
    });
  }
  updateWeightsUI();
  renderCodeList();
  updateMailto();
}

/* -------------------- Prefs -------------------- */
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
function renderSavedPalettes(){
  if(!els.savedPalettes) return;
  const list=loadSavedPalettes(); els.savedPalettes.innerHTML='';
  list.forEach((p,idx)=>{
    const div=document.createElement('div'); div.className='item';
    const sw=p.colors.map(h=>`<span class="sw" title="${h}" style="display:inline-block;width:16px;height:16px;border-radius:4px;border:1px solid #334155;background:${h}"></span>`).join('');
    div.innerHTML=`<div><strong>${p.name||('Palette '+(idx+1))}</strong><br><small>${p.colors.join(', ')}</small></div><div>${sw}</div>`;
    on(div,'click',()=>{ setPalette(p.colors); });
    els.savedPalettes.appendChild(div);
  });
}

/* -------------------- Misc UI helpers -------------------- */
function updateWeightsUI(){
  if(els.wChromaOut) els.wChromaOut.textContent=fmtMult(els.wChroma?.value||100);
  if(els.wLightOut)  els.wLightOut.textContent =fmtMult(els.wLight?.value||100);
}
function toggleImageActions(enable){
  if(els.applyBtn) els.applyBtn.disabled=!enable;
  if(els.autoExtract) els.autoExtract.disabled=!enable;
  if(els.resetBtn) els.resetBtn.disabled=!enable;
  if(els.openEditor) els.openEditor.disabled=!enable;
}

/* -------------------- Event wiring -------------------- */
function bindEvents(){
  // Image I/O
  on(els.fileInput,'change',e=> handleFile(e.target.files?.[0]));
  on(els.cameraInput,'change',e=> handleFile(e.target.files?.[0]));
  on(els.pasteBtn,'click', async ()=>{
    if(!navigator.clipboard?.read){ alert('Clipboard paste not supported. Use Upload.'); return; }
    try{
      const items=await navigator.clipboard.read();
      for(const it of items){ for(const type of it.types){ if(type.startsWith('image/')){ const blob=await it.getType(type); await handleFile(blob); return; } } }
      alert('No image in clipboard.');
    }catch{ alert('Clipboard read failed.'); }
  });
  const prevent=e=>{ e.preventDefault(); e.stopPropagation(); };
  ['dragenter','dragover','dragleave','drop'].forEach(ev=> window.addEventListener(ev, prevent, {passive:false}));
  window.addEventListener('drop', e=>{ const f=e.dataTransfer?.files?.[0]; if(f) handleFile(f); }, {passive:false});
  on(els.resetBtn,'click', ()=> state.fullBitmap && drawPreviewFromState());

  // Palette controls
  on(els.addColor,'click', ()=>{ addPaletteRow('#FFFFFF',64); rebuildPaletteFromDOM(); });
  on(els.clearColors,'click', ()=>{ els.paletteList.innerHTML=''; rebuildPaletteFromDOM(); });
  on(els.loadExample,'click', ()=>{ setPalette(['#FFFFFF','#000000','#B3753B','#5B3A21','#D22C2C','#1D6E2E']); });
  on(els.savePalette,'click', ()=>{
    const name=prompt('Save palette as (optional name):')||`Palette ${Date.now()}`;
    const colors=getPaletteHex();
    const list=loadSavedPalettes(); list.unshift({name, colors});
    saveSavedPalettes(list.slice(0,50)); renderSavedPalettes();
  });
  on(els.clearSavedPalettes,'click', ()=>{ if(confirm('Clear all saved palettes?')){ saveSavedPalettes([]); renderSavedPalettes(); } });
  on(els.autoExtract,'click', ()=>{
    if(!els.srcCanvas?.width){ toast('Load an image first.'); return; }
    const k=clamp(parseInt(els.kColors?.value||'6',10),2,16);
    const hexes=autoPaletteFromCanvasHybrid(els.srcCanvas,k);
    if(hexes?.length) setPalette(hexes);
  });

  // Restricted palette
  on(els.restrictedList,'change', ()=>{ getRestrictedInkIndices(); renderCodeList(); updateMailto(); });
  on(els.restrictedSelectAll,'click', ()=>{ $$('input[type=checkbox]', els.restrictedList).forEach(c=>c.checked=true); getRestrictedInkIndices(); renderCodeList(); });
  on(els.restrictedSelectNone,'click', ()=>{ $$('input[type=checkbox]', els.restrictedList).forEach(c=>c.checked=false); getRestrictedInkIndices(); renderCodeList(); });

  // Mapping
  ;['input','change'].forEach(ev=>{
    on(els.wChroma,ev, updateWeightsUI);
    on(els.wLight, ev, updateWeightsUI);
  });
  on(els.applyBtn,'click', refreshOutput);
  on(els.bigRegenBtn,'click', refreshOutput);
  on(els.downloadBtn,'click', ()=> {
    if(!state.outFullImageData){ toast("Apply mapping first."); return; }
    const scale = clamp(parseInt(els.exportScale?.value||'1',10),1,4);
    exportPNG(state.outFullImageData, scale);
  });
  on(els.vectorExportBtn,'click', ()=> {
    if(!state.outFullImageData){ toast("Apply mapping first."); return; }
    const paletteHex = getPaletteHex();
    const ncolors = Math.min(16, getRestrictedInkIndices().length || state.palette.length);
    exportSVG(state.outFullImageData, paletteHex, ncolors);
  });

  // Suggestions & rules
  on(els.suggestHueLumaBtn,'click', suggestByHueLuma);
  on(els.addRuleBtn,'click', ()=>{
    const allow=getRestrictedInkIndices(); if(allow.length<2){ toast("Select at least 2 inks."); return; }
    state.rules.push({enabled:true,targetHex:'#808080',pattern:'checker',inks:allow.slice(0,2),density:0.5});
    renderRulesTable();
  });
  on(els.refreshOutputBtn,'click', refreshOutput);
  on(els.smartMixOpen,'click', ()=>{
    const allow=getRestrictedInkIndices();
    if(allow.length<2){ toast("Select at least 2 inks in Restricted Palette."); return; }
    const target=prompt("Enter target HEX to approximate (e.g. #2A8F3C):","#2A8F3C");
    if(!target || !/^#([0-9a-f]{6})$/i.test(target)){ toast("Enter a valid hex like #22AA66"); return; }
    const best=smartMixSuggest(target, state.palette, allow);
    if(!best){ toast("No mix found."); return; }
    state.rules.push({enabled:true,targetHex:target.toUpperCase(),pattern:best.pattern,inks:best.inks,density:best.density});
    renderRulesTable();
    toast("Smart mix suggestion added. Refresh Output to apply.");
  });

  // Codes / report
  on(els.colorCodeMode,'change', ()=>{ state.codeMode = els.colorCodeMode.value==='hex'?'hex':'pms'; renderCodeList(); updateMailto(); });
  on(els.exportReport,'click', ()=>{
    const txt=buildPrinterReport();
    const blob=new Blob([txt],{type:'text/plain'});
    const a=document.createElement('a'); a.download = state.codeMode==='pms'?'pms_report.txt':'hex_report.txt';
    a.href=URL.createObjectURL(blob); a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1500);
  });

  // Projects drawer
  on(els.openProjects,'click', ()=>setPane(true));
  on(els.closeProjects,'click', ()=>setPane(false));
  on(els.refreshProjects,'click', refreshProjectsList);
  on(els.saveProject,'click', saveCurrentProject);
  on(els.exportProject,'click', async ()=>{
    const id=state.selectedProjectId; if(!id){ alert('Select a project first.'); return; }
    const rec=await dbGet(id); if(!rec){ alert('Project not found.'); return; }
    const b64=await blobToBase64(rec.imageBlob);
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
      const blob=base64ToBlob(obj.imageBase64);
      const rec={ name:obj.name||`Imported ${Date.now()}`, createdAt:obj.createdAt||Date.now(), updatedAt:Date.now(), settings:obj.settings, imageBlob:blob };
      const id=await dbPutProject(rec); await refreshProjectsList(); await loadProject(id); setPane(false); toast('Imported.');
    }catch{ alert('Invalid JSON.'); } finally { e.target.value=''; }
  });
  on(els.deleteProject,'click', async ()=>{
    const id=state.selectedProjectId; if(!id){ alert('Select a project then Delete.'); return; }
    if(!confirm('Delete selected project?')) return; await dbDelete(id); state.selectedProjectId=null; await refreshProjectsList();
  });

  // Editor toolbar
  on(els.openEditor,'click', openEditor);
  on(els.editorDone,'click', closeEditor);
  on(els.toolEyedrop,'click', ()=>{ setToolActive('toolEyedrop'); disableLasso(); enableEyedrop(); });
  on(els.toolLasso,'click',  ()=>{ setToolActive('toolLasso'); disableEyedrop(); enableLasso(); });
  on(els.toolPan,'click',    ()=>{ setToolActive('toolPan');  disableEyedrop(); disableLasso(); toast('Pan (two-finger drag / trackpad scroll).'); });
}

/* -------------------- Blob helpers -------------------- */
function blobToBase64(blob){ return new Promise(res=>{ const r=new FileReader(); r.onload=()=>res(r.result.split(',')[1]); r.readAsDataURL(blob); }); }
function base64ToBlob(b64){ const byteChars=atob(b64); const len=byteChars.length; const bytes=new Uint8Array(len); for(let i=0;i<len;i++) bytes[i]=byteChars.charCodeAt(i); return new Blob([bytes],{type:'image/png'}); }

/* -------------------- Init -------------------- */
async function init(){
  const prefs=loadPrefs();
  if(prefs.lastPalette) setPalette(prefs.lastPalette); else setPalette(['#FFFFFF','#000000']);
  if(prefs.keepFullRes!==undefined && els.keepFullRes) els.keepFullRes.checked=!!prefs.keepFullRes;
  if(prefs.sharpenEdges!==undefined && els.sharpenEdges) els.sharpenEdges.checked=!!prefs.sharpenEdges;
  if(prefs.maxW && els.maxW) els.maxW.value=prefs.maxW;
  if(prefs.wChroma && els.wChroma) els.wChroma.value=prefs.wChroma;
  if(prefs.wLight && els.wLight) els.wLight.value=prefs.wLight;
  if(prefs.bgMode && els.bgMode) els.bgMode.value=prefs.bgMode;
  if(prefs.useDither!==undefined && els.useDither) els.useDither.checked=!!prefs.useDither;
  if(prefs.useHalftone!==undefined && els.useHalftone) els.useHalftone.checked=!!prefs.useHalftone;
  if(prefs.dotCell && els.dotCell) els.dotCell.value=prefs.dotCell;
  if(prefs.dotBg && els.dotBg) els.dotBg.value=prefs.dotBg;
  if(prefs.dotJitter!==undefined && els.dotJitter) els.dotJitter.checked=!!prefs.dotJitter;
  state.codeMode = (prefs.codeMode==='hex'?'hex':'pms');
  if(els.colorCodeMode) els.colorCodeMode.value=state.codeMode;

  updateWeightsUI();
  renderSavedPalettes();
  await loadPmsJson();
  renderCodeList();
  updateMailto();
  refreshProjectsList();

  bindEvents();

  setTimeout(()=>toast('Tip: Build your Palette in Section 2, then choose inks in “Restricted Palette”.'), 600);
  setTimeout(()=>toast('Use “Suggest by Hue & Luma” to auto-create replacement rules; tweak densities, then Refresh Output.'), 2200);
}

window.addEventListener('load', init);
