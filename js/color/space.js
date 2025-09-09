// js/color/space.js
import { clamp } from '../utils/canvas.js';

// ---------- HEX <-> RGB ----------
export const hexToRgb = (hex) => {
  let h = String(hex || '').trim();
  if (!h) return null;
  if (!h.startsWith('#')) h = '#' + h;
  const m = /^#([0-9a-fA-F]{6})$/i.exec(h);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
};

export const rgbToHex = (r, g, b) =>
  '#' + [r, g, b].map(v => clamp(v, 0, 255)).map(v => Math.round(v).toString(16).padStart(2, '0')).join('');

// ---------- RGB <-> HSL ----------
export function rgbToHsl(r, g, b) {
  r = clamp(r, 0, 255) / 255;
  g = clamp(g, 0, 255) / 255;
  b = clamp(b, 0, 255) / 255;

  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return { h: h * 360, s, l };
}

export function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360; // normalize
  s = clamp(s, 0, 1);
  l = clamp(l, 0, 1);
  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r1 = 0, g1 = 0, b1 = 0;
  if (0 <= hp && hp < 1)       { r1 = c; g1 = x; b1 = 0; }
  else if (1 <= hp && hp < 2)  { r1 = x; g1 = c; b1 = 0; }
  else if (2 <= hp && hp < 3)  { r1 = 0; g1 = c; b1 = x; }
  else if (3 <= hp && hp < 4)  { r1 = 0; g1 = x; b1 = c; }
  else if (4 <= hp && hp < 5)  { r1 = x; g1 = 0; b1 = c; }
  else                         { r1 = c; g1 = 0; b1 = x; }
  const m = l - c / 2;
  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255)
  };
}

// ---------- RGB -> Lab (D65) & ΔE ----------
function srgbToLinear(u) {
  u /= 255;
  return (u <= 0.04045) ? (u / 12.92) : Math.pow((u + 0.055) / 1.055, 2.4);
}

function rgbToXyz(r, g, b) {
  const rl = srgbToLinear(r), gl = srgbToLinear(g), bl = srgbToLinear(b);
  // sRGB D65 matrix
  return [
    rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375,
    rl * 0.2126729 + gl * 0.7151522 + bl * 0.0721750,
    rl * 0.0193339 + gl * 0.1191920 + bl * 0.9503041
  ];
}

function xyzToLab(x, y, z) {
  // D65 reference white
  const Xn = 0.95047, Yn = 1.00000, Zn = 1.08883;
  x /= Xn; y /= Yn; z /= Zn;
  const f = t => (t > 0.008856) ? Math.cbrt(t) : (7.787 * t + 16 / 116);
  const fx = f(x), fy = f(y), fz = f(z);
  const L = 116 * fy - 16;
  const a = 500 * (fx - fy);
  const b = 200 * (fy - fz);
  return [L, a, b];
}

export function rgbToLab(r, g, b) {
  const [x, y, z] = rgbToXyz(r, g, b);
  return xyzToLab(x, y, z);
}

// CIEDE2000-ish fast ΔE (matches your previous usage)
export const deltaE2Weighted = (l1, a1, b1, l2, a2, b2) => {
  const dL = l1 - l2;
  const dA = a1 - a2;
  const dB = b1 - b2;
  return Math.sqrt(dL * dL + (dA * dA) + (dB * dB));
};
