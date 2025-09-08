// js/app.js
// App orchestrator — wires UI, state, and events (incl. editable color dots)

import { renderRestrictedFromPalette, getRestrictedInkIndices } from './ui/controls.js';

// If you already have color utils elsewhere (e.g., ./color/space.js), import them.
// Otherwise these safe fallbacks will be used.
let hexToRgb, rgbToHex;
try {
  const space = await import('./color/space.js');
  hexToRgb = space.hexToRgb;
  rgbToHex = space.rgbToHex;
} catch (e) {
  // Fallback tiny utils
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  hexToRgb = (hx) => {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec((hx||'').trim());
    if (!m) return null;
    return { r: parseInt(m[1],16), g: parseInt(m[2],16), b: parseInt(m[3],16) };
  };
  rgbToHex = (r,g,b) => '#' + [r,g,b].map(v => clamp(v|0,0,255).toString(16).padStart(2,'0')).join('');
}

// ---------- DOM ----------
const els = {
  // Restricted palette container (UL/OL/DIV) where items render
  restrictedList: document.querySelector('#restrictedList'),

  // Optional: buttons/inputs you might have
  btnSave: document.querySelector('#btnSave'),
  btnReset: document.querySelector('#btnReset'),
  codeList: document.querySelector('#codeList'),           // e.g., <pre id="codeList">
  hexTextarea: document.querySelector('#hexTextarea'),     // optional bulk editor
  status: document.querySelector('#status'),
};

// ---------- App State ----------
const DEFAULT_HEXES = ['#CE6D01', '#8B3400', '#F23300', '#0CB300', '#FFFFFF'];
const DEFAULT_TOL = 64;

const state = {
  // palette: [{r,g,b,tol}, ...]
  palette: [],
  // indices included as "restricted inks"
  restricted: new Set(),
  // localStorage key
  key: 'limited-palette-designer:v1',
};

// ---------- Init ----------
init();

function init() {
  loadPrefs();

  // If empty (first run), seed from defaults
  if (!state.palette?.length) {
    state.palette = DEFAULT_HEXES.map(h => {
      const rgb = hexToRgb(h) || { r:255, g:255, b:255 };
      return { ...rgb, tol: DEFAULT_TOL };
    });
    state.restricted = new Set(state.palette.map((_, i) => i)); // all enabled by default
  }

  renderAll();
  wireEvents();
  info('Ready');
}

// ---------- Render ----------
function renderAll() {
  const hexes = state.palette.map(p => rgbToHex(p.r, p.g, p.b));

  // Render Restricted Palette list with editable dots
  renderRestrictedFromPalette(els, hexes, state.restricted);

  // Optional: show a code export
  renderCodeList();

  // Optional: sync a bulk hex textarea if you use one
  if (els.hexTextarea) {
    els.hexTextarea.value = hexes.join('\n');
  }
}

function renderCodeList() {
  if (!els.codeList) return;
  const hexes = state.palette.map(p => rgbToHex(p.r, p.g, p.b));
  const indices = [...state.restricted].sort((a,b)=>a-b);
  const active = indices.map(i => hexes[i]);

  // Just a simple preview of active inks. Adjust to your preferred format.
  const lines = [
    '// Restricted Inks (active):',
    ...active.map((hx, idx) => `Ink ${idx+1}: ${hx}`),
    '',
    '// Full Palette (with tolerance):',
    ...state.palette.map((p, i) => `#${String(i).padStart(2,'0')} ${rgbToHex(p.r,p.g,p.b)}  tol=${p.tol}`)
  ].join('\n');

  els.codeList.textContent = lines;
}

// ---------- Events ----------
function wireEvents() {
  // 1) Color dot edits from Restricted Palette
  els.restrictedList?.addEventListener('restricted:coloredit', (e) => {
    const { index, hex } = e.detail || {};
    if (index == null || !hex) return;
    const rgb = hexToRgb(hex);
    if (!rgb) return;

    const prev = state.palette[index] || { tol: DEFAULT_TOL };
    state.palette[index] = { r: rgb.r, g: rgb.g, b: rgb.b, tol: prev.tol ?? DEFAULT_TOL };

    // Re-render UI that depends on palette
    renderAll();
    persistPrefs();
    info(`Updated color ${index+1} → ${hex.toUpperCase()}`);
  });

  // 2) Checkbox toggles (include/exclude inks)
  els.restrictedList?.addEventListener('restricted:toggle', () => {
    // recompute restricted set from current DOM
    const indices = getRestrictedInkIndices({ restrictedList: els.restrictedList });
    state.restricted = new Set(indices);
    renderCodeList();
    persistPrefs();
    info('Updated restricted inks');
  });

  // 3) Optional: bulk hex textarea import (one hex per line)
  els.hexTextarea?.addEventListener('change', () => {
    const lines = els.hexTextarea.value
      .split(/\r?\n/)
      .map(s => s.trim())
      .filter(Boolean);

    if (!lines.length) return;

    state.palette = lines.map(h => {
      const rgb = hexToRgb(h) || { r:255, g:255, b:255 };
      return { ...rgb, tol: DEFAULT_TOL };
    });
    // Reset restricted to all
    state.restricted = new Set(state.palette.map((_, i) => i));

    renderAll();
    persistPrefs();
    info('Imported palette from text');
  });

  // 4) Save / Reset buttons (optional)
  els.btnSave?.addEventListener('click', () => {
    persistPrefs();
    info('Saved');
  });

  els.btnReset?.addEventListener('click', () => {
    localStorage.removeItem(state.key);
    state.palette = DEFAULT_HEXES.map(h => {
      const rgb = hexToRgb(h) || { r:255, g:255, b:255 };
      return { ...rgb, tol: DEFAULT_TOL };
    });
    state.restricted = new Set(state.palette.map((_, i) => i));
    renderAll();
    info('Reset to defaults');
  });

  // 5) Window unload — persist quietly
  window.addEventListener('beforeunload', persistPrefs);
}

// ---------- Persistence ----------
function loadPrefs() {
  try {
    const raw = localStorage.getItem(state.key);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (Array.isArray(data.palette)) {
      state.palette = data.palette.map(p => ({
        r: p.r|0, g: p.g|0, b: p.b|0, tol: (p.tol ?? DEFAULT_TOL)|0
      }));
    }
    if (Array.isArray(data.restricted)) {
      state.restricted = new Set(data.restricted.map(i => i|0));
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
  const hh = String(now.getHours()).padStart(2,'0');
  const mm = String(now.getMinutes()).padStart(2,'0');
  els.status.textContent = `[${hh}:${mm}] ${msg}`;
}

// ---------- Export hooks (optional) ----------
/**
 * If other modules need access (e.g., canvas mapper),
 * you can export selected pieces here.
 */
export function getActiveRestrictedHexes() {
  const indices = [...state.restricted].sort((a,b)=>a-b);
  return indices.map(i => rgbToHex(state.palette[i].r, state.palette[i].g, state.palette[i].b));
}
export function setToleranceAt(index, tol) {
  if (!state.palette[index]) return;
  state.palette[index].tol = Math.max(0, Math.min(255, tol|0));
  persistPrefs();
  renderCodeList();
}
export function getState() { return state; }
