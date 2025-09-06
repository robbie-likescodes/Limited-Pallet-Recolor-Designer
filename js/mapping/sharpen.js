// mapping/sharpen.js
import { clamp } from '../utils/canvas.js';

export function unsharpMask(imageData, amount=0.35){
  const w=imageData.width, h=imageData.height, src=imageData.data;
  const out=new ImageData(w,h); out.data.set(src);
  const k=[0,-1,0,-1,5,-1,0,-1,0];
  for(let y=1;y<h-1;y++){
    for(let x=1;x<w-1;x++){
      let r=0,g=0,b=0, ki=0;
      for(let dy=-1;dy<=1;dy++){
        for(let dx=-1;dx<=1;dx++,ki++){
          const i=((y+dy)*w+(x+dx))*4; const kv=k[ki];
          r+=src[i]*kv; g+=src[i+1]*kv; b+=src[i+2]*kv;
        }
      }
      const o=(y*w+x)*4;
      out.data[o]   = clamp((1-amount)*src[o]   + amount*r, 0,255);
      out.data[o+1] = clamp((1-amount)*src[o+1] + amount*g, 0,255);
      out.data[o+2] = clamp((1-amount)*src[o+2] + amount*b, 0,255);
      out.data[o+3] = src[o+3];
    }
  }
  return out;
}
