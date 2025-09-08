// js/ui/controls.js
// Renders palette-related UI controls (Restricted Palette list, etc.)
// Adds editable color "dots" so users can click any color and adjust it.
//
// Events emitted on els.restrictedList:
//  - 'restricted:coloredit'  { index, hex }      when a dot is edited
//  - 'restricted:toggle'     { index, checked }  when a checkbox is toggled

import { createColorDot } from './color-dot.js';

// --- small helpers ---
const normHex = (hx) => {
  if (!hx) return '#000000';
  let s = hx.trim();
  if (!s.startsWith('#')) s = '#' + s;
  if (s.length === 4) {
    // #rgb -> #rrggbb
    const r = s[1], g = s[2], b = s[3];
    s = `#${r}${r}${g}${g}${b}${b}`;
  }
  return s.slice(0, 7).toUpperCase();
};

/**
 * Render the Restricted Palette list with checkboxes and editable color dots.
 * @param {Object} els - Expected: { restrictedList: HTMLElement }
 * @param {string[]} hexes - Array of HEX strings (e.g., "#FFAA00")
 * @param {Set<number>} selectedIdxSet - which indices are currently "enabled"
 */
export function renderRestrictedFromPalette(els, hexes, selectedIdxSet = new Set()) {
  if (!els?.restrictedList) return;
  const host = els.restrictedList;
  host.innerHTML = '';

  hexes.forEach((hx, i) => {
    const hex = normHex(hx);

    // Container
    const row = document.createElement('label');
    row.className = 'rp-item';
    row.dataset.index = String(i);

    // Checkbox to include/exclude ink
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'rp-check';
    box.dataset.idx = String(i);
    if (selectedIdxSet.has(i)) box.checked = true;

    // Editable color dot (popover with sliders/native color input)
    const dot = createColorDot({
      hex,
      size: 18,
      ariaLabel: `Edit color ${hex}`,
      onChange: (newHex) => {
        const clean = normHex(newHex);
        // Update inline label immediately
        hexLabel.textContent = clean;
        // Notify app.js (or whoever listens) so state can be updated
        host.dispatchEvent(new CustomEvent('restricted:coloredit', {
          detail: { index: i, hex: clean },
          bubbles: true
        }));
      }
    });

    // (Optional) legacy chip kept for layout (now visually inert)
    const chip = document.createElement('span');
    chip.className = 'chip';

    // Monospace hex label
    const hexLabel = document.createElement('span');
    hexLabel.className = 'mono';
    hexLabel.textContent = hex;

    // Wire checkbox toggle -> event
    box.addEventListener('change', () => {
      host.dispatchEvent(new CustomEvent('restricted:toggle', {
        detail: { index: i, checked: box.checked },
        bubbles: true
      }));
    });

    row.appendChild(box);
    row.appendChild(dot);
    row.appendChild(chip);
    row.appendChild(hexLabel);
    host.appendChild(row);
  });
}

/**
 * Return indices of restricted inks currently checked.
 * @param {Object} els - Expected: { restrictedList: HTMLElement }
 * @returns {number[]}
 */
export function getRestrictedInkIndices(els) {
  const list = els?.restrictedList;
  if (!list) return [];
  const checks = Array.from(list.querySelectorAll('input.rp-check'));
  return checks.filter(c => c.checked).map(c => parseInt(c.dataset.idx, 10));
}
