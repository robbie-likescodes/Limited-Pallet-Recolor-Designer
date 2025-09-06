// mapping/mapper.js
import { rgbToLab, deltaE2Weighted } from '../color/space.js';

function buildPaletteLab(palette) {
  // palette is [{r,g,b,tol}] from app state
  return palette.map(p => ({ rgb:[p.r,p.g,p.b], lab: rgbToLab(p.r,p.g,p.b) }));
}

export function mapToPalette(imgData, palette, opts = {}) {
  const {
    wL = 1, wC = 1, dither = false, bgMode = 'keep',
    restricted = null
  } = opts;

  const w = imgData.width, h = imgData.height;
  const src = imgData.data;
  const out = new ImageData(w, h);
  out.data.set(src);

  // restrict palette if indices provided
  const palSrc = (Array.isArray(restricted) && restricted.length >= 1)
    ? restricted.map(i => palette[i]).filter(Boolean)
    : palette;

  const pal = buildPaletteLab(palSrc);

  // error buffers for FS dither
  const errR = dither ? new Float32Array(w*h) : null;
  const errG = dither ? new Float32Array(w*h) : null;
  const errB = dither ? new Float32Array(w*h) : null;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y*w + x, i4 = idx*4;
      if (out.data[i4+3] === 0) continue;

      let r = out.data[i4], g = out.data[i4+1], b = out.data[i4+2];
      if (dither) {
        r = Math.max(0, Math.min(255, Math.round(r + (errR[idx]||0))));
        g = Math.max(0, Math.min(255, Math.round(g + (errG[idx]||0))));
        b = Math.max(0, Math.min(255, Math.round(b + (errB[idx]||0))));
      }

      const lab = rgbToLab(r,g,b);
      let best = 0, bestD = Infinity;
      for (let p = 0; p < pal.length; p++) {
        const d2 = deltaE2Weighted(lab, pal[p].lab, wL, wC);
        if (d2 < bestD) { bestD = d2; best = p; }
      }
      const nr = pal[best].rgb[0], ng = pal[best].rgb[1], nb = pal[best].rgb[2];
      out.data[i4] = nr; out.data[i4+1] = ng; out.data[i4+2] = nb;

      if (dither) {
        const er = r - nr, eg = g - ng, eb = b - nb;
        // distribute error (Floyd–Steinberg)
        const push = (xx, yy, fr, fg, fb) => {
          if (xx<0 || xx>=w || yy<0 || yy>=h) return;
          const j = yy*w + xx;
          errR[j] = (errR[j]||0) + fr;
          errG[j] = (errG[j]||0) + fg;
          errB[j] = (errB[j]||0) + fb;
        };
        push(x+1,y,     er*7/16, eg*7/16, eb*7/16);
        push(x-1,y+1,   er*3/16, eg*3/16, eb*3/16);
        push(x,  y+1,   er*5/16, eg*5/16, eb*5/16);
        push(x+1,y+1,   er*1/16, eg*1/16, eb*1/16);
      }
    }
  }

  if (bgMode === 'white') {
    for (let i = 0; i < out.data.length; i+=4) out.data[i+3] = 255;
  }
  return out;
}
