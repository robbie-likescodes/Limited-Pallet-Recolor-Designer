import { State, bus, setOption, setOriginalPalette, setRestrictedPalette, setTolerance, setReplacement, deleteReplacement, clearReplacements } from '../state.js';
import { loadPMS, paletteFromHexes, paletteToHexes, nearestPMS, ensureToleranceSlots } from '../color/palette.js';
import { suggestByHueAndLuma, suggestForTargetColor, patternFn } from '../color/suggest.js';
import { mapImage } from '../mapping/mapper.js';
import { unsharpMask } from '../mapping/sharpen.js';
import { exportFullPNG } from '../export/png.js';
import { exportSVGFromImageData } from '../export/svg.js';
import { toast, helpOnce } from './toasts.js';

function rgbToHexLocal([r,g,b]){ return '#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('').toUpperCase(); }

export function wireControls(els){
  // Cache canvases
  State.preview.canvas = els.srcCanvas; State.preview.ctx = els.srcCanvas.getContext('2d',{willReadFrequently:true});
  State.mapped.canvas  = els.outCanvas; State.mapped.ctx  = els.outCanvas.getContext('2d',{willReadFrequently:true});

  // Sliders / toggles
  const syncWeights=()=>{
    els.wChromaOut.textContent=(parseInt(els.wChroma.value,10)/100).toFixed(2)+'×';
    els.wLightOut.textContent =(parseInt(els.wLight.value,10)/100).toFixed(2)+'×';
    setOption('wChroma', parseInt(els.wChroma.value,10)/100);
    setOption('wLight',  parseInt(els.wLight.value,10)/100);
  };
  ['input','change'].forEach(ev=>{
    els.wChroma.addEventListener(ev, syncWeights);
    els.wLight .addEventListener(ev, syncWeights);
  });
  els.useDither.addEventListener('change', ()=> setOption('useDither', !!els.useDither.checked));
  els.keepFullRes.addEventListener('change', ()=> setOption('keepFullRes', !!els.keepFullRes.checked));
  if(els.sharpenEdges) els.sharpenEdges.addEventListener('change', ()=> setOption('sharpenEdges', !!els.sharpenEdges.checked));
  els.bgMode.addEventListener('change', ()=> setOption('bgMode', els.bgMode.value));
  els.maxW .addEventListener('change', ()=> setOption('maxPreviewW', parseInt(els.maxW.value,10)||1400));

  // Palette list UI
  function addPaletteRow(hex='#FFFFFF'){
    const row=document.createElement('div'); row.className='palette-item';
    row.innerHTML=`
      <input class="col" type="color" value="${hex}">
      <input class="hex" type="text" value="${hex}">
      <label class="t">Tol L <input class="tolL" type="range" min="50" max="200" value="100"></label>
      <label class="t">Tol C <input class="tolC" type="range" min="50" max="200" value="100"></label>
      <button class="ghost rm" type="button">Remove</button>
    `;
    const col=row.querySelector('.col'), hexInp=row.querySelector('.hex'), tolL=row.querySelector('.tolL'), tolC=row.querySelector('.tolC'), rm=row.querySelector('.rm');

    const syncHex=(fromColor)=>{
      if(fromColor) hexInp.value=col.value.toUpperCase();
      let v=hexInp.value.trim(); if(!v.startsWith('#')) v='#'+v;
      if(/^#([0-9A-Fa-f]{6})$/.test(v)){ col.value=v; hexInp.value=v.toUpperCase(); redrawCodes(); }
    };
    col.addEventListener('input',()=>{ syncHex(true); persistPalette(); });
    hexInp.addEventListener('change',()=>{ syncHex(false); persistPalette(); });

    tolL.addEventListener('input',()=>{ const idx=[...els.paletteList.children].indexOf(row); setTolerance(idx,{light:parseInt(tolL.value,10)/100, chroma:parseInt(tolC.value,10)/100}); });
    tolC.addEventListener('input',()=>{ const idx=[...els.paletteList.children].indexOf(row); setTolerance(idx,{light:parseInt(tolL.value,10)/100, chroma:parseInt(tolC.value,10)/100}); });

    rm.addEventListener('click',()=>{ row.remove(); persistPalette(); redrawCodes(); });

    els.paletteList.appendChild(row);
  }
  function getPaletteFromRows(){
    const rows=[...els.paletteList.querySelectorAll('.palette-item')];
    const out=[]; for(const r of rows){ const hx=r.querySelector('.hex').value.trim().toUpperCase(); const m=/^#([0-9A-F]{6})$/.test(hx); if(m){ const n=parseInt(hx.slice(1),16); out.push([ (n>>16)&255, (n>>8)&255, n&255 ]); } }
    return out;
  }
  function persistPalette(){
    const pal=getPaletteFromRows(); setOriginalPalette(pal); ensureToleranceSlots();
  }
  window.addEventListener('palette:add', (e)=>{ addPaletteRow(e.detail||'#FFFFFF'); persistPalette(); });

  els.addColor.addEventListener('click', ()=>{ addPaletteRow('#FFFFFF'); persistPalette(); });
  els.clearColors.addEventListener('click', ()=>{ els.paletteList.innerHTML=''; setOriginalPalette([]); });
  els.loadExample.addEventListener('click', ()=>{
    els.paletteList.innerHTML='';
    ['#FFFFFF','#B3753B','#5B3A21','#D22C2C','#1D6E2E','#000000'].forEach(addPaletteRow);
    persistPalette();
  });

  function redrawCodes(){
    const pal=getPaletteFromRows();
    const list=els.codeList;
    const lines = pal.map((rgb,i)=>{
      const hex = rgbToHexLocal(rgb);
      if(State.codeMode==='pms'){
        const p = nearestPMS(hex);
        return `<div class="row"><span class="sw" style="background:${p.hex}"></span>${i+1}. ${p.name} (${p.hex})</div>`;
      }
      return `<div class="row"><span class="sw" style="background:${hex}"></span>${i+1}. ${hex}</div>`;
    });
    list.innerHTML = lines.join('') || '<em>No colors</em>';
  }

  // Restricted palette selector
  function renderRestricted(){
    const wrap=els.restrictedPaletteList; if(!wrap) return;
    wrap.innerHTML='';
    const pal=State.originalPalette;
    pal.forEach((rgb,idx)=>{
      const id='r_'+idx;
      const hex=rgbToHexLocal(rgb);
      const div=document.createElement('label'); div.className='r-item';
      div.innerHTML=`<input type="checkbox" id="${id}" checked><span class="sw" style="background:${hex}"></span><span>${hex}</span>`;
      const cb=div.querySelector('input'); cb.checked = State.restrictedPalette.find(c=>c[0]===rgb[0]&&c[1]===rgb[1]&&c[2]===rgb[2])?true:false;
      cb.addEventListener('change',()=>{
        const now=[...wrap.querySelectorAll('input:checked')].map(inp=>{
          const el=inp.closest('.r-item'); const sw=el.querySelector('.sw'); const hx=sw.style.background; const n=parseInt(hx.slice(1),16); return [ (n>>16)&255, (n>>8)&255, n&255 ];
        });
        setRestrictedPalette(now);
      });
      wrap.appendChild(div);
    });
    if(!State.restrictedPalette.length) setRestrictedPalette(State.originalPalette.slice(0, Math.min(4, State.originalPalette.length)));
  }

  // Suggest by hue & luma
  els.btnSuggest?.addEventListener('click', ()=>{
    if(!State.originalPalette.length || !State.restrictedPalette.length){ toast('Set both palettes first'); return; }
    const src = State.preview.ctx.getImageData(0,0,State.preview.canvas.width, State.preview.canvas.height);
    const suggestions = suggestByHueAndLuma(src, State.originalPalette, State.restrictedPalette);
    if(!suggestions.size){ toast('No suggestions (palettes overlap)'); return; }
    // Render suggestions list
    renderSuggestions(suggestions);
    toast('Suggestions generated');
  });

  function renderSuggestions(map){
    const wrap=els.suggestList; if(!wrap) return; wrap.innerHTML='';
    map.forEach((mix,targetIdx)=>{
      const li=document.createElement('div'); li.className='mix-item';
      const targetHex=rgbToHexLocal(State.originalPalette[targetIdx]);
      li.innerHTML=`<div class="mix-head"><span class="sw" style="background:${targetHex}"></span><strong>${targetHex}</strong> →</div><div class="mix-controls"></div>`;
      const ctl=li.querySelector('.mix-controls');

      mix.forEach((m,mi)=>{
        const inkHex=rgbToHexLocal(State.restrictedPalette[m.inkIndex]);
        const row=document.createElement('div'); row.className='mix-row';
        row.innerHTML=`
          <span class="sw" style="background:${inkHex}"></span>
          <select class="pattern">
            <option value="bayer4" ${m.pattern==='bayer4'?'selected':''}>Bayer 4×4</option>
            <option value="bayer2" ${m.pattern==='bayer2'?'selected':''}>Bayer 2×2</option>
            <option value="checker" ${m.pattern==='checker'?'selected':''}>Checker</option>
            <option value="stripes" ${m.pattern==='stripes'?'selected':''}>Stripes</option>
            <option value="stipple" ${m.pattern==='stipple'?'selected':''}>Stipple</option>
          </select>
          <input class="density" type="range" min="0" max="100" value="${Math.round(m.density*100)}">
          <span class="mono densOut">${(m.density*100|0)}%</span>
        `;
        const pat=row.querySelector('.pattern'), den=row.querySelector('.density'), out=row.querySelector('.densOut');
        pat.addEventListener('change',()=>{ m.pattern=pat.value; commit(); });
        den.addEventListener('input',()=>{ m.density=parseInt(den.value,10)/100; out.textContent=(m.density*100|0)+'%'; commit(); });
        ctl.appendChild(row);
      });
      const bar=document.createElement('div'); bar.className='mix-bar';
      bar.innerHTML=`
        <button class="ghost apply" type="button">Apply</button>
        <button class="ghost del" type="button">Delete</button>
      `;
      bar.querySelector('.apply').addEventListener('click',()=>{ setReplacement(targetIdx, mix); toast('Applied'); });
      bar.querySelector('.del').addEventListener('click',()=>{ deleteReplacement(targetIdx); li.remove(); });
      li.appendChild(bar);
      wrap.appendChild(li);

      function commit(){ /* Live update stored suggestion UI only; apply button sets into state */ }
    });
  }

  // Manual replacement panel: choose target color and compose mix
  function wireManual(){
    if(!els.manualTarget || !els.manualMix) return;
    const tgtSel=els.manualTarget, mixWrap=els.manualMix;
    function renderTargetOptions(){
      tgtSel.innerHTML='';
      State.originalPalette.forEach((rgb,idx)=>{
        const opt=document.createElement('option'); opt.value=String(idx); opt.textContent=rgbToHexLocal(rgb);
        tgtSel.appendChild(opt);
      });
    }
    function renderMixRows(){
      mixWrap.innerHTML='';
      State.restrictedPalette.forEach((rgb, i)=>{
        const hex=rgbToHexLocal(rgb);
        const row=document.createElement('div'); row.className='mix-row';
        row.innerHTML=`
          <span class="sw" style="background:${hex}"></span>
          <select class="pattern">
            <option value="bayer4">Bayer 4×4</option>
            <option value="bayer2">Bayer 2×2</option>
            <option value="checker">Checker</option>
            <option value="stripes">Stripes</option>
            <option value="stipple">Stipple</option>
          </select>
          <input class="density" type="range" min="0" max="100" value="0">
          <span class="mono densOut">0%</span>
        `;
        const pat=row.querySelector('.pattern'), den=row.querySelector('.density'), out=row.querySelector('.densOut');
        den.addEventListener('input',()=> out.textContent=den.value+'%');
        row.dataset.inkIndex=String(i);
        mixWrap.appendChild(row);
      });
    }
    renderTargetOptions(); renderMixRows();
    els.manualApply?.addEventListener('click', ()=>{
      const tIdx=parseInt(tgtSel.value,10); if(Number.isNaN(tIdx)) return toast('Pick a target');
      const mix=[...mixWrap.querySelectorAll('.mix-row')].map(row=>{
        const inkIndex=parseInt(row.dataset.inkIndex,10);
        const density=parseInt(row.querySelector('.density').value,10)/100;
        const pattern=row.querySelector('.pattern').value;
        return {inkIndex,density,pattern,params:{}};
      }).filter(m=>m.density>0.001);
      if(!mix.length) return toast('Set at least one ink density');
      setReplacement(tIdx, mix); toast('Manual replacement set');
    });
  }

  // Regenerate mapping
  els.btnRegenerate?.addEventListener('click', ()=>{
    if(!State.original.bitmap) return toast('Load an image first');
    const src = State.preview.ctx.getImageData(0,0, State.preview.canvas.width, State.preview.canvas.height);
    const pal = State.restrictedPalette.length ? State.restrictedPalette : State.originalPalette;
    let out = mapImage(src, pal, {
      wLight: State.opts.wLight, wChroma: State.opts.wChroma, useDither: State.opts.useDither, bgMode: State.opts.bgMode
    });
    if(State.opts.sharpenEdges) out = unsharpMask(out, 0.35);

    // Draw scaled preview
    State.mapped.canvas.width=out.width; State.mapped.canvas.height=out.height;
    State.mapped.ctx.putImageData(out,0,0);

    // Also compute full-res if keepFullRes
    if(State.opts.keepFullRes){
      const fullC=document.createElement('canvas');
      const {width:ow, height:oh} = State.preview.canvas; // using preview dims for memory; swap with original full dims if needed
      fullC.width=State.preview.canvas.width; fullC.height=State.preview.canvas.height;
      const fx=fullC.getContext('2d',{willReadFrequently:true}); fx.drawImage(State.preview.canvas,0,0);
      const full = fx.getImageData(0,0,fullC.width,fullC.height);
      let outFull = mapImage(full, pal, { wLight: State.opts.wLight, wChroma: State.opts.wChroma, useDither: State.opts.useDither, bgMode: State.opts.bgMode });
      if(State.opts.sharpenEdges) outFull = unsharpMask(outFull,0.35);
      State.mapped.fullImageData = outFull;
    }else{
      State.mapped.fullImageData = out;
    }
    toast('Mapping updated');
  });

  // Export buttons
  els.downloadBtn?.addEventListener('click', ()=> exportFullPNG(State.mapped.fullImageData, 'mapped_fullres.png'));
  els.btnExportSVG?.addEventListener('click', ()=>{
    if(!State.mapped.fullImageData){ toast('Map first'); return;}
    exportSVGFromImageData(State.mapped.fullImageData, 'mapped_vector.svg');
  });

  // Report
  els.exportReport?.addEventListener('click', ()=>{
    import('../export/report.js').then(({buildFinalReport})=>{
      const txt=buildFinalReport(); const blob=new Blob([txt],{type:'text/plain'});
      const a=document.createElement('a'); a.download='final_inks_report.txt'; a.href=URL.createObjectURL(blob); a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1500);
    });
  });

  // Restricted palette open
  els.btnOpenRestricted?.addEventListener('click', ()=>{
    if(!State.originalPalette.length){ toast('Create a base palette first'); return; }
    renderRestricted(); toast('Select inks to keep');
  });

  // Init defaults
  syncWeights(); redrawCodes(); wireManual();

  // React to palette changes
  bus.on('palette:original', ()=>{ redrawCodes(); renderRestricted(); });
  bus.on('palette:restricted', ()=>{ /* could repaint badges */ });

  helpOnce('suggest','Tip: Set the Restricted Palette, then “Suggest by Hue & Luma” to auto-create mixes. You can tweak densities and patterns per suggestion.');
}

