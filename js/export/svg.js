// export/svg.js
export function exportSVG(imageData, paletteHex, numberOfColors, filename='mapped.svg'){
  if(!window.ImageTracer){ alert("Vectorizer not loaded. Include js/imagetracer-loader.js"); return; }
  const c=document.createElement('canvas');
  c.width=imageData.width; c.height=imageData.height;
  c.getContext('2d').putImageData(imageData,0,0);

  const opts = {
    pal: paletteHex,
    numberofcolors: Math.min(16, numberOfColors),
    strokewidth: 0,
    roundcoords: 1,
    ltres: 1, qtres: 1,
    pathomit: 0
  };
  const svgstr = ImageTracer.imagedataToSVG(c.getContext('2d').getImageData(0,0,c.width,c.height), opts);
  const blob = new Blob([svgstr],{type:'image/svg+xml'});
  const a=document.createElement('a');
  a.download=filename; a.href=URL.createObjectURL(blob); a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1500);
}
