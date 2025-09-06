// ui/controls.js
// Renders Restricted Palette from a HEX list and provides helpers

export function renderRestrictedFromPalette(els, hexes, selectedIdxSet = new Set()) {
  if (!els?.restrictedList) return;
  const host = els.restrictedList;
  host.innerHTML = '';

  hexes.forEach((hx, i) => {
    const lab = document.createElement('label');
    lab.className = 'rp-item';
    lab.innerHTML = `
      <input type="checkbox" data-idx="${i}" ${selectedIdxSet.has(i) ? 'checked' : ''}>
      <span class="chip" style="background:${hx}"></span>
      <span class="mono">${hx}</span>
    `;
    host.appendChild(lab);
  });
}

export function getRestrictedInkIndices(els) {
  const checks = [...els?.restrictedList?.querySelectorAll('input[type=checkbox]') || []];
  return checks.filter(c => c.checked).map(c => parseInt(c.dataset.idx, 10));
}
