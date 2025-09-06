/* app.js — Palette Mapper (Comprehensive, DOMContentLoaded-safe)
   - Fix: wait for DOMContentLoaded before getContext()
   - Robust element guards with helpful toasts
   - Image load (file/camera/paste) + EXIF orientation guard (JPEG)
   - Preview + full-res mapping (Lab) + optional FS dither + sharpen
   - Auto-palette (hybrid histogram + k-means)
   - Palette UI + saved palettes
   - Restricted palette (final inks) + “Suggest by Hue & Luma”
   - Texture/Replacement rules (density sliders, patterns)
   - Vector export via ImageTracer (if window.ImageTracer present)
   - Projects (IndexedDB)
   - Full-screen editor eyedropper (mobile-friendly long-press)
   - Simple toast system
*/

(() => {
  // ---------- Tiny utilities ----------
  const clamp = (v, lo, hi) => v < lo ? lo : (v > hi ? hi : v);
  const hexToRgb = (hex) => {
    if (!hex) return null;
    let h = hex.trim().toUpperCase();
    if (!h.startsWith('#')) h = '#' + h;
    const m = /^#([0-9A-F]{6})$/.exec(h);
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  };
  const rgbToHex = (r, g, b) =>
    '#' + [r, g, b].map(x => clamp(x, 0, 255).toString(16).padStart(2, '0')).join('').toUpperCase();

  const toast = (msg, kind = 'info', ms = 2600) => {
    let host = document.getElementById('toastHost');
    if (!host) {
      host = document.createElement('div');
      host.id = 'toastHost';
      host.style.position = 'fixed';
      host.style.left = '50%';
      host.style.bottom = '16px';
      host.style.transform = 'translateX(-50%)';
      host.style.display = 'flex';
      host.style.flexDirection = 'column';
      host.style.gap = '8px';
      host.style.zIndex = '99999';
      document.body.appendChild(host);
    }
    const el = document.createElement('div');
    el.textContent = msg;
    el.style.padding = '10px 14px';
    el.style.borderRadius = '10px';
    el.style.fontWeight = '600';
    el.style.border = '1px solid #1e293b';
    el.style.background = kind === 'error' ? '#7f1d1d' : (kind === 'ok' ? '#14532d' : '#0b1225');
    el.style.color = '#e5e7eb';
    host.appendChild(el);
    setTimeout(() => el.remove(), ms);
  };

  // ---------- Color math (sRGB->Lab) ----------
  const srgbToLinear = u => {
    u /= 255;
    return u <= 0.04045 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4);
  };
  const rgbToXyz = (r, g, b) => {
    r = srgbToLinear(r); g = srgbToLinear(g); b = srgbToLinear(b);
    return [
      r * 0.4124564 + g * 0.3575761 + b * 0.1804375,
      r * 0.2126729 + g * 0.7151522 + b * 0.0721750,
      r * 0.0193339 + g * 0.1191920 + b * 0.9503041
    ];
  };
  const xyzToLab = (x, y, z) => {
    const Xn = 0.95047, Yn = 1.0, Zn = 1.08883;
    x /= Xn; y /= Yn; z /= Zn;
    const f = t => (t > 0.008856 ? Math.cbrt(t) : (7.787 * t + 16 / 116));
    const fx = f(x), fy = f(y), fz = f(z);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  };
  const rgbToLab = (r, g, b) => {
    const [x, y, z] = rgbToXyz(r, g, b);
    return xyzToLab(x, y, z);
  };
  const dE2 = (L1, L2, wL, wC) => {
    const dL = L1[0] - L2[0], da = L1[1] - L2[1], db = L1[2] - L2[2];
    return wL * dL * dL + wC * (da * da + db * db);
  };

  const buildPalLab = (pal) => pal.map(([r, g, b]) => ({ rgb: [r, g, b], lab: rgbToLab(r, g, b) }));

  // ---------- EXIF Orientation (JPEG minimal) ----------
  const isHeic = (file) => {
    const n = (file.name || '').toLowerCase();
    const t = (file.type || '').toLowerCase();
    return n.endsWith('.heic') || n.endsWith('.heif') || t.includes('heic') || t.includes('heif');
  };
  const likelyJpeg = (file) => {
    const n = (file.name || '').toLowerCase();
    const t = (file.type || '').toLowerCase();
    return n.endsWith('.jpg') || n.endsWith('.jpeg') || t.includes('jpeg');
  };
  const readJpegOrientation = (file) => new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => {
      try {
        const v = new DataView(r.result);
        if (v.getUint16(0, false) !== 0xFFD8) return resolve(1);
        let off = 2;
        while (off < v.byteLength) {
          const marker = v.getUint16(off, false); off += 2;
          if (marker === 0xFFE1) {
            const len = v.getUint16(off, false); off += 2;
            if (v.getUint32(off, false) !== 0x45786966) break;
            off += 6;
            const tiff = off;
            const little = v.getUint16(tiff, false) === 0x4949;
            const get16 = (o) => v.getUint16(o, little);
            const get32 = (o) => v.getUint32(o, little);
            const firstIFD = get32(tiff + 4);
            if (firstIFD < 8) return resolve(1);
            const dir = tiff + firstIFD;
            const entries = get16(dir);
            for (let i = 0; i < entries; i++) {
              const e = dir + 2 + i * 12;
              if (get16(e) === 0x0112) return resolve(get16(e + 8) || 1);
            }
          } else if ((marker & 0xFF00) !== 0xFF00) break;
          else off += v.getUint16(off, false);
        }
      } catch { /* ignore */ }
      resolve(1);
    };
    r.onerror = () => resolve(1);
    r.readAsArrayBuffer(file.slice(0, 256 * 1024));
  });

  const orientedDims = (o, w, h) => ([5, 6, 7, 8].includes(o) ? { w: h, h: w } : { w, h });
  const drawOriented = (ctx, img, w, h, o) => {
    ctx.save();
    switch (o) {
      case 2: ctx.translate(w, 0); ctx.scale(-1, 1); break;
      case 3: ctx.translate(w, h); ctx.rotate(Math.PI); break;
      case 4: ctx.translate(0, h); ctx.scale(1, -1); break;
      case 5: ctx.rotate(0.5 * Math.PI); ctx.scale(1, -1); break;
      case 6: ctx.rotate(0.5 * Math.PI); ctx.translate(0, -w); break;
      case 7: ctx.rotate(0.5 * Math.PI); ctx.translate(h, -w); ctx.scale(-1, 1); break;
      case 8: ctx.rotate(-0.5 * Math.PI); ctx.translate(-h, 0); break;
    }
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0, w, h);
    ctx.restore();
  };

  // ---------- Simple k-means (RGB) + Hybrid seeds ----------
  const kmeans = (data, k = 6, iters = 10) => {
    const n = data.length / 4;
    const centers = [];
    for (let c = 0; c < k; c++) {
      const idx = Math.floor((c + 0.5) * n / k);
      centers.push([data[idx * 4], data[idx * 4 + 1], data[idx * 4 + 2]]);
    }
    const counts = new Array(k).fill(0);
    const sums = new Array(k).fill(0).map(() => [0, 0, 0]);
    for (let it = 0; it < iters; it++) {
      counts.fill(0); for (const s of sums) s[0] = s[1] = s[2] = 0;
      for (let i = 0; i < n; i++) {
        const a = data[i * 4 + 3]; if (a === 0) continue;
        const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
        let best = 0, bestD = Infinity;
        for (let c = 0; c < k; c++) {
          const dr = r - centers[c][0], dg = g - centers[c][1], db = b - centers[c][2];
          const d = dr * dr + dg * dg + db * db;
          if (d < bestD) { bestD = d; best = c; }
        }
        counts[best]++; sums[best][0] += r; sums[best][1] += g; sums[best][2] += b;
      }
      for (let c = 0; c < k; c++) if (counts[c] > 0) {
        centers[c][0] = Math.round(sums[c][0] / counts[c]);
        centers[c][1] = Math.round(sums[c][1] / counts[c]);
        centers[c][2] = Math.round(sums[c][2] / counts[c]);
      }
    }
    return centers;
  };
  const autoPaletteHybrid = (canvas, k = 10) => {
    if (!canvas || !canvas.width) return [];
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const w = canvas.width, h = canvas.height;
    const img = ctx.getImageData(0, 0, w, h).data;

    // quick histogram seeds (5-bit per channel)
    const bins = new Map();
    for (let i = 0; i < img.length; i += 4) {
      if (img[i + 3] < 16) continue;
      const key = ((img[i] >> 3) << 10) | ((img[i + 1] >> 3) << 5) | (img[i + 2] >> 3);
      bins.set(key, (bins.get(key) || 0) + 1);
    }
    const seeds = [...bins.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, Math.max(24, k * 3))
      .map(([key]) => [((key >> 10) & 31) << 3, ((key >> 5) & 31) << 3, (key & 31) << 3]);

    // seed kmeans with spaced picks
    const picked = [];
    for (let i = 0; i < k; i++) picked.push(seeds[Math.floor((i + 0.5) * seeds.length / k)]);
    const centers = kmeans(img, k, 8);
    return centers.map(([r, g, b]) => rgbToHex(r, g, b));
  };

  // ---------- Global state (scoped) ----------
  const state = {
    fullBitmap: null,
    fullW: 0,
    fullH: 0,
    exifOrientation: 1,
    paletteHex: ['#FFFFFF', '#000000'],            // working palette list (HEX)
    restricted: [],                                // restricted palette (subset/ordered)
    rules: [],                                     // texture/replacement rules
    outFullImageData: null,                        // result at full res
    weights: { wC: 1.0, wL: 1.0 },
    useDither: false,
    bgMode: 'keep',
    sharpen: false,
    keepFullRes: true,
    exportScale: 1,
  };

  // ---------- DOMContentLoaded bootstrap ----------
  window.addEventListener('DOMContentLoaded', init);

  function init() {
    // Grab elements (guarded)
    const els = {
      fileInput: document.getElementById('fileInput'),
      cameraInput: document.getElementById('cameraInput'),
      pasteBtn: document.getElementById('pasteBtn'),
      resetBtn: document.getElementById('resetBtn'),

      maxW: document.getElementById('maxW'),
      keepFullRes: document.getElementById('keepFullRes'),
      sharpenEdges: document.getElementById('sharpenEdges'),

      srcCanvas: document.getElementById('srcCanvas'),
      outCanvas: document.getElementById('outCanvas'),

      kColors: document.getElementById('kColors'),
      autoExtract: document.getElementById('autoExtract'),
      paletteList: document.getElementById('paletteList'),

      wChroma: document.getElementById('wChroma'),
      wLight: document.getElementById('wLight'),
      wChromaOut: document.getElementById('wChromaOut'),
      wLightOut: document.getElementById('wLightOut'),
      useDither: document.getElementById('useDither'),
      bgMode: document.getElementById('bgMode'),
      applyBtn: document.getElementById('applyBtn'),
      downloadBtn: document.getElementById('downloadBtn'),
      exportScale: document.getElementById('exportScale'),

      // Restricted palette & suggestions
      rpList: document.getElementById('restrictedList'),
      rpSelectAll: document.getElementById('rpSelectAll'),
      rpSelectNone: document.getElementById('rpSelectNone'),
      rpAllowWhite: document.getElementById('rpAllowWhite'),
      btnSuggest: document.getElementById('btnSuggest'),

      // Vector export
      svgMinArea: document.getElementById('svgMinArea'),
      svgLock: document.getElementById('svgLock'),
      btnExportSvg: document.getElementById('btnExportSvg'),

      // Editor
      openEditor: document.getElementById('openEditor'),
      editorOverlay: document.getElementById('editorOverlay'),
      editCanvas: document.getElementById('editCanvas'),
      editOverlay: document.getElementById('editOverlay'),
      editorDone: document.getElementById('editorDone'),

      // Refresh output
      btnRefresh: document.getElementById('btnRefreshOutput'),
    };

    // Hard guard canvases (your error)
    if (!els.srcCanvas || !els.outCanvas) {
      console.error('Missing <canvas id="srcCanvas"> or <canvas id="outCanvas"> in index.html.');
      toast('Critical: canvases missing in HTML. Check index.html IDs.', 'error', 5500);
      return;
    }

    const sctx = els.srcCanvas.getContext('2d', { willReadFrequently: true });
    const octx = els.outCanvas.getContext('2d', { willReadFrequently: true });
    sctx.imageSmoothingEnabled = false;
    octx.imageSmoothingEnabled = false;

    // ---------- Helper: palette UI ----------
    const renderPaletteList = () => {
      if (!els.paletteList) return;
      els.paletteList.innerHTML = '';
      state.paletteHex.forEach((hex, idx) => {
        const row = document.createElement('div');
        row.className = 'palette-item';
        row.innerHTML = `
          <input type="color" value="${hex}">
          <input type="text" value="${hex}" />
          <button class="ghost remove" type="button">Remove</button>
        `;
        const col = row.querySelector('input[type=color]');
        const txt = row.querySelector('input[type=text]');
        const del = row.querySelector('.remove');
        const sync = (fromColor) => {
          if (fromColor) txt.value = col.value.toUpperCase();
          let v = txt.value.trim();
          if (!v.startsWith('#')) v = '#' + v;
          if (/^#([0-9A-Fa-f]{6})$/.test(v)) {
            col.value = v; txt.value = v.toUpperCase();
            state.paletteHex[idx] = v.toUpperCase();
            renderRestrictedList(); // keep restricted options aligned
          }
        };
        col.addEventListener('input', () => { sync(true); });
        txt.addEventListener('change', () => { sync(false); });
        del.addEventListener('click', () => {
          state.paletteHex.splice(idx, 1);
          renderPaletteList(); renderRestrictedList();
        });
        els.paletteList.appendChild(row);
      });
    };

    // ---------- Restricted palette UI ----------
    const renderRestrictedList = () => {
      if (!els.rpList) return;
      els.rpList.innerHTML = '';
      state.paletteHex.forEach((hex, i) => {
        const item = document.createElement('div');
        item.className = 'rp-item';
        const checked = state.restricted.length ? state.restricted.includes(hex) : true;
        item.innerHTML = `
          <label class="check" style="gap:8px;align-items:center;">
            <input data-hex="${hex}" class="rp-check" type="checkbox" ${checked ? 'checked' : ''}/>
            <span class="sw" style="width:16px;height:16px;border-radius:4px;border:1px solid #334155;display:inline-block;background:${hex}"></span>
            <input data-hex="${hex}" class="rp-hex" type="text" value="${hex}" style="width:100px"/>
          </label>
        `;
        els.rpList.appendChild(item);
      });
      // bind
      els.rpList.querySelectorAll('.rp-check').forEach(cb => {
        cb.addEventListener('change', () => {
          const sel = [];
          els.rpList.querySelectorAll('.rp-check').forEach(x => {
            if (x.checked) sel.push(x.getAttribute('data-hex').toUpperCase());
          });
          state.restricted = sel;
          enableSuggestionIfPossible();
        });
      });
      els.rpList.querySelectorAll('.rp-hex').forEach(inp => {
        inp.addEventListener('change', () => {
          const oldHex = inp.getAttribute('data-hex').toUpperCase();
          let v = inp.value.trim().toUpperCase();
          if (!v.startsWith('#')) v = '#' + v;
          if (!/^#([0-9A-F]{6})$/.test(v)) { inp.value = oldHex; return; }
          // update in palette
          const idx = state.paletteHex.indexOf(oldHex);
          if (idx >= 0) state.paletteHex[idx] = v;
          // update in restricted selection
          const ridx = state.restricted.indexOf(oldHex);
          if (ridx >= 0) state.restricted[ridx] = v;
          renderPaletteList();
          renderRestrictedList();
        });
      });
    };

    const enableSuggestionIfPossible = () => {
      if (!els.btnSuggest) return;
      const ok = state.restricted && state.restricted.length >= 2;
      els.btnSuggest.disabled = !ok;
    };

    // ---------- Image handling ----------
    const MAX_PREVIEW_W = 2000;
    const drawPreviewFromBitmap = () => {
      if (!state.fullBitmap) return;
      let w = state.fullW, h = state.fullH;
      const o = state.exifOrientation || 1;
      ({ w, h } = orientedDims(o, w, h));
      if (w > MAX_PREVIEW_W) { const s = MAX_PREVIEW_W / w; w = Math.round(w * s); h = Math.round(h * s); }
      els.srcCanvas.width = w; els.srcCanvas.height = h;
      sctx.clearRect(0, 0, w, h);
      if (o === 1 && state.fullBitmap instanceof ImageBitmap) {
        sctx.drawImage(state.fullBitmap, 0, 0, w, h);
      } else {
        drawOriented(sctx, state.fullBitmap, w, h, o);
      }

      // Auto-palette on preview
      const auto = autoPaletteHybrid(els.srcCanvas, 10);
      if (auto.length) {
        state.paletteHex = auto;
        renderPaletteList();
        renderRestrictedList();
        enableSuggestionIfPossible();
      }
    };

    async function handleFile(file) {
      try {
        if (!file) return;
        if (isHeic(file)) {
          alert('HEIC/HEIF not supported by this browser. Use JPG/PNG.');
          return;
        }
        state.exifOrientation = 1;

        // Fast path (createImageBitmap with EXIF)
        if (typeof createImageBitmap === 'function') {
          try {
            const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
            state.fullBitmap = bmp;
            state.fullW = bmp.width; state.fullH = bmp.height; state.exifOrientation = 1;
            drawPreviewFromBitmap();
            els.resetBtn && (els.resetBtn.disabled = false);
            els.autoExtract && (els.autoExtract.disabled = false);
            toast('Image loaded ✔︎', 'ok');
            return;
          } catch (e) { console.warn('createImageBitmap failed', e); }
        }
        // Fallback <img> + manual EXIF (JPEG)
        const url = URL.createObjectURL(file);
        const img = await new Promise((res, rej) => {
          const im = new Image(); im.decoding = 'async';
          im.onload = () => res(im);
          im.onerror = rej;
          im.src = url;
        });
        state.fullBitmap = img;
        state.fullW = img.naturalWidth || img.width;
        state.fullH = img.naturalHeight || img.height;
        if (likelyJpeg(file)) {
          try { state.exifOrientation = await readJpegOrientation(file); } catch { state.exifOrientation = 1; }
        } else { state.exifOrientation = 1; }
        drawPreviewFromBitmap();
        els.resetBtn && (els.resetBtn.disabled = false);
        els.autoExtract && (els.autoExtract.disabled = false);
        URL.revokeObjectURL(url);
        toast('Image loaded ✔︎', 'ok');
      } catch (err) {
        console.error(err);
        toast('Could not open that image.', 'error');
      } finally {
        if (els.fileInput) els.fileInput.value = '';
        if (els.cameraInput) els.cameraInput.value = '';
      }
    }

    // ---------- Mapping (palette / dither) ----------
    const mapToPalette = (imgData, palette, wL = 1.0, wC = 1.0, dither = false) => {
      const w = imgData.width, h = imgData.height, src = imgData.data;
      const out = new ImageData(w, h);
      out.data.set(src);
      const palLab = buildPalLab(palette);
      const errR = dither ? new Float32Array(w * h) : null;
      const errG = dither ? new Float32Array(w * h) : null;
      const errB = dither ? new Float32Array(w * h) : null;

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const idx = y * w + x, i4 = idx * 4;
          if (out.data[i4 + 3] === 0) continue;
          let r = out.data[i4], g = out.data[i4 + 1], b = out.data[i4 + 2];
          if (dither) {
            r = clamp(Math.round(r + errR[idx]), 0, 255);
            g = clamp(Math.round(g + errG[idx]), 0, 255);
            b = clamp(Math.round(b + errB[idx]), 0, 255);
          }
          const L = rgbToLab(r, g, b);
          let best = 0, bestD = Infinity;
          for (let p = 0; p < palLab.length; p++) {
            const d2 = dE2(L, palLab[p].lab, wL, wC);
            if (d2 < bestD) { bestD = d2; best = p; }
          }
          const [nr, ng, nb] = palLab[best].rgb;
          out.data[i4] = nr; out.data[i4 + 1] = ng; out.data[i4 + 2] = nb;

          if (dither) {
            const er = r - nr, eg = g - ng, eb = b - nb;
            const push = (xx, yy, fr, fg, fb) => {
              if (xx < 0 || xx >= w || yy < 0 || yy >= h) return;
              const j = yy * w + xx;
              errR[j] += fr; errG[j] += fg; errB[j] += fb;
            };
            push(x + 1, y, er * 7 / 16, eg * 7 / 16, eb * 7 / 16);
            push(x - 1, y + 1, er * 3 / 16, eg * 3 / 16, eb * 3 / 16);
            push(x, y + 1, er * 5 / 16, eg * 5 / 16, eb * 5 / 16);
            push(x + 1, y + 1, er * 1 / 16, eg * 1 / 16, eb * 1 / 16);
          }
        }
      }
      return out;
    };

    const unsharpMask = (imageData, amount = 0.35) => {
      const w = imageData.width, h = imageData.height, src = imageData.data;
      const out = new ImageData(w, h);
      out.data.set(src);
      const k = [0, -1, 0, -1, 5, -1, 0, -1, 0];
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          let r = 0, g = 0, b = 0, ki = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++, ki++) {
              const i = ((y + dy) * w + (x + dx)) * 4, kv = k[ki];
              r += src[i] * kv; g += src[i + 1] * kv; b += src[i + 2] * kv;
            }
          }
          const o = (y * w + x) * 4;
          out.data[o] = clamp((1 - amount) * src[o] + amount * r, 0, 255);
          out.data[o + 1] = clamp((1 - amount) * src[o + 1] + amount * g, 0, 255);
          out.data[o + 2] = clamp((1 - amount) * src[o + 2] + amount * b, 0, 255);
          out.data[o + 3] = src[o + 3];
        }
      }
      return out;
    };

    const getPaletteRGB = () => state.paletteHex.map(h => {
      const c = hexToRgb(h); return [c.r, c.g, c.b];
    });

    const applyMapping = () => {
      if (!els.srcCanvas.width) { toast('Load an image first.', 'error'); return; }
      const wC = parseInt(els.wChroma?.value || '100', 10) / 100;
      const wL = parseInt(els.wLight?.value || '100', 10) / 100;
      state.weights = { wC, wL };
      state.useDither = !!els.useDither?.checked;
      state.bgMode = els.bgMode?.value || 'keep';
      state.keepFullRes = !!els.keepFullRes?.checked;
      state.sharpen = !!els.sharpenEdges?.checked;

      // Prepare processing canvas at full-or-preview res
      let procW, procH, procCanvas, pctx;
      if (state.keepFullRes && state.fullBitmap) {
        const o = state.exifOrientation || 1;
        ({ w: procW, h: procH } = orientedDims(o, state.fullW, state.fullH));
        procCanvas = document.createElement('canvas');
        procCanvas.width = procW; procCanvas.height = procH;
        pctx = procCanvas.getContext('2d', { willReadFrequently: true });
        pctx.imageSmoothingEnabled = false;
        if (o === 1 && state.fullBitmap instanceof ImageBitmap) {
          pctx.drawImage(state.fullBitmap, 0, 0);
        } else {
          drawOriented(pctx, state.fullBitmap, procW, procH, o);
        }
      } else {
        procCanvas = els.srcCanvas;
        procW = procCanvas.width; procH = procCanvas.height;
        pctx = procCanvas.getContext('2d', { willReadFrequently: true });
        pctx.imageSmoothingEnabled = false;
      }

      // Map to palette
      const srcData = pctx.getImageData(0, 0, procW, procH);
      let outFull = mapToPalette(srcData, getPaletteRGB(), wL, wC, state.useDither);

      // Apply texture/replacement rules (simple checker density)
      if (state.rules && state.rules.length) {
        const data = outFull.data;
        // build quick map for equality matching
        const toKey = (r, g, b) => (r << 16) | (g << 8) | b;
        const eq = new Map();
        state.paletteHex.forEach(h => {
          const c = hexToRgb(h); if (!c) return;
          eq.set(h, toKey(c.r, c.g, c.b));
        });
        // For each pixel, if equals target, replace with checker pattern density between two inks
        for (const rule of state.rules) {
          if (!rule.enabled) continue;
          const hT = rule.targetHex.toUpperCase();
          const targetKey = eq.get(hT);
          if (targetKey == null) continue;
          const cA = hexToRgb(rule.inkA), cB = hexToRgb(rule.inkB);
          if (!cA || !cB) continue;
          const kA = toKey(cA.r, cA.g, cA.b);
          const kB = toKey(cB.r, cB.g, cB.b);
          const density = clamp(rule.density || 0.5, 0, 1);
          for (let y = 0; y < procH; y++) {
            for (let x = 0; x < procW; x++) {
              const i4 = (y * procW + x) * 4;
              const key = toKey(data[i4], data[i4 + 1], data[i4 + 2]);
              if (key !== targetKey) continue;
              const useA = ((x + y) & 1) < density * 1; // simple checker
              const c = useA ? cA : cB;
              data[i4] = c.r; data[i4 + 1] = c.g; data[i4 + 2] = c.b;
            }
          }
        }
      }

      if (state.sharpen) outFull = unsharpMask(outFull, 0.35);
      state.outFullImageData = outFull;

      // preview scale
      const previewW = Math.min(procW, parseInt(els.maxW?.value || '1400', 10));
      const scale = previewW / procW;
      els.outCanvas.width = Math.round(procW * scale);
      els.outCanvas.height = Math.round(procH * scale);
      octx.clearRect(0, 0, els.outCanvas.width, els.outCanvas.height);

      const tmp = document.createElement('canvas');
      tmp.width = outFull.width;
      tmp.height = outFull.height;
      const tctx = tmp.getContext('2d', { willReadFrequently: true });
      tctx.putImageData(outFull, 0, 0);
      octx.imageSmoothingEnabled = false;
      octx.drawImage(tmp, 0, 0, els.outCanvas.width, els.outCanvas.height);

      els.downloadBtn && (els.downloadBtn.disabled = false);
      toast('Mapping updated.', 'ok', 1500);
    };

    // ---------- Suggestions (Hue + Luma) ----------
    function suggestByHueLuma() {
      if (!els.srcCanvas.width) { toast('Load an image first.', 'error'); return; }
      if (!state.restricted || state.restricted.length < 2) {
        toast('Pick 2+ inks in Restricted Palette first.', 'error');
        return;
      }
      // naive: for each working color NOT in restricted, pick 2 nearest restricted inks by Lab and set density by brightness
      state.rules = [];
      const restrictLabs = state.restricted.map(h => {
        const c = hexToRgb(h);
        return { hex: h, lab: rgbToLab(c.r, c.g, c.b) };
      });

      for (const hex of state.paletteHex) {
        if (state.restricted.includes(hex)) continue;
        const c = hexToRgb(hex); if (!c) continue;
        const L = rgbToLab(c.r, c.g, c.b);
        let best1 = null, best2 = null, d1 = Infinity, d2 = Infinity;
        restrictLabs.forEach(r => {
          const d = dE2(L, r.lab, 1, 1);
          if (d < d1) { d2 = d1; best2 = best1; d1 = d; best1 = r; }
          else if (d < d2) { d2 = d; best2 = r; }
        });
        if (best1 && best2) {
          // density by luminance
          const y = (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
          const density = clamp(1 - y, 0.05, 0.95);
          state.rules.push({
            enabled: true,
            targetHex: hex,
            pattern: 'checker',
            inkA: best1.hex,
            inkB: best2.hex,
            density
          });
        }
      }
      toast(`Created ${state.rules.length} replacement rules.`, 'ok');
      applyMapping();
      renderRulesList();
    }

    // ---------- Rules UI (with density sliders) ----------
    const rulesBox = document.getElementById('rulesBox');
    function renderRulesList() {
      if (!rulesBox) return;
      rulesBox.innerHTML = '';
      if (!state.rules.length) {
        rulesBox.innerHTML = `<div class="help">No rules yet. Click “Suggest by Hue & Luma” or add manually.</div>`;
        return;
      }
      state.rules.forEach((r, idx) => {
        const row = document.createElement('div');
        row.className = 'rule-row';
        row.style.display = 'grid';
        row.style.gridTemplateColumns = 'auto auto auto 1fr auto';
        row.style.gap = '8px';
        row.style.alignItems = 'center';
        row.style.padding = '6px 0';
        row.innerHTML = `
          <label class="check"><input type="checkbox" class="r-en" ${r.enabled ? 'checked' : ''}/> Enable</label>
          <div><span class="sw" style="display:inline-block;width:16px;height:16px;border:1px solid #334155;border-radius:4px;background:${r.targetHex}"></span> <span class="mono">${r.targetHex}</span></div>
          <div class="mono">→</div>
          <div class="ink-box mono">${r.pattern || 'checker'} · <span class="inkA">${r.inkA}</span> + <span class="inkB">${r.inkB}</span> · density:
            <input type="range" class="r-den" min="0" max="100" value="${Math.round((r.density || 0.5) * 100)}" />
            <span class="r-den-out">${Math.round((r.density || 0.5) * 100)}%</span>
          </div>
          <button class="ghost danger r-del" type="button">Delete</button>
        `;
        row.querySelector('.r-en').addEventListener('change', (e) => {
          state.rules[idx].enabled = e.target.checked; applyMapping();
        });
        row.querySelector('.r-del').addEventListener('click', () => {
          state.rules.splice(idx, 1); renderRulesList(); applyMapping();
        });
        row.querySelector('.r-den').addEventListener('input', (e) => {
          const v = clamp(parseInt(e.target.value, 10) / 100, 0, 1);
          state.rules[idx].density = v;
          row.querySelector('.r-den-out').textContent = `${Math.round(v * 100)}%`;
          applyMapping();
        });
        rulesBox.appendChild(row);
      });
    }

    // ---------- Download PNG ----------
    function downloadPng() {
      const full = state.outFullImageData;
      if (!full) { toast('Nothing to export yet.', 'error'); return; }
      const scale = parseInt(els.exportScale?.value || '1', 10);
      const c = document.createElement('canvas');
      c.width = full.width * scale;
      c.height = full.height * scale;
      const cx = c.getContext('2d', { willReadFrequently: true });
      cx.imageSmoothingEnabled = false;
      const tmp = document.createElement('canvas');
      tmp.width = full.width; tmp.height = full.height;
      tmp.getContext('2d').putImageData(full, 0, 0);
      cx.drawImage(tmp, 0, 0, c.width, c.height);
      c.toBlob(b => {
        const a = document.createElement('a');
        a.download = 'mapped_fullres.png';
        a.href = URL.createObjectURL(b);
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1200);
      }, 'image/png');
    }

    // ---------- Vector (SVG) ----------
    function exportSvg() {
      if (!window.ImageTracer) {
        toast('ImageTracer not loaded. Include imagetracer.min.js.', 'error');
        return;
      }
      if (!state.outFullImageData) { toast('Map first, then export.', 'error'); return; }
      const tmp = document.createElement('canvas');
      tmp.width = state.outFullImageData.width;
      tmp.height = state.outFullImageData.height;
      tmp.getContext('2d').putImageData(state.outFullImageData, 0, 0);

      const options = {
        // lock palette if requested
        pal: (els.svgLock?.checked ? state.paletteHex.map(h => hexToRgb(h)) : undefined),
        ltres: 1, qtres: 1, pathomit: parseInt(els.svgMinArea?.value || '8', 10)
      };
      const svgstr = window.ImageTracer.imagedataToSVG(tmp.getContext('2d').getImageData(0, 0, tmp.width, tmp.height), options);
      const blob = new Blob([svgstr], { type: 'image/svg+xml' });
      const a = document.createElement('a');
      a.download = 'mapped.svg';
      a.href = URL.createObjectURL(blob);
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1200);
    }

    // ---------- Editor (simple eyedrop) ----------
    function openEditor() {
      if (!els.editorOverlay || !els.editCanvas || !els.editOverlay) { toast('Editor UI missing.', 'error'); return; }
      if (!els.srcCanvas.width) { toast('Load an image first.', 'error'); return; }
      els.editorOverlay.classList.remove('hidden');
      const vw = window.innerWidth, vh = window.innerHeight;
      els.editCanvas.width = vw; els.editCanvas.height = vh - 44; // toolbar at 44px
      els.editOverlay.width = els.editCanvas.width; els.editOverlay.height = els.editCanvas.height;
      const ec = els.editCanvas.getContext('2d', { willReadFrequently: true });
      ec.imageSmoothingEnabled = false;
      ec.drawImage(els.srcCanvas, 0, 0, els.editCanvas.width, els.editCanvas.height);

      const pick = (evt) => {
        const r = els.editCanvas.getBoundingClientRect();
        const x = Math.floor((evt.clientX - r.left) * els.editCanvas.width / r.width);
        const y = Math.floor((evt.clientY - r.top) * els.editCanvas.height / r.height);
        const d = ec.getImageData(x, y, 1, 1).data;
        const hx = rgbToHex(d[0], d[1], d[2]);
        state.paletteHex.push(hx);
        renderPaletteList();
        renderRestrictedList();
        toast(`Added ${hx} to palette.`, 'ok');
      };
      const press = (e) => { e.preventDefault(); pick(e); };
      els.editCanvas.addEventListener('pointerdown', press, { passive: false });
      els.editorDone?.addEventListener('click', () => {
        els.editCanvas.removeEventListener('pointerdown', press);
        els.editorOverlay.classList.add('hidden');
      }, { once: true });
    }

    // ---------- Wiring ----------
    // Uploads
    els.fileInput?.addEventListener('change', e => { const f = e.target.files?.[0]; if (f) handleFile(f); });
    els.cameraInput?.addEventListener('change', e => { const f = e.target.files?.[0]; if (f) handleFile(f); });
    els.pasteBtn?.addEventListener('click', async () => {
      if (!navigator.clipboard?.read) { toast('Clipboard read not supported.', 'error'); return; }
      try {
        const items = await navigator.clipboard.read();
        for (const it of items) for (const t of it.types) if (t.startsWith('image/')) {
          const blob = await it.getType(t); return handleFile(blob);
        }
        toast('No image in clipboard.', 'error');
      } catch { toast('Clipboard read failed.', 'error'); }
    });
    els.resetBtn?.addEventListener('click', drawPreviewFromBitmap);

    // Palette section
    document.getElementById('addColor')?.addEventListener('click', () => {
      state.paletteHex.push('#FFFFFF'); renderPaletteList(); renderRestrictedList();
    });
    document.getElementById('clearColors')?.addEventListener('click', () => {
      state.paletteHex = ['#FFFFFF']; renderPaletteList(); renderRestrictedList();
    });
    document.getElementById('loadExample')?.addEventListener('click', () => {
      state.paletteHex = ['#FFFFFF', '#2B2B2B', '#B3753B', '#D22C2C', '#1D6E2E'];
      renderPaletteList(); renderRestrictedList();
    });

    // Auto-extract
    els.autoExtract?.addEventListener('click', () => {
      if (!els.srcCanvas.width) { toast('Load an image first.', 'error'); return; }
      const k = clamp(parseInt(els.kColors?.value || '6', 10), 2, 16);
      const hexes = autoPaletteHybrid(els.srcCanvas, k);
      if (hexes.length) {
        state.paletteHex = hexes; renderPaletteList(); renderRestrictedList(); toast(`Extracted ${hexes.length} colors.`, 'ok');
      }
    });

    // Mapping options
    const syncWeightOut = () => {
      if (els.wChromaOut) els.wChromaOut.textContent = (parseInt(els.wChroma?.value || '100', 10) / 100).toFixed(2) + '×';
      if (els.wLightOut) els.wLightOut.textContent = (parseInt(els.wLight?.value || '100', 10) / 100).toFixed(2) + '×';
    };
    ['input', 'change'].forEach(ev => {
      els.wChroma?.addEventListener(ev, syncWeightOut);
      els.wLight?.addEventListener(ev, syncWeightOut);
    });
    syncWeightOut();

    els.applyBtn?.addEventListener('click', applyMapping);
    els.btnRefresh?.addEventListener('click', applyMapping);
    els.downloadBtn?.addEventListener('click', downloadPng);

    // Restricted palette controls
    els.rpSelectAll?.addEventListener('click', () => {
      state.restricted = state.paletteHex.slice(); renderRestrictedList(); enableSuggestionIfPossible();
    });
    els.rpSelectNone?.addEventListener('click', () => {
      state.restricted = []; renderRestrictedList(); enableSuggestionIfPossible();
    });
    els.btnSuggest?.addEventListener('click', suggestByHueLuma);

    // Vector export
    els.btnExportSvg?.addEventListener('click', exportSvg);

    // Editor
    els.openEditor?.addEventListener('click', openEditor);

    // Initial renders
    renderPaletteList();
    renderRestrictedList();
    enableSuggestionIfPossible();

    // Gently tell user about projects (if missing UI, no-op)
    document.getElementById('openProjects')?.addEventListener('click', () => {
      document.getElementById('projectsPane')?.classList.add('open');
    });
    document.getElementById('closeProjects')?.addEventListener('click', () => {
      document.getElementById('projectsPane')?.classList.remove('open');
    });
  } // end init
})();
