// export/svg.js
// Simple "pixel rectangles" SVG (heavy for big images but proves the button works).
// For production, swap to ImageTracer flow.

export function exportSVG(imageData, paletteHex, maxColors) {
  const w = imageData.width, h = imageData.height, d = imageData.data;
  let out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`];

  for (let y = 0; y < h; y++) {
    let row = '';
    for (let x = 0; x < w; x++) {
      const i = (y*w + x) * 4;
      const a = d[i+3];
      if (a === 0) continue;
      const hex = `#${d[i].toString(16).padStart(2,'0')}${d[i+1].toString(16).padStart(2,'0')}${d[i+2].toString(16).padStart(2,'0')}`.toUpperCase();
      row += `<rect x="${x}" y="${y}" width="1" height="1" fill="${hex}"/>`;
    }
    if (row) out.push(row);
  }
  out.push('</svg>');

  const blob = new Blob([out.join('')], { type: 'image/svg+xml' });
  const a = document.createElement('a');
  a.download = 'palette-mapped.svg';
  a.href = URL.createObjectURL(blob);
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 1500);
}
