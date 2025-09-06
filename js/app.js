// app.js — robust image loader + restricted palette wiring + suggest UI
// This version is intentionally noisy in console/toasts so you can diagnose issues fast.

// ----------------- tiny toast -----------------
function toast(msg){
  console.log('[Toast]', msg);
  const el=document.createElement('div');
  el.textContent=msg;
  el.style.cssText='position:fixed;left:50%;top:18px;transform:translateX(-50%);padding:8px 12px;border-radius:8px;background:#0ea5e9;color:#001018;font-weight:700;z-index:9999;box-shadow:0 6px 24px rgba(0,0,0,.25);';
  document.body.appendChild(el);
  setTimeout(()=>el.remove(),1800);
}

// ----------------- DOM -----------------
const els = {
  fileInput: document.getElementById('fileInput'),
  pasteBtn: document.getElementById('pasteBtn'),
  resetBtn: document.getElementById('resetBtn'),

  srcCanvas: document.getElementById('srcCanvas'),
  outCanvas: document.getElementById('outCanvas'),

  workingList: document.getElementById('workingList'),

  rpList: document.getElementById('restrictedList'),
  rpSelectAll: document.getElementById('rpSelectAll'),
  rpSelectNone: document.getElementById('rpSelectNone'),
  rpAllowWhite: document.getElementById('rpAllowWhite'),

  btnSuggest: document.getElementById('btnSuggestHueLuma'),
  texPattern: document.getElementById('texPattern'),
  rulesBox: document.getElementById('replacementRules'),

  openProjects: document.getElementById('openProjects'),
  closeProjects: document.getElementById('closeProjects'),
  projectsPane: document.getElementById('projectsPane'),
  refreshProjects: document.getElementById('refreshProjects'),
  saveProject: document.getElementById('saveProject'),
  exportProject: document.getElementById('exportProject'),
  importProject: document.getElementById('importProject'),
  deleteProject: document.getElementById('deleteProject'),
  projectsList: document.getElementById('projectsList'),
};

const sctx = els.srcCanvas.getContext('2d', { willReadFrequently:true });
const octx = els.outCanvas.getContext('2d', { willReadFrequently:true });
sctx.imageSmoothingEnabled=false; octx.imageSmoothingEnabled=false;

// ----------------- State -----------------
const state = {
  imageLoaded:false,
  fullBitmap:null, fullW:0, fullH:0, exifOrientation:1,
  paletteHex:[],
  restricted:[],
  allowWhite:true,
  rules:[],
};

// ----------------- Utils -----------------
const clamp=(v,min,max)=>v<min?min:(v>max?max:v);
const rgbToHex=(r,g,b)=>'#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('').toUpperCase();
function hexToRgb(h){ const m=/^#?([0-9a-f]{6})$/i.exec(h||''); if(!m) return null; const n=parseInt(m[1],16); return {r:(n>>16)&255,g:(n>>8)&255,b:n&255}; }
const getOrientedDims=(o,w,h)=> ([5,6,7,8].includes(o)?{w:h,h:w}:{w,h});

// Minimal EXIF orientation for JPEGs
async function readJpegOrientation(file){
  return new Promise((resolve)=>{
    try{
      const r=new FileReader();
      r.onload=()=>{
        try{
          const v=new DataView(r.result);
          if(v.getUint16(0,false)!==0xFFD8) return resolve(1);
          let off=2,len=v.byteLength;
          while(off<len){
            const marker=v.getUint16(off,false); off+=2;
            if(marker===0xFFE1){
              const exifLen=v.getUint16(off,false); off+=2;
              if(v.getUint32(off,false)!==0x45786966) break; // "Exif"
              off+=6;
              const tiff=off;
              const little=v.getUint16(tiff,false)===0x4949;
              const get16=o=>v.getUint16(o,little);
              const get32=o=>v.getUint32(o,little);
              const firstIFD=get32(tiff+4);
              if(firstIFD<8) return resolve(1);
              const dir=tiff+firstIFD;
              const entries=get16(dir);
              for(let i=0;i<entries;i++){
                const e=dir+2+i*12;
                const tag=get16(e);
                if(tag===0x0112) return resolve(get16(e+8)||1);
              }
            } else if((marker & 0xFF00)!==0xFF00) break;
            else off+=v.getUint16(off,false);
          }
        }catch{}
        resolve(1);
      };
      r.onerror=()=>resolve(1);
      r.readAsArrayBuffer(file.slice(0,256*1024));
    }catch{ resolve(1); }
  });
}
function drawImageWithOrientation(ctx, img, targetW, targetH, orientation){
  ctx.save();
  switch (orientation) {
    case 2: ctx.translate(targetW,0); ctx.scale(-1,1); break;
    case 3: ctx.translate(targetW,targetH); ctx.rotate(Math.PI); break;
    case 4: ctx.translate(0,targetH); ctx.scale(1,-1); break;
    case 5: ctx.rotate(0.5*Math.PI); ctx.scale(1,-1); break;
    case 6: ctx.rotate(0.5*Math.PI); ctx.translate(0,-targetW); break;
    case 7: ctx.rotate(0.5*Math.PI); ctx.translate(targetH,-targetW); ctx.scale(-1,1); break;
    case 8: ctx.rotate(-0.5*Math.PI); ctx.translate(-targetH,0); break;
    default: break;
  }
  ctx.imageSmoothingEnabled=false;
  ctx.drawImage(img,0,0,targetW,targetH);
  ctx.restore();
}

// Palette extraction (coarse; good for UI)
function extractPaletteFromCanvas(canvas,k=10){
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  const w=canvas.width,h=canvas.height; if(!w||!h) return ['#FFFFFF','#000000'];
  const step=Math.max(1,Math.floor(Math.sqrt((w*h)/120000)));
  const bins=new Map();
  for(let y=0;y<h;y+=step){
    const row=ctx.getImageData(0,y,w,1).data;
    for(let x=0;x<w;x+=step){
      const i=x*4, a=row[i+3]; if(a<16) continue;
      const r=row[i]>>3, g=row[i+1]>>3, b=row[i+2]>>3;
      const key=(r<<10)|(g<<5)|b;
      bins.set(key,(bins.get(key)||0)+1);
    }
  }
  const picks=[...bins.entries()].sort((a,b)=>b[1]-a[1]).slice(0,k)
    .map(([key])=>rgbToHex(((key>>10)&31)<<3, ((key>>5)&31)<<3, (key&31)<<3));
  if(!picks.includes('#FFFFFF')) picks.unshift('#FFFFFF');
  if(!picks.includes('#000000')) picks.push('#000000');
  return Array.from(new Set(picks)).slice(0,k);
}

// ----------------- Loader -----------------
function objectUrlFor(file){ return URL.createObjectURL(file); }
function revokeUrl(u){ try{ URL.revokeObjectURL(u); }catch{} }
function loadImage(url){ return new Promise((resolve,reject)=>{ const img=new Image(); img.decoding='async'; img.onload=()=>resolve(img); img.onerror=reject; img.src=url; }); }

async function handleFile(file){
  try{
    toast('Loading image…');
    state.exifOrientation = 1;

    // Best path: createImageBitmap respects EXIF with imageOrientation
    if (typeof createImageBitmap === 'function') {
      try{
        const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
        state.fullBitmap = bmp; state.fullW=bmp.width; state.fullH=bmp.height; state.exifOrientation=1;
        drawPreviewFromState();
        onImageReady();
        return;
      }catch(e){ console.warn('createImageBitmap failed:', e); }
    }

    // Fallback: <img> + manual EXIF orientation (JPEG)
    let url = objectUrlFor(file);
    let img;
    try{
      img = await loadImage(url);
    }catch(err){
      // Last resort: FileReader -> dataURL
      console.warn('Image() failed, falling back to FileReader:', err);
      const dataUrl = await new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=rej; r.readAsDataURL(file); });
      img = await loadImage(dataUrl);
      url = null;
    } finally {
      if (url) revokeUrl(url);
    }

    state.fullBitmap=img;
    state.fullW=img.naturalWidth||img.width; state.fullH=img.naturalHeight||img.height;
    // manual EXIF only for likely JPEG
    const name=(file.name||'').toLowerCase(); const type=(file.type||'').toLowerCase();
    const isJpg = name.endsWith('.jpg')||name.endsWith('.jpeg')||type.includes('jpeg')||type.includes('jpg');
    if (isJpg) { try{ state.exifOrientation = await readJpegOrientation(file); }catch{} }

    drawPreviewFromState();
    onImageReady();

  }catch(e){
    console.error('Image load error:', e);
    toast('Could not open that image. Try a JPG/PNG or a different photo.');
  }
}

function drawPreviewFromState(){
  const bmp = state.fullBitmap; if(!bmp) return;
  const o = state.exifOrientation||1;
  let w = state.fullW, h = state.fullH;
  ({w,h} = getOrientedDims(o,w,h));
  const MAX_W = 1400;
  if (w>MAX_W){ const s=MAX_W/w; w=Math.round(w*s); h=Math.round(h*s); }

  els.srcCanvas.width=w; els.srcCanvas.height=h;
  sctx.clearRect(0,0,w,h);
  if (o===1 && (bmp instanceof ImageBitmap)) sctx.drawImage(bmp,0,0,w,h);
  else drawImageWithOrientation(sctx,bmp,w,h,o);

  els.outCanvas.width=w; els.outCanvas.height=h;
  octx.clearRect(0,0,w,h);
}

// called after preview is painted successfully
function onImageReady(){
  state.imageLoaded=true;
  toast('Image loaded ✔');
  state.paletteHex = extractPaletteFromCanvas(els.srcCanvas, 10);
  renderWorkingPalette();
  syncRestrictedFromPalette();
  renderRestrictedPalette();
  updateSuggestButtonState();
}

// ----------------- Working palette UI -----------------
function renderWorkingPalette(){
  const box=els.workingList; if(!box) return; box.innerHTML='';
  state.paletteHex.forEach(h=>{
    const row=document.createElement('div'); row.className='palette-item';
    row.innerHTML=`<span class="sw" style="background:${h}"></span><span class="mono">${h}</span>`;
    box.appendChild(row);
  });
}

// ----------------- Restricted palette -----------------
function syncRestrictedFromPalette(){
  if (!state.paletteHex.length) return;
  if (!state.restricted.length){
    state.restricted = state.paletteHex.map(hex=>({hex:hex.toUpperCase(), enabled:true}));
  } else {
    const map = new Map(state.restricted.map(r=>[r.hex.toUpperCase(), r.enabled]));
    state.restricted = state.paletteHex.map(h=>({hex:h.toUpperCase(), enabled: map.get(h.toUpperCase()) ?? true}));
  }
}
function renderRestrictedPalette(){
  const box=els.rpList; if(!box) return; box.innerHTML='';
  state.restricted.forEach((ink,idx)=>{
    const row=document.createElement('div'); row.className='rp-item';
    row.innerHTML=`
      <input type="checkbox" ${ink.enabled?'checked':''} />
      <span class="dot" style="background:${ink.hex}"></span>
      <input type="text" value="${ink.hex}" />
      <button class="ghost remove" type="button">x</button>
    `;
    const cb=row.querySelector('input[type=checkbox]');
    const hexInput=row.querySelector('input[type=text]');
    const dot=row.querySelector('.dot');
    const remove=row.querySelector('.remove');

    cb.addEventListener('change',()=>{ ink.enabled=cb.checked; updateSuggestButtonState(); });
    hexInput.addEventListener('change',()=>{
      let v=hexInput.value.trim(); if(!v.startsWith('#')) v='#'+v;
      if(!/^#([0-9A-Fa-f]{6})$/.test(v)){ hexInput.value=ink.hex; return; }
      ink.hex=v.toUpperCase(); dot.style.background=ink.hex; updateSuggestButtonState();
    });
    remove.addEventListener('click',()=>{ state.restricted.splice(idx,1); renderRestrictedPalette(); updateSuggestButtonState(); });

    box.appendChild(row);
  });

  els.rpSelectAll.onclick=()=>{ state.restricted.forEach(r=>r.enabled=true); renderRestrictedPalette(); updateSuggestButtonState(); };
  els.rpSelectNone.onclick=()=>{ state.restricted.forEach(r=>r.enabled=false); renderRestrictedPalette(); updateSuggestButtonState(); };
  els.rpAllowWhite.onchange=()=>{ state.allowWhite=!!els.rpAllowWhite.checked; updateSuggestButtonState(); };
}
function getEnabledRestrictedHexes(){ return state.restricted.filter(r=>r.enabled).map(r=>r.hex.toUpperCase()); }
function updateSuggestButtonState(){
  const inks=getEnabledRestrictedHexes();
  const ok = state.imageLoaded && (inks.length>=2 || (inks.length>=1 && state.allowWhite));
  els.btnSuggest.disabled = !ok;
}

// ----------------- Suggest (simple placeholder) -----------------
function grayness({r,g,b}){ const mx=Math.max(r,g,b), mn=Math.min(r,g,b); return 1 - (mx-mn)/Math.max(1,mx); }
function luma({r,g,b}){ return 0.2126*r + 0.7152*g + 0.0722*b; }

function suggestReplacementsByHueAndLuma(enabledInks, opts){
  const pattern = opts.pattern || 'checker';
  const rules=[];
  const allowed=new Set(enabledInks.map(h=>h.toUpperCase()));
  const white = '#FFFFFF';
  const pool = enabledInks.slice();
  if (opts.whiteOK && !pool.includes(white)) pool.push(white);

  const best2 = (targetHex)=>{
    const t=hexToRgb(targetHex);
    let best=null, errBest=1e9, bestD=0.5;
    for(let i=0;i<pool.length;i++){
      for(let j=i+1;j<pool.length;j++){
        const a=hexToRgb(pool[i]), b=hexToRgb(pool[j]);
        for(let d=0; d<=10; d++){
          const w=d/10;
          const R=Math.round(a.r*w + b.r*(1-w));
          const G=Math.round(a.g*w + b.g*(1-w));
          const B=Math.round(a.b*w + b.b*(1-w));
          const dl=Math.abs(luma({r:R,g:G,b:B}) - luma(t));
          const dh=Math.abs(grayness({r:R,g:G,b:B}) - grayness(t));
          const err=dl*0.9 + dh*0.1;
          if(err<errBest){ errBest=err; best=[pool[i],pool[j]]; bestD=w; }
        }
      }
    }
    return { mix: best||[pool[0]], density: bestD };
  };

  state.paletteHex.forEach(hex=>{
    if(allowed.has(hex)) return;
    if(pool.length<1) return;
    const {mix,density}=best2(hex);
    rules.push({ target: hex, pattern, density, mix });
  });

  return rules;
}
function renderReplacementRules(rules){
  state.rules = rules.slice();
  const box=els.rulesBox; box.innerHTML='';
  state.rules.forEach((r,i)=>{
    const row=document.createElement('div');
    row.className='rule';
    row.innerHTML=`
      <div><strong class="mono">${r.target}</strong></div>
      <div>Pattern: ${r.pattern} · Density: <span class="mono">${Math.round(r.density*100)}%</span></div>
      <div>Mix: ${r.mix.join(' + ')}</div>
      <div class="row">
        <input type="range" min="0" max="100" value="${Math.round(r.density*100)}" />
        <button class="ghost danger" type="button">Delete</button>
      </div>
    `;
    const slider=row.querySelector('input[type=range]');
    const del=row.querySelector('button');
    const pct=row.querySelector('span.mono');

    slider.addEventListener('input',()=>{
      r.density=slider.value/100; pct.textContent=`${Math.round(r.density*100)}%`; drawRulesPreview();
    });
    del.addEventListener('click',()=>{ state.rules.splice(i,1); renderReplacementRules(state.rules); drawRulesPreview(); });
    box.appendChild(row);
  });
  drawRulesPreview();
}

// Demo preview so you see UI is alive
function drawRulesPreview(){
  const w=els.outCanvas.width, h=els.outCanvas.height; if(!w||!h) return;
  octx.clearRect(0,0,w,h);
  if(!state.rules.length){ octx.drawImage(els.srcCanvas,0,0,w,h); return; }
  const r0=state.rules[0];
  const a=hexToRgb(r0.mix[0]); const b=r0.mix[1]?hexToRgb(r0.mix[1]):a;
  const wgt=r0.density;
  const R=Math.round(a.r*wgt + b.r*(1-wgt));
  const G=Math.round(a.g*wgt + b.g*(1-wgt));
  const B=Math.round(a.b*wgt + b.b*(1-wgt));
  octx.fillStyle=rgbToHex(R,G,B);
  octx.fillRect(0,0,w,h);
  octx.globalAlpha=.25; octx.drawImage(els.srcCanvas,0,0,w,h); octx.globalAlpha=1;
}

// ----------------- Events -----------------
els.fileInput?.addEventListener('change', e=>{
  const f=e.target.files?.[0]; if(f) handleFile(f);
});
els.pasteBtn?.addEventListener('click', async ()=>{
  try{
    const items=await (navigator.clipboard?.read?.() ?? Promise.reject());
    for(const it of items){ for(const t of it.types){ if(t.startsWith('image/')){ const b=await it.getType(t); handleFile(b); return; } } }
    toast('No image in clipboard.');
  }catch{ toast('Clipboard read not supported here.'); }
});
els.resetBtn?.addEventListener('click',()=>{
  if(!state.fullBitmap) return; drawPreviewFromState(); drawRulesPreview();
});

els.btnSuggest?.addEventListener('click', ()=>{
  const inks=getEnabledRestrictedHexes();
  if(!state.imageLoaded || !inks.length){ toast('Load an image and enable inks first.'); return; }
  const rules=suggestReplacementsByHueAndLuma(inks,{whiteOK:state.allowWhite, pattern:els.texPattern?.value||'checker'});
  renderReplacementRules(rules);
});

// Projects drawer (stubs)
function wireProjectsUI(){
  const pane=els.projectsPane;
  document.getElementById('openProjects')?.addEventListener('click',()=>{ pane?.classList.add('open'); pane?.setAttribute('aria-hidden','false'); });
  els.closeProjects?.addEventListener('click',()=>{ pane?.classList.remove('open'); pane?.setAttribute('aria-hidden','true'); });
  els.refreshProjects?.addEventListener('click',()=>toast('Refresh projects (stub)'));
  els.saveProject?.addEventListener('click',()=>toast('Save project (stub)'));
  els.exportProject?.addEventListener('click',()=>toast('Export project (stub)'));
  els.importProject?.addEventListener('change',()=>toast('Import project (stub)'));
  els.deleteProject?.addEventListener('click',()=>toast('Delete project (stub)'));
}

// ----------------- Init -----------------
function init(){
  // give canvases a starting size so they’re visible
  els.srcCanvas.width=800; els.srcCanvas.height=500; sctx.fillStyle='#0a142b'; sctx.fillRect(0,0,800,500);
  els.outCanvas.width=800; els.outCanvas.height=500; octx.fillStyle='#0a142b'; octx.fillRect(0,0,800,500);
  wireProjectsUI();
  updateSuggestButtonState();
}
window.addEventListener('DOMContentLoaded', init);
