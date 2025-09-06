import { State, bus } from '../state.js';
import { isHeic, isLikelyJpeg, readJpegOrientation } from '../utils/image.js';
import { getOrientedDims, drawImageWithOrientation, fitPreviewW } from '../utils/canvas.js';
import { toast } from '../ui/toasts.js';

function loadImage(url){ return new Promise((res,rej)=>{ const img=new Image(); img.decoding='async'; img.onload=()=>res(img); img.onerror=rej; img.src=url; }); }

export async function handleFile(file){
  try{
    if(!file) return;
    if(isHeic(file)){ alert('HEIC/HEIF not supported; please use JPG/PNG.'); return; }
    let exif=1;

    // Fast path
    if(typeof createImageBitmap==='function'){
      try{
        const bmp=await createImageBitmap(file,{imageOrientation:'from-image'});
        State.original.bitmap=bmp; State.original.width=bmp.width; State.original.height=bmp.height; State.original.exif=1;
        drawPreview(); bus.emit('image:loaded'); return;
      }catch(e){ console.warn('createImageBitmap failed:',e); }
    }
    const url=URL.createObjectURL(file);
    try{
      const img=await loadImage(url);
      State.original.bitmap=img; State.original.width=img.naturalWidth||img.width; State.original.height=img.naturalHeight||img.height;
      exif = isLikelyJpeg(file) ? await readJpegOrientation(file) : 1;
      State.original.exif = exif;
      drawPreview(); bus.emit('image:loaded');
    } finally { URL.revokeObjectURL(url); }
  }catch(err){
    console.error(err); alert('Could not open that image. Try JPG/PNG.');
  }
}

export function drawPreview(){
  const bmp=State.original.bitmap; if(!bmp) return;
  const {w:ow,h:oh} = getOrientedDims(State.original.exif, State.original.width, State.original.height);
  const {w,h} = fitPreviewW(ow, oh, State.opts.maxPreviewW);
  const c=State.preview.canvas, ctx=State.preview.ctx; c.width=w; c.height=h; ctx.clearRect(0,0,w,h); ctx.imageSmoothingEnabled=false;
  if(State.original.exif===1 && bmp instanceof ImageBitmap) ctx.drawImage(bmp,0,0,w,h);
  else drawImageWithOrientation(ctx,bmp,w,h,State.original.exif);

  // reset mapped preview
  const oc=State.mapped.canvas, octx=State.mapped.ctx;
  oc.width=w; oc.height=h; octx.clearRect(0,0,w,h);
  toast('Image loaded ✔︎');
}

