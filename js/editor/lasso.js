import { State, addRegion } from '../state.js';
import { getEditorContexts } from './fullscreen.js';
import { toast } from '../ui/toasts.js';

export function enableLasso(els){
  const {canvas, ocanvas, octx} = getEditorContexts(); if(!canvas) return;
  let pts=[], active=false;

  function toMask(points, targetW, targetH){
    const tmp=document.createElement('canvas'); tmp.width=targetW; tmp.height=targetH; const tctx=tmp.getContext('2d');
    tctx.clearRect(0,0,targetW,targetH); tctx.fillStyle='#fff'; tctx.beginPath();
    tctx.moveTo(points[0][0]*targetW/canvas.width, points[0][1]*targetH/canvas.height);
    for(let i=1;i<points.length;i++){
      tctx.lineTo(points[i][0]*targetW/canvas.width, points[i][1]*targetH/canvas.height);
    }
    tctx.closePath(); tctx.fill();
    const id=tctx.getImageData(0,0,targetW,targetH).data; const mask=new Uint8Array(targetW*targetH);
    for(let i=0;i<mask.length;i++) mask[i]=id[i*4+3]>0?1:0;
    return mask;
  }

  function draw(close=false){
    octx.clearRect(0,0,ocanvas.width,ocanvas.height);
    if(pts.length<2) return;
    octx.lineWidth=2; octx.strokeStyle='#93c5fd'; octx.fillStyle='rgba(147,197,253,0.15)';
    octx.beginPath(); octx.moveTo(pts[0][0], pts[0][1]);
    for(let i=1;i<pts.length;i++) octx.lineTo(pts[i][0], pts[i][1]);
    if(close) octx.closePath(); octx.stroke(); if(close) octx.fill();
  }
  function pos(e){ const r=canvas.getBoundingClientRect(); return [ Math.round((e.clientX-r.left)*canvas.width/r.width), Math.round((e.clientY-r.top)*canvas.height/r.height) ]; }
  function down(e){ e.preventDefault(); pts=[]; active=true; pts.push(pos(e)); draw(false); }
  function move(e){ if(!active) return; e.preventDefault(); pts.push(pos(e)); draw(false); }
  function up(e){ if(!active) return; e.preventDefault(); active=false; draw(true); els.lassoSave.disabled=false; els.lassoClear.disabled=false; }

  canvas.addEventListener('pointerdown',down,{passive:false});
  canvas.addEventListener('pointermove',move,{passive:false});
  ['pointerup','pointerleave','pointercancel'].forEach(ev=>canvas.addEventListener(ev,up,{passive:false}));

  els.lassoClear?.addEventListener('click', ()=>{ pts=[]; draw(false); els.lassoSave.disabled=true; els.lassoClear.disabled=true; });
  els.lassoSave?.addEventListener('click', ()=>{
    if(!pts.length) return;
    // build allowed set from checkboxes in UI
    const checks=[...els.lassoChecks?.querySelectorAll('input[type=checkbox]')||[]];
    const allowed=new Set(); checks.forEach((cb,i)=>{ if(cb.checked) allowed.add(i); });
    const mask=toMask(pts, State.preview.canvas.width, State.preview.canvas.height);
    addRegion({ type:'polygon', points:pts.slice(), mask, allowed });
    toast('Region saved');
    pts=[]; draw(false); els.lassoSave.disabled=true; els.lassoClear.disabled=true;
  });
}

