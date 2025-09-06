// app.js — minimal but complete wiring for: image load/preview,
// restricted palette with color dots, suggest-by-hue&luma button,
// replacement rules UI, and projects drawer toggle.

// =============== DOM refs ===============
const els = {
  // image
  fileInput: document.getElementById('fileInput'),
  pasteBtn: document.getElementById('pasteBtn'),
  resetBtn: document.getElementById('resetBtn'),
  srcCanvas: document.getElementById('srcCanvas'),
  outCanvas: document.getElementById('outCanvas'),

  // working palette
  workingList: document.getElementById('workingList'),

  // restricted palette
  rpList: document.getElementById('restrictedList'),
  rpSelectAll: document.getElementById('rpSelectAll'),
  rpSelectNone: document.getElementById('rpSelectNone'),
  rpAllowWhite: document.getElementById('rpAllowWhite'),

  // suggestions
  btnSuggest: document.getElementById('btnSuggestHueLuma'),
  texPattern: document.getElementById('texPattern'),
  rulesBox: document.getElementById('replacementRules'),

  // projects
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

const sctx = els.srcCanvas.getContext('2d', { willReadFrequently: true });
const octx = els.outCanvas.getContext('2d', { willReadFrequently: true });
sctx.imageSmoothingEnabled = false;
octx.imageSmoothingEnabled = false;

// =============== State ===============
const state = {
  imageLoaded: false,
  img: null,
  paletteHex: [],     // working palette as HEX strings
  restricted: [],     // [{hex, enabled}]
  allowWhite: true,
  rules: [],          // [{target, pattern, density[0..1], mix:[hex,...]}]
};

// =============== Utils ===============
const clamp = (v,min,max)=>v<min?min:(v>max?max:v);
const rgbToHex = (r,g,b)=>'#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('').toUpperCase();
function hexToRgb(h){ const m=/^#?([0-9a-f]{6})$/i.exec(h||''); if(!m) return null; const n=parseInt(m[1],16); return {r:(n>>16)&255,g:(n>>8)&255,b:n&255}; }

// quick/rough palette extractor (downsample + 5-bit bins + K seeds)
function extractPaletteFromCanvas(canvas,k=10){
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  const w=canvas.width,h=canvas.height;
  if(!w||!h){ return ['#FFFFFF','#000000']; }
  const step=Math.max(1,Math.floor(Math.sqrt((w*h)/120000)));
  const bins=new Map();
  for(let y=0;y<h;y+=step){
    const row=ctx.getImageData(0,y,w,1).data;
    for(let x=0;x<w;x+=step){
      const i=x*4; const a=row[i+3]; if(a<8) continue;
      const r=row[i]>>3,g=row[i+1]>>3,b=row[i+2]>>3;
      const key=(r<<10)|(g<<5)|b; bins.set(key,(bins.get(key)||0)+1);
    }
  }
  const picks=[...bins.entries()].sort((a,b)=>b[1]-a[1]).slice(0,k)
    .map(([key])=>rgbToHex(((key>>10)&31)<<3, ((key>>5)&31)<<3, (key&31)<<3));
  // ensure white & black often present
  if(!picks.includes('#FFFFFF')) picks.unshift('#FFFFFF');
  if(!picks.includes('#000000')) picks.push('#000000');
  return Array.from(new Set(picks)).slice(0,k);
}

// =============== Image load ===============
function objectUrlFor(file){ return URL.createObjectURL(file); }
function revokeUrl(u){ try{ URL.revokeObjectURL(u); }catch{} }
function loadImage(url){ return new Promise((res,rej)=>{ const img=new Image(); img.onload=()=>res(img); img.onerror=rej; img.src=url; }); }

async function handleFile(file){
  try{
    if(!file) return;
    const url=objectUrlFor(file);
    const img=await loadImage(url);
    revokeUrl(url);
    state.img=img;
    drawPreview(img);
    state.imageLoaded=true;

    // create working palette from preview
    state.paletteHex = extractPaletteFromCanvas(els.srcCanvas, 10);
    renderWorkingPalette();
    syncRestrictedFromPalette();
    renderRestrictedPalette();
    updateSuggestButtonState();
  }catch(e){
    alert('Could not open that image. Try a JPG/PNG.');
    console.error(e);
  }
}

function drawPreview(img){
  // fit into preview width
  const MAX_W = 1400;
  let w=img.naturalWidth||img.width, h=img.naturalHeight||img.height;
  if(w>MAX_W){ const s=MAX_W/w; w=Math.round(w*s); h=Math.round(h*s); }
  els.srcCanvas.width=w; els.srcCanvas.height=h;
  sctx.clearRect(0,0,w,h);
  sctx.drawImage(img,0,0,w,h);

  els.outCanvas.width=w; els.outCanvas.height=h;
  octx.clearRect(0,0,w,h);
}

// =============== Working palette UI ===============
function renderWorkingPalette(){
  const box=els.workingList; if(!box) return; box.innerHTML='';
  state.paletteHex.forEach(h=>{
    const row=document.createElement('div'); row.className='palette-item';
    row.innerHTML=`<span class="sw" style="background:${h}"></span><span class="mono">${h}</span>`;
    box.appendChild(row);
  });
}

// =============== Restricted palette logic ===============
function syncRestrictedFromPalette() {
  if (!state.paletteHex || !state.paletteHex.length) return;
  if (!state.restricted.length) {
    state.restricted = state.paletteHex.map(h => ({ hex: h.toUpperCase(), enabled: true }));
  } else {
    const map = new Map(state.restricted.map(r => [r.hex.toUpperCase(), r.enabled]));
    state.restricted = state.paletteHex.map(h => ({ hex: h.toUpperCase(), enabled: map.get(h.toUpperCase()) ?? true }));
  }
}

function renderRestrictedPalette() {
  const box = els.rpList; if(!box) return; box.innerHTML='';

  state.restricted.forEach((ink, idx) => {
    const row = document.createElement('div');
    row.className='rp-item';
    row.innerHTML = `
      <input type="checkbox" ${ink.enabled?'checked':''} aria-label="enable ink">
      <span class="dot" style="background:${ink.hex}"></span>
      <input type="text" value="${ink.hex}" aria-label="hex">
      <button type="button" class="ghost remove">x</button>
    `;
    const cb=row.querySelector('input[type=checkbox]');
    const hexInput=row.querySelector('input[type=text]');
    const dot=row.querySelector('.dot');
    const removeBtn=row.querySelector('.remove');

    cb.addEventListener('change',()=>{ ink.enabled=cb.checked; updateSuggestButtonState(); });

    hexInput.addEventListener('change',()=>{
      let v=hexInput.value.trim(); if(!v.startsWith('#')) v='#'+v;
      if(!/^#([0-9A-Fa-f]{6})$/.test(v)){ hexInput.value=ink.hex; return; }
      ink.hex=v.toUpperCase(); dot.style.background=ink.hex; updateSuggestButtonState();
    });

    removeBtn.addEventListener('click',()=>{
      state.restricted.splice(idx,1);
      renderRestrictedPalette();
      updateSuggestButtonState();
    });

    box.appendChild(row);
  });

  els.rpSelectAll?.addEventListener('click',()=>{
    state.restricted.forEach(r=>r.enabled=true);
    renderRestrictedPalette(); updateSuggestButtonState();
  });
  els.rpSelectNone?.addEventListener('click',()=>{
    state.restricted.forEach(r=>r.enabled=false);
    renderRestrictedPalette(); updateSuggestButtonState();
  });
  els.rpAllowWhite?.addEventListener('change',()=>{
    state.allowWhite=!!els.rpAllowWhite.checked;
    updateSuggestButtonState();
  });
}

function getEnabledRestrictedHexes(){
  return state.restricted.filter(r=>r.enabled).map(r=>r.hex.toUpperCase());
}

function updateSuggestButtonState(){
  const btn=els.btnSuggest; if(!btn) return;
  const inks=getEnabledRestrictedHexes();
  const ok = state.imageLoaded && (inks.length>=2 || (inks.length>=1 && state.allowWhite));
  btn.disabled = !ok;
}

// =============== Suggest by Hue & Luma (simple impl) ===============
function grayness({r,g,b}){ const mx=Math.max(r,g,b), mn=Math.min(r,g,b); return 1 - (mx-mn)/Math.max(1,mx); } // 1=gray, 0=highly chromatic
function luma({r,g,b}){ return 0.2126*r + 0.7152*g + 0.0722*b; }

function suggestReplacementsByHueAndLuma(enabledInks, opts){
  // Very lightweight suggestion: for each “non-restricted” working color,
  // choose up to 2 inks (or ink+white) whose linear combination best matches luma and hue.
  const pattern = opts.pattern || 'checker';
  const rules=[];
  const allowedSet=new Set(enabledInks.map(h=>h.toUpperCase()));
  const work=state.paletteHex;

  const white = '#FFFFFF';
  const inkPool = enabledInks.slice();
  if (opts.whiteOK && !inkPool.includes(white)) inkPool.push(white);

  // Helper: best 2-ink combo by luma (coarse grid)
  const best2Mix = (targetHex)=>{
    const t=hexToRgb(targetHex);
    let best=null, bestErr=1e9, bestPair=null, bestD=0.5;
    for(let i=0;i<inkPool.length;i++){
      for(let j=i+1;j<inkPool.length;j++){
        const a=hexToRgb(inkPool[i]), b=hexToRgb(inkPool[j]);
        for(let d=0; d<=10; d++){
          const w=d/10;
          const r=Math.round(a.r*w + b.r*(1-w));
          const g=Math.round(a.g*w + b.g*(1-w));
          const bch=Math.round(a.b*w + b.b*(1-w));
          const dl=Math.abs(luma({r,g,b:bch}) - luma(t));
          const dh = grayness(t) - grayness({r,g,b:bch});
          const err = dl*0.9 + Math.abs(dh)*0.1;
          if(err<bestErr){ bestErr=err; bestPair=[inkPool[i],inkPool[j]]; bestD=w; }
        }
      }
    }
    return { mix: bestPair||[inkPool[0]], density: bestD };
  };

  // For each working color that is NOT restricted, propose a rule
  work.forEach(hex=>{
    if (allowedSet.has(hex)) return; // already allowed ink
    if (inkPool.length<1) return;
    const {mix,density}=best2Mix(hex);
    rules.push({ target: hex, pattern, density, mix });
  });

  return rules;
}

function renderReplacementRules(rules){
  state.rules = rules.slice();
  const box=els.rulesBox; if(!box) return;
  box.innerHTML='';
  state.rules.forEach((r,i)=>{
    const row=document.createElement('div');
    row.className='rule';
    const mixLabel = r.mix.join(' + ');
    row.innerHTML=`
      <div><strong class="mono">${r.target}</strong></div>
      <div>Pattern: ${r.pattern} &nbsp;·&nbsp; Density: <span class="mono">${Math.round(r.density*100)}%</span></div>
      <div>Mix: ${mixLabel}</div>
      <div class="row">
        <input type="range" min="0" max="100" value="${Math.round(r.density*100)}" />
        <button class="ghost danger" type="button">Delete</button>
      </div>
    `;
    const slider=row.querySelector('input[type=range]');
    const del=row.querySelector('button');
    const pct=row.querySelector('span.mono');
    slider.addEventListener('input',()=>{
      r.density=slider.value/100;
      pct.textContent = `${Math.round(r.density*100)}%`;
      // hook: re-render mapped preview if desired
      drawRulesPreview();
    });
    del.addEventListener('click',()=>{
      state.rules.splice(i,1);
      renderReplacementRules(state.rules);
      drawRulesPreview();
    });
    box.appendChild(row);
  });
  drawRulesPreview();
}

// Demo preview: just flood fill with average of first rule to show it’s wired.
// (Replace with your real mapping + pattern render)
function drawRulesPreview(){
  const w=els.outCanvas.width, h=els.outCanvas.height;
  if(!w||!h) return;
  octx.clearRect(0,0,w,h);
  if(!state.rules.length){ octx.drawImage(els.srcCanvas,0,0,w,h); return; }
  const r0=state.rules[0];
  const a=hexToRgb(r0.mix[0]); const b=r0.mix[1]?hexToRgb(r0.mix[1]):a;
  const wgt=r0.density;
  const r=Math.round(a.r*wgt + b.r*(1-wgt));
  const g=Math.round(a.g*wgt + b.g*(1-wgt));
  const bl=Math.round(a.b*wgt + b.b*(1-wgt));
  octx.fillStyle=rgbToHex(r,g,bl);
  octx.fillRect(0,0,w,h);
  octx.globalAlpha=0.25;
  octx.drawImage(els.srcCanvas,0,0,w,h);
  octx.globalAlpha=1;
}

// =============== Events ===============
els.fileInput?.addEventListener('change', e=>{
  const f=e.target.files?.[0]; if(f) handleFile(f);
});
els.pasteBtn?.addEventListener('click', async ()=>{
  if(!navigator.clipboard || !navigator.clipboard.read){ alert('Clipboard not supported here.'); return; }
  try{
    const items=await navigator.clipboard.read();
    for(const it of items){ for(const t of it.types){ if(t.startsWith('image/')){ const b=await it.getType(t); handleFile(b); return; } } }
    alert('No image in clipboard.');
  }catch{ alert('Clipboard read failed.'); }
});
els.resetBtn?.addEventListener('click',()=>{
  if(!state.img) return;
  drawPreview(state.img);
  drawRulesPreview();
});

els.btnSuggest?.addEventListener('click', ()=>{
  const inks = getEnabledRestrictedHexes();
  if(!state.imageLoaded || !inks.length) return;
  const rules = suggestReplacementsByHueAndLuma(inks, { whiteOK: state.allowWhite, pattern: els.texPattern?.value || 'checker' });
  renderReplacementRules(rules);
});

// Projects Drawer
function wireProjectsUI(){
  const pane=els.projectsPane;
  els.openProjects?.addEventListener('click',()=>{ pane?.classList.add('open'); pane?.setAttribute('aria-hidden','false'); });
  els.closeProjects?.addEventListener('click',()=>{ pane?.classList.remove('open'); pane?.setAttribute('aria-hidden','true'); });
  // Stub actions to avoid “undefined” errors (replace with your IndexedDB impl)
  els.refreshProjects?.addEventListener('click',()=>alert('Refresh projects (stub).'));
  els.saveProject?.addEventListener('click',()=>alert('Save project (stub).'));
  els.exportProject?.addEventListener('click',()=>alert('Export project (stub).'));
  els.importProject?.addEventListener('change',()=>alert('Import project (stub).'));
  els.deleteProject?.addEventListener('click',()=>alert('Delete project (stub).'));
}

// =============== Init ===============
function init(){
  wireProjectsUI();
  // initial empty canvases
  els.srcCanvas.width=800; els.srcCanvas.height=500; sctx.fillStyle='#0a142b'; sctx.fillRect(0,0,800,500);
  els.outCanvas.width=800; els.outCanvas.height=500; octx.fillStyle='#0a142b'; octx.fillRect(0,0,800,500);
  // no palette yet
  updateSuggestButtonState();
}

window.addEventListener('DOMContentLoaded', init);
