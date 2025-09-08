// js/app.js — comprehensive orchestrator with editable color dots
// -----------------------------------------------------------------------------
// IMPORTANT: static imports only (Safari-safe). No top-level await.
// This file assumes the following modules exist in your repo. All calls are
// defensive (feature detection) so missing helpers won't crash the app.
// -----------------------------------------------------------------------------

// UI
import {
  renderRestrictedFromPalette,
  getRestrictedInkIndices
} from './ui/controls.js';

// Color spaces / utils
import { hexToRgb, rgbToHex, rgbToHsl, hslToRgb } from './color/space.js';

// Palette extraction & suggestions
import * as Palette from './color/palette.js';       // e.g. Palette.autoExtract(...)
import * as Suggest from './color/suggest.js';       // e.g. Suggest.byHueLuma(...), Suggest.smartMix(...)

// Patterns / preview options (optional wiring)
import * as Patterns from './color/patterns.js';     // e.g. halftone helpers

// Mapping pipeline
import * as Mapper from './mapping/mapper.js';       // e.g. Mapper.mapImage(...)
import * as Sharpen from './mapping/sharpen.js';     // e.g. Sharpen.unsharpMask(...)

// Exporters
import * as PNG from './export/png.js';              // e.g. PNG.exportPNG(...)
import * as SVG from './export/svg.js';              // e.g. SVG.exportSVG(...)
import * as Report from './export/report.js';        // e.g. Report.exportReport(...)

// IO & storage helpers
import * as Files from './io/files.js';              // e.g. read blobs, dataurls
import * as Store from './io/storage.js';            // e.g. list/save/load projects

// Canvas & image utilities
import * as C2D from './utils/canvas.js';            // e.g. drawImageToFit, copy
import * as Img from './utils/image.js';             // e.g. blobToImage

// Toasts (optional)
import * as Toasts from './ui/toasts.js';            // e.g. Toasts.show('...')

// -----------------------------------------------------------------------------
// DOM getters
// -----------------------------------------------------------------------------
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const els = {
  // Header / Projects
  openProjects:     $('#openProjects'),
  projectsPane:     $('#projectsPane'),
  closeProjects:    $('#closeProjects'),
  projectsList:     $('#projectsList'),
  refreshProjects:  $('#refreshProjects'),
  saveProject:      $('#saveProject'),
  exportProject:    $('#exportProject'),
  importProject:    $('#importProject'),
  deleteProject:    $('#deleteProject'),

  // Image inputs
  fileInput:        $('#fileInput'),
  cameraInput:      $('#cameraInput'),
  pasteBtn:         $('#pasteBtn'),
  resetBtn:         $('#resetBtn'),
  maxW:             $('#maxW'),
  keepFullRes:      $('#keepFullRes'),
  sharpenEdges:     $('#sharpenEdges'),

  // Canvases
  srcCanvas:        $('#srcCanvas'),
  outCanvas:        $('#outCanvas'),

  // Palette controls
  kColors:          $('#kColors'),
  autoExtract:      $('#autoExtract'),

  // Restricted Palette
  restrictedList:   $('#restrictedList'),
  restrictedSelectAll:  $('#restrictedSelectAll'),
  restrictedSelectNone: $('#restrictedSelectNone'),
  allowWhite:       $('#allowWhite'),

  // Suggestions / Rules
  btnSuggestHueLuma:  $('#btnSuggestHueLuma'),
  btnSmartMix:        $('#btnSmartMix'),
  addRule:            $('#addRule'),
  btnRefreshOutput:   $('#btnRefreshOutput'),
  rulesTable:         $('#rulesTable'),

  // Map & Preview
  wChroma:         $('#wChroma'),
  wChromaOut:      $('#wChromaOut'),
  wLight:          $('#wLight'),
  wLightOut:       $('#wLightOut'),
  useDither:       $('#useDither'),
  bgMode:          $('#bgMode'),
  applyBtn:        $('#applyBtn'),
  bigRegen:        $('#bigRegen'),

  // Export & Codes
  exportScale:     $('#exportScale'),
  downloadBtn:     $('#downloadBtn'),
  vectorExport:    $('#vectorExport'),
  colorCodeMode:   $('#colorCodeMode'),
  mailtoLink:      $('#mailtoLink'),
  exportReport:    $('#exportReport'),
  codeList:        $('#codeList'),

  // Misc
  status:          $('#status'),
  toasts:          $('#toasts'),

  // Optional editor overlay
  editorOverlay:   $('#editorOverlay'),
  openEditor:      $('#openEditor'),
  editorDone:      $('#editorDone'),
  editCanvas:      $('#editCanvas'),
  editOverlay:     $('#editOverlay'),
};

// -----------------------------------------------------------------------------
// App state
// -----------------------------------------------------------------------------
const DEFAULT_HEXES = ['#CE6D01', '#8B3400', '#F23300', '#0CB300', '#FFFFFF'];
const DEFAULT_TOL   = 64;

const state = {
  palette:      [],                   // [{r,g,b,tol}, ...]
  restricted:   new Set(),            // active ink indices
  srcImage:     null,                 // original image (HTMLImageElement) or flag
  fullImage:    null,                 // original full-res image/canvas (optional)
  mappedMeta:   null,                 // last mapping info (Mapper return)
  rules:        [],                   // rules table model
  projects:     [],                   // {id,name,data}
  key:          'limited-palette-designer:v1',
};

// -----------------------------------------------------------------------------
// Boot
// -----------------------------------------------------------------------------
init();

function init() {
  loadPrefs();
  ensureDefaultPalette();
  renderAll();
  wireEvents();
  info('Ready');
}

// -----------------------------------------------------------------------------
// Rendering
// -----------------------------------------------------------------------------
function renderAll() {
  renderRestrictedPaletteUI();
  renderCodeList();
  renderRulesTable();
  syncWeightsUI();
  updateButtonsEnabled();
}

function renderRestrictedPaletteUI() {
  const hexes = state.palette.map(p => rgbToHex(p.r, p.g, p.b));
  renderRestrictedFromPalette(els, hexes, state.restricted);
}

function renderCodeList() {
  if (!els.codeList) return;
  const mode = (els.colorCodeMode?.value || 'pms').toLowerCase();
  const hexes = state.palette.map(p => rgbToHex(p.r, p.g, p.b));
  const indices = [...state.restricted].sort((a, b) => a - b);
  const active  = indices.map(i => hexes[i]);

  const out = [];
  out.push('// Restricted Inks (active):');
  active.forEach((hx, i) => {
    out.push(`Ink ${i + 1}: ${formatColorForMode(hx, mode)}`);
  });
  out.push('');
  out.push('// Full Palette (with tolerance):');
  state.palette.forEach((p, i) => {
    out.push(`#${String(i).padStart(2,'0')} ${rgbToHex(p.r,p.g,p.b)}  tol=${p.tol}`);
  });

  els.codeList.textContent = out.join('\n');
}

function renderRulesTable() {
  if (!els.rulesTable) return;
  const tbody = $('tbody', els.rulesTable);
  if (!tbody) return;
  tbody.innerHTML = '';
  state.rules.forEach((rule, idx) => {
    const tr = document.createElement('tr');

    const tdOn = cell();
    const on = input('checkbox'); on.checked = !!rule.on;
    on.addEventListener('change', () => { rule.on = on.checked; persistPrefs(); });
    tdOn.append(on);

    const tdTarget = cell();
    const target = input('text'); target.value = rule.target || '';
    target.addEventListener('input', () => { rule.target = target.value; persistPrefs(); });
    tdTarget.append(target);

    const tdPattern = cell();
    const pattern = input('text'); pattern.value = rule.pattern || '';
    pattern.addEventListener('input', () => { rule.pattern = pattern.value; persistPrefs(); });
    tdPattern.append(pattern);

    const tdInks = cell();
    const inks = input('text'); inks.placeholder = 'e.g. 0,1,3'; inks.value = (rule.inks || []).join(',');
    inks.addEventListener('input', () => {
      rule.inks = (inks.value || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
        .map(n => n|0);
      persistPrefs();
    });
    tdInks.append(inks);

    const tdDen = cell();
    const den = input('number'); den.min = 0; den.max = 100; den.value = rule.density ?? 100;
    den.addEventListener('input', () => { rule.density = den.value|0; persistPrefs(); });
    tdDen.append(den);

    const tdDel = cell();
    const del = button('Del', 'btn btn-danger');
    del.addEventListener('click', () => {
      state.rules.splice(idx, 1);
      renderRulesTable();
      persistPrefs();
    });
    tdDel.append(del);

    tr.append(tdOn, tdTarget, tdPattern, tdInks, tdDen, tdDel);
    tbody.append(tr);
  });

  function cell() { const td = document.createElement('td'); return td; }
  function input(t) { const el = document.createElement('input'); el.type = t; return el; }
  function button(txt, cls) { const b = document.createElement('button'); b.textContent = txt; if (cls) b.className = cls; return b; }
}

function syncWeightsUI() {
  if (els.wChroma && els.wChromaOut) {
    els.wChromaOut.textContent = (Number(els.wChroma.value || 100) / 100).toFixed(2) + '×';
  }
  if (els.wLight && els.wLightOut) {
    els.wLightOut.textContent  = (Number(els.wLight.value  || 100) / 100).toFixed(2) + '×';
  }
}

function updateButtonsEnabled() {
  const hasImage = !!state.srcImage;
  const set = (el, on) => { if (el) el.disabled = !on; };
  set(els.resetBtn,      hasImage);
  set(els.autoExtract,   hasImage);
  set(els.applyBtn,      hasImage);
  set(els.downloadBtn,   hasImage);
  set(els.vectorExport,  hasImage);
}

// -----------------------------------------------------------------------------
// Events
// -----------------------------------------------------------------------------
function wireEvents() {
  // Editable Color Dots (NEW)
  els.restrictedList?.addEventListener('restricted:coloredit', (e) => {
    const { index, hex } = e.detail || {};
    if (index == null || !hex) return;
    const rgb = hexToRgb(hex);
    if (!rgb) return;

    const prev = state.palette[index] || { tol: DEFAULT_TOL };
    state.palette[index] = { r: rgb.r, g: rgb.g, b: rgb.b, tol: prev.tol ?? DEFAULT_TOL };

    renderRestrictedPaletteUI();
    renderCodeList();
    persistPrefs();
    info(`Updated color ${index + 1} → ${hex.toUpperCase()}`);
  });

  els.restrictedList?.addEventListener('restricted:toggle', () => {
    const indices = getRestrictedInkIndices({ restrictedList: els.restrictedList });
    state.restricted = new Set(indices);
    renderCodeList();
    persistPrefs();
  });

  // Image IO
  els.fileInput?.addEventListener('change', handleFile);
  els.cameraInput?.addEventListener('change', handleFile);
  els.pasteBtn?.addEventListener('click', pasteImage);
  els.resetBtn?.addEventListener('click', resetAll);

  // Palette extraction
  els.autoExtract?.addEventListener('click', runAutoExtract);
  els.kColors?.addEventListener('change', () => info(`K = ${els.kColors.value}`));

  // Suggestions & Rules
  els.btnSuggestHueLuma?.addEventListener('click', suggestHueLuma);
  els.btnSmartMix?.addEventListener('click', smartMix);
  els.addRule?.addEventListener('click', addRule);
  els.btnRefreshOutput?.addEventListener('click', () => mapToRestricted(true));

  // Mapping
  els.wChroma?.addEventListener('input', syncWeightsUI);
  els.wLight?.addEventListener('input',  syncWeightsUI);
  els.applyBtn?.addEventListener('click', () => mapToRestricted(false));
  els.bigRegen?.addEventListener('click', () => mapToRestricted(true));

  // Export
  els.downloadBtn?.addEventListener('click', exportPng);
  els.vectorExport?.addEventListener('click', exportSvg);
  els.exportReport?.addEventListener('click', exportReport);
  els.colorCodeMode?.addEventListener('change', renderCodeList);

  // Projects
  els.openProjects?.addEventListener('click', () => els.projectsPane?.classList.add('open'));
  els.closeProjects?.addEventListener('click', () => els.projectsPane?.classList.remove('open'));
  els.refreshProjects?.addEventListener('click', refreshProjects);
  els.saveProject?.addEventListener('click', saveProject);
  els.exportProject?.addEventListener('click', exportProjectJson);
  els.importProject?.addEventListener('change', importProjectJson);
  els.deleteProject?.addEventListener('click', deleteSelectedProject);

  // Persistence on leave
  window.addEventListener('beforeunload', persistPrefs);
}

// -----------------------------------------------------------------------------
// Image pipeline
// -----------------------------------------------------------------------------
async function handleFile(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  await loadBlobToCanvas(file, els.srcCanvas);
  state.srcImage = true;

  // enable auto-extract immediately
  updateButtonsEnabled();
  info(`Loaded ${file.name}`);
}

async function pasteImage() {
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      for (const type of item.types) {
        if (type.startsWith('image/')) {
          const blob = await item.getType(type);
          await loadBlobToCanvas(blob, els.srcCanvas);
          state.srcImage = true;
          updateButtonsEnabled();
          info('Image pasted.');
          return;
        }
      }
    }
    info('No image on clipboard.');
  } catch (e) {
    console.warn(e);
    info('Clipboard paste not available.');
  }
}

function resetAll() {
  clearCanvas(els.srcCanvas);
  clearCanvas(els.outCanvas);
  state.srcImage = null;
  info('Reset.');
  updateButtonsEnabled();
}

async function runAutoExtract() {
  if (!els.srcCanvas) return;
  const k = clamp(els.kColors?.value|0 || 10, 2, 16);
  if (!Palette || !Palette.autoExtract) {
    info('Auto-extract module not available.');
    return;
  }

  try {
    info('Extracting palette...');
    const result = await Palette.autoExtract(els.srcCanvas, { k });
    // result: [{r,g,b}, ...]
    state.palette = (result || []).map(rgb => ({ ...rgb, tol: DEFAULT_TOL }));
    state.restricted = new Set(state.palette.map((_, i) => i));
    renderAll();
    persistPrefs();
    info(`Extracted ${state.palette.length} colors.`);
  } catch (e) {
    console.warn(e);
    info('Failed to extract palette.');
  }
}

async function mapToRestricted(forceRemap = false) {
  if (!Mapper || !Mapper.mapImage) {
    info('Mapping module not available.');
    return;
  }
  if (!els.srcCanvas || !els.outCanvas) return;

  const indices = [...state.restricted].sort((a, b) => a - b);
  const inks = indices.map(i => state.palette[i]).filter(Boolean);
  if (!inks.length) {
    info('Select at least one ink.');
    return;
  }

  const weights = {
    chroma: (els.wChroma?.value|0 || 100) / 100,
    luma:   (els.wLight?.value|0  || 100) / 100,
  };
  const opts = {
    dither: !!els.useDither?.checked,
    bgMode: els.bgMode?.value || 'keep',
    allowWhite: !!els.allowWhite?.checked,
    forceRemap,
  };

  try {
    info('Mapping…');
    const mapped = await Mapper.mapImage(els.srcCanvas, inks, weights, opts);
    state.mappedMeta = mapped || null;

    // draw mapped output
    if (mapped?.canvas) {
      copyCanvas(mapped.canvas, els.outCanvas);
    } else if (mapped?.imageData) {
      drawImageData(mapped.imageData, els.outCanvas);
    }

    // optional sharpen
    if (els.sharpenEdges?.checked && Sharpen?.unsharpMask) {
      const ctx = els.outCanvas.getContext('2d', { willReadFrequently: true });
      const imgData = ctx.getImageData(0, 0, els.outCanvas.width, els.outCanvas.height);
      const sharp = Sharpen.unsharpMask(imgData, { amount: 0.5, radius: 0.6, threshold: 2 });
      ctx.putImageData(sharp, 0, 0);
    }

    info('Done.');
  } catch (e) {
    console.warn(e);
    info('Mapping failed.');
  }
}

// -----------------------------------------------------------------------------
// Suggestions & rules
// -----------------------------------------------------------------------------
async function suggestHueLuma() {
  if (!Suggest?.byHueLuma) {
    info('Suggest-by-hue module not available.');
    return;
  }
  const hexes = state.palette.map(p => rgbToHex(p.r, p.g, p.b));
  try {
    const picks = await Suggest.byHueLuma(hexes);
    // picks -> array of indices; set them active:
    state.restricted = new Set(picks);
    renderRestrictedPaletteUI();
    renderCodeList();
    persistPrefs();
    info(`Suggested ${picks.length} inks by Hue/Luma.`);
  } catch (e) {
    console.warn(e);
    info('Suggestion failed.');
  }
}

async function smartMix() {
  if (!Suggest?.smartMix) {
    info('Smart Mix module not available.');
    return;
  }
  try {
    const indices = [...state.restricted].sort((a, b) => a - b);
    const inks = indices.map(i => state.palette[i]).filter(Boolean);
    const res = await Suggest.smartMix(inks, { allowWhite: !!els.allowWhite?.checked });
    showToast(`Smart Mix produced ${res?.length || 0} mixes.`);
  } catch (e) {
    console.warn(e);
    info('Smart Mix failed.');
  }
}

function addRule() {
  state.rules.push({ on: true, target: '', pattern: '', inks: [], density: 100 });
  renderRulesTable();
  persistPrefs();
}

// -----------------------------------------------------------------------------
// Export
// -----------------------------------------------------------------------------
async function exportPng() {
  if (!PNG?.exportPNG) {
    info('PNG export module not available.');
    return;
  }
  try {
    const scale = clamp(els.exportScale?.value|0 || 1, 1, 8);
    const blob = await PNG.exportPNG(els.outCanvas || els.srcCanvas, { scale });
    await Files?.saveBlob?.(blob, 'palette-mapper.png');
    info('PNG exported.');
  } catch (e) {
    console.warn(e);
    info('PNG export failed.');
  }
}

async function exportSvg() {
  if (!SVG?.exportSVG) {
    info('SVG export module not available.');
    return;
  }
  try {
    const svgText = await SVG.exportSVG(state.mappedMeta);
    await Files?.saveText?.(svgText, 'palette-mapper.svg', 'image/svg+xml');
    info('SVG exported.');
  } catch (e) {
    console.warn(e);
    info('SVG export failed.');
  }
}

async function exportReport() {
  if (!Report?.exportReport) {
    info('Report module not available.');
    return;
  }
  try {
    const indices = [...state.restricted].sort((a, b) => a - b);
    const inks = indices.map(i => state.palette[i]).filter(Boolean);
    const text = await Report.exportReport({ inks, rules: state.rules });
    await Files?.saveText?.(text, 'palette-report.txt', 'text/plain');
    info('Report exported.');
  } catch (e) {
    console.warn(e);
    info('Report failed.');
  }
}

// -----------------------------------------------------------------------------
// Projects
// -----------------------------------------------------------------------------
async function refreshProjects() {
  try {
    const list = await Store?.list?.();
    state.projects = Array.isArray(list) ? list : [];
    renderProjectsList();
    info('Projects refreshed.');
  } catch (e) {
    console.warn(e);
    info('Could not refresh projects.');
  }
}

function renderProjectsList() {
  if (!els.projectsList) return;
  els.projectsList.innerHTML = '';
  state.projects.forEach(p => {
    const btn = document.createElement('button');
    btn.className = 'btn btn-ghost';
    btn.textContent = p.name || p.id;
    btn.addEventListener('click', async () => {
      try {
        const data = await Store?.load?.(p.id);
        if (!data) return;
        hydrateFromProject(data);
        renderAll();
        showToast(`Loaded project: ${p.name || p.id}`);
      } catch (e) {
        console.warn(e);
        info('Load failed.');
      }
    });
    els.projectsList.append(btn);
  });
}

async function saveProject() {
  try {
    const data = serializeProject();
    const saved = await Store?.save?.(data);
    if (saved) showToast('Project saved.');
  } catch (e) {
    console.warn(e);
    info('Save failed.');
  }
}

async function exportProjectJson() {
  try {
    const json = JSON.stringify(serializeProject(), null, 2);
    await Files?.saveText?.(json, 'palette-project.json', 'application/json');
    showToast('Project JSON exported.');
  } catch (e) {
    console.warn(e);
    info('Export failed.');
  }
}

async function importProjectJson(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    hydrateFromProject(data);
    renderAll();
    showToast('Project imported.');
  } catch (err) {
    console.warn(err);
    info('Import failed.');
  } finally {
    e.target.value = '';
  }
}

async function deleteSelectedProject() {
  try {
    const list = await Store?.list?.();
    const last = list?.[0];
    if (!last?.id) { info('No project to delete.'); return; }
    await Store?.remove?.(last.id);
    showToast(`Deleted project ${last.name || last.id}.`);
    refreshProjects();
  } catch (e) {
    console.warn(e);
    info('Delete failed.');
  }
}

function serializeProject() {
  const payload = {
    palette: state.palette,
    restricted: [...state.restricted],
    rules: state.rules,
    weights: {
      chroma: (els.wChroma?.value|0 || 100)/100,
      luma:   (els.wLight?.value|0  || 100)/100,
    }
  };
  return payload;
}

function hydrateFromProject(data) {
  if (Array.isArray(data.palette)) {
    state.palette = data.palette.map(p => ({ r:p.r|0, g:p.g|0, b:p.b|0, tol:(p.tol ?? DEFAULT_TOL)|0 }));
  }
  if (Array.isArray(data.restricted)) {
    state.restricted = new Set(data.restricted.map(i => i|0));
  }
  if (Array.isArray(data.rules)) {
    state.rules = data.rules;
  }
}

// -----------------------------------------------------------------------------
// Persistence (local)
// -----------------------------------------------------------------------------
function loadPrefs() {
  try {
    const raw = localStorage.getItem(state.key);
    if (!raw) return;
    const data = JSON.parse(raw);
    hydrateFromProject(data);
  } catch (e) {
    console.warn('Prefs load failed:', e);
  }
}

function persistPrefs() {
  try {
    const data = serializeProject();
    localStorage.setItem(state.key, JSON.stringify(data));
  } catch (e) {
    console.warn('Prefs save failed:', e);
  }
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------
function ensureDefaultPalette() {
  if (state.palette?.length) return;
  state.palette = DEFAULT_HEXES.map(h => {
    const rgb = hexToRgb(h) || { r: 255, g: 255, b: 255 };
    return { ...rgb, tol: DEFAULT_TOL };
  });
  state.restricted = new Set(state.palette.map((_, i) => i));
}

async function loadBlobToCanvas(blob, canvas) {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      drawToCanvas(img, canvas, Number(els.maxW?.value || 1400));
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      info('Could not load image.');
    };
    img.src = url;
  } catch (e) {
    URL.revokeObjectURL(url);
    console.warn(e);
    info('Could not load image.');
  }
}

function drawToCanvas(img, canvas, maxW = 1400) {
  if (!canvas) return;
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const scale = Math.min(1, maxW > 0 ? maxW / w : 1);
  const dw = Math.max(1, Math.round(w * scale));
  const dh = Math.max(1, Math.round(h * scale));
  canvas.width = dw;
  canvas.height = dh;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.clearRect(0, 0, dw, dh);
  ctx.drawImage(img, 0, 0, dw, dh);
}

function clearCanvas(canvas) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  canvas.width = 1; canvas.height = 1;
}

function copyCanvas(src, dst) {
  dst.width = src.width; dst.height = src.height;
  const dctx = dst.getContext('2d');
  dctx.clearRect(0, 0, dst.width, dst.height);
  dctx.drawImage(src, 0, 0);
}

function drawImageData(imageData, canvas) {
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext('2d');
  ctx.putImageData(imageData, 0, 0);
}

function formatColorForMode(hex, mode) {
  if (mode === 'hex') return hex.toUpperCase();
  // For PMS or other systems, your Report/Suggest modules may provide a
  // converter; if not available, fall back to HEX.
  if (Report?.toPMS) {
    try { return Report.toPMS(hex) || hex.toUpperCase(); } catch {}
  }
  return hex.toUpperCase();
}

function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }

function info(msg) {
  if (!els.status) return;
  const now = new Date();
  const hh = String(now.getHours()).padStart(2,'0');
  const mm = String(now.getMinutes()).padStart(2,'0');
  els.status.textContent = `[${hh}:${mm}] ${msg}`;
}

function showToast(msg) {
  if (Toasts?.show) { Toasts.show(msg); return; }
  info(msg);
}

// -----------------------------------------------------------------------------
// End of file
// -----------------------------------------------------------------------------
