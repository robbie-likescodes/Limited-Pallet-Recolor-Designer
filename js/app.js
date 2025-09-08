// js/app.js
// Orchestrates UI wiring, state, and events (incl. editable color dots)

import { renderRestrictedFromPalette, getRestrictedInkIndices } from './ui/controls.js';
import { hexToRgb, rgbToHex } from './color/space.js'; // ✅ static import (no top-level await)

// ---------- DOM ----------
const $ = (sel) => document.querySelector(sel);
const els = {
  // Header / Projects
  openProjects: $('#openProjects'),
  projectsPane: $('#projectsPane'),
  closeProjects: $('#closeProjects'),
  projectsList: $('#projectsList'),
  refreshProjects: $('#refreshProjects'),
  saveProject: $('#saveProject'),
  exportProject: $('#exportProject'),
  importProject: $('#importProject'),
  deleteProject: $('#deleteProject'),

  // Image inputs
  fileInput: $('#fileInput'),
  cameraInput: $('#cameraInput'),
  pasteBtn: $('#pasteBtn'),
  resetBtn: $('#resetBtn'),
  maxW: $('#maxW'),
  keepFullRes: $('#keepFullRes'),
  sharpenEdges: $('#sharpenEdges'),

  // Canvases
  srcCanvas: $('#srcCanvas'),
  outCanvas: $('#outCanvas'),

  // Palette controls
  kColors: $('#kColors'),
  autoExtract: $('#autoExtract'),

  // Restricted Palette
  restrictedList: $('#restrictedList'),
  restrictedSelectAll: $('#restrictedSelectAll'),
  restrictedSelectNone: $('#restrictedSelectNone'),
  allowWhite: $('#allowWhite'),

  // Suggestions / Rules
  btnSuggestHueLuma: $('#btnSuggestHueLuma'),
  btnSmartMix: $('#btnSmartMix'),
  addRule: $('#addRule'),
  btnRefreshOutput: $('#btnRefreshOutput'),
  rulesTable: $('#rulesTable'),

  // Map & Preview
  wChroma: $('#wChroma'),
  wChromaOut: $('#wChromaOut'),
  wLight: $('#wLight'),
  wLightOut: $('#wLightOut'),
  useDither: $('#useDither'),
  bgMode: $('#bgMode'),
  applyBtn: $('#applyBtn'),
  bigRegen: $('#bigRegen'),

  // Export & Codes
  exportScale: $('#exportScale'),
  downloadBtn: $('#downloadBtn'),
  vectorExport: $('#vectorExport'),
  colorCodeMode: $('#colorCodeMode'),
  mailtoLink: $('#mailtoLink'),
  exportReport: $('#exportReport'),
  codeList: $('#codeList'),

  // Misc
  status: $('#status'),
  toasts: $('#toasts'),

  // Optional editor overlay (kept inert unless you wire modules)
  editorOverlay: $('#editorOverlay'),
  openEditor: $('#openEditor'),
  editorDone: $('#editorDone'),
  editCanvas: $('#editCanvas'),
  editOverlay: $('#editOverlay'),
};

// ---------- App State ----------
const DEFAULT_HEXES = ['#CE6D01', '#8B3400', '#F23300', '#0CB300', '#FFFFFF'];
const DEFAULT_TOL = 64;

const state = {
  // [{r,g,b,tol}, ...]
  palette: [],
  // selected indices for restricted inks
  restricted: new Set(),
  // image data
  srcImage: null,
  key: 'limited-palette-designer:v1',
};

// ---------- Init ----------
init();

function init() {
  loadPrefs();

  if (!state.palette?.length) {
    state.palette = DEFAULT_HEXES.map(h => {
      const rgb = hexToRgb(h) || { r: 255, g: 255, b: 255 };
      return { ...rgb, tol: DEFAULT_TOL };
    });
    state.restricted = new Set(state.palette.map((_, i) => i));
  }

  renderAll();
  wireEvents();
  info('Ready');
}

// ---------- Render ----------
function renderAll() {
  renderRestrictedPaletteUI();
  renderCodeList();
  syncWeightsUI();
  updateButtonsEnabled();
}

function renderRestrictedPaletteUI() {
  const hexes = state.palette.map(p => rgbToHex(p.r, p.g, p.b));
  renderRestrictedFromPalette(els, hexes, state.restricted);
}

function renderCodeList() {
  if (!els.codeList) return;
  const hexes = state.palette.map(p => rgbToHex(p.r, p.g, p.b));
  const indices = [...state.restricted].sort((a, b) => a - b);
  const active = indices.map(i => hexes[i]);

  const lines = [
    '// Restricted Inks (active):',
    ...active.map((hx, idx) => `Ink ${idx + 1}: ${hx}`),
    '',
    '// Full Palette (with tolerance):',
    ...state.palette.map((p, i) => `#${String(i).padStart(2, '0')} ${rgbToHex(p.r, p.g, p.b)}  tol=${p.tol}`)
  ].join('\n');

  els.codeList.textContent = lines;
}

function syncWeightsUI() {
  if (els.wChroma && els.wChromaOut) {
    els.wChromaOut.textContent = (Number(els.wChroma.value || 100) / 100).toFixed(2) + '×';
  }
  if (els.wLight && els.wLightOut) {
    els.wLightOut.textContent = (Number(els.wLight.value || 100) / 100).toFixed(2) + '×';
  }
}

function updateButtonsEnabled() {
  const hasImage = !!state.srcImage;
  if (els.resetBtn) els.resetBtn.disabled = !hasImage;
  if (els.autoExtract) els.autoExtract.disabled = !hasImage;
  if (els.applyBtn) els.applyBtn.disabled = !hasImage;
  if (els.downloadBtn) els.downloadBtn.disabled = !hasImage;
  if (els.vectorExport) els.vectorExport.disabled = !hasImage;
}

// ---------- Events ----------
function wireEvents() {
  // Color dot edits in Restricted list
  els.restrictedList?.addEventListener('restricted:coloredit', (e) => {
    const { index, hex } = e.detail || {};
    if (index == null || !hex) return;
    const rgb = hexToRgb(hex);
    if (!rgb) return;
    const prev = state.palette[index] || { tol: DEFAULT_TOL };
    state.palette[index] = { r: rgb.r, g: rgb.g, b: rgb.b, tol: prev.tol ?? DEFAULT_TOL };
    renderAll();
    persistPrefs();
    info(`Updated color ${index + 1} → ${hex.toUpperCase()}`);
  });

  // Restricted checkboxes
  els.restrictedList?.addEventListener('restricted:toggle', () => {
    const indices = getRestrictedInkIndices({ restrictedList: els.restrictedList });
    state.restricted = new Set(indices);
    renderCodeList();
    persistPrefs();
    info('Updated restricted inks');
  });

  // File inputs
  els.fileInput?.addEventListener('change', handleFile);
  els.cameraInput?.addEventListener('change', handleFile);

  // Paste image
  els.pasteBtn?.addEventListener('click', async () => {
    try {
      const clipboardItems = await navigator.clipboard.read();
      for (const item of clipboardItems) {
        for (const type of item.types) {
          if (type.startsWith('image/')) {
            const blob = await item.getType(type);
            await loadBlobToCanvas(blob, els.srcCanvas);
            state.srcImage = true;
            renderAll();
            info('Image pasted.');
            return;
          }
        }
      }
      info('No image data on clipboard.');
    } catch (e) {
      console.warn(e);
      info('Clipboard paste not available.');
    }
  });

  // Reset
  els.resetBtn?.addEventListener('click', () => {
    if (els.srcCanvas) clearCanvas(els.srcCanvas);
    if (els.outCanvas) clearCanvas(els.outCanvas);
    state.srcImage = null;
    renderAll();
    info('Reset.');
  });

  // Sliders
  els.wChroma?.addEventListener('input', syncWeightsUI);
  els.wLight?.addEventListener('input', syncWeightsUI);

  // Projects drawer (basic toggle)
  els.openProjects?.addEventListener('click', () => {
    els.projectsPane?.classList.add('open');
  });
  els.closeProjects?.addEventListener('click', () => {
    els.projectsPane?.classList.remove('open');
  });

  // Prevent unload loss
  window.addEventListener('beforeunload', persistPrefs);
}

// ---------- Image helpers ----------
async function handleFile(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  await loadBlobToCanvas(file, els.srcCanvas);
  state.srcImage = true;
  renderAll();
  info(`Loaded ${file.name}`);
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
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  canvas.width = 1; canvas.height = 1;
}

// ---------- Persistence ----------
function loadPrefs() {
  try {
    const raw = localStorage.getItem(state.key);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (Array.isArray(data.palette)) {
      state.palette = data.palette.map(p => ({
        r: p.r | 0, g: p.g | 0, b: p.b | 0, tol: (p.tol ?? DEFAULT_TOL) | 0
      }));
    }
    if (Array.isArray(data.restricted)) {
      state.restricted = new Set(data.restricted.map(i => i | 0));
    }
  } catch (e) {
    console.warn('Prefs load failed:', e);
  }
}

function persistPrefs() {
  try {
    const payload = {
      palette: state.palette,
      restricted: [...state.restricted],
    };
    localStorage.setItem(state.key, JSON.stringify(payload));
  } catch (e) {
    console.warn('Prefs save failed:', e);
  }
}

// ---------- Utilities ----------
function info(msg) {
  if (!els.status) return;
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  els.status.textContent = `[${hh}:${mm}] ${msg}`;
}

// Public helpers (if needed elsewhere)
export function getActiveRestrictedHexes() {
  const indices = [...state.restricted].sort((a, b) => a - b);
  return indices.map(i => rgbToHex(state.palette[i].r, state.palette[i].g, state.palette[i].b));
}
export function setToleranceAt(index, tol) {
  if (!state.palette[index]) return;
  state.palette[index].tol = Math.max(0, Math.min(255, tol | 0));
  persistPrefs();
  renderCodeList();
}
export function getState() { return state; }
