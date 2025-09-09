// js/app.js — cohesive, full-featured orchestrator w/ editable color dots
// -----------------------------------------------------------------------------
// SAFARI-SAFE: static imports only; no top-level await.
// Matches repo APIs from the previously functional build.
// -----------------------------------------------------------------------------

// UI (Restricted list + color dots)
import {
  renderRestrictedFromPalette,
  getRestrictedInkIndices
} from './ui/controls.js';

// Color utils
import { hexToRgb, rgbToHex, rgbToHsl, hslToRgb } from './color/space.js';

// Palette extraction / suggestions
import * as Palette  from './color/palette.js';   // autoPaletteFromCanvasHybrid(canvas, k)
import * as Suggest  from './color/suggest.js';   // suggestByHueLuma(srcCanvas, paletteHex, allowedIdx), smartMixSuggest(targetHex, paletteHex, allowedIdx)

// Patterns (optional)
import * as Patterns from './color/patterns.js';

// Mapping & sharpening
import * as Mapper   from './mapping/mapper.js';  // mapToPalette(imageData, palette, opts)
import * as Sharpen  from './mapping/sharpen.js'; // unsharpMask(imageData, amount)

// Exports
import * as PNG      from './export/png.js';      // exportPNG(imageData, scale) -> Blob
import * as SVG      from './export/svg.js';      // exportSVG(imageData, paletteHex, maxColors) -> string
import * as Report   from './export/report.js';   // buildPrinterReport(), (opt) loadPmsJson()

// IO & storage
import * as Files    from './io/files.js';        // saveBlob(blob, name), saveText(text, name, mime)
import * as Store    from './io/storage.js';      // list(), load(id), save(data), remove(id)

// Canvas & image helpers (optional; we still implement local fallbacks)
import * as C2D      from './utils/canvas.js';
import * as Img      from './utils/image.js';

// Toasts (optional)
import * as Toasts   from './ui/toasts.js';

// -----------------------------------------------------------------------------
// DOM
// -----------------------------------------------------------------------------
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const els = {
  // Header / Projects
  openProjects:        $('#openProjects'),
  projectsPane:        $('#projectsPane'),
  closeProjects:       $('#closeProjects'),
  projectsList:        $('#projectsList'),
  refreshProjects:     $('#refreshProjects'),
  saveProject:         $('#saveProject'),
  exportProject:       $('#exportProject'),
  importProject:       $('#importProject'),
  deleteProject:       $('#deleteProject'),

  // Image inputs
  fileInput:           $('#fileInput'),
  cameraInput:         $('#cameraInput'),
  pasteBtn:            $('#pasteBtn'),
  resetBtn:            $('#resetBtn'),
  maxW:                $('#maxW'),
  keepFullRes:         $('#keepFullRes'),
  sharpenEdges:        $('#sharpenEdges'),

  // Canvases
  srcCanvas:           $('#srcCanvas'),
  outCanvas:           $('#outCanvas'),

  // Palette
  kColors:             $('#kColors'),
  autoExtract:         $('#autoExtract'),

  // Restricted Palette
  restrictedList:      $('#restrictedList'),
  restrictedSelectAll: $('#restrictedSelectAll'),
  restrictedSelectNone:$('#restrictedSelectNone'),
  allowWhite:          $('#allowWhite'),

  // Suggestions / Rules
  btnSuggestHueLuma:   $('#btnSuggestHueLuma'),
  btnSmartMix:         $('#btnSmartMix'),
  addRule:             $('#addRule'),
  btnRefreshOutput:    $('#btnRefreshOutput'),
  rulesTable:          $('#rulesTable'),

  // Mapping
  wChroma:             $('#wChroma'),
  wChromaOut:          $('#wChromaOut'),
  wLight:              $('#wLight'),
  wLightOut:           $('#wLightOut'),
  useDither:           $('#useDither'),
  bgMode:              $('#bgMode'),
  applyBtn:            $('#applyBtn'),
  bigRegen:            $('#bigRegen'),

  // Export
  exportScale:         $('#exportScale'),
  downloadBtn:         $('#downloadBtn'),
  vectorExport:        $('#vectorExport'),
  colorCodeMode:       $('#colorCodeMode'),
  mailtoLink:          $('#mailtoLink'),
  exportReport:        $('#exportReport'),
  codeList:            $('#codeList'),

  // Misc
  status:              $('#status'),
  toasts:              $('#toasts'),

  // Optional editor overlay
  editorOverlay:       $('#editorOverlay'),
  openEditor:          $('#openEditor'),
  editorDone:          $('#editorDone'),
  editCanvas:          $('#editCanvas'),
  editOverlay:         $('#editOverlay'),
};

// -----------------------------------------------------------------------------
// State
// -----------------------------------------------------------------------------
const DEFAULT_HEXES = ['#CE6D01', '#8B3400', '#F23300', '#0CB300', '#FFFFFF'];
const DEFAULT_TOL   = 64;

const state = {
  // Colors used everywhere. Array of { r,g,b,tol }
  palette: [],
  // Which palette indices are allowed as final inks
  restricted: new Set(),
  // Image pipeline
  srcImage: null,     // we use canvases; keep a flag for "image loaded"
  mapped:   null,     // last ImageData result (for export)
  // Rules (Suggestions & Rules table)
  rules: [],
  // Projects list (from Store)
  projects: [],
  // Persist key
  key: 'limited-palette-designer:v1',
};

// -----------------------------------------------------------------------------
// Init
// -----------------------------------------------------------------------------
init();

function init() {
  loadPrefs();
  ensureDefaultPalette();
  renderAll();
  wireEvents();
  enableUIAccordingToImage(false);
  info('Ready');
}

// -----------------------------------------------------------------------------
// Render
// -----------------------------------------------------------------------------
function renderAll() {
  renderRestrictedPaletteUI();
  renderCodeList();
  renderRulesTable();
  syncWeightsUI();
}

function renderRestrictedPaletteUI() {
  const hexes = state.palette.map(p => rgbToHex(p.r, p.g, p.b));
  renderRestrictedFromPalette(els, hexes, state.restricted);
}

function renderCodeList() {
  if (!els.codeList) return;
  const mode  = (els.colorCodeMode?.value || 'pms').toLowerCase();
  const hexes = state.palette.map(p => rgbToHex(p.r, p.g, p.b));
  const idx   = [...state.restricted].sort((a,b)=>a-b);
  const act   = idx.map(i => hexes[i]);

  const out = [];
  out.push('// Restricted Inks (active):');
  act.forEach((hx, i) => out.push(`Ink ${i+1}: ${formatColor(hx, mode)}`));
  out.push('');
  out.push('// Full Palette (with tolerance):');
  state.palette.forEach((p, i) => out.push(`#${String(i).padStart(2,'0')} ${rgbToHex(p.r,p.g,p.b)}  tol=${p.tol}`));

  els.codeList.textContent = out.join('\n');
}

function renderRulesTable() {
  if (!els.rulesTable) return;
  const tbody = $('tbody', els.rulesTable);
  if (!tbody) return;
  tbody.innerHTML = '';

  state.rules.forEach((rule, idx) => {
    const tr = document.createElement('tr');

    const tdOn = td(); const on = input('checkbox'); on.checked = !!rule.on;
    on.addEventListener('change', () => { rule.on = on.checked; persistPrefs(); });
    tdOn.append(on);

    const tdTarget = td(); const target = input('text'); target.value = rule.target || '';
    target.addEventListener('input', () => { rule.target = target.value; persistPrefs(); });
    tdTarget.append(target);

    const tdPattern = td(); const pattern = input('text'); pattern.value = rule.pattern || '';
    pattern.addEventListener('input', () => { rule.pattern = pattern.value; persistPrefs(); });
    tdPattern.append(pattern);

    const tdInks = td(); const inks = input('text');
    inks.placeholder = 'e.g. 0,1,3'; inks.value = (rule.inks || []).join(',');
    inks.addEventListener('input', () => {
      rule.inks = (inks.value || '')
        .split(',').map(s=>s.trim()).filter(Boolean).map(n=>n|0);
      persistPrefs();
    });
    tdInks.append(inks);

    const tdDen = td(); const den = input('number');
    den.min = 0; den.max = 100; den.value = rule.density ?? 100;
    den.addEventListener('input', () => { rule.density = den.value|0; persistPrefs(); });
    tdDen.append(den);

    const tdDel = td(); const del = btn('Del','btn btn-danger');
    del.addEventListener('click', () => {
      state.rules.splice(idx, 1);
      renderRulesTable();
      persistPrefs();
    });
    tdDel.append(del);

    tr.append(tdOn, tdTarget, tdPattern, tdInks, tdDen, tdDel);
    tbody.append(tr);
  });

  function td(){ return document.createElement('td'); }
  function input(t){ const el = document.createElement('input'); el.type = t; return el; }
  function btn(txt, cls){ const b = document.createElement('button'); b.textContent = txt; if (cls) b.className = cls; return b; }
}

function syncWeightsUI() {
  if (els.wChroma && els.wChromaOut) {
    els.wChromaOut.textContent = (Number(els.wChroma.value || 100) / 100).toFixed(2) + '×';
  }
  if (els.wLight && els.wLightOut) {
    els.wLightOut.textContent  = (Number(els.wLight.value  || 100) / 100).toFixed(2) + '×';
  }
}

function enableUIAccordingToImage(has) {
  const en = (el, on) => { if (el) el.disabled = !on; };
  en(els.resetBtn,     has);
  en(els.autoExtract,  has);
  en(els.applyBtn,     has);
  en(els.downloadBtn,  has);
  en(els.vectorExport, has);
}

// -----------------------------------------------------------------------------
// Events
// -----------------------------------------------------------------------------
function wireEvents() {
  // New: editable color dots in Restricted list
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

  // New: checkbox changes in Restricted list
  els.restrictedList?.addEventListener('restricted:toggle', () => {
    const indices = getRestrictedInkIndices({ restrictedList: els.restrictedList });
    state.restricted = new Set(indices);
    renderCodeList();
    persistPrefs();
  });

  // Image I/O
  els.fileInput?.addEventListener('change', handleFile);
  els.cameraInput?.addEventListener('change', handleFile);
  els.pasteBtn?.addEventListener('click', pasteImage);
  els.resetBtn?.addEventListener('click', resetAll);

  // Extract / Suggestions / Rules
  els.autoExtract?.addEventListener('click', runAutoExtract);
  els.kColors?.addEventListener('change', () => info(`K = ${els.kColors.value}`));
  els.btnSuggestHueLuma?.addEventListener('click', suggestHueLuma);
  els.btnSmartMix?.addEventListener('click',  smartMix);
  els.addRule?.addEventListener('click',      addRule);
  els.btnRefreshOutput?.addEventListener('click', () => mapToRestricted(true));

  // Mapping
  els.wChroma?.addEventListener('input', syncWeightsUI);
  els.wLight ?.addEventListener('input', syncWeightsUI);
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
  els.saveProject?.addEventListener('click',    saveProject);
  els.exportProject?.addEventListener('click',  exportProjectJson);
  els.importProject?.addEventListener('change', importProjectJson);
  els.deleteProject?.addEventListener('click',  deleteSelectedProject);

  // Persist on leave
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
  enableUIAccordingToImage(true);
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
          enableUIAccordingToImage(true);
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
  state.mapped = null;
  enableUIAccordingToImage(false);
  info('Reset.');
}

// -----------------------------------------------------------------------------
// Palette extraction & suggestions
// -----------------------------------------------------------------------------
async function runAutoExtract() {
  if (!els.srcCanvas) return;
  const k = clamp(els.kColors?.value|0 || 10, 2, 16);

  if (!Palette?.autoPaletteFromCanvasHybrid) {
    info('Auto-extract not available.');
    return;
  }
  try {
    info('Extracting palette…');
    const hexes = Palette.autoPaletteFromCanvasHybrid(els.srcCanvas, k) || [];
    if (!hexes.length) { info('No colors found.'); return; }

    state.palette = hexes.map(hx => {
      const { r, g, b } = hexToRgb(hx);
      return { r, g, b, tol: DEFAULT_TOL };
    });
    state.restricted = new Set(state.palette.map((_, i) => i));

    renderAll();
    persistPrefs();
    info(`Extracted ${state.palette.length} colors.`);
  } catch (e) {
    console.warn(e);
    info('Failed to extract palette.');
  }
}

async function suggestHueLuma() {
  if (!Suggest?.suggestByHueLuma) { info('Suggest module not available.'); return; }
  try {
    const hexes = state.palette.map(p => rgbToHex(p.r,p.g,p.b));
    const allowed = [...state.restricted].sort((a,b)=>a-b);
    const picks = Suggest.suggestByHueLuma(els.srcCanvas, hexes, allowed) || [];
    if (picks.length) {
      state.restricted = new Set(picks);
      renderRestrictedPaletteUI();
      renderCodeList();
      persistPrefs();
    }
    info(`Suggested ${picks.length} inks by Hue/Luma.`);
  } catch (e) {
    console.warn(e); info('Suggestion failed.');
  }
}

async function smartMix() {
  if (!Suggest?.smartMixSuggest) { info('Smart Mix module not available.'); return; }
  try {
    const allowed = [...state.restricted].sort((a,b)=>a-b);
    const hexes   = state.palette.map(p => rgbToHex(p.r,p.g,p.b));
    const target  = hexes[allowed[0]] ?? hexes[0];
    const res     = Suggest.smartMixSuggest(target, hexes, allowed);
    info(res ? `Smart Mix: ${JSON.stringify(res)}` : 'No mix found.');
  } catch (e) {
    console.warn(e); info('Smart Mix failed.');
  }
}

// -----------------------------------------------------------------------------
// Mapping
// -----------------------------------------------------------------------------
async function mapToRestricted(forceRemap = false) {
  if (!Mapper?.mapToPalette) { info('Mapping module not available.'); return; }
  if (!els.srcCanvas || !els.outCanvas) return;

  const idx  = [...state.restricted].sort((a,b)=>a-b);
  const inks = idx.map(i => state.palette[i]).filter(Boolean);
  if (!inks.length) { info('Select at least one ink.'); return; }

  const weights = {
    wC: (els.wChroma?.value|0 || 100)/100,
    wL: (els.wLight ?.value|0 || 100)/100,
  };
  const opts = {
    dither: !!els.useDither?.checked,
    bgMode: els.bgMode?.value || 'keep',
    ...weights,
    forceRemap,
  };

  try {
    info('Mapping…');
    const sctx = els.srcCanvas.getContext('2d', { willReadFrequently: true });
    const srcData = sctx.getImageData(0, 0, els.srcCanvas.width, els.srcCanvas.height);

    const outData = Mapper.mapToPalette(srcData, inks, opts); // ImageData in/out
    state.mapped  = outData;

    els.outCanvas.width  = outData.width;
    els.outCanvas.height = outData.height;
    els.outCanvas.getContext('2d').putImageData(outData, 0, 0);

    if (els.sharpenEdges?.checked && Sharpen?.unsharpMask) {
      const ctx = els.outCanvas.getContext('2d', { willReadFrequently: true });
      const img = ctx.getImageData(0, 0, els.outCanvas.width, els.outCanvas.height);
      const sharp = Sharpen.unsharpMask(img, 0.5); // amount
      ctx.putImageData(sharp, 0, 0);
    }

    info('Done.');
  } catch (e) {
    console.warn(e);
    info('Mapping failed.');
  }
}

// -----------------------------------------------------------------------------
// Exports
// -----------------------------------------------------------------------------
async function exportPng() {
  if (!PNG?.exportPNG) { info('PNG export not available.'); return; }

  try {
    const scale = clamp(els.exportScale?.value|0 || 1, 1, 8);
    const imgData = getExportImageData();
    if (!imgData) { info('Nothing to export.'); return; }

    const blob = PNG.exportPNG(imgData, scale);
    if (Files?.saveBlob) {
      await Files.saveBlob(blob, 'palette-mapper.png');
    } else {
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement('a'), { href:url, download:'palette-mapper.png' });
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    }
    info('PNG exported.');
  } catch (e) {
    console.warn(e); info('PNG export failed.');
  }
}

async function exportSvg() {
  if (!SVG?.exportSVG) { info('SVG export not available.'); return; }

  try {
    const imgData = getExportImageData();
    if (!imgData) { info('Nothing to export.'); return; }

    const allowedIdx = [...state.restricted].sort((a,b)=>a-b);
    const paletteHex = allowedIdx.map(i => rgbToHex(state.palette[i].r, state.palette[i].g, state.palette[i].b));
    const svgText    = SVG.exportSVG(imgData, paletteHex, paletteHex.length);

    if (Files?.saveText) {
      await Files.saveText(svgText, 'palette-mapper.svg', 'image/svg+xml');
    } else {
      const blob = new Blob([svgText], { type:'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement('a'), { href:url, download:'palette-mapper.svg' });
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    }
    info('SVG exported.');
  } catch (e) {
    console.warn(e); info('SVG export failed.');
  }
}

async function exportReport() {
  if (!Report?.buildPrinterReport) { info('Report module not available.'); return; }

  try {
    // if your report builder relies on PMS json, load once:
    if (Report?.loadPmsJson && !exportReport._pmsLoaded) {
      exportReport._pmsLoaded = true;
      try { await Report.loadPmsJson('./assets/pms_solid_coated.json'); } catch {}
    }
    const txt = Report.buildPrinterReport(); // uses repo’s internal state logic
    if (Files?.saveText) {
      await Files.saveText(txt, 'palette-report.txt', 'text/plain');
    } else {
      const blob = new Blob([txt], { type:'text/plain' });
      const url  = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement('a'), { href:url, download:'palette-report.txt' });
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    }
    info('Report exported.');
  } catch (e) {
    console.warn(e); info('Report failed.');
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
    console.warn(e); info('Could not refresh projects.');
  }
}

function renderProjectsList() {
  if (!els.projectsList) return;
  els.projectsList.innerHTML = '';
  state.projects.forEach(p => {
    const b = document.createElement('button');
    b.className = 'btn btn-ghost';
    b.textContent = p.name || p.id;
    b.addEventListener('click', async () => {
      try {
        const data = await Store?.load?.(p.id);
        if (!data) return;
        hydrateFromProject(data);
        renderAll();
        showToast(`Loaded project: ${p.name || p.id}`);
      } catch (e) {
        console.warn(e); info('Load failed.');
      }
    });
    els.projectsList.append(b);
  });
}

async function saveProject() {
  try {
    const payload = serializeProject();
    const saved   = await Store?.save?.(payload);
    if (saved) showToast('Project saved.');
  } catch (e) {
    console.warn(e); info('Save failed.');
  }
}

async function exportProjectJson() {
  try {
    const json = JSON.stringify(serializeProject(), null, 2);
    if (Files?.saveText) {
      await Files.saveText(json, 'palette-project.json', 'application/json');
    } else {
      const blob = new Blob([json], { type:'application/json' });
      const url  = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement('a'), { href:url, download:'palette-project.json' });
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    }
    showToast('Project JSON exported.');
  } catch (e) {
    console.warn(e); info('Export failed.');
  }
}

async function importProjectJson(e) {
  const file = e.target.files?.[0]; if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    hydrateFromProject(data);
    renderAll();
    showToast('Project imported.');
  } catch (err) {
    console.warn(err); info('Import failed.');
  } finally {
    e.target.value = '';
  }
}

async function deleteSelectedProject() {
  try {
    const list = await Store?.list?.();
    const first = list?.[0];
    if (!first?.id) { info('No project to delete.'); return; }
    await Store?.remove?.(first.id);
    showToast(`Deleted project ${first.name || first.id}.`);
    refreshProjects();
  } catch (e) {
    console.warn(e); info('Delete failed.');
  }
}

function serializeProject() {
  return {
    palette: state.palette,
    restricted: [...state.restricted],
    rules: state.rules,
    weights: {
      chroma: (els.wChroma?.value|0 || 100)/100,
      luma:   (els.wLight ?.value|0 || 100)/100,
    }
  };
}

function hydrateFromProject(data) {
  if (Array.isArray(data.palette)) {
    state.palette = data.palette.map(p => ({
      r: p.r|0, g: p.g|0, b: p.b|0, tol: (p.tol ?? DEFAULT_TOL)|0
    }));
  }
  if (Array.isArray(data.restricted)) {
    state.restricted = new Set(data.restricted.map(i => i|0));
  }
  if (Array.isArray(data.rules)) {
    state.rules = data.rules;
  }
}

// -----------------------------------------------------------------------------
// Persistence
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
    localStorage.setItem(state.key, JSON.stringify(serializeProject()));
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
    const { r, g, b } = hexToRgb(h) || { r:255, g:255, b:255 };
    return { r, g, b, tol: DEFAULT_TOL };
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
    img.onerror = () => { URL.revokeObjectURL(url); info('Could not load image.'); };
    img.src = url;
  } catch (e) {
    URL.revokeObjectURL(url);
    console.warn(e); info('Could not load image.');
  }
}

function drawToCanvas(img, canvas, maxW = 1400) {
  if (!canvas) return;
  const w = img.naturalWidth, h = img.naturalHeight;
  const scale = Math.min(1, maxW>0 ? maxW/w : 1);
  const dw = Math.max(1, Math.round(w*scale));
  const dh = Math.max(1, Math.round(h*scale));
  canvas.width = dw; canvas.height = dh;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.clearRect(0,0,dw,dh);
  ctx.drawImage(img,0,0,dw,dh);
}

function clearCanvas(canvas) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0,0,canvas.width,canvas.height);
  canvas.width = 1; canvas.height = 1;
}

function getExportImageData() {
  const c = els.outCanvas && els.outCanvas.width > 1 ? els.outCanvas : els.srcCanvas;
  if (!c) return null;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  return ctx.getImageData(0, 0, c.width, c.height);
}

function formatColor(hex, mode) {
  if (mode === 'hex') return hex.toUpperCase();
  // If your report module provides a PMS converter, use it; else fallback:
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
// End
// -----------------------------------------------------------------------------
