export function unsharpMask(imageData, amount=0.35){
  const w=imageData.width, h=imageData.height, src=imageData.data;
  const out=new ImageData(w,h); out.data.set(src);
  const k=[0,-1,0,-1,5,-1,0,-1,0];
  for(let y=1;y<h-1;y++){
    for(let x=1;x<w-1;x++){
      let r=0,g=0,b=0,ki=0;
      for(let dy=-1;dy<=1;dy++){
        for(let dx=-1;dx<=1;dx++,ki++){
          const i=((y+dy)*w+(x+dx))*4, kv=k[ki];
          r+=src[i]*kv; g+=src[i+1]*kv; b+=src[i+2]*kv;
        }
      }
      const o=(y*w+x)*4;
      out.data[o]   = Math.max(0, Math.min(255, (1-amount)*src[o]   + amount*r));
      out.data[o+1] = Math.max(0, Math.min(255, (1-amount)*src[o+1] + amount*g));
      out.data[o+2] = Math.max(0, Math.min(255, (1-amount)*src[o+2] + amount*b));
      out.data[o+3] = src[o+3];
    }
  }
  return out;
}

