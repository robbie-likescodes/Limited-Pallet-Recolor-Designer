export function exportFullPNG(fullImageData, filename='mapped_fullres.png'){
  if(!fullImageData){ alert('Nothing to export yet.'); return; }
  const c=document.createElement('canvas'); c.width=fullImageData.width; c.height=fullImageData.height;
  const cx=c.getContext('2d',{willReadFrequently:true}); cx.imageSmoothingEnabled=false;
  cx.putImageData(fullImageData,0,0);
  c.toBlob(blob=>{
    const a=document.createElement('a'); a.download=filename; a.href=URL.createObjectURL(blob); a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href),1500);
  },'image/png');
}

