// color/palette.js
import { rgbToHex } from './space.js';

function sampleForClusteringFast(ctx, w, h, targetPixels = 120000) {
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / targetPixels)));
  const data = ctx.getImageData(0, 0, w, h).data;
  const out = new Uint8ClampedArray(((Math.floor(h/step)+1) * (Math.floor(w/step)+1)) * 4);
  let si = 0;
  for (let y = 0; y < h; y += step) {
    let rowStart = y * w * 4;
    for (let x = 0; x < w; x += step) {
      const i = rowStart + x * 4;
      out[si++] = data[i];
      out[si++] = data[i + 1];
      out[si++] = data[i + 2];
      out[si++] = data[i + 3];
    }
  }
  return out;
}

function kmeansRGB(data, k = 6, iters = 10) {
  const n = data.length / 4;
  const centers = [];
  for (let c = 0; c < k; c++) {
    const idx = Math.floor((c + 0.5) * n / k);
    centers.push([data[idx*4], data[idx*4+1], data[idx*4+2]]);
  }
  const counts = new Array(k).fill(0);
  const sums = new Array(k).fill(0).map(() => [0,0,0]);

  for (let it = 0; it < iters; it++) {
    counts.fill(0); for (const s of sums) s[0]=s[1]=s[2]=0;
    for (let i = 0; i < n; i++) {
      if (data[i*4+3] < 8) continue; // ignore transparent
      const r = data[i*4], g = data[i*4+1], b = data[i*4+2];
      let best = 0, bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const dr=r-centers[c][0], dg=g-centers[c][1], db=b-centers[c][2];
        const d = dr*dr + dg*dg + db*db;
        if (d < bestD) { bestD = d; best = c; }
      }
      counts[best]++; sums[best][0]+=r; sums[best][1]+=g; sums[best][2]+=b;
    }
    for (let c = 0; c < k; c++) {
      if (counts[c] > 0) {
        centers[c][0] = Math.round(sums[c][0] / counts[c]);
        centers[c][1] = Math.round(sums[c][1] / counts[c]);
        centers[c][2] = Math.round(sums[c][2] / counts[c]);
      }
    }
  }
  return centers;
}

// Public: returns HEX[] (uppercased)
export function autoPaletteFromCanvasHybrid(canvas, k = 10) {
  if (!canvas || !canvas.width) return [];
  const ctx = canvas.getContext('2d', { willReadFrequently:true });
  const sampled = sampleForClusteringFast(ctx, canvas.width, canvas.height, 120000);
  const kk = Math.min(16, Math.max(2, (k|0)));
  const centers = kmeansRGB(sampled, kk, 10);
  return centers.map(([r,g,b]) => rgbToHex(r,g,b)).map(h => h.toUpperCase());
}
