// export/png.js
export function exportPNG(imageData, scale=1, filename='mapped_fullres.png'){
  const src=imageData;
  const c=document.createElement('canvas');
  c.width=src.width*scale; c.height=src.height*scale;
  const cx=c.getContext('2d',{willReadFrequently:true}); cx.imageSmoothingEnabled=false;

  const tmp=document.createElement('canvas');
  tmp.width=src.width; tmp.height=src.height;
  tmp.getContext('2d').putImageData(src,0,0);
  cx.drawImage(tmp, 0,0,c.width,c.height);

  c.toBlob(blob=>{
    const a=document.createElement('a');
    a.download=filename; a.href=URL.createObjectURL(blob); a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href),1500);
  }, 'image/png');
}
