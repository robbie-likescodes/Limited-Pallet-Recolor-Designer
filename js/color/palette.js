// color/palette.js
import { rgbToHex } from './space.js';

// Compact sampler + pure JS k-means (can be upgraded to worker)
export function sampleForClusteringFast(ctx, w, h, targetPixels = 120000) {
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / targetPixels)));
  const data = ctx.getImageData(0, 0, w, h).data;
  const out = new Uint8ClampedArray(((Math.floor(h/step)+1)*(Math.floor(w/step)+1))*4);
  let si=0;
  for (let y=0; y<h; y+=step) {
    let rowStart=y*w*4;
    for (let x=0; x<w; x+=step) {
      const i=rowStart + x*4;
      out[si++]=data[i]; out[si++]=data[i+1]; out[si++]=data[i+2]; out[si++]=data[i+3];
    }
  }
  return out;
}

export function kmeans(data, k=6, iters=10){
  const n=data.length/4;
  const centers=[]; for(let c=0;c<k;c++){ const idx=Math.floor((c+0.5)*n/k); centers.push([data[idx*4],data[idx*4+1],data[idx*4+2]]); }
  const counts=new Array(k).fill(0); const sums=new Array(k).fill(0).map(()=>[0,0,0]);
  for(let it=0; it<iters; it++){
    counts.fill(0); for(const s of sums){ s[0]=s[1]=s[2]=0; }
    for(let i=0;i<n;i++){
      const a=data[i*4+3]; if(a<8) continue;
      const r=data[i*4], g=data[i*4+1], b=data[i*4+2];
      let best=0, bestD=Infinity;
      for(let c=0;c<k;c++){
        const dr=r-centers[c][0], dg=g-centers[c][1], db=b-centers[c][2];
        const d=dr*dr+dg*dg+db*db; if(d<bestD){ bestD=d; best=c; }
      }
      counts[best]++; sums[best][0]+=r; sums[best][1]+=g; sums[best][2]+=b;
    }
    for(let c=0;c<k;c++){
      if(counts[c]>0){
        centers[c][0]=Math.round(sums[c][0]/counts[c]);
        centers[c][1]=Math.round(sums[c][1]/counts[c]);
        centers[c][2]=Math.round(sums[c][2]/counts[c]);
      }
    }
  }
  return centers;
}

// Returns array of HEX strings
export function autoPaletteFromCanvasHybrid(canvas, k=10){
  if(!canvas || !canvas.width) return [];
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  const w=canvas.width,h=canvas.height;
  const sampled = sampleForClusteringFast(ctx,w,h, 120000);
  const kk = Math.min(16, Math.max(2, (k|0)));
  const centers = kmeans(sampled, kk, 10);
  return centers.map(([r,g,b])=>rgbToHex(r,g,b));
}
