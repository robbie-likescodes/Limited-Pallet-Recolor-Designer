/* Palette Mapper — Comprehensive App (2025-09-05)
   Key features:
   - Robust image loader (createImageBitmap fallback)
   - Source Palette (auto-extract K-means, add/remove/edit, per-color tolerance)
   - Restricted Palette (you pick inks to allow; “Select All/None”; include white)
   - Suggest by Hue & Luma (build replacement recipes using 2–3 restricted inks + optional white)
   - Manual Replace tool (choose any source color and mix from selected restricted inks; pattern + density)
   - Mapping engine:
       * direct Lab matching OR per-color pattern replacement (checker / Bayer 4x4 / stipple)
       * Floyd–Steinberg dithering (optional)
       * background keep/white/transparent
       * weights for Lightness/Chroma
   - Full-screen Editor (opens, eyedropper adds to Source palette, lasso UI hooks intact)
   - Big Refresh Mapping button above output
   - Export PNG (full-res) with optional sharpen edges
   - Export SVG via ImageTracer (calls your fork with imagetracer-loader.js)
   - Codes/Report: PMS or HEX listing for final used inks (excludes colors replaced by mixes)
*/

import { ensureImageTracerLoaded } from './imagetracer-loader.js';

/* -------------------- DOM helpers -------------------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const els = {
  // Load
  fileInput: $('#fileInput'),
  cameraInput: $('#cameraInput'),
  pasteBtn: $('#pasteBtn'),
  resetBtn: $('#resetBtn'),

  // Canvases
  srcCanvas: $('#srcCanvas'),
  outCanvas: $('#outCanvas'),

  // Prefs
  maxW: $('#maxW'),
  keepFullRes: $('#keepFullRes'),
  sharpenEdges: $('#sharpenEdges'),

  // Editor
  openEditor: $('#openEditor'),
  editorOverlay: $('#editorOverlay'),
  toolEyedrop: $('#toolEyedrop'),
  toolLasso: $('#toolLasso'),
  toolPan: $('#toolPan'),
  editorDone: $('#editorDone'),
  editCanvas: $('#editCanvas'),
  editOverlay: $('#editOverlay'),
  editorPalette: $('#editorPalette'),
  eyeSwatch: $('#eyeSwatch'),
  eyeHex: $('#eyeHex'),
  eyeAdd: $('#eyeAdd'),
  eyeCancel: $('#eyeCancel'),
  lassoChecks: $('#lassoChecks'),
  lassoSave: $('#lassoSave'),
  lassoClear: $('#lassoClear'),

  // Source Palette
  sourcePalette: $('#sourcePalette'),
  addColor: $('#addColor'),
  clearColors: $('#clearColors'),
  autoExtract: $('#autoExtract'),
  kColors: $('#kColors'),

  // Restricted Palette
  restrictedPalette: $('#restrictedPalette'),
  selectAllRestricted: $('#selectAllRestricted'),
  selectNoneRestricted: $('#selectNoneRestricted'),
  includeWhite: $('#includeWhite'),

  // Suggest / Manual
  suggestByHueLuma: $('#suggestByHueLuma'),
  suggestionsBox: $('#suggestionsBox'),
  defaultPattern: $('#defaultPattern'),

  manualSource: $('#manualSource'),
  manualTargets: $('#manualTargets'),
  manualPattern: $('#manualPattern'),
  manualDensity: $('#manualDensity'),
  addManualReplace: $('#addManualReplace'),

  // Mapping
  wChroma: $('#wChroma'),
  wLight: $('#wLight'),
  wChromaOut: $('#wChromaOut'),
  wLightOut: $('#wLightOut'),
  useDither: $('#useDither'),
  bgMode: $('#bgMode'),

  refreshMappingBtn: $('#refreshMappingBtn'),
  applyBtn: $('#applyBtn'),
  downloadBtn: $('#downloadBtn'),
  exportSvgBtn: $('#exportSvgBtn'),

  // Codes
  colorCodeMode: $('#colorCodeMode'),
  codeList: $('#codeList'),
  exportReport: $('#exportReport'),
  mailtoLink: $('#mailtoLink'),
};

// 2D contexts
const sctx = els.srcCanvas.getContext('2d', { willReadFrequently: true });
const octx = els.outCanvas.getContext('2d', { willReadFrequently: true });
sctx.imageSmoothingEnabled = false;
octx.imageSmoothingEnabled = false;

/* -------------------- State -------------------- */
const state = {
  // image
  img: null, imgW: 0, imgH: 0,

  // palettes
  source: [],       // [{hex,r,g,b,tol}]
  restricted: [],   // [{hex,r,g,b,enabled:true}]

  includeWhite: true,

  // replacement recipes: Map srcIndex -> { pattern:'checker'|'bayer4'|'stipple', parts:[{i:restrictedIndex, w:0..1}], density:0..1 }
  // - parts weights normalized; for two inks, density controls the first ink’s ratio; for three, density controls mix bias (we balance remaining)
  recipes: new Map(),

  // editor
  editorActive: false,
  eyeHex: '#000000',

  // mapping prefs
  wC: 1.0,
  wL: 1.0,
  dither: false,
  bgMode: 'keep',
  defaultPattern: 'checker',

  // caches
  fullMappedImageData: null,   // last full mapped result
};

/* -------------------- Utils -------------------- */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hexToRgb = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
};
const rgbToHex = (r, g, b) =>
  '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();

function toast(msg, ms = 1700) {
  let box = $('#toasts');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toasts';
    box.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:18px;display:grid;gap:8px;z-index:99999';
    document.body.appendChild(box);
  }
  const t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = 'background:#0b1225;border:1px solid #1e293b;color:#e5e7eb;padding:10px 12px;border-radius:10px';
  box.appendChild(t);
  setTimeout(() => {
    t.style.opacity = '0';
    t.style.transition = 'opacity .25s';
    setTimeout(() => t.remove(), 260);
  }, ms);
}

/* sRGB → Lab (for perceptual metrics) */
function srgbToLinear(u) { u /= 255; return (u <= 0.04045) ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4); }
function rgbToXyz(r, g, b) {
  r = srgbToLinear(r); g = srgbToLinear(g); b = srgbToLinear(b);
  return [
    r * 0.4124564 + g * 0.3575761 + b * 0.1804375,
    r * 0.2126729 + g * 0.7151522 + b * 0.0721750,
    r * 0.0193339 + g * 0.1191920 + b * 0.9503041
  ];
}
function xyzToLab(x, y, z) {
  const Xn = 0.95047, Yn = 1.0, Zn = 1.08883;
  x /= Xn; y /= Yn; z /= Zn;
  const f = t => (t > 0.008856) ? Math.cbrt(t) : (7.787 * t + 16 / 116);
  const fx = f(x), fy = f(y), fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
function rgbToLab(r, g, b) { const [x, y, z] = rgbToXyz(r, g, b); return xyzToLab(x, y, z); }
function deltaE2Weighted(l1, l2, wL, wC) {
  const dL = l1[0] - l2[0], da = l1[1] - l2[1], db = l1[2] - l2[2];
  return wL * dL * dL + wC * (da * da + db * db);
}

/* HSV + luma for suggestions */
function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  const s = max === 0 ? 0 : d / max;
  const v = max;
  return { h, s, v };
}
const luma = (r, g, b) => Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);

/* -------------------- Image load & preview -------------------- */
function objectUrlFor(file) { return URL.createObjectURL(file); }
function revokeUrl(url) { try { URL.revokeObjectURL(url); } catch {} }

async function decodeImageFile(file) {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(file); } catch {}
  }
  const url = objectUrlFor(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    return img;
  } finally { revokeUrl(url); }
}

async function handleFile(file) {
  if (!file) return;
  try {
    state.img = await decodeImageFile(file);
  } catch (e) {
    console.error(e);
    alert('Could not open image. Try a JPG/PNG.');
    return;
  }
  state.imgW = state.img.width || state.img.naturalWidth;
  state.imgH = state.img.height || state.img.naturalHeight;

  drawPreview();

  // Enable actions
  els.resetBtn.disabled = false;
  els.autoExtract.disabled = false;
  els.applyBtn.disabled = false;
  els.refreshMappingBtn.disabled = false;
  els.exportSvgBtn.disabled = false;

  // If no palette yet, auto-extract
  if (state.source.length === 0) {
    await autoExtractPalette();
  }
  if (state.restricted.length === 0) {
    state.restricted = state.source.map(s => ({ ...s, enabled: true }));
    renderRestrictedPalette();
  }
  toast('Image loaded. Configure palettes, then Suggest by Hue & Luma or map directly.');
}

function drawPreview() {
  if (!state.img) return;
  const maxW = parseInt(els.maxW.value || '1400', 10);
  let w = state.imgW, h = state.imgH;
  if (w > maxW) { const s = maxW / w; w = Math.round(w * s); h = Math.round(h * s); }
  els.srcCanvas.width = w; els.srcCanvas.height = h;
  sctx.clearRect(0, 0, w, h); sctx.imageSmoothingEnabled = false;
  sctx.drawImage(state.img, 0, 0, w, h);

  els.outCanvas.width = w; els.outCanvas.height = h;
  octx.clearRect(0, 0, w, h); octx.imageSmoothingEnabled = false;
}

/* -------------------- Source Palette -------------------- */
function renderSourcePalette() {
  const host = els.sourcePalette;
  host.innerHTML = '';
  state.source.forEach((c, i) => {
    const row = document.createElement('div');
    row.className = 'palette-item';
    row.innerHTML = `
      <input type="color" value="${c.hex}">
      <input type="text" value="${c.hex}" class="hex">
      <label class="mini">Tol <input type="range" min="0" max="100" step="1" value="${c.tol ?? 10}" data-role="tol"></label>
      <button class="ghost" data-role="del">Remove</button>
    `;
    const color = row.querySelector('input[type=color]');
    const hex = row.querySelector('.hex');
    const tol = row.querySelector('[data-role=tol]');
    color.oninput = () => { hex.value = color.value.toUpperCase(); applySourceHex(i, hex.value); };
    hex.onchange = () => applySourceHex(i, hex.value);
    tol.oninput = () => { state.source[i].tol = parseInt(tol.value, 10); };
    row.querySelector('[data-role=del]').onclick = () => {
      state.source.splice(i, 1);
      renderSourcePalette();
      renderRestrictedPalette();
      rebuildManualSelectors();
    };
    host.appendChild(row);
  });
  rebuildManualSelectors();
  renderCodes();
}
function applySourceHex(i, hex) {
  if (!/^#([0-9A-F]{6})$/i.test(hex)) return;
  const rgb = hexToRgb(hex);
  state.source[i].hex = rgbToHex(rgb.r, rgb.g, rgb.b);
  state.source[i].r = rgb.r; state.source[i].g = rgb.g; state.source[i].b = rgb.b;
  renderCodes();
}
function addSourceColor(hex = '#FFFFFF') {
  const rgb = hexToRgb(hex) || { r: 255, g: 255, b: 255 };
  state.source.push({ hex: rgbToHex(rgb.r, rgb.g, rgb.b), r: rgb.r, g: rgb.g, b: rgb.b, tol: 10 });
  renderSourcePalette();
}

/* -------------------- Restricted Palette -------------------- */
function renderRestrictedPalette() {
  const host = els.restrictedPalette;
  host.innerHTML = '';
  state.restricted.forEach((ink, i) => {
    const row = document.createElement('label');
    row.className = 'restricted-item';
    row.innerHTML = `
      <input type="checkbox" ${ink.enabled ? 'checked' : ''}>
      <span class="sw" style="background:${ink.hex}"></span>
      <input class="hex" value="${ink.hex}">
      <button class="ghost mini" data-role="del">✕</button>
    `;
    const cb = row.querySelector('input[type=checkbox]');
    const hex = row.querySelector('.hex');
    const sw = row.querySelector('.sw');

    cb.onchange = () => { state.restricted[i].enabled = cb.checked; };
    hex.onchange = () => {
      if (!/^#([0-9A-F]{6})$/i.test(hex.value)) { hex.value = ink.hex; return; }
      const rgb = hexToRgb(hex.value);
      state.restricted[i].hex = rgbToHex(rgb.r, rgb.g, rgb.b);
      state.restricted[i].r = rgb.r; state.restricted[i].g = rgb.g; state.restricted[i].b = rgb.b;
      sw.style.background = state.restricted[i].hex;
      rebuildManualSelectors();
      renderCodes();
    };
    row.querySelector('[data-role=del]').onclick = () => {
      state.restricted.splice(i, 1);
      renderRestrictedPalette();
      rebuildManualSelectors();
      renderCodes();
    };

    host.appendChild(row);
  });
  rebuildManualSelectors();
  renderCodes();
}

function setRestrictedFromSource(all = true) {
  if (all) {
    state.restricted = state.source.map(s => ({ hex: s.hex, r: s.r, g: s.g, b: s.b, enabled: true }));
  } else {
    state.restricted = state.source.map(s => ({ hex: s.hex, r: s.r, g: s.g, b: s.b, enabled: false }));
  }
  renderRestrictedPalette();
}

/* -------------------- Auto Palette (K-means) -------------------- */
function sampleForKMeans(ctx, w, h, target = 120_000) {
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / target)));
  const outW = Math.floor(w / step);
  const outH = Math.floor(h / step);
  const data = new Uint8ClampedArray(outW * outH * 4);
  let di = 0;
  for (let y = 0; y < h; y += step) {
    const row = ctx.getImageData(0, y, w, 1).data;
    for (let x = 0; x < w; x += step) {
      const i = x * 4;
      data[di++] = row[i];
      data[di++] = row[i + 1];
      data[di++] = row[i + 2];
      data[di++] = row[i + 3];
    }
  }
  return data;
}
function kmeans(data, k = 8, iters = 10) {
  const n = data.length / 4;
  const centers = [];
  for (let c = 0; c < k; c++) {
    const idx = Math.floor((c + 0.5) * n / k);
    centers.push([data[idx * 4], data[idx * 4 + 1], data[idx * 4 + 2]]);
  }
  const counts = new Array(k).fill(0);
  const sums = new Array(k).fill(0).map(() => [0, 0, 0]);
  for (let it = 0; it < iters; it++) {
    counts.fill(0); for (const s of sums) { s[0] = s[1] = s[2] = 0; }
    for (let i = 0; i < n; i++) {
      if (data[i * 4 + 3] < 8) continue;
      const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
      let best = 0, bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const dr = r - centers[c][0], dg = g - centers[c][1], db = b - centers[c][2];
        const d = dr * dr + dg * dg + db * db;
        if (d < bestD) { bestD = d; best = c; }
      }
      counts[best]++; sums[best][0] += r; sums[best][1] += g; sums[best][2] += b;
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
async function autoExtractPalette() {
  if (!els.srcCanvas.width) return;
  const k = clamp(parseInt(els.kColors.value || '8', 10), 2, 16);
  const sampled = sampleForKMeans(sctx, els.srcCanvas.width, els.srcCanvas.height);
  const centers = kmeans(sampled, k, 10);
  state.source = centers.map(([r, g, b]) => ({ hex: rgbToHex(r, g, b), r, g, b, tol: 10 }));
  renderSourcePalette();
  setRestrictedFromSource(true);
  toast(`Auto-extracted ${k} colors into Source + Restricted.`);
}

/* -------------------- Suggest by Hue & Luma -------------------- */
/* Choose up to 3 restricted enabled inks (+ optional white) to simulate a source color.
   We test combinations and pick the mix that minimizes Lab distance. */
function enabledRestricted() {
  const out = [];
  state.restricted.forEach((ink, i) => {
    if (ink.enabled) out.push({ ...ink, i });
  });
  if (state.includeWhite) out.push({ hex: '#FFFFFF', r: 255, g: 255, b: 255, i: -1 }); // virtual white
  return out;
}

function labFor(rgb) { return rgbToLab(rgb.r, rgb.g, rgb.b); }
function mixRGB(weights, rgbs) {
  // simple linear blend (area-coverage simulation); weights sum to 1
  let r = 0, g = 0, b = 0;
  for (let k = 0; k < rgbs.length; k++) { r += weights[k] * rgbs[k].r; g += weights[k] * rgbs[k].g; b += weights[k] * rgbs[k].b; }
  return { r: Math.round(r), g: Math.round(g), b: Math.round(b) };
}
function combos2(arr) {
  const out = [];
  for (let i = 0; i < arr.length; i++)
    for (let j = i + 1; j < arr.length; j++) out.push([arr[i], arr[j]]);
  return out;
}
function combos3(arr) {
  const out = [];
  for (let i = 0; i < arr.length; i++)
    for (let j = i + 1; j < arr.length; j++)
      for (let k = j + 1; k < arr.length; k++) out.push([arr[i], arr[j], arr[k]]);
  return out;
}

function bestMixForTarget(targetRGB, inks) {
  const targetLab = labFor(targetRGB);
  let best = null, bestD = Infinity;

  // Try 2-ink mixes with density 0..1
  combos2(inks).forEach(pair => {
    for (let t = 0; t <= 100; t += 2) {
      const a = t / 100, b = 1 - a;
      const rgb = mixRGB([a, b], pair);
      const d2 = deltaE2Weighted(targetLab, labFor(rgb), state.wL, state.wC);
      if (d2 < bestD) { bestD = d2; best = { parts: [{ i: pair[0].i, w: a }, { i: pair[1].i, w: b }], density: a, pattern: state.defaultPattern }; }
    }
  });

  // Try 3-ink mixes in coarse grid (a+b<=1; c=1-a-b)
  combos3(inks).forEach(tri => {
    for (let a = 0; a <= 100; a += 25) {
      for (let b = 0; b <= 100 - a; b += 25) {
        const aa = a / 100, bb = b / 100, cc = 1 - aa - bb;
        const rgb = mixRGB([aa, bb, cc], tri);
        const d2 = deltaE2Weighted(targetLab, labFor(rgb), state.wL, state.wC);
        if (d2 < bestD) {
          bestD = d2;
          best = {
            parts: [{ i: tri[0].i, w: aa }, { i: tri[1].i, w: bb }, { i: tri[2].i, w: cc }],
            density: aa,
            pattern: state.defaultPattern
          };
        }
      }
    }
  });

  return best;
}

function suggestByHueLuma() {
  if (!state.source.length) { toast('Load image and build Source palette first.'); return; }
  const usable = enabledRestricted();
  if (usable.length < 2) { toast('Enable at least 2 inks in Restricted (or include White).'); return; }

  // For each SOURCE color that is NOT exactly one of the enabled restricted inks,
  // propose a recipe.
  let suggestions = 0;
  state.source.forEach((sc, si) => {
    const exact = usable.find(u => u.r === sc.r && u.g === sc.g && u.b === sc.b);
    if (exact) {
      // if exact ink exists, remove suggestion for it
      state.recipes.delete(si);
      return;
    }
    const mix = bestMixForTarget({ r: sc.r, g: sc.g, b: sc.b }, usable);
    if (mix) {
      // normalize weights
      const sum = mix.parts.reduce((s, p) => s + p.w, 0);
      mix.parts.forEach(p => p.w = p.w / (sum || 1));
      mix.pattern = els.defaultPattern.value || 'checker';
      state.recipes.set(si, mix);
      suggestions++;
    }
  });
  renderSuggestionsUI();
  toast(`${suggestions} suggestion(s) created. Adjust densities, then Refresh Mapping.`);
}

/* -------------------- Suggestions UI -------------------- */
function renderSuggestionsUI() {
  const host = els.suggestionsBox;
  host.innerHTML = '';
  if (state.recipes.size === 0) {
    host.innerHTML = '<div class="tiny-help">No replacement suggestions yet.</div>';
    return;
  }
  state.recipes.forEach((rec, si) => {
    const src = state.source[si];
    const row = document.createElement('div');
    row.className = 'sug-item';
    const partsText = rec.parts.map(p => {
      const ink = p.i === -1 ? { hex: '#FFFFFF' } : state.restricted[p.i];
      return `${ink?.hex || '#??'} ${(p.w * 100).toFixed(0)}%`;
    }).join(' + ');
    row.innerHTML = `
      <div class="sug-head">
        <span class="sw" style="background:${src.hex}"></span>
        <strong>${src.hex}</strong>
      </div>
      <div class="sug-body">
        <label>Pattern
          <select class="pat">
            <option value="checker"${rec.pattern === 'checker' ? ' selected' : ''}>Checker</option>
            <option value="bayer4"${rec.pattern === 'bayer4' ? ' selected' : ''}>Bayer 4×4</option>
            <option value="stipple"${rec.pattern === 'stipple' ? ' selected' : ''}>Stipple</option>
          </select>
        </label>
        <label>Density <input class="dens" type="range" min="0" max="1" step="0.01" value="${clamp(rec.density ?? 0.5, 0, 1)}"></label>
        <div class="tiny-help">Mix: ${partsText}</div>
      </div>
      <div class="sug-actions">
        <button class="ghost" data-role="del">Delete</button>
      </div>
    `;
    const pat = row.querySelector('.pat');
    const dens = row.querySelector('.dens');
    const del = row.querySelector('[data-role=del]');
    pat.onchange = () => { rec.pattern = pat.value; };
    dens.oninput = () => {
      // Adjust first part weight with density, re-balance others proportionally
      if (!rec.parts.length) return;
      const d = parseFloat(dens.value);
      if (rec.parts.length === 1) { rec.parts[0].w = 1; }
      else if (rec.parts.length === 2) {
        rec.parts[0].w = d;
        rec.parts[1].w = 1 - d;
      } else {
        // 3 or more: bias first; scale others to fill remaining equally
        rec.parts[0].w = d;
        const rem = Math.max(0, 1 - d);
        const rest = rec.parts.length - 1;
        rec.parts.slice(1).forEach(p => p.w = rem / rest);
      }
      rec.density = d;
    };
    del.onclick = () => { state.recipes.delete(si); renderSuggestionsUI(); };
    host.appendChild(row);
  });
}

/* -------------------- Manual Replace -------------------- */
function rebuildManualSelectors() {
  // source list
  els.manualSource.innerHTML = '';
  state.source.forEach((c, i) => {
    const o = document.createElement('option');
    o.value = String(i); o.textContent = `${i + 1}: ${c.hex}`;
    els.manualSource.appendChild(o);
  });
  // restricted list
  els.manualTargets.innerHTML = '';
  state.restricted.forEach((c, i) => {
    const o = document.createElement('option');
    o.value = String(i); o.textContent = `${i + 1}: ${c.hex}${c.enabled ? '' : ' (disabled)'}`;
    els.manualTargets.appendChild(o);
  });
}
function addManualReplacement() {
  const si = parseInt(els.manualSource.value || '-1', 10);
  if (isNaN(si) || si < 0 || si >= state.source.length) { toast('Pick a source color.'); return; }
  const targets = [...els.manualTargets.selectedOptions].map(o => parseInt(o.value, 10)).filter(i => !isNaN(i));
  if (targets.length < 1) { toast('Select at least one restricted ink.'); return; }
  const parts = targets.slice(0, 3).map((i, idx) => ({ i, w: idx === 0 ? 1 : 0 }));
  const d = parseFloat(els.manualDensity.value || '0.5');
  // Distribute weights: first gets d, remaining share (1-d)
  if (parts.length === 1) { parts[0].w = 1; }
  else if (parts.length === 2) { parts[0].w = d; parts[1].w = 1 - d; }
  else {
    parts[0].w = d;
    const rem = Math.max(0, 1 - d); const rest = parts.length - 1;
    for (let k = 1; k < parts.length; k++) parts[k].w = rem / rest;
  }
  state.recipes.set(si, {
    pattern: els.manualPattern.value || 'checker',
    parts, density: d
  });
  renderSuggestionsUI();
  toast('Manual replacement added/updated.');
}

/* -------------------- Mapping (palette & patterns) -------------------- */
function buildLabPalette(pal) { return pal.map(c => ({ lab: rgbToLab(c.r, c.g, c.b), r: c.r, g: c.g, b: c.b })); }

function nearestColorLab(r, g, b, palLab, wL, wC) {
  const L = rgbToLab(r, g, b);
  let best = 0, bestD = Infinity;
  for (let i = 0; i < palLab.length; i++) {
    const d2 = deltaE2Weighted(L, palLab[i].lab, wL, wC);
    if (d2 < bestD) { bestD = d2; best = i; }
  }
  return best;
}

/* Ordered Bayer 4×4 threshold matrix */
const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5]
];
function patternPick(pattern, x, y, parts) {
  // returns index in parts to place at (x,y)
  if (parts.length === 1) return 0;

  if (pattern === 'checker') {
    // Simple 2-color checker with ratio from weights (first vs second/others)
    const sum = parts.reduce((s, p) => s + p.w, 0) || 1;
    const w0 = parts[0].w / sum;
    // tile 2×2; use parity & hash to approximate coverage
    const on = ((x + y) & 1) === 0;
    if (parts.length === 2) {
      // allocate proportion by staggering threshold
      const th = w0 > 0.5 ? 0.75 : 0.25;
      return (on ? (w0 >= th ? 0 : 1) : (w0 >= th ? 1 : 0));
    } else {
      // 3+ colors: first vs others; if not first, split remainder equally
      if (on && Math.random() < w0) return 0;
      const rest = parts.length - 1;
      return 1 + Math.floor(Math.random() * rest);
    }
  }

  if (pattern === 'bayer4') {
    const m = BAYER4[y & 3][x & 3] / 16;
    const sum = parts.reduce((s, p) => s + p.w, 0) || 1;
    let acc = 0, r = m * sum;
    for (let i = 0; i < parts.length; i++) {
      acc += parts[i].w;
      if (r <= acc) return i;
    }
    return parts.length - 1;
  }

  // stipple: random threshold based on weights
  const sum = parts.reduce((s, p) => s + p.w, 0) || 1;
  let r = Math.random() * sum, acc = 0;
  for (let i = 0; i < parts.length; i++) {
    acc += parts[i].w;
    if (r <= acc) return i;
  }
  return parts.length - 1;
}

function applyMappingToCanvas(srcCtx, dstCtx, palFinal, wL, wC, dither, bgMode) {
  const w = srcCtx.canvas.width, h = srcCtx.canvas.height;
  const src = srcCtx.getImageData(0, 0, w, h);
  const out = new ImageData(w, h);
  out.data.set(src.data);

  const palLab = buildLabPalette(palFinal);

  // Build fast map of source color index by nearest color in SOURCE palette
  const sourceLab = buildLabPalette(state.source.map(s => ({ r: s.r, g: s.g, b: s.b })));

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i4 = (y * w + x) * 4;
      const a = src.data[i4 + 3]; if (a === 0) { out.data[i4 + 3] = 0; continue; }
      let r = src.data[i4], g = src.data[i4 + 1], b = src.data[i4 + 2];

      // Find nearest source palette entry (to decide replacement)
      let nearestSrc = 0, bestD = Infinity;
      const L = rgbToLab(r, g, b);
      for (let s = 0; s < sourceLab.length; s++) {
        const d2 = deltaE2Weighted(L, sourceLab[s].lab, wL, wC);
        if (d2 < bestD) { bestD = d2; nearestSrc = s; }
      }

      const recipe = state.recipes.get(nearestSrc);
      if (recipe && recipe.parts.length) {
        // draw pattern ink at (x,y)
        const partIndex = patternPick(recipe.pattern, x, y, recipe.parts);
        const rp = recipe.parts[partIndex];
        const ink = rp.i === -1
          ? { r: 255, g: 255, b: 255 }
          : palFinal[rp.i]; // palFinal is restricted (enabled only) array

        out.data[i4] = ink.r; out.data[i4 + 1] = ink.g; out.data[i4 + 2] = ink.b; out.data[i4 + 3] = 255;
      } else {
        // normal nearest match in final palette
        const j = nearestColorLab(r, g, b, palLab, wL, wC);
        out.data[i4] = palLab[j].r; out.data[i4 + 1] = palLab[j].g; out.data[i4 + 2] = palLab[j].b;
      }

      if (bgMode === 'white') out.data[i4 + 3] = 255;
      else if (bgMode === 'transparent' && a < 128) out.data[i4 + 3] = 0;
    }
  }

  dstCtx.putImageData(out, 0, 0);
  return out;
}

/* Simple sharpen kernel (edge emphasis) */
function unsharp(imageData, amount = 0.35) {
  const w = imageData.width, h = imageData.height, src = imageData.data;
  const out = new ImageData(w, h);
  out.data.set(src);
  const k = [0, -1, 0, -1, 5, -1, 0, -1, 0];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      let r = 0, g = 0, b = 0, ki = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++, ki++) {
          const i = ((y + dy) * w + (x + dx)) * 4;
          const kv = k[ki];
          r += src[i] * kv; g += src[i + 1] * kv; b += src[i + 2] * kv;
        }
      }
      const o = (y * w + x) * 4;
      out.data[o] = clamp((1 - amount) * src[o] + amount * r, 0, 255);
      out.data[o + 1] = clamp((1 - amount) * src[o + 1] + amount * g, 0, 255);
      out.data[o + 2] = clamp((1 - amount) * src[o + 2] + amount * b, 0, 255);
    }
  }
  return out;
}

/* Build final restricted palette list (enabled only) */
function buildFinalRestricted() {
  const out = [];
  state.restricted.forEach((ink, i) => {
    if (ink.enabled) out.push({ r: ink.r, g: ink.g, b: ink.b, hex: ink.hex, _i: i });
  });
  return out;
}

/* Do mapping at preview scale; cache full res on Apply */
function refreshMappingPreview() {
  if (!els.srcCanvas.width) { toast('Load an image first.'); return; }
  const palFinal = buildFinalRestricted();
  if (palFinal.length === 0 && state.recipes.size === 0) { toast('Enable inks in Restricted or add replacements.'); return; }

  const wL = parseInt(els.wLight.value, 10) / 100, wC = parseInt(els.wChroma.value, 10) / 100;
  const bgMode = els.bgMode.value;
  const dither = !!els.useDither.checked;

  state.wL = wL; state.wC = wC; state.bgMode = bgMode;

  const out = applyMappingToCanvas(sctx, octx, palFinal, wL, wC, dither, bgMode);
  if (els.sharpenEdges.checked) {
    const sharp = unsharp(out, 0.35);
    octx.putImageData(sharp, 0, 0);
  }
  els.downloadBtn.disabled = false;
}

/* Full-res Apply + cache for export */
function applyFullRes() {
  if (!state.img) { toast('Load image first.'); return; }
  const w = state.imgW, h = state.imgH;
  const tmp = document.createElement('canvas'); tmp.width = w; tmp.height = h;
  const tctx = tmp.getContext('2d', { willReadFrequently: true });
  tctx.imageSmoothingEnabled = false;
  tctx.drawImage(state.img, 0, 0, w, h);

  const palFinal = buildFinalRestricted();
  const out = applyMappingToCanvas(tctx, tctx, palFinal, state.wL, state.wC, state.dither, state.bgMode);
  const finalImg = els.sharpenEdges.checked ? unsharp(out, 0.35) : out;
  state.fullMappedImageData = finalImg;

  // Draw scaled preview
  const scale = els.srcCanvas.width / w;
  octx.putImageData(finalImg, 0, 0);
  if (scale !== 1) {
    const disp = document.createElement('canvas'); disp.width = w; disp.height = h;
    disp.getContext('2d').putImageData(finalImg, 0, 0);
    octx.clearRect(0, 0, els.outCanvas.width, els.outCanvas.height);
    octx.imageSmoothingEnabled = false;
    octx.drawImage(disp, 0, 0, els.srcCanvas.width, els.srcCanvas.height);
  }
  toast('Full-res mapping complete.');
}

/* Export PNG (full-res) */
function exportPNG() {
  const full = state.fullMappedImageData;
  if (!full) { toast('Click “Apply mapping” first (full-res).'); return; }
  const c = document.createElement('canvas'); c.width = full.width; c.height = full.height;
  c.getContext('2d').putImageData(full, 0, 0);
  c.toBlob(b => {
    const a = document.createElement('a');
    a.download = 'mapped_fullres.png';
    a.href = URL.createObjectURL(b);
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  }, 'image/png');
}

/* Export SVG via ImageTracer */
async function exportSVG() {
  const full = state.fullMappedImageData;
  if (!full) { toast('Click “Apply mapping” first (full-res).'); return; }

  try {
    await ensureImageTracerLoaded();
  } catch (e) {
    console.error(e); alert('Could not load ImageTracer. Check your GitHub Pages URL.'); return;
  }

  // Convert ImageData → SVG (posterized)
  const svgstr = window.ImageTracer.imagedataToSVG(full, {
    // tighter paths, few colors expected
    ltres: 1,        // line threshold
    qtres: 1,        // curve fitting
    numberofcolors: 64,
    mincolorratio: 0.0,
    pathomit: 0,
    blurradius: 0,
    blurdelta: 0
  });

  const blob = new Blob([svgstr], { type: 'image/svg+xml' });
  const a = document.createElement('a');
  a.download = 'mapped_vector.svg';
  a.href = URL.createObjectURL(blob);
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}

/* -------------------- Codes / Report (PMS or HEX) -------------------- */
let PMS_LIB = [];
const PMS_CACHE = new Map();
async function loadPmsJson(url = './assets/pms_solid_coated.json') {
  try { PMS_LIB = await (await fetch(url, { cache: 'no-store' })).json(); }
  catch { PMS_LIB = []; }
}
function nearestPms(hex) {
  if (PMS_CACHE.has(hex)) return PMS_CACHE.get(hex);
  if (!PMS_LIB.length) { const out = { name: '—', hex, deltaE: 0 }; PMS_CACHE.set(hex, out); return out; }
  const rgb = hexToRgb(hex); const lab = rgbToLab(rgb.r, rgb.g, rgb.b);
  let best = null, bestD = Infinity;
  for (const sw of PMS_LIB) {
    const c = hexToRgb(sw.hex); if (!c) continue;
    const d = deltaE2Weighted(lab, rgbToLab(c.r, c.g, c.b), 1, 1);
    if (d < bestD) { bestD = d; best = { name: sw.name, hex: sw.hex, deltaE: Math.sqrt(d) }; }
  }
  PMS_CACHE.set(hex, best); return best;
}
function finalUsedInkHexes() {
  // Final inks are restricted ENABLED + any virtual white if recipes use -1
  const used = new Set();
  const enabled = state.restricted.filter(x => x.enabled).map(x => x.hex);
  enabled.forEach(h => used.add(h));
  state.recipes.forEach(rec => {
    rec.parts.forEach(p => {
      if (p.i === -1) used.add('#FFFFFF');
      else {
        const ink = state.restricted[p.i];
        if (ink?.enabled) used.add(ink.hex);
      }
    });
  });
  return [...used];
}
function renderCodes() {
  const box = els.codeList;
  const mode = els.colorCodeMode?.value || 'pms';
  const list = finalUsedInkHexes();
  if (!list.length) { box.innerHTML = '<em>No final inks selected.</em>'; return; }

  const rows = list.map((hex, i) => {
    if (mode === 'hex') return `<div class="row"><span class="sw" style="background:${hex}"></span>${i + 1}. ${hex}</div>`;
    const p = nearestPms(hex);
    return `<div class="row"><span class="sw" style="background:${p.hex}"></span>${i + 1}. ${p.name} (${p.hex}) ΔE≈${p.deltaE?.toFixed(1) ?? '—'}</div>`;
  });
  box.innerHTML = rows.join('');
}
function exportReport() {
  const mode = els.colorCodeMode?.value || 'pms';
  const items = finalUsedInkHexes();
  const lines = [
    'Project: Palette Mapper output',
    `Colors used: ${items.length}`,
    `Code mode: ${mode.toUpperCase()}`,
    '',
    ...items.map((hex, i) => {
      if (mode === 'hex') return `${i + 1}. ${hex}`;
      const p = nearestPms(hex);
      return `${i + 1}. ${p.name} (${p.hex}) ΔE≈${p.deltaE?.toFixed(1) ?? '—'}`;
    })
  ];
  const txt = lines.join('\n');
  const blob = new Blob([txt], { type: 'text/plain' });
  const a = document.createElement('a'); a.download = 'print_report.txt'; a.href = URL.createObjectURL(blob); a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}

/* -------------------- Full-screen Editor (Eyedrop working) -------------------- */
const editor = { active: false, ectx: null, octx: null, timer: null, currentHex: '#000000' };

function openEditor() {
  if (!state.img || !els.srcCanvas.width) { toast('Load an image first.'); return; }
  els.editorOverlay.classList.remove('hidden');
  els.editorOverlay.setAttribute('aria-hidden', 'false');
  editor.active = true;

  const vw = window.innerWidth, vh = window.innerHeight;
  const rightW = (vw > 900) ? 320 : 0, toolbarH = 44;
  els.editCanvas.width = vw - rightW;
  els.editCanvas.height = vh - toolbarH;
  els.editOverlay.width = els.editCanvas.width;
  els.editOverlay.height = els.editCanvas.height;

  editor.ectx = els.editCanvas.getContext('2d', { willReadFrequently: true });
  editor.octx = els.editOverlay.getContext('2d', { willReadFrequently: true });
  editor.ectx.imageSmoothingEnabled = false; editor.octx.imageSmoothingEnabled = false;

  // Draw stretched preview into editCanvas
  editor.ectx.clearRect(0, 0, els.editCanvas.width, els.editCanvas.height);
  editor.ectx.drawImage(els.srcCanvas, 0, 0, els.editCanvas.width, els.editCanvas.height);

  // Eye tool default
  enableEyedrop();
  renderEditorPalette();
}
function closeEditor() {
  if (!editor.active) return;
  disableEyedrop();
  editor.active = false;
  els.editorOverlay.classList.add('hidden');
  els.editorOverlay.setAttribute('aria-hidden', 'true');
}
function renderEditorPalette() {
  els.editorPalette.innerHTML = '';
  state.source.forEach(c => {
    const s = document.createElement('span');
    s.className = 'sw'; s.style.background = c.hex;
    els.editorPalette.appendChild(s);
  });
}
function pickAtEditor(evt) {
  const rect = els.editCanvas.getBoundingClientRect();
  const x = Math.floor((evt.clientX - rect.left) * els.editCanvas.width / rect.width);
  const y = Math.floor((evt.clientY - rect.top) * els.editCanvas.height / rect.height);
  const d = editor.ectx.getImageData(x, y, 1, 1).data;
  return rgbToHex(d[0], d[1], d[2]);
}
function showEye(hex) {
  els.eyeSwatch.style.background = hex;
  els.eyeHex.textContent = hex;
  editor.currentHex = hex;
}
function eyeStart(evt) {
  evt.preventDefault();
  clearTimeout(editor.timer);
  editor.timer = setTimeout(() => { showEye(pickAtEditor(evt)); drawEyeRing(evt); }, 220);
}
function drawEyeRing(evt) {
  const rect = els.editCanvas.getBoundingClientRect();
  const cx = (evt.clientX - rect.left) * els.editCanvas.width / rect.width;
  const cy = (evt.clientY - rect.top) * els.editCanvas.height / rect.height;
  editor.octx.clearRect(0, 0, els.editOverlay.width, els.editOverlay.height);
  editor.octx.strokeStyle = '#93c5fd'; editor.octx.lineWidth = 2;
  editor.octx.beginPath(); editor.octx.arc(cx, cy, 14, 0, Math.PI * 2); editor.octx.stroke();
}
function eyeMove(evt) {
  if (editor.timer === null) return;
  evt.preventDefault();
  showEye(pickAtEditor(evt));
}
function eyeEnd(evt) {
  evt.preventDefault();
  clearTimeout(editor.timer); editor.timer = null;
}
function enableEyedrop() {
  els.editCanvas.addEventListener('pointerdown', eyeStart, { passive: false });
  els.editCanvas.addEventListener('pointermove', eyeMove, { passive: false });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev =>
    els.editCanvas.addEventListener(ev, eyeEnd, { passive: false }));
}
function disableEyedrop() {
  els.editCanvas.removeEventListener('pointerdown', eyeStart);
  els.editCanvas.removeEventListener('pointermove', eyeMove);
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev =>
    els.editCanvas.removeEventListener(ev, eyeEnd));
}
els.eyeAdd?.addEventListener('click', () => {
  const hex = editor.currentHex || '#000000';
  addSourceColor(hex);
  renderEditorPalette();
  toast(`Added ${hex} to Source palette.`);
});
els.eyeCancel?.addEventListener('click', () => {
  editor.octx?.clearRect(0, 0, els.editOverlay.width, els.editOverlay.height);
});

/* -------------------- Wiring -------------------- */
function bindEvents() {
  // Load
  els.fileInput?.addEventListener('change', e => { const f = e.target.files?.[0]; if (f) handleFile(f); });
  els.cameraInput?.addEventListener('change', e => { const f = e.target.files?.[0]; if (f) handleFile(f); });
  els.pasteBtn?.addEventListener('click', async () => {
    if (!navigator.clipboard || !navigator.clipboard.read) { alert('Clipboard not supported here.'); return; }
    try {
      const items = await navigator.clipboard.read();
      for (const it of items) for (const t of it.types) if (t.startsWith('image/')) { const blob = await it.getType(t); await handleFile(blob); return; }
      alert('No image in clipboard.');
    } catch { alert('Clipboard read failed.'); }
  });
  els.resetBtn?.addEventListener('click', () => { drawPreview(); toast('Preview reset.'); });

  // Source palette
  els.addColor?.addEventListener('click', () => { addSourceColor('#FFFFFF'); });
  els.clearColors?.addEventListener('click', () => { state.source.length = 0; renderSourcePalette(); });
  els.autoExtract?.addEventListener('click', () => autoExtractPalette());

  // Restricted
  els.selectAllRestricted?.addEventListener('click', () => setRestrictedFromSource(true));
  els.selectNoneRestricted?.addEventListener('click', () => setRestrictedFromSource(false));
  els.includeWhite?.addEventListener('change', () => { state.includeWhite = !!els.includeWhite.checked; });

  // Suggest
  els.suggestByHueLuma?.addEventListener('click', () => { suggestByHueLuma(); });

  // Manual
  els.addManualReplace?.addEventListener('click', () => addManualReplacement());

  // Mapping prefs
  const updWeights = () => {
    els.wChromaOut.textContent = (parseInt(els.wChroma.value, 10) / 100).toFixed(2) + '×';
    els.wLightOut.textContent = (parseInt(els.wLight.value, 10) / 100).toFixed(2) + '×';
  };
  ['input', 'change'].forEach(ev => {
    els.wChroma.addEventListener(ev, updWeights);
    els.wLight.addEventListener(ev, updWeights);
    els.useDither.addEventListener(ev, () => state.dither = !!els.useDither.checked);
    els.bgMode.addEventListener(ev, () => state.bgMode = els.bgMode.value);
  });
  updWeights();

  // Mapping actions
  els.refreshMappingBtn?.addEventListener('click', refreshMappingPreview);
  els.applyBtn?.addEventListener('click', applyFullRes);
  els.downloadBtn?.addEventListener('click', exportPNG);
  els.exportSvgBtn?.addEventListener('click', exportSVG);

  // Codes & Report
  els.colorCodeMode?.addEventListener('change', renderCodes);
  els.exportReport?.addEventListener('click', exportReport);

  // Editor
  els.openEditor?.addEventListener('click', openEditor);
  els.editorDone?.addEventListener('click', closeEditor);

  // Quick eyedrop on preview (desktop ALT-click)
  els.srcCanvas.addEventListener('click', (evt) => {
    if (!evt.altKey) return;
    const r = els.srcCanvas.getBoundingClientRect();
    const x = Math.floor((evt.clientX - r.left) * els.srcCanvas.width / r.width);
    const y = Math.floor((evt.clientY - r.top) * els.srcCanvas.height / r.height);
    const d = sctx.getImageData(x, y, 1, 1).data;
    addSourceColor(rgbToHex(d[0], d[1], d[2]));
    toast('Color added to Source.');
  });
}

/* -------------------- Init -------------------- */
async function init() {
  try {
    bindEvents();
    await loadPmsJson(); // for PMS codes
    els.defaultPattern.value = 'checker';
    state.defaultPattern = 'checker';
    toast('Ready. Load an image to begin.');
  } catch (e) {
    console.error('Init error:', e);
  }
}
init();
