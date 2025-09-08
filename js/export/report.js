// js/export/report.js — PMS loader + reporting helpers (compat-safe)

import { State } from '../state.js';
import { rgbToHex, hexToRgb, rgbToLab, deltaE2Weighted } from '../color/space.js';

/** Load PMS JSON into State.PMS once (array of {name, hex}) */
export async function loadPmsJson(url) {
  if (State.PMS && State.PMS.length) return State.PMS;
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error('Failed to load PMS JSON: ' + res.status);
  const list = await res.json();
  // Normalize: ensure {name, hex} and uppercase hex
  State.PMS = (Array.isArray(list) ? list : []).map(x => ({
    name: String(x.name || 'PMS'),
    hex:  String(x.hex || '#000000').toUpperCase()
  }));
  State.PMSCache = new Map();
  return State.PMS;
}

/** Find nearest PMS entry to a given HEX (returns {name, hex, dE}) */
export function nearestPms(hex) {
  if (!hex) return { name: '—', hex: '#000000', dE: 0 };
  const key = String(hex).toUpperCase();
  if (State.PMSCache && State.PMSCache.has(key)) return State.PMSCache.get(key);

  const rgb = hexToRgb(key);
  if (!rgb) return { name: '—', hex: '#000000', dE: 0 };
  const lab = rgbToLab(rgb.r, rgb.g, rgb.b);

  let best = null;
  for (let i = 0; i < (State.PMS ? State.PMS.length : 0); i++) {
    const p = State.PMS[i];
    const prgb = hexToRgb(p.hex);
    if (!prgb) continue;
    const plab = rgbToLab(prgb.r, prgb.g, prgb.b);
    const dE = deltaE2Weighted(lab, plab, 1, 1);
    if (!best || dE < best.dE) best = { name: p.name, hex: p.hex, dE };
  }
  if (!best) best = { name: '—', hex: '#000000', dE: 0 };
  if (State.PMSCache) State.PMSCache.set(key, best);
  return best;
}

/** Build a printable report string of the final inks currently selected */
export function buildPrinterReport() {
  // Final inks: restricted palette + inks referenced by replacement mixes
  const used = new Set();
  (State.restrictedPalette || []).forEach(rgb => used.add(rgb.join(',')));
  (State.replacements || new Map()).forEach(mix => {
    (mix || []).forEach(m => {
      const ink = (State.restrictedPalette && State.restrictedPalette[m.inkIndex]) || null;
      if (ink) used.add(ink.join(','));
    });
  });

  const finalHexes = Array.from(used).map(k => {
    const parts = k.split(',').map(n => parseInt(n, 10));
    return rgbToHex(parts[0], parts[1], parts[2]);
  });

  const lines = [];
  lines.push('Final inks (after replacements):');
  finalHexes.forEach((hx, i) => {
    if (State.codeMode === 'pms') {
      const p = nearestPms(hx);
      lines.push((i + 1) + '. ' + p.name + ' (' + p.hex + ')');
    } else {
      lines.push((i + 1) + '. ' + hx);
    }
  });
  return lines.join('\n');
}

