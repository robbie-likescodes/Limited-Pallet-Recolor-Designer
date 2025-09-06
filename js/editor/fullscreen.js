import { State, bus, addRegion } from '../state.js';
import { toast, helpOnce } from '../ui/toasts.js';

let overlay, canvas, ocanvas, ectx, octx;
let active=false;
export function initFullscreen(els){
  canvas=els.editCanvas; ocanvas=els.editOverlay; overlay=els.editorOverlay;
  ectx=canvas.getContext('2d',{willReadFrequently:true});
  octx=ocanvas.getContext('2d',{willReadFrequently:true});
  ectx.imageSmoothingEnabled=false; octx.imageSmoothingEnabled=false;

  els.openEditor?.addEventListener('click', open);
  els.editorDone?.addEventListener('click', close);

  helpOnce('editor_open','Tip: In the editor, long-press to eyedrop. Use Lasso to restrict inks in a region.');
  bus.on('image:loaded', ()=>{ if(active) draw(); });
}
function sizeToViewport(){
  const vw=window.innerWidth, vh=window.innerHeight;
  const rightW=(vw>900)?320:0, toolbarH=46;
  canvas.width=vw-rightW; canvas.height=vh-toolbarH;
  ocanvas.width=canvas.width; ocanvas.height=canvas.height;
}
function draw(){
  sizeToViewport();
  const src = State.preview.canvas;
  ectx.clearRect(0,0,canvas.width,canvas.height);
  ectx.drawImage(src,0,0,canvas.width,canvas.height);
}
export function open(){
  if(!State.original.bitmap){ toast('Load an image first'); return; }
  overlay.classList.remove('hidden'); overlay.setAttribute('aria-hidden','false'); active=true; draw();
}
export function close(){ overlay.classList.add('hidden'); overlay.setAttribute('aria-hidden','true'); active=false; }
export function getEditorContexts(){ return {ectx,octx,canvas,ocanvas}; }

