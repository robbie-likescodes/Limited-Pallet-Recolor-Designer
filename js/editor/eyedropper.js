import { State } from '../state.js';
import { rgbToHex } from '../color/space.js';
import { getEditorContexts } from './fullscreen.js';
import { toast } from '../ui/toasts.js';

export function enableEyedrop(els){
  const {canvas, ectx, ocanvas, octx} = getEditorContexts();
  if(!canvas) return;
  let timer=null, curr='#000000';

  function pick(evt){
    const rect=canvas.getBoundingClientRect();
    const x=Math.floor((evt.clientX-rect.left)*canvas.width/rect.width);
    const y=Math.floor((evt.clientY-rect.top )*canvas.height/rect.height);
    const d=ectx.getImageData(x,y,1,1).data;
    curr=rgbToHex(d[0],d[1],d[2]);
    if(els.eyeSwatch) els.eyeSwatch.style.background=curr;
    if(els.eyeHex) els.eyeHex.textContent=curr;
    octx.clearRect(0,0,ocanvas.width,ocanvas.height);
    octx.strokeStyle='#93c5fd'; octx.lineWidth=2; octx.beginPath(); octx.arc(x,y,14,0,Math.PI*2); octx.stroke();
  }
  function down(e){ e.preventDefault(); clearTimeout(timer); timer=setTimeout(()=>pick(e),220); }
  function move(e){ if(timer!==null) pick(e); }
  function up(){ clearTimeout(timer); timer=null; }

  canvas.addEventListener('pointerdown',down,{passive:false});
  canvas.addEventListener('pointermove',move,{passive:false});
  ['pointerup','pointerleave','pointercancel'].forEach(ev=>canvas.addEventListener(ev,up,{passive:false}));

  els.eyeAdd?.addEventListener('click', ()=>{
    if(!curr){ toast('Tap & hold on image to sample'); return; }
    // Push to palette UI via custom event; UI will handle row creation
    window.dispatchEvent(new CustomEvent('palette:add',{ detail: curr }));
    toast('Color added to palette');
  });
  els.eyeCancel?.addEventListener('click', ()=>{ octx.clearRect(0,0,ocanvas.width,ocanvas.height); });
}

